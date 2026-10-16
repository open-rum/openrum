package mailer

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestValidate(t *testing.T) {
	valid := Settings{Host: "smtp.example.com", Port: 587, Security: SecurityStartTLS, From: "no-reply@example.com"}
	cases := []struct {
		name   string
		mutate func(*Settings)
		want   string
	}{
		{"valid", func(*Settings) {}, ""},
		{"display name", func(s *Settings) { s.From = "OpenRUM <no-reply@example.com>" }, ""},
		{"credentials", func(s *Settings) { s.Username, s.Password = "user", "secret" }, ""},
		{"no host", func(s *Settings) { s.Host = "" }, "host is required"},
		{"url host", func(s *Settings) { s.Host = "smtp://smtp.example.com" }, "bare host"},
		{"host with path", func(s *Settings) { s.Host = "smtp.example.com/x" }, "bare host"},
		{"port", func(s *Settings) { s.Port = 70000 }, "port"},
		{"security", func(s *Settings) { s.Security = "ssl" }, "security"},
		{"from", func(s *Settings) { s.From = "not an address" }, "from"},
		{"from injection", func(s *Settings) { s.From = "a@example.com\r\nBcc: b@example.com" }, "from"},
		{"user without password", func(s *Settings) { s.Username = "user" }, "together"},
		{"password without user", func(s *Settings) { s.Password = "secret" }, "together"},
		{"credentials in the clear", func(s *Settings) { s.Security, s.Username, s.Password = SecurityNone, "u", "p" }, "in the clear"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			settings := valid
			test.mutate(&settings)
			err := settings.Validate()
			if test.want == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if test.want != "" && (err == nil || !strings.Contains(err.Error(), test.want)) {
				t.Fatalf("error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestNormalizeAppliesDefaults(t *testing.T) {
	got := Settings{Host: " smtp.example.com ", From: " a@example.com "}.Normalize()
	if got.Security != SecurityStartTLS || got.Port != 587 || got.Host != "smtp.example.com" || got.From != "a@example.com" {
		t.Fatalf("normalized = %+v", got)
	}
	if got := (Settings{Security: "TLS"}).Normalize(); got.Security != SecurityTLS || got.Port != 465 {
		t.Fatalf("tls defaults = %+v", got)
	}
	if got := (Settings{Security: SecurityNone}).Normalize(); got.Port != 25 {
		t.Fatalf("none default port = %d", got.Port)
	}
}

func TestBuildMessageEncodesNonASCIIAndRejectsInjection(t *testing.T) {
	raw, recipients, err := buildMessage("OpenRUM <no-reply@example.com>", Message{
		To: []string{"Li <li@example.org>"}, Subject: "测试邮件", Body: "你好，OpenRUM",
	})
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "Subject: =?utf-8?q?") || strings.Contains(text, "测试") {
		t.Fatalf("subject not encoded: %s", text)
	}
	if !strings.Contains(text, "Message-ID: <") || !strings.Contains(text, "@example.com>") || !strings.Contains(text, "Date: ") {
		t.Fatalf("missing generated headers: %s", text)
	}
	if len(recipients) != 1 || recipients[0] != "li@example.org" {
		t.Fatalf("recipients = %v", recipients)
	}
	if _, _, err := buildMessage("a@example.com", Message{To: []string{"b@example.com"}, Subject: "hi\r\nBcc: x@example.com", Body: "x"}); err == nil {
		t.Fatal("subject with line break accepted")
	}
	if _, _, err := buildMessage("a@example.com", Message{To: []string{"b@example.com\r\nBcc: x@example.com"}, Subject: "hi", Body: "x"}); err == nil {
		t.Fatal("recipient with line break accepted")
	}
	if _, _, err := buildMessage("a@example.com", Message{Subject: "hi", Body: "x"}); err == nil {
		t.Fatal("message without recipients accepted")
	}
}

func TestSendPlainRelay(t *testing.T) {
	server := startServer(t, serverOptions{})
	err := SMTPSender{}.Send(context.Background(), server.settings(SecurityNone), Message{
		To: []string{"admin@example.org"}, Subject: "OpenRUM test", Body: "hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	got := server.received()
	if got.from != "no-reply@example.com" || len(got.to) != 1 || got.to[0] != "admin@example.org" {
		t.Fatalf("envelope = %+v", got)
	}
	if !strings.Contains(got.data, "Subject: OpenRUM test") {
		t.Fatalf("data = %q", got.data)
	}
}

func TestSendStartTLSWithAuth(t *testing.T) {
	server := startServer(t, serverOptions{startTLS: true, auth: "PLAIN"})
	settings := server.settings(SecurityStartTLS)
	settings.Username, settings.Password = "mailer", "s3cret"
	if err := (SMTPSender{RootCAs: server.roots}).Send(context.Background(), settings, Message{
		To: []string{"admin@example.org"}, Subject: "hi", Body: "hello",
	}); err != nil {
		t.Fatal(err)
	}
	if got := server.received(); got.user != "mailer" || got.password != "s3cret" {
		t.Fatalf("credentials seen by server = %+v", got)
	}
}

func TestSendImplicitTLSWithLoginAuth(t *testing.T) {
	server := startServer(t, serverOptions{implicitTLS: true, auth: "LOGIN"})
	settings := server.settings(SecurityTLS)
	settings.Username, settings.Password = "mailer", "s3cret"
	if err := (SMTPSender{RootCAs: server.roots}).Send(context.Background(), settings, Message{
		To: []string{"admin@example.org"}, Subject: "hi", Body: "hello",
	}); err != nil {
		t.Fatal(err)
	}
	if got := server.received(); got.user != "mailer" || got.password != "s3cret" {
		t.Fatalf("credentials seen by server = %+v", got)
	}
}

func TestStartTLSRequiredWhenServerDoesNotOfferIt(t *testing.T) {
	server := startServer(t, serverOptions{})
	err := SMTPSender{}.Probe(context.Background(), server.settings(SecurityStartTLS))
	assertStage(t, err, StageTLS)
}

func TestUntrustedCertificateFailsTLSStage(t *testing.T) {
	server := startServer(t, serverOptions{startTLS: true})
	err := SMTPSender{}.Probe(context.Background(), server.settings(SecurityStartTLS))
	assertStage(t, err, StageTLS)
}

func TestWrongPasswordFailsAuthStageWithServerReply(t *testing.T) {
	server := startServer(t, serverOptions{startTLS: true, auth: "PLAIN"})
	settings := server.settings(SecurityStartTLS)
	settings.Username, settings.Password = "mailer", "wrong"
	err := SMTPSender{RootCAs: server.roots}.Probe(context.Background(), settings)
	assertStage(t, err, StageAuth)
	var failure *Error
	if !errors.As(err, &failure) || !strings.Contains(failure.Message, "535") {
		t.Fatalf("message = %v", err)
	}
	if strings.Contains(err.Error(), "wrong") {
		t.Fatalf("error leaks the password: %v", err)
	}
}

func TestRejectedRecipientFailsRecipientStage(t *testing.T) {
	server := startServer(t, serverOptions{rejectRecipient: true})
	err := SMTPSender{}.Send(context.Background(), server.settings(SecurityNone), Message{
		To: []string{"admin@example.org"}, Subject: "hi", Body: "x",
	})
	assertStage(t, err, StageRecipient)
}

func TestConnectionRefusedFailsConnectStage(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	err = SMTPSender{}.Probe(context.Background(), Settings{Host: "127.0.0.1", Port: port, Security: SecurityNone, From: "a@example.com"})
	assertStage(t, err, StageConnect)
}

func assertStage(t *testing.T, err error, want Stage) {
	t.Helper()
	var failure *Error
	if !errors.As(err, &failure) || failure.Stage != want {
		t.Fatalf("error = %v, want stage %s", err, want)
	}
}

// ---- in-process SMTP server ---------------------------------------------------------

type serverOptions struct {
	startTLS, implicitTLS, rejectRecipient bool
	auth                                   string
}

type delivery struct {
	from, data, user, password string
	to                         []string
}

type fakeServer struct {
	t        *testing.T
	listener net.Listener
	options  serverOptions
	config   *tls.Config
	roots    *x509.CertPool
	mutex    sync.Mutex
	last     delivery
}

func (server *fakeServer) settings(security Security) Settings {
	return Settings{
		Host: "localhost", Port: server.listener.Addr().(*net.TCPAddr).Port, Security: security, From: "no-reply@example.com",
	}
}

func (server *fakeServer) received() delivery {
	server.mutex.Lock()
	defer server.mutex.Unlock()
	return server.last
}

func startServer(t *testing.T, options serverOptions) *fakeServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &fakeServer{t: t, listener: listener, options: options}
	server.config, server.roots = selfSigned(t)
	if options.implicitTLS {
		server.listener = tls.NewListener(listener, server.config)
	}
	t.Cleanup(func() { _ = server.listener.Close() })
	go func() {
		for {
			connection, err := server.listener.Accept()
			if err != nil {
				return
			}
			go server.serve(connection)
		}
	}()
	return server
}

func (server *fakeServer) serve(connection net.Conn) {
	defer func() { _ = connection.Close() }()
	_ = connection.SetDeadline(time.Now().Add(10 * time.Second))
	reader := textproto.NewReader(bufio.NewReader(connection))
	write := func(format string, args ...any) {
		_, _ = connection.Write([]byte(strings.ReplaceAll(fmt.Sprintf(format, args...), "\n", "\r\n")))
	}
	write("220 fake ESMTP\n")
	secured := server.options.implicitTLS
	var current delivery
	for {
		line, err := reader.ReadLine()
		if err != nil {
			return
		}
		command := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(command, "EHLO"), strings.HasPrefix(command, "HELO"):
			write("250-fake\n")
			if server.options.startTLS && !secured {
				write("250-STARTTLS\n")
			}
			if server.options.auth != "" && (secured || !server.options.startTLS) {
				write("250-AUTH %s\n", server.options.auth)
			}
			write("250 OK\n")
		case command == "STARTTLS":
			write("220 ready\n")
			secure := tls.Server(connection, server.config)
			if err := secure.Handshake(); err != nil {
				return
			}
			connection = secure
			reader = textproto.NewReader(bufio.NewReader(secure))
			secured = true
		case strings.HasPrefix(command, "AUTH PLAIN"):
			decoded, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(line[len("AUTH PLAIN"):]))
			parts := strings.Split(string(decoded), "\x00")
			if len(parts) == 3 && parts[2] == "s3cret" {
				current.user, current.password = parts[1], parts[2]
				write("235 2.7.0 accepted\n")
			} else {
				write("535 5.7.8 authentication failed\n")
			}
		case command == "AUTH LOGIN":
			write("334 VXNlcm5hbWU6\n")
			user, _ := reader.ReadLine()
			write("334 UGFzc3dvcmQ6\n")
			password, _ := reader.ReadLine()
			u, _ := base64.StdEncoding.DecodeString(user)
			p, _ := base64.StdEncoding.DecodeString(password)
			if string(p) == "s3cret" {
				current.user, current.password = string(u), string(p)
				write("235 2.7.0 accepted\n")
			} else {
				write("535 5.7.8 authentication failed\n")
			}
		case strings.HasPrefix(command, "MAIL FROM:"):
			current.from = strings.Trim(line[len("MAIL FROM:"):], "<> ")
			write("250 OK\n")
		case strings.HasPrefix(command, "RCPT TO:"):
			if server.options.rejectRecipient {
				write("550 5.1.1 no such user\n")
				continue
			}
			current.to = append(current.to, strings.Trim(line[len("RCPT TO:"):], "<> "))
			write("250 OK\n")
		case command == "DATA":
			write("354 go ahead\n")
			var body strings.Builder
			for {
				text, err := reader.ReadLine()
				if err != nil || text == "." {
					break
				}
				body.WriteString(text + "\n")
			}
			current.data = body.String()
			server.mutex.Lock()
			server.last = current
			server.mutex.Unlock()
			write("250 queued\n")
		case command == "QUIT":
			write("221 bye\n")
			return
		default:
			write("250 OK\n")
		}
	}
}

func selfSigned(t *testing.T) (*tls.Config, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true, IsCA: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(certificate)
	return &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}, pool
}
