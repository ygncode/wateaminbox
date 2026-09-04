package main

import (
	"testing"

	waStore "go.mau.fi/whatsmeow/store"
)

func TestConfigureLinkedDeviceDisplayName(t *testing.T) {
	originalName := waStore.DeviceProps.Os
	originalVersion := waStore.DeviceProps.GetVersion()
	originalPlatform := waStore.DeviceProps.GetPlatformType()
	t.Cleanup(func() {
		waStore.DeviceProps.Os = originalName
	})

	configureLinkedDeviceDisplayName()

	if got := waStore.DeviceProps.GetOs(); got != linkedDeviceDisplayName {
		t.Fatalf("linked device display name = %q, want %q", got, linkedDeviceDisplayName)
	}
	if got := waStore.DeviceProps.GetVersion(); got != originalVersion {
		t.Fatalf("device version changed from %v to %v", originalVersion, got)
	}
	if got := waStore.DeviceProps.GetPlatformType(); got != originalPlatform {
		t.Fatalf("device platform changed from %v to %v", originalPlatform, got)
	}
}
