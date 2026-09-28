package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	ber "github.com/go-asn1-ber/asn1-ber"
	"github.com/go-ldap/ldap/v3"
)

func TestValidateProviderKeepsOIDCIssuerExactAndRejectsPlainLDAP(t *testing.T) {
	provider := Provider{ID: "company", Kind: "oidc", Label: "Company", Settings: ProviderSettings{
		IssuerURL: "https://sso.example.test/realm/", ClientID: "console",
	}}
	if err := ValidateProvider(&provider); err != nil {
		t.Fatal(err)
	}
	if provider.Settings.IssuerURL != "https://sso.example.test/realm/" || provider.IdentityScope != "https://sso.example.test/realm/|console" {
		t.Fatalf("issuer was changed: %+v", provider)
	}
	provider.Settings.ClientID = "another-app"
	if err := ValidateProvider(&provider); err != nil || provider.IdentityScope == "https://sso.example.test/realm/|console" {
		t.Fatalf("client ID did not change the immutable identity scope: %+v, %v", provider, err)
	}
	provider.Settings.IssuerURL = "http://sso.example.test/"
	if err := ValidateProvider(&provider); err == nil {
		t.Fatal("HTTP issuer was accepted")
	}
	ldapProvider := Provider{ID: "ldap", Kind: "ldap", Label: "LDAP", Settings: ProviderSettings{
		LDAPURL: "ldap://ldap.example.test:389", BaseDN: "dc=example,dc=test", BindDN: "cn=reader,dc=example,dc=test",
		UserFilter: "(uid={username})", IDAttribute: "entryUUID", EmailAttribute: "mail",
	}}
	if err := ValidateProvider(&ldapProvider); err != nil {
		t.Fatalf("StartTLS directory should be valid: %v", err)
	}
	ldapProvider.Settings.LDAPURL = "ldap://ldap.example.test:389/ou=users"
	if err := ValidateProvider(&ldapProvider); err == nil {
		t.Fatal("LDAP URL with an unexpected path was accepted")
	}
}

func TestOIDCExchangeVerifiesSignedTokenNonceAndEmail(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	verified := true
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"issuer": server.URL, "authorization_endpoint": server.URL + "/authorize",
				"token_endpoint": server.URL + "/token", "jwks_uri": server.URL + "/jwks",
				"response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"},
				"id_token_signing_alg_values_supported": []string{"RS256"},
			})
		case "/jwks":
			_ = json.NewEncoder(writer).Encode(map[string]any{"keys": []any{map[string]string{
				"kty": "RSA", "kid": "test-key", "alg": "RS256", "use": "sig",
				"n": base64.RawURLEncoding.EncodeToString(privateKey.PublicKey.N.Bytes()),
				"e": "AQAB",
			}}})
		case "/token":
			if err := request.ParseForm(); err != nil || request.Form.Get("code_verifier") != "a-test-verifier" {
				http.Error(writer, "missing verifier", http.StatusBadRequest)
				return
			}
			claims := map[string]any{"iss": server.URL, "aud": "console", "sub": "stable-user-42", "nonce": "expected-nonce",
				"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "email": "person@example.test",
				"email_verified": verified, "name": "Person"}
			token := signedIDToken(t, privateKey, claims)
			_ = json.NewEncoder(writer).Encode(map[string]any{"access_token": "opaque", "token_type": "Bearer", "expires_in": 3600, "id_token": token})
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	previousClient := providerHTTPClient
	providerHTTPClient = server.Client()
	defer func() { providerHTTPClient = previousClient }()
	provider := Provider{ID: "company", Kind: "oidc", Label: "Company", Secret: "client-secret", Settings: ProviderSettings{ClientID: "console", IssuerURL: server.URL}}
	if err := ValidateProvider(&provider); err != nil {
		t.Fatal(err)
	}
	authorizationURL, err := OAuthAuthorizationURL(context.Background(), provider, "https://openrum.example.test/callback", "state", "expected-nonce", "a-test-verifier")
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(authorizationURL)
	if parsed.Query().Get("code_challenge_method") != "S256" || parsed.Query().Get("nonce") != "expected-nonce" {
		t.Fatalf("authorization URL lacks PKCE or nonce: %s", authorizationURL)
	}
	identity, err := ExchangeOAuthIdentity(context.Background(), provider, "https://openrum.example.test/callback", "code", "expected-nonce", "a-test-verifier")
	if err != nil || identity.Subject != "stable-user-42" || identity.Email != "person@example.test" {
		t.Fatalf("identity=%+v err=%v", identity, err)
	}
	if _, err := ExchangeOAuthIdentity(context.Background(), provider, "https://openrum.example.test/callback", "code", "wrong-nonce", "a-test-verifier"); err == nil {
		t.Fatal("invalid nonce was accepted")
	}
	verified = false
	if _, err := ExchangeOAuthIdentity(context.Background(), provider, "https://openrum.example.test/callback", "code", "expected-nonce", "a-test-verifier"); err == nil {
		t.Fatal("unverified email was accepted")
	}
}

