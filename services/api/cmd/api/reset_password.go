package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"openrum/internal/auth"
	"openrum/internal/metadata"
)

type resetPasswordIO struct {
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
	// readSecret reads a secret line without echoing when stdin is a TTY.
	// Tests replace this hook to simulate interactive prompts.
	readSecret func(prompt string) (string, error)
}

func runResetPasswordCommand(ctx context.Context, args []string) error {
	return runResetPasswordWithIO(ctx, args, os.Getenv("POSTGRES_DSN"), resetPasswordIO{
		stdin:  os.Stdin,
		stdout: os.Stdout,
		stderr: os.Stderr,
	})
}

func runResetPasswordWithIO(ctx context.Context, args []string, postgresDSN string, stdio resetPasswordIO) error {
	flags := flag.NewFlagSet("reset-password", flag.ContinueOnError)
	flags.SetOutput(stdio.stderr)

	var email string
	var passwordStdin bool
	var listAdmins bool
	flags.StringVar(&email, "email", "", "Email address of the account to reset")
	flags.BoolVar(&passwordStdin, "password-stdin", false, "Read the new password from standard input instead of prompting")
	flags.BoolVar(&listAdmins, "list-admins", false, "List instance owner and admin email addresses without changing any password")
	flags.Usage = func() {
		fmt.Fprintf(stdio.stderr, "Usage: api reset-password --email <address> [--password-stdin]\n")
		fmt.Fprintf(stdio.stderr, "       api reset-password --list-admins\n\n")
		fmt.Fprintf(stdio.stderr, "Resets a user's password directly in PostgreSQL and revokes every active session.\n")
		fmt.Fprintf(stdio.stderr, "Requires POSTGRES_DSN in the environment.\n\n")
		flags.PrintDefaults()
	}

	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() > 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}

	if listAdmins {
		if strings.TrimSpace(postgresDSN) == "" {
			return errors.New("POSTGRES_DSN must be set")
		}
		opCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()

		database, err := metadata.OpenPostgres(opCtx, postgresDSN)
		if err != nil {
			return fmt.Errorf("connect postgres: %w", err)
		}
		defer func() { _ = database.Close() }()

		admins, err := metadata.NewPasswordResetRepository(database).ListAdmins(opCtx)
		if err != nil {
			return fmt.Errorf("list admins: %w", err)
		}
		if len(admins) == 0 {
			fmt.Fprintln(stdio.stdout, "No instance administrators found.")
			return nil
		}
		for _, admin := range admins {
			fmt.Fprintf(stdio.stdout, "%s\t%s\t%s\t%s\n", admin.Email, admin.Role, admin.Status, admin.DisplayName)
		}
		return nil
	}

	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return errors.New("--email is required (use --list-admins to look up administrator emails)")
	}

	password, err := readResetPassword(passwordStdin, stdio)
	if err != nil {
		return err
	}
	if err := auth.ValidatePassword(password); err != nil {
		return fmt.Errorf("invalid password: %w", err)
	}

	if strings.TrimSpace(postgresDSN) == "" {
		return errors.New("POSTGRES_DSN must be set")
	}

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	opCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	database, err := metadata.OpenPostgres(opCtx, postgresDSN)
	if err != nil {
		return fmt.Errorf("connect postgres: %w", err)
	}
	defer func() { _ = database.Close() }()

	repo := metadata.NewPasswordResetRepository(database)
	if _, err := repo.AdminResetPassword(opCtx, email, passwordHash); err != nil {
		if errors.Is(err, metadata.ErrPasswordResetUserNotFound) {
			return fmt.Errorf("no account found with email %s", email)
		}
		return fmt.Errorf("reset password: %w", err)
	}

	fmt.Fprintf(stdio.stdout, "Password updated for %s. All active sessions have been revoked.\n", email)
	return nil
}

func readResetPassword(fromStdin bool, stdio resetPasswordIO) (string, error) {
	if fromStdin {
		reader := bufio.NewReader(stdio.stdin)
		line, err := reader.ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", fmt.Errorf("read password from stdin: %w", err)
		}
		password := strings.TrimRight(line, "\r\n")
		if password == "" {
			return "", errors.New("password read from stdin is empty")
		}
		return password, nil
	}

	promptSecret := stdio.readSecret
	if promptSecret == nil {
		promptSecret = func(prompt string) (string, error) {
			return readPasswordFromTerminal(stdio.stdin, stdio.stderr, prompt)
		}
	}

	first, err := promptSecret("New password: ")
	if err != nil {
		return "", err
	}
	second, err := promptSecret("Confirm new password: ")
	if err != nil {
		return "", err
	}
	if first != second {
		return "", errors.New("passwords do not match")
	}
	return first, nil
}

func readPasswordFromTerminal(in io.Reader, out io.Writer, prompt string) (string, error) {
	fmt.Fprint(out, prompt)
	ttyFile, isFile := in.(*os.File)
	echoDisabled := false
	if isFile {
		if info, err := ttyFile.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
			if setTerminalEcho(ttyFile, false) == nil {
				echoDisabled = true
				defer func() {
					_ = setTerminalEcho(ttyFile, true)
					fmt.Fprintln(out)
				}()
			}
		}
	}

	reader := bufio.NewReader(in)
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("read password: %w", err)
	}
	if !echoDisabled && isFile {
		// Nothing extra to print when echo remained enabled.
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func setTerminalEcho(tty *os.File, enabled bool) error {
	arg := "-echo"
	if enabled {
		arg = "echo"
	}
	cmd := exec.Command("stty", arg)
	cmd.Stdin = tty
	return cmd.Run()
}
