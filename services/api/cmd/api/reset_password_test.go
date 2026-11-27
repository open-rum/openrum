package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestResetPasswordCommandValidation(t *testing.T) {
	t.Run("requires --email", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		err := runResetPasswordWithIO(context.Background(), []string{"--password-stdin"}, "postgres://unused", resetPasswordIO{
			stdin:  strings.NewReader("ValidPassword123!\n"),
			stdout: &stdout,
			stderr: &stderr,
		})
		if err == nil || !strings.Contains(err.Error(), "--email is required") {
			t.Fatalf("err=%v, want --email is required", err)
		}
	})

	t.Run("rejects weak password from stdin", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		err := runResetPasswordWithIO(context.Background(), []string{"--email", "admin@example.com", "--password-stdin"}, "postgres://unused", resetPasswordIO{
			stdin:  strings.NewReader("weak\n"),
			stdout: &stdout,
			stderr: &stderr,
		})
		if err == nil || !strings.Contains(err.Error(), "invalid password") {
			t.Fatalf("err=%v, want invalid password", err)
		}
	})

	t.Run("rejects mismatched interactive passwords", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		inputs := []string{"ValidPassword123!", "DifferentPassword123!"}
		index := 0
		err := runResetPasswordWithIO(context.Background(), []string{"--email", "admin@example.com"}, "postgres://unused", resetPasswordIO{
			stdin:  strings.NewReader(""),
			stdout: &stdout,
			stderr: &stderr,
			readSecret: func(string) (string, error) {
				v := inputs[index]
				index++
				return v, nil
			},
		})
		if err == nil || !strings.Contains(err.Error(), "do not match") {
			t.Fatalf("err=%v, want passwords do not match", err)
		}
	})

	t.Run("requires POSTGRES_DSN after validation", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		err := runResetPasswordWithIO(context.Background(), []string{"--email", "admin@example.com", "--password-stdin"}, "", resetPasswordIO{
			stdin:  strings.NewReader("ValidPassword123!\n"),
			stdout: &stdout,
			stderr: &stderr,
		})
		if err == nil || !strings.Contains(err.Error(), "POSTGRES_DSN") {
			t.Fatalf("err=%v, want POSTGRES_DSN must be set", err)
		}
	})

	t.Run("list-admins requires POSTGRES_DSN", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		err := runResetPasswordWithIO(context.Background(), []string{"--list-admins"}, "", resetPasswordIO{
			stdin:  strings.NewReader(""),
			stdout: &stdout,
			stderr: &stderr,
		})
		if err == nil || !strings.Contains(err.Error(), "POSTGRES_DSN") {
			t.Fatalf("err=%v, want POSTGRES_DSN must be set", err)
		}
	})
}