func signedIDToken(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": "test-key"})
	payload, _ := json.Marshal(claims)
	part := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(part))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return part + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func TestGitHubIdentityUsesStableIDAndVerifiedPrimaryEmail(t *testing.T) {
	verified := true
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer fake-access-token" {
			http.Error(writer, "missing bearer token", http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/user":
			_, _ = fmt.Fprint(writer, `{"id":12345,"login":"person","name":"Person"}`)
		case "/user/emails":
			_, _ = fmt.Fprintf(writer, `[{"email":"person@example.test","primary":true,"verified":%t},{"email":"other@example.test","primary":false,"verified":true}]`, verified)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()
	identity, err := githubIdentityAt(context.Background(), "fake-access-token", server.URL)
	if err != nil || identity.Subject != "12345" || identity.Email != "person@example.test" {
		t.Fatalf("identity=%+v err=%v", identity, err)
	}
	verified = false
	if _, err := githubIdentityAt(context.Background(), "fake-access-token", server.URL); err == nil || !strings.Contains(err.Error(), "verified primary") {
		t.Fatalf("unverified primary email was accepted: %v", err)
	}
}

func TestLDAPSAuthenticatesAgainstVerifiedDirectoryAndRejectsBadCertificate(t *testing.T) {
	certificateSource := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	certificate := certificateSource.TLS.Certificates[0]
	caPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Certificate[0]}))
	certificateSource.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	secureListener := tls.NewListener(listener, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
	defer func() { _ = secureListener.Close() }()
	go func() {
		for {
			connection, err := secureListener.Accept()
			if err != nil {
				return
			}
			go serveMockLDAP(connection, nil)
		}
	}()
	provider := Provider{ID: "directory", Kind: "ldap", Label: "Directory", Secret: "reader-password",
		Settings: ProviderSettings{LDAPURL: "ldaps://" + listener.Addr().String(), BaseDN: "dc=example,dc=test",
			BindDN: "cn=reader,dc=example,dc=test", UserFilter: "(uid={username})",
			IDAttribute: "entryUUID", EmailAttribute: "mail", NameAttribute: "displayName", CACertificate: caPEM}}
	if err := ValidateProvider(&provider); err != nil {
		t.Fatal(err)
	}
	if err := TestLDAPProvider(provider); err != nil {
		t.Fatalf("directory test failed: %v", err)
	}
	identity, err := AuthenticateLDAP(provider, "alice", "user-password")
	if err != nil || identity.Subject != "directory-user-42" || identity.Email != "alice@example.test" || identity.Name != "Alice" {
		t.Fatalf("directory identity=%+v err=%v", identity, err)
	}
	if _, err := AuthenticateLDAP(provider, "alice", "wrong-password"); err == nil {
		t.Fatal("invalid LDAP password was accepted")
	}
	provider.Settings.CACertificate = ""
	if _, err := AuthenticateLDAP(provider, "alice", "user-password"); err == nil {
		t.Fatal("untrusted LDAP certificate was accepted")
	}
	plainListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = plainListener.Close() }()
	go func() {
		for {
			connection, err := plainListener.Accept()
			if err != nil {
				return
			}
			go serveMockLDAP(connection, &certificate)
		}
	}()
	provider.Settings.LDAPURL = "ldap://" + plainListener.Addr().String()
	provider.Settings.CACertificate = caPEM
	if err := ValidateProvider(&provider); err != nil {
		t.Fatal(err)
	}
	identity, err = AuthenticateLDAP(provider, "alice", "user-password")
	if err != nil || identity.Subject != "directory-user-42" {
		t.Fatalf("StartTLS directory identity=%+v err=%v", identity, err)
	}
}

