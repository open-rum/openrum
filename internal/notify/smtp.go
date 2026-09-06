package notify

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	To       []string
}

type SMTPDelivery interface {
	Deliver(context.Context, SMTPConfig, []byte) error
}

type SMTPNotifier struct {
	config   SMTPConfig
	delivery SMTPDelivery
	sleeper  Sleeper
}

func NewSMTPNotifier(config SMTPConfig, delivery SMTPDelivery) (*SMTPNotifier, error) {
	if !validSMTPConfig(config) {
		return nil, errors.New("invalid SMTP configuration")
	}
	if delivery == nil {
		delivery = smtpDelivery{}
	}
	return &SMTPNotifier{config: config, delivery: delivery}, nil
}

func (notifier *SMTPNotifier) Send(ctx context.Context, notification Notification) error {
	message, err := smtpMessage(notifier.config.From, notifier.config.To, notification)
	if err != nil {
		return err
	}
	return retry(ctx, notifier.sleeper, func() (bool, error) {
		err := notifier.delivery.Deliver(ctx, notifier.config, message)
		return err != nil, err
	})
}

func smtpMessage(from string, recipients []string, notification Notification) ([]byte, error) {
	if strings.ContainsAny(notification.Title, "\r\n") {
		return nil, errors.New("invalid notification title")
	}
	var builder strings.Builder
	builder.WriteString("From: " + from + "\r\n")
	builder.WriteString("To: " + strings.Join(recipients, ", ") + "\r\n")
	builder.WriteString("Subject: " + notification.Title + "\r\n")
	builder.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n")
	builder.WriteString(notification.Message)
	if notification.DeepLink != "" {
		builder.WriteString("\n\nOpen in OpenRUM: " + notification.DeepLink)
	}
	return []byte(builder.String()), nil
}

func validSMTPConfig(config SMTPConfig) bool {
	if config.Host == "" || strings.ContainsAny(config.Host, "\r\n") || config.Port < 1 || config.Port > 65535 || len(config.To) == 0 {
		return false
	}
	addresses := append([]string{config.From}, config.To...)
	for _, value := range addresses {
		address, err := mail.ParseAddress(value)
		if err != nil || address.Address != value || strings.ContainsAny(value, "\r\n") {
			return false
		}
	}
	return true
}

type smtpDelivery struct{}

func (smtpDelivery) Deliver(ctx context.Context, config SMTPConfig, message []byte) error {
	address := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	connection, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer func() { _ = connection.Close() }()
	client, err := smtp.NewClient(connection, config.Host)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	if ok, _ := client.Extension("STARTTLS"); !ok {
		return errors.New("SMTP server does not support required STARTTLS")
	}
	if err := client.StartTLS(&tls.Config{ServerName: config.Host, MinVersion: tls.VersionTLS12}); err != nil {
		return err
	}
	if config.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", config.Username, config.Password, config.Host)); err != nil {
			return err
		}
	}
	from, _ := mail.ParseAddress(config.From)
	if err := client.Mail(from.Address); err != nil {
		return err
	}
	for _, value := range config.To {
		recipient, _ := mail.ParseAddress(value)
		if err := client.Rcpt(recipient.Address); err != nil {
			return err
		}
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	buffered := bufio.NewWriter(writer)
	if _, err := buffered.Write(message); err != nil {
		_ = writer.Close()
		return err
	}
	if err := buffered.Flush(); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
