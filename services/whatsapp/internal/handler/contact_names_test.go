package handler

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestIsRedactedContactLabel(t *testing.T) {
	tests := []struct {
		value    string
		expected bool
	}{
		{value: "+65∙∙∙∙∙∙06", expected: true},
		{value: "+84••••••••89", expected: true},
		{value: "+1********35", expected: true},
		{value: "6582239810", expected: false},
		{value: "Jane * Sales", expected: false},
		{value: "AI Sharing Group", expected: false},
	}

	for _, test := range tests {
		if actual := isRedactedContactLabel(test.value); actual != test.expected {
			t.Errorf("isRedactedContactLabel(%q): expected %v, got %v", test.value, test.expected, actual)
		}
	}
}

func TestMergeContactInfoKeepsSavedNamesAndAddsMissingFields(t *testing.T) {
	current := types.ContactInfo{FullName: "Saved Name"}
	incoming := types.ContactInfo{FullName: "Other Name", PushName: "Push Name", BusinessName: "Business"}

	merged := mergeContactInfo(current, incoming)
	if merged.FullName != "Saved Name" {
		t.Fatalf("expected saved full name to win, got %q", merged.FullName)
	}
	if merged.PushName != "Push Name" || merged.BusinessName != "Business" {
		t.Fatalf("expected missing fields to be merged, got %+v", merged)
	}
}
