package auth

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-ldap/ldap/v3"
	"golang.org/x/oauth2"
)

type ProviderIdentity struct {
	Subject string
	Email   string
	Name    string
}

var providerHTTPClient = &http.Client{Timeout: 10 * time.Second}

var ldapAttributePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)

func ValidateProvider(provider *Provider) error {
	if !providerIDPattern.MatchString(provider.ID) || strings.TrimSpace(provider.Label) == "" || len(provider.Label) > 80 {
		return ErrProviderUnavailable
	}
	provider.Label = strings.TrimSpace(provider.Label)
	s := &provider.Settings
	s.ClientID = strings.TrimSpace(s.ClientID)
	s.IssuerURL = strings.TrimSpace(s.IssuerURL)
	s.LDAPURL = strings.TrimSpace(s.LDAPURL)
	s.BaseDN = strings.TrimSpace(s.BaseDN)
	s.BindDN = strings.TrimSpace(s.BindDN)
	s.IDAttribute = strings.TrimSpace(s.IDAttribute)
	s.EmailAttribute = strings.TrimSpace(s.EmailAttribute)
	s.NameAttribute = strings.TrimSpace(s.NameAttribute)
	s.UserFilter = strings.TrimSpace(s.UserFilter)
	switch provider.Kind {
	case "google":
		if s.ClientID == "" {
			return ErrProviderUnavailable
		}
		s.IssuerURL = "https://accounts.google.com"
		provider.IdentityScope = s.IssuerURL + "|" + s.ClientID
	case "github":
		if s.ClientID == "" {
			return ErrProviderUnavailable
		}
		provider.IdentityScope = "https://github.com|" + s.ClientID
		s.IssuerURL = ""
	case "oidc":
		if s.ClientID == "" || !validProviderURL(s.IssuerURL, "https") {
			return ErrProviderUnavailable
		}
		provider.IdentityScope = s.IssuerURL + "|" + s.ClientID
	case "ldap":
		parsed, err := url.Parse(s.LDAPURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "ldap" && parsed.Scheme != "ldaps") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" {
			return ErrProviderUnavailable
		}
		if s.BaseDN == "" || s.BindDN == "" || s.IDAttribute == "" || s.EmailAttribute == "" || s.UserFilter == "" || !strings.Contains(s.UserFilter, "{username}") {
			return ErrProviderUnavailable
		}
		if _, err := ldap.ParseDN(s.BaseDN); err != nil {
			return ErrProviderUnavailable
		}
		if _, err := ldap.ParseDN(s.BindDN); err != nil {
			return ErrProviderUnavailable
		}
		if !ldapAttributePattern.MatchString(s.IDAttribute) || !ldapAttributePattern.MatchString(s.EmailAttribute) ||
			(s.NameAttribute != "" && !ldapAttributePattern.MatchString(s.NameAttribute)) {
			return ErrProviderUnavailable
		}
		if _, err := ldap.CompileFilter(strings.ReplaceAll(s.UserFilter, "{username}", ldap.EscapeFilter("test-user"))); err != nil {
			return ErrProviderUnavailable
		}
		provider.IdentityScope = s.LDAPURL + "|" + s.BaseDN + "|" + s.IDAttribute
	default:
		return ErrProviderUnavailable
	}
	if s.CACertificate != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(s.CACertificate)) {
			return ErrProviderUnavailable
		}
	}
	return nil
}

func validProviderURL(raw, scheme string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == scheme && u.Host != "" && u.User == nil && u.Fragment == "" && u.RawQuery == "" && u.Opaque == ""
}

func oauthConfig(ctx context.Context, p Provider, redirectURL string) (*oauth2.Config, *oidc.Provider, error) {
	if p.Kind == "github" {
		return &oauth2.Config{ClientID: p.Settings.ClientID, ClientSecret: p.Secret, RedirectURL: redirectURL,
			Endpoint: oauth2.Endpoint{AuthURL: "https://github.com/login/oauth/authorize", TokenURL: "https://github.com/login/oauth/access_token"},
			Scopes:   []string{"read:user", "user:email"}}, nil, nil
	}
	issuer := p.Settings.IssuerURL
	if p.Kind == "google" {
		issuer = "https://accounts.google.com"
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, providerHTTPClient)
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, nil, err
	}
	return &oauth2.Config{ClientID: p.Settings.ClientID, ClientSecret: p.Secret, RedirectURL: redirectURL,
		Endpoint: provider.Endpoint(), Scopes: []string{oidc.ScopeOpenID, oidc.ScopeProfile, oidc.ScopeEmail}}, provider, nil
}

func OAuthAuthorizationURL(ctx context.Context, p Provider, redirectURL, state, nonce, verifier string) (string, error) {
	configuration, _, err := oauthConfig(ctx, p, redirectURL)
	if err != nil {
		return "", err
	}
	options := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(verifier)}
	if p.Kind != "github" {
		options = append(options, oauth2.SetAuthURLParam("nonce", nonce))
	}
	return configuration.AuthCodeURL(state, options...), nil
}

func ExchangeOAuthIdentity(ctx context.Context, p Provider, redirectURL, code, nonce, verifier string) (ProviderIdentity, error) {
	configuration, oidcProvider, err := oauthConfig(ctx, p, redirectURL)
	if err != nil {
		return ProviderIdentity{}, err
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, providerHTTPClient)
	token, err := configuration.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return ProviderIdentity{}, err
	}
	if p.Kind == "github" {
		return githubIdentity(ctx, token.AccessToken)
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return ProviderIdentity{}, errors.New("missing ID token")
	}
	idToken, err := oidcProvider.Verifier(&oidc.Config{ClientID: p.Settings.ClientID}).Verify(ctx, raw)
	if err != nil {
		return ProviderIdentity{}, err
	}
	if idToken.Nonce != nonce {
		return ProviderIdentity{}, errors.New("invalid ID token nonce")
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return ProviderIdentity{}, err
	}
	if !claims.EmailVerified || claims.Email == "" {
		return ProviderIdentity{}, errors.New("verified email is required")
	}
	return ProviderIdentity{Subject: idToken.Subject, Email: claims.Email, Name: claims.Name}, nil
}

