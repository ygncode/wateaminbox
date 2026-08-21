package main

import (
	"bytes"
	"testing"
)

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
