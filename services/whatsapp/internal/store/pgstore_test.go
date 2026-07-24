package store

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store"
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

func completeTestDevice(t *testing.T) *store.Device {
	t.Helper()
	device := (&PGContainer{log: waLog.Noop}).NewDevice()
	jid, err := types.ParseJID("959428203611:47@s.whatsapp.net")
	if err != nil {
		t.Fatal(err)
	}
	device.ID = &jid
	device.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             []byte{1},
		AccountSignature:    make([]byte, 64),
		AccountSignatureKey: make([]byte, 32),
		DeviceSignature:     make([]byte, 64),
	}
	return device
}

func TestCompleteDeviceIdentityValidation(t *testing.T) {
	if !hasCompleteDeviceIdentity(completeTestDevice(t)) {
		t.Fatal("expected complete device identity to be accepted")
	}

	tests := map[string]func(*store.Device){
		"missing device id":         func(device *store.Device) { device.ID = nil },
		"missing noise key":         func(device *store.Device) { device.NoiseKey = nil },
		"missing identity key":      func(device *store.Device) { device.IdentityKey = nil },
		"missing signed pre-key":    func(device *store.Device) { device.SignedPreKey = nil },
		"missing ADV secret":        func(device *store.Device) { device.AdvSecretKey = nil },
		"missing signed identity":   func(device *store.Device) { device.Account = nil },
		"missing account details":   func(device *store.Device) { device.Account.Details = nil },
		"missing account signature": func(device *store.Device) { device.Account.AccountSignature = nil },
		"missing account key":       func(device *store.Device) { device.Account.AccountSignatureKey = nil },
		"missing device signature":  func(device *store.Device) { device.Account.DeviceSignature = nil },
	}
	for name, invalidate := range tests {
		t.Run(name, func(t *testing.T) {
			device := completeTestDevice(t)
			invalidate(device)
			if hasCompleteDeviceIdentity(device) {
				t.Fatal("expected incomplete device identity to be rejected")
			}
		})
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
