package store

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
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

func TestLIDMappingsAreIdentityLevelAndPreserveDevice(t *testing.T) {
	pn, err := types.ParseJID("6584042683:17@s.whatsapp.net")
	if err != nil {
		t.Fatal(err)
	}
	lid, err := types.ParseJID("190288643534904@lid")
	if err != nil {
		t.Fatal(err)
	}

	if normalized := normalizedMappingJID(pn); normalized != "6584042683@s.whatsapp.net" {
		t.Fatalf("unexpected normalized PN: %s", normalized)
	}
	mapped, err := mappedDeviceJID(lid.String(), pn)
	if err != nil {
		t.Fatal(err)
	}
	if mapped.String() != "190288643534904:17@lid" {
		t.Fatalf("expected device-preserving LID, got %s", mapped)
	}
	if lid.SignalAddressUser() != "190288643534904_1" {
		t.Fatalf("unexpected LID Signal address: %s", lid.SignalAddressUser())
	}
}
