package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"syscall"
	"testing"

	"hegel.dev/go/hegel"
)

type failingWriter struct {
	calls    int
	captured bytes.Buffer
	err      error
}

func (w *failingWriter) Write(p []byte) (int, error) {
	w.calls++
	_, _ = w.captured.Write(p)
	return 0, w.err
}

func TestRedactingWriterHandlesMetacharactersRepeatsAndChunkBoundaries(t *testing.T) {
	secrets := []string{"safe.^$[]*+?(){}|\\secret", "short"}
	var output bytes.Buffer
	writer := newRedactingWriter(&output, secrets)
	parts := []string{
		"prefix safe.^$[]*",
		"+?(){}|\\se",
		"cret short short suffix",
	}
	for _, part := range parts {
		if _, err := writer.Write([]byte(part)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	want := "prefix [REDACTED] [REDACTED] [REDACTED] suffix"
	if output.String() != want {
		t.Fatalf("redacted output = %q, want %q", output.String(), want)
	}
}

// redactAll is the whole-input reference: scan left to right and replace the
// longest secret that starts at each position.
func redactAll(input string, secrets []string) string {
	sorted := append([]string(nil), secrets...)
	sort.Slice(sorted, func(i, j int) bool { return len(sorted[i]) > len(sorted[j]) })
	var out strings.Builder
	for i := 0; i < len(input); {
		matched := false
		for _, secret := range sorted {
			if secret != "" && strings.HasPrefix(input[i:], secret) {
				out.WriteString(redactionMarker)
				i += len(secret)
				matched = true
				break
			}
		}
		if !matched {
			out.WriteByte(input[i])
			i++
		}
	}
	return out.String()
}

func TestRedactingWriterOutputDoesNotDependOnWriteBoundaries(t *testing.T) {
	hegel.Test(t, func(ht *hegel.T) {
		// A tiny alphabet makes secrets overlap and recur in the input. Secrets
		// never contain newlines; run() rejects those before redaction starts.
		secrets := hegel.Draw(ht, hegel.Lists(hegel.Text().Alphabet("ab.").MaxSize(6)).MaxSize(4))
		pieces := []hegel.Generator[string]{hegel.Text().Alphabet("ab.\n")}
		for _, secret := range secrets {
			pieces = append(pieces, hegel.Just(secret))
		}
		input := strings.Join(hegel.Draw(ht, hegel.Lists(hegel.OneOf(pieces...))), "")
		cuts := hegel.Draw(ht, hegel.Lists(hegel.Integers(0, len(input))))
		sort.Ints(cuts)

		var output bytes.Buffer
		writer := newRedactingWriter(&output, secrets)
		previous := 0
		for _, cut := range append(cuts, len(input)) {
			if _, err := writer.Write([]byte(input[previous:cut])); err != nil {
				ht.Fatal(err)
			}
			previous = cut
		}
		if err := writer.Close(); err != nil {
			ht.Fatal(err)
		}

		if want := redactAll(input, secrets); output.String() != want {
			ht.Fatalf("input %q split at %v with secrets %q:\n got %q\nwant %q", input, cuts, secrets, output.String(), want)
		}
	})
}

func TestRedactingWriterFlushesTrailingOutput(t *testing.T) {
	var output bytes.Buffer
	writer := newRedactingWriter(&output, []string{"boundary-secret"})
	if _, err := writer.Write([]byte("no-newline boundary-secret")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if output.String() != "no-newline [REDACTED]" {
		t.Fatalf("unexpected output: %q", output.String())
	}
}

func TestRedactingWriterRecordsDestinationFailureAndKeepsDraining(t *testing.T) {
	destinationErr := errors.New("destination failed")
	destination := &failingWriter{err: destinationErr}
	writer := newRedactingWriter(destination, []string{"exact-secret"})

	for _, output := range []string{
		"first exact-secret line\n",
		"second exact-secret line\n",
		"trailing exact-secret",
	} {
		written, err := writer.Write([]byte(output))
		if err != nil || written != len(output) {
			t.Fatalf("Write() = (%d, %v), want (%d, nil)", written, err, len(output))
		}
	}
	if !errors.Is(writer.Close(), destinationErr) {
		t.Fatal("Close did not report the first destination error")
	}
	if destination.calls != 1 {
		t.Fatalf("destination writes = %d, want exactly one before discard mode", destination.calls)
	}
	if bytes.Contains(destination.captured.Bytes(), []byte("exact-secret")) {
		t.Fatal("destination received an unredacted secret")
	}
}

func TestOutputFailureDoesNotInduceSIGPIPEAndStatusPrecedenceIsStable(t *testing.T) {
	for _, test := range []struct {
		name       string
		childExit  int
		wantStatus int
	}{
		{name: "successful child reports output failure", childExit: 0, wantStatus: 74},
		{name: "nonzero child status wins", childExit: 23, wantStatus: 23},
	} {
		t.Run(test.name, func(t *testing.T) {
			destinationErr := errors.New("destination failed")
			stdout := newRedactingWriter(&failingWriter{err: destinationErr}, []string{"high-volume-secret"})
			stderr := newRedactingWriter(io.Discard, []string{"high-volume-secret"})
			script := fmt.Sprintf("i=0; while [ $i -lt 20000 ]; do printf 'high-volume-secret line %%s\\n' \"$i\"; i=$((i+1)); done; exit %d", test.childExit)
			command := exec.Command("/bin/sh", "-c", script)
			command.Stdout = stdout
			command.Stderr = stderr
			signals := make(chan os.Signal, 1)

			waitErr, startErr := executeCommand(command, signals)
			if startErr != nil {
				t.Fatal(startErr)
			}
			outputErr := errors.Join(stdout.Close(), stderr.Close())
			if !errors.Is(outputErr, destinationErr) {
				t.Fatal("output failure was not retained")
			}
			if status := commandExitStatus(waitErr, outputErr); status != test.wantStatus {
				t.Fatalf("status = %d, want %d (SIGPIPE would be 141)", status, test.wantStatus)
			}
		})
	}
}

func TestQueuedStartupSignalIsForwardedAfterStart(t *testing.T) {
	command := exec.Command("/bin/sleep", "30")
	signals := make(chan os.Signal, 1)
	signals <- syscall.SIGTERM

	waitErr, startErr := executeCommand(command, signals)
	if startErr != nil {
		t.Fatal(startErr)
	}
	if status := commandExitStatus(waitErr, nil); status != 128+int(syscall.SIGTERM) {
		t.Fatalf("queued startup signal status = %d, want %d", status, 128+int(syscall.SIGTERM))
	}
}

func TestStartFailureSignalQueueCanBeDrained(t *testing.T) {
	signals := make(chan os.Signal, 2)
	signals <- syscall.SIGTERM
	signals <- syscall.SIGHUP
	command := exec.Command("/definitely/missing/centrifugo-child")

	_, startErr := executeCommand(command, signals)
	if startErr == nil {
		t.Fatal("missing command unexpectedly started")
	}
	drainSignalQueue(signals)
	if len(signals) != 0 {
		t.Fatalf("signal queue retained %d entries after start failure", len(signals))
	}
}
