// Package mailer sends plain-text mail over SMTP. It holds the transport only: which settings
// apply (deployment or Console) and who gets mail is decided by the callers, so alerts,
// invitations and test messages share one tested path.
package mailer

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

type Security string

const (
	// SecurityStartTLS upgrades a plain connection with STARTTLS and refuses to continue without it.
	SecurityStartTLS Security = "starttls"
	// SecurityTLS wraps the connection in TLS from the first byte (SMTPS, usually port 465).
	SecurityTLS Security = "tls"
	// SecurityNone sends in the clear. It is for a trusted local relay and cannot carry credentials.
	SecurityNone Security = "none"
)

const operationTimeout = 20 * time.Second

// Settings describe one SMTP server. The JSON form is what the Console stores encrypted.
type Settings struct {
	Host     string   `json:"host"`
	Port     int      `json:"port"`
	Security Security `json:"security"`
	Username string   `json:"username,omitempty"`
	Password string   `json:"password,omitempty"`
	From     string   `json:"from"`
}

// Configured reports whether a server is named at all.
func (settings Settings) Configured() bool { return settings.Host != "" }

// DefaultPort is the conventional submission port for a security mode.
func DefaultPort(security Security) int {
	switch security {
	case SecurityTLS:
		return 465
	case SecurityNone:
		return 25
	default:
		return 587
	}
}

// Normalize trims input and fills the defaults that Validate would otherwise reject.
func (settings Settings) Normalize() Settings {
	settings.Host = strings.TrimSpace(settings.Host)
	settings.Username = strings.TrimSpace(settings.Username)
	settings.From = strings.TrimSpace(settings.From)
	settings.Security = Security(strings.ToLower(strings.TrimSpace(string(settings.Security))))
	if settings.Security == "" {
		settings.Security = SecurityStartTLS
	}
	if settings.Port == 0 {
		settings.Port = DefaultPort(settings.Security)
	}
	return settings
}

// Validate reports the first problem with normalized settings. Messages name the setting rather
// than its environment variable so both the Console and startup can show them.
func (settings Settings) Validate() error {
	if settings.Host == "" {
		return errors.New("host is required")
	}
	if len(settings.Host) > 253 || strings.ContainsAny(settings.Host, " \t\r\n/\\@?#") || strings.Contains(settings.Host, "://") {
		return errors.New("host must be a bare host name or address, without a scheme, path or credentials")
	}
	if settings.Port < 1 || settings.Port > 65535 {
		return errors.New("port must be between 1 and 65535")
	}
	switch settings.Security {
	case SecurityStartTLS, SecurityTLS, SecurityNone:
	default:
		return errors.New("security must be starttls, tls or none")
	}
	if _, err := parseAddress(settings.From); err != nil {
		return errors.New("from must be an address such as no-reply@example.com or OpenRUM <no-reply@example.com>")
	}
	if strings.ContainsAny(settings.Username, "\r\n") || strings.ContainsAny(settings.Password, "\r\n") {
		return errors.New("username and password must not contain line breaks")
	}
	if (settings.Username == "") != (settings.Password == "") {
		return errors.New("username and password must be set together")
	}
	if settings.Username != "" && settings.Security == SecurityNone {
		return errors.New("credentials require security starttls or tls; they would be sent in the clear")
	}
	return nil
}

func parseAddress(value string) (*mail.Address, error) {
	if value == "" || strings.ContainsAny(value, "\r\n") {
		return nil, errors.New("invalid address")
	}
	return mail.ParseAddress(value)
}

type Message struct {
	To      []string
	Subject string
	Body    string
}

// Stage names where an attempt stopped, so an administrator knows what to fix.
type Stage string

const (
	StageConnect   Stage = "connect"
	StageTLS       Stage = "tls"
	StageAuth      Stage = "auth"
	StageSender    Stage = "sender"
	StageRecipient Stage = "recipient"
	StageSend      Stage = "send"
)

// Error is a delivery failure with the stage it happened in. The message is safe to show to an
// administrator: it carries the server's own reply but never the settings.
type Error struct {
	Stage   Stage
	Message string
	err     error
}

func (failure *Error) Error() string { return string(failure.Stage) + ": " + failure.Message }
func (failure *Error) Unwrap() error { return failure.err }

func fail(stage Stage, err error) *Error {
	message := err.Error()
	var protocol *textproto.Error
	if errors.As(err, &protocol) {
		message = fmt.Sprintf("%d %s", protocol.Code, protocol.Msg)
	}
	if len(message) > 300 {
		message = message[:300]
	}
	return &Error{Stage: stage, Message: strings.TrimSpace(message), err: err}
}

// Sender delivers one message with the given settings.
type Sender interface {
	Send(context.Context, Settings, Message) error
	// Probe connects, secures the channel and authenticates, without sending mail.
	Probe(context.Context, Settings) error
}

// SMTPSender is the net/smtp implementation. RootCAs exists for tests; production uses the
// system roots.
type SMTPSender struct {
	RootCAs *x509.CertPool
}

