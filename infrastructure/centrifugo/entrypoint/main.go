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
	mu             sync.Mutex
	dst            io.Writer
	secrets        [][]byte
	pending        []byte
	maxLen         int
	destinationErr error
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
	w.flush(false)
	// A destination failure must never close os/exec's source pipe: doing so
	// gives the child SIGPIPE and hides its natural status. Continue draining,
	// redact in memory, and safely discard after recording the first error.
	return len(p), nil
}

func (w *redactingWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.flush(true)
	return w.destinationErr
}

func (w *redactingWriter) flush(final bool) {
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
			return
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
	if output.Len() > 0 && w.destinationErr == nil {
		written, err := w.dst.Write(output.Bytes())
		if err == nil && written != output.Len() {
			err = io.ErrShortWrite
		}
		if err != nil {
			w.destinationErr = err
		}
	}
	w.pending = append(w.pending[:0], w.pending[consumed:]...)
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

func executeCommand(command *exec.Cmd, signals <-chan os.Signal) (waitErr, startErr error) {
	if err := command.Start(); err != nil {
		return nil, err
	}

	done := make(chan struct{})
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
	waitErr = command.Wait()
	close(done)
	return waitErr, nil
}

func drainSignalQueue(signals <-chan os.Signal) {
	for {
		select {
		case <-signals:
		default:
			return
		}
	}
}

// commandExitStatus defines failure precedence: a naturally nonzero child
// status is authoritative even if log delivery also failed. Output failure 74
// applies only when the child itself completed successfully.
func commandExitStatus(waitErr, outputErr error) int {
	if waitErr == nil {
		if outputErr != nil {
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
	return 70
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
	// Register before Start. Signals delivered while fork/exec is in progress
	// remain queued and are forwarded as soon as a child exists.
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	waitErr, startErr := executeCommand(command, signals)
	signal.Stop(signals)
	drainSignalQueue(signals)
	if startErr != nil {
		fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: failed to start child")
		return 70
	}

	outputErr := errors.Join(stdout.Close(), stderr.Close())
	status := commandExitStatus(waitErr, outputErr)
	if waitErr == nil && outputErr != nil {
		fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: failed to stream child output")
	} else if status == 70 {
		fmt.Fprintln(os.Stderr, "centrifugo-entrypoint: child wait failed")
	}
	return status
}

func main() {
	// Go otherwise terminates the process when fd 1 or 2 is a closed pipe.
	// Catch SIGPIPE before run performs any child or output activity so writes
	// return EPIPE to redactingWriter. A caught disposition resets to default
	// across exec, so Centrifugo retains normal child SIGPIPE semantics.
	sigpipe := make(chan os.Signal, 1)
	signal.Notify(sigpipe, syscall.SIGPIPE)
	os.Exit(run())
}