func serveMockLDAP(connection net.Conn, certificate *tls.Certificate) {
	defer func() { _ = connection.Close() }()
	for {
		request, err := ber.ReadPacket(connection)
		if err != nil || len(request.Children) < 2 {
			return
		}
		id := request.Children[0].Value
		operation := request.Children[1]
		switch operation.Tag {
		case ldap.ApplicationExtendedRequest:
			if certificate == nil {
				return
			}
			writeMockLDAPResponse(connection, id, ldapResult(ldap.ApplicationExtendedResponse, ldap.LDAPResultSuccess))
			upgraded := tls.Server(connection, &tls.Config{Certificates: []tls.Certificate{*certificate}, MinVersion: tls.VersionTLS12})
			if err := upgraded.Handshake(); err != nil {
				return
			}
			connection = upgraded
		case ldap.ApplicationBindRequest:
			if len(operation.Children) < 3 {
				return
			}
			dn, _ := operation.Children[1].Value.(string)
			password := string(operation.Children[2].Data.Bytes())
			code := uint64(ldap.LDAPResultInvalidCredentials)
			if dn == "cn=reader,dc=example,dc=test" && password == "reader-password" ||
				dn == "uid=alice,dc=example,dc=test" && password == "user-password" {
				code = ldap.LDAPResultSuccess
			}
			writeMockLDAPResponse(connection, id, ldapResult(ldap.ApplicationBindResponse, code))
		case ldap.ApplicationSearchRequest:
			entry := ber.Encode(ber.ClassApplication, ber.TypeConstructed, ldap.ApplicationSearchResultEntry, nil, "entry")
			entry.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "uid=alice,dc=example,dc=test", "dn"))
			attributes := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attributes")
			for name, value := range map[string]string{"entryUUID": "directory-user-42", "mail": "alice@example.test", "displayName": "Alice"} {
				attribute := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attribute")
				attribute.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, name, "type"))
				values := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSet, nil, "values")
				values.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, value, "value"))
				attribute.AppendChild(values)
				attributes.AppendChild(attribute)
			}
			entry.AppendChild(attributes)
			writeMockLDAPResponse(connection, id, entry)
			writeMockLDAPResponse(connection, id, ldapResult(ldap.ApplicationSearchResultDone, ldap.LDAPResultSuccess))
		case ldap.ApplicationUnbindRequest:
			return
		default:
			return
		}
	}
}

func ldapResult(tag ber.Tag, code uint64) *ber.Packet {
	response := ber.Encode(ber.ClassApplication, ber.TypeConstructed, tag, nil, "result")
	response.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, code, "code"))
	response.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "matched DN"))
	response.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "diagnostic"))
	return response
}

func writeMockLDAPResponse(connection net.Conn, id any, operation *ber.Packet) {
	packet := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAP message")
	packet.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, id, "message ID"))
	packet.AppendChild(operation)
	_, _ = connection.Write(packet.Bytes())
}