func githubIdentity(ctx context.Context, accessToken string) (ProviderIdentity, error) {
	return githubIdentityAt(ctx, accessToken, "https://api.github.com")
}

func githubIdentityAt(ctx context.Context, accessToken, baseURL string) (ProviderIdentity, error) {
	call := func(path string, destination any) error {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
		if err != nil {
			return err
		}
		request.Header.Set("Authorization", "Bearer "+accessToken)
		request.Header.Set("Accept", "application/vnd.github+json")
		request.Header.Set("User-Agent", "OpenRUM")
		response, err := providerHTTPClient.Do(request)
		if err != nil {
			return err
		}
		defer func() { _ = response.Body.Close() }()
		if response.StatusCode != http.StatusOK {
			return fmt.Errorf("GitHub API returned %d", response.StatusCode)
		}
		return json.NewDecoder(io.LimitReader(response.Body, 32<<10)).Decode(destination)
	}
	var user struct {
		ID    int64  `json:"id"`
		Name  string `json:"name"`
		Login string `json:"login"`
	}
	if err := call("/user", &user); err != nil {
		return ProviderIdentity{}, err
	}
	if user.ID <= 0 {
		return ProviderIdentity{}, errors.New("GitHub user ID is missing")
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := call("/user/emails", &emails); err != nil {
		return ProviderIdentity{}, err
	}
	for _, entry := range emails {
		if entry.Primary && entry.Verified {
			name := user.Name
			if name == "" {
				name = user.Login
			}
			return ProviderIdentity{Subject: fmt.Sprint(user.ID), Email: entry.Email, Name: name}, nil
		}
	}
	return ProviderIdentity{}, errors.New("verified primary GitHub email is required")
}

func ldapConnection(p Provider) (*ldap.Conn, error) {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if p.Settings.CACertificate != "" && !pool.AppendCertsFromPEM([]byte(p.Settings.CACertificate)) {
		return nil, ErrProviderUnavailable
	}
	u, err := url.Parse(p.Settings.LDAPURL)
	if err != nil {
		return nil, err
	}
	tlsConfig := &tls.Config{ServerName: u.Hostname(), MinVersion: tls.VersionTLS12, RootCAs: pool}
	conn, err := ldap.DialURL(p.Settings.LDAPURL, ldap.DialWithDialer(&net.Dialer{Timeout: 5 * time.Second}), ldap.DialWithTLSConfig(tlsConfig))
	if err != nil {
		return nil, err
	}
	conn.SetTimeout(5 * time.Second)
	if u.Scheme == "ldap" {
		if err := conn.StartTLS(tlsConfig); err != nil {
			_ = conn.Close()
			return nil, err
		}
	}
	return conn, nil
}

func TestLDAPProvider(p Provider) error {
	conn, err := ldapConnection(p)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	if err := conn.Bind(p.Settings.BindDN, p.Secret); err != nil {
		return err
	}
	result, err := conn.Search(ldap.NewSearchRequest(p.Settings.BaseDN, ldap.ScopeBaseObject, ldap.NeverDerefAliases, 1, 5, false, "(objectClass=*)", []string{"dn"}, nil))
	if err != nil {
		return err
	}
	if len(result.Entries) != 1 {
		return errors.New("LDAP base DN was not found")
	}
	return nil
}

func AuthenticateLDAP(p Provider, username, password string) (ProviderIdentity, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" || len(username) > 320 || len(password) > 1024 {
		return ProviderIdentity{}, ErrInvalidCredentials
	}
	conn, err := ldapConnection(p)
	if err != nil {
		return ProviderIdentity{}, err
	}
	defer func() { _ = conn.Close() }()
	if err := conn.Bind(p.Settings.BindDN, p.Secret); err != nil {
		return ProviderIdentity{}, err
	}
	filter := strings.ReplaceAll(p.Settings.UserFilter, "{username}", ldap.EscapeFilter(username))
	attributes := []string{p.Settings.IDAttribute, p.Settings.EmailAttribute}
	if p.Settings.NameAttribute != "" {
		attributes = append(attributes, p.Settings.NameAttribute)
	}
	result, err := conn.Search(ldap.NewSearchRequest(p.Settings.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, 5, false, filter, attributes, nil))
	if err != nil {
		return ProviderIdentity{}, err
	}
	if len(result.Entries) != 1 {
		return ProviderIdentity{}, ErrInvalidCredentials
	}
	entry := result.Entries[0]
	if err := conn.Bind(entry.DN, password); err != nil {
		return ProviderIdentity{}, ErrInvalidCredentials
	}
	var subject string
	if strings.EqualFold(p.Settings.IDAttribute, "objectGUID") {
		subject = hex.EncodeToString(entry.GetRawAttributeValue(p.Settings.IDAttribute))
	} else {
		subject = entry.GetAttributeValue(p.Settings.IDAttribute)
	}
	if subject == "" {
		return ProviderIdentity{}, ErrProviderUnavailable
	}
	name := entry.GetAttributeValue(p.Settings.NameAttribute)
	return ProviderIdentity{Subject: subject, Email: entry.GetAttributeValue(p.Settings.EmailAttribute), Name: name}, nil
}

func PKCEChallenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
