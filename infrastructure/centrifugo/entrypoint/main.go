package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"
)

const (
	defaultNATSPasswordFile = "/run/secrets/nats_service_password"
	redactionMarker         = "[REDACTED]"
)

type redactingWriter struct {
	mu      sync.Mutex
	dst     io.Writer
	secrets [][]byte
	pending []byte
	maxLen  int
}

func newRedactingWriter(dst io.Writer, secrets []string) *redactingWriter {
	byteSecrets := make([][]byte, 0, len(secrets))
	maxLen := 0
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		value := []byte(secret)
		byteSecrets = append(byteSecrets, value)
		if len(value) > maxLen {
			maxLen = len(value)
		}
	}
	sort.Slice(byteSecrets, func(i, j int) bool { return len(byteSecrets[i]) > len(byteSecrets[j]) })
	return &redactingWriter{dst: dst, secrets: byteSecrets, maxLen: maxLen}
}

func (w *redactingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.pending = append(w.pending, p...)
	if err := w.flush(false); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (w *redactingWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.flush(true)
}

func (w *redactingWriter) flush(final bool) error {
	limit := len(w.pending)
	if !final && w.maxLen > 1 {
		limit -= w.maxLen - 1
		// Secrets are rejected if they contain newlines, so a complete log
		// record is always safe to emit immediately. This keeps normal logs
		// streaming while retaining only an incomplete trailing record.
		if newline := bytes.LastIndexByte(w.pending, '\n') + 1; newline > limit {
			limit = newline
		}
		if limit <= 0 {
			return nil
		}
	}

	var output bytes.Buffer
	consumed := 0
	for consumed < limit {
		matched := false
		for _, secret := range w.secrets {
			if len(w.pending)-consumed >= len(secret) && bytes.Equal(w.pending[consumed:consumed+len(secret)], secret) {
				output.WriteString(redactionMarker)
				consumed += len(secret)
				matched = true
				break
			}
		}
		if !matched {
			output.WriteByte(w.pending[consumed])
			consumed++
		}
	}
	if output.Len() > 0 {
		if _, err := w.dst.Write(output.Bytes()); err != nil {
			return err
		}
	}
	w.pending = append(w.pending[:0], w.pending[consumed:]...)
	return nil
}

func readSecret(label, path string) (string, error) {
	value, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("centrifugo-entrypoint: cannot read %s secret file", label)
	}
	secret := strings.TrimRight(string(value), "\r\n")
	if secret == "" {
		return "", fmt.Errorf("centrifugo-entrypoint: empty %s secret file", label)
	}
	if strings.ContainsAny(secret, "\r\n") {
		return "", fmt.Errorf("centrifugo-entrypoint: invalid %s secret file", label)
	}
	return secret, nil
}

func envWithout(keys ...string) []string {
	blocked := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		blocked[key] = struct{}{}
	}
	result := make([]string, 0, len(os.Environ()))
	for _, item := range os.Environ() {
		key, _, _ := strings.Cut(item, "=")
		if _, found := blocked[key]; !found {
			result = append(result, item)
		}
	}
	return result
}

func run() int {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: command is required")
		return 64
	}

	passwordFile := os.Getenv("CENTRIFUGO_NATS_PASSWORD_FILE")
	if passwordFile == "" {
		passwordFile = defaultNATSPasswordFile
	}
	natsPassword, err := readSecret("NATS", passwordFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 78
	}
	if len(natsPassword) < 32 {
		fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: invalid NATS secret")
		return 78
	}
	for _, character := range natsPassword {
		if !(character >= 'a' && character <= 'z') && !(character >= 'A' && character <= 'Z') && !(character >= '0' && character <= '9') && character != '_' && character != '-' {
			fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: invalid NATS secret")
			return 78
		}
	}

	secrets := []string{natsPassword}
	childEnv := envWithout(
		"CENTRIFUGO_BROKER_NATS_URL",
		"CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY",
		"CENTRIFUGO_HTTP_API_KEY",
	)
	childEnv = append(childEnv, "CENTRIFUGO_BROKER_NATS_URL=nats://service:"+natsPassword+"@nats:4222")

	fileBacked := []struct {
		pathVariable string
		valueKey     string
		label        string
	}{
		{"CENTRIFUGO_TOKEN_HMAC_SECRET_FILE", "CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY", "token"},
		{"CENTRIFUGO_API_KEY_FILE", "CENTRIFUGO_HTTP_API_KEY", "API"},
	}
	for _, item := range fileBacked {
		if path := os.Getenv(item.pathVariable); path != "" {
			secret, readErr := readSecret(item.label, path)
			if readErr != nil {
				fmt.Fprintln(os.Stderr, readErr)
				return 78
			}
			secrets = append(secrets, secret)
			childEnv = append(childEnv, item.valueKey+"="+secret)
		} else if secret := os.Getenv(item.valueKey); secret != "" {
			if strings.ContainsAny(secret, "\r\n") {
				fmt.Fprintf(os.Stderr, "centrifugo-entrypoint: invalid %s secret\n", item.label)
				return 78
			}
			secrets = append(secrets, secret)
			childEnv = append(childEnv, item.valueKey+"="+secret)
		}
	}

	stdout := newRedactingWriter(os.Stdout, secrets)
	stderr := newRedactingWriter(os.Stderr, secrets)
	command := exec.Command(os.Args[1], os.Args[2:]...)
	command.Env = childEnv
	command.Stdout = stdout
	command.Stderr = stderr
	if err = command.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: failed to start child")
		return 70
	}

	signals := make(chan os.Signal, 4)
	done := make(chan struct{})
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	go func() {
		for {
			select {
			case received := <-signals:
				_ = command.Process.Signal(received)
			case <-done:
				return
			}
		}
	}()

	waitErr := command.Wait()
	close(done)
	signal.Stop(signals)
	stdoutErr := stdout.Close()
	stderrErr := stderr.Close()
	if waitErr == nil {
		if stdoutErr != nil || stderrErr != nil {
			fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: failed to stream child output")
			return 74
		}
		return 0
	}
	var exitError *exec.ExitError
	if errors.As(waitErr, &exitError) {
		if status, ok := exitError.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			return 128 + int(status.Signal())
		}
		return exitError.ExitCode()
	}
	fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: child wait failed")
	return 70
}

func main() {
	os.Exit(run())
}
