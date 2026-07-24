package store

import (
	"testing"

	waLog "go.mau.fi/whatsmeow/util/log"
)

func TestNewDeviceInitializesCurrentWhatsmeowStores(t *testing.T) {
	device := (&PGContainer{log: waLog.Noop}).NewDevice()

	if device.NCTSalt == nil {
		t.Fatal("NCT salt store must be initialized to prevent direct-send panics")
	}
	if device.EventBuffer == nil {
		t.Fatal("event buffer must be initialized to prevent retry/decryption panics")
	}
}