func (sender SMTPSender) Send(ctx context.Context, settings Settings, message Message) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	raw, recipients, err := buildMessage(settings.From, message)
	if err != nil {
		return err
	}
	return sender.deliver(ctx, settings, func(client *smtp.Client) error {
		from, _ := parseAddress(settings.From)
		if err := client.Mail(from.Address); err != nil {
			return fail(StageSender, err)
		}
		for _, recipient := range recipients {
			if err := client.Rcpt(recipient); err != nil {
				return fail(StageRecipient, err)
			}
		}
		writer, err := client.Data()
		if err != nil {
			return fail(StageSend, err)
		}
		if _, err := writer.Write(raw); err != nil {
			_ = writer.Close()
			return fail(StageSend, err)
		}
		if err := writer.Close(); err != nil {
			return fail(StageSend, err)
		}
		return nil
	})
}

func (sender SMTPSender) Probe(ctx context.Context, settings Settings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	return sender.deliver(ctx, settings, func(client *smtp.Client) error { return nil })
}

func (sender SMTPSender) deliver(ctx context.Context, settings Settings, transaction func(*smtp.Client) error) error {
	ctx, cancel := context.WithTimeout(ctx, operationTimeout)
	defer cancel()
	tlsConfig := &tls.Config{ServerName: settings.Host, MinVersion: tls.VersionTLS12, RootCAs: sender.RootCAs}
	address := net.JoinHostPort(settings.Host, strconv.Itoa(settings.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var connection net.Conn
	var err error
	if settings.Security == SecurityTLS {
		connection, err = (&tls.Dialer{NetDialer: dialer, Config: tlsConfig}).DialContext(ctx, "tcp", address)
		if err != nil {
			return fail(StageTLS, err)
		}
	} else if connection, err = dialer.DialContext(ctx, "tcp", address); err != nil {
		return fail(StageConnect, err)
	}
	defer func() { _ = connection.Close() }()
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}
	client, err := smtp.NewClient(connection, settings.Host)
	if err != nil {
		return fail(StageConnect, err)
	}
	defer func() { _ = client.Close() }()
	if settings.Security == SecurityStartTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return &Error{Stage: StageTLS, Message: "the server does not offer STARTTLS; choose tls or none, or use another port"}
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			return fail(StageTLS, err)
		}
	}
	if settings.Username != "" {
		if err := client.Auth(authFor(client, settings)); err != nil {
			return fail(StageAuth, err)
		}
	}
	if err := transaction(client); err != nil {
		return err
	}
	if err := client.Quit(); err != nil {
		// The message is already accepted; a refused QUIT is not a delivery failure.
		return nil
	}
	return nil
}

// authFor prefers PLAIN and falls back to LOGIN for older servers that only offer it.
func authFor(client *smtp.Client, settings Settings) smtp.Auth {
	_, mechanisms := client.Extension("AUTH")
	fields := strings.Fields(strings.ToUpper(mechanisms))
	plain, login := false, false
	for _, field := range fields {
		plain = plain || field == "PLAIN"
		login = login || field == "LOGIN"
	}
	if login && !plain {
		return loginAuth{username: settings.Username, password: settings.Password}
	}
	return smtp.PlainAuth("", settings.Username, settings.Password, settings.Host)
}

type loginAuth struct{ username, password string }

func (auth loginAuth) Start(*smtp.ServerInfo) (string, []byte, error) { return "LOGIN", nil, nil }
func (auth loginAuth) Next(challenge []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(challenge))) {
	case "username:":
		return []byte(auth.username), nil
	case "password:":
		return []byte(auth.password), nil
	}
	return nil, errors.New("unexpected LOGIN challenge")
}

func buildMessage(from string, message Message) ([]byte, []string, error) {
	sender, err := parseAddress(from)
	if err != nil {
		return nil, nil, errors.New("invalid sender address")
	}
	if len(message.To) == 0 {
		return nil, nil, errors.New("at least one recipient is required")
	}
	recipients := make([]string, 0, len(message.To))
	for _, value := range message.To {
		address, err := parseAddress(value)
		if err != nil {
			return nil, nil, errors.New("invalid recipient address")
		}
		recipients = append(recipients, address.Address)
	}
	if message.Subject == "" || strings.ContainsAny(message.Subject, "\r\n") {
		return nil, nil, errors.New("invalid subject")
	}
	domain := "openrum.local"
	if at := strings.LastIndex(sender.Address, "@"); at >= 0 {
		domain = sender.Address[at+1:]
	}
	identifier := make([]byte, 12)
	if _, err := rand.Read(identifier); err != nil {
		return nil, nil, err
	}
	var buffer bytes.Buffer
	header := func(name, value string) { buffer.WriteString(name + ": " + value + "\r\n") }
	header("From", from)
	header("To", strings.Join(message.To, ", "))
	header("Subject", mime.QEncoding.Encode("utf-8", message.Subject))
	header("Date", time.Now().UTC().Format(time.RFC1123Z))
	header("Message-ID", "<"+hex.EncodeToString(identifier)+"@"+domain+">")
	header("MIME-Version", "1.0")
	header("Content-Type", "text/plain; charset=UTF-8")
	header("Content-Transfer-Encoding", "base64")
	buffer.WriteString("\r\n")
	encoded := base64.StdEncoding.EncodeToString([]byte(message.Body))
	for len(encoded) > 76 {
		buffer.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	buffer.WriteString(encoded + "\r\n")
	return buffer.Bytes(), recipients, nil
}
