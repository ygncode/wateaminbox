package manager

import (
	"testing"

	"github.com/ygncode-lab/whatsapp-web/services/orchestrator/internal/types"
)

func TestRecoveryAnnouncement_PlannedRestartIsNotAnError(t *testing.T) {
	status, reason := recoveryAnnouncement(WorkerStatusRecovering)

	if status != types.StatusConnecting {
		t.Errorf("planned restart announced as %q, want %q", status, types.StatusConnecting)
	}
	if reason == "" {
		t.Error("planned restart announced without a reason")
	}
}

func TestRecoveryAnnouncement_LostWorkerIsStillAnError(t *testing.T) {
	// Every status other than the shutdown marker means the orchestrator never
	// got to stop this worker, so its process really did vanish.
	for _, recorded := range []string{
		types.StatusConnected,
		types.StatusConnecting,
		types.StatusStarting,
		types.StatusDisconnected,
		"",
	} {
		status, reason := recoveryAnnouncement(recorded)

		if status != types.StatusError {
			t.Errorf("record %q announced as %q, want %q", recorded, status, types.StatusError)
		}
		if reason != "worker process died" {
			t.Errorf("record %q announced with reason %q, want %q", recorded, reason, "worker process died")
		}
	}
}

func TestSurvivorAnnouncement_TranslatesTheRegistryOnlyState(t *testing.T) {
	status, publish := survivorAnnouncement(WorkerStatusRecovering)
	if !publish {
		t.Fatal("a worker this orchestrator marked for recovery should be announced")
	}
	if status != types.StatusConnecting {
		t.Errorf("survivorAnnouncement(%q) = %q, want %q", WorkerStatusRecovering, status, types.StatusConnecting)
	}
}

// The regression this guards: worker_registry is written once, at spawn, and
// never advanced as the session comes up, so a worker connected for hours still
// carries "connecting". Republishing that on recovery pushed a connection the
// API had as "connected" back to "connecting", where nothing corrected it —
// the process survived, so it never re-announced itself.
func TestSurvivorAnnouncement_StaleRecordIsNotRepublished(t *testing.T) {
	for _, recorded := range []string{
		types.StatusConnecting, // the spawn-time default: the actual production case
		types.StatusConnected,  // never written today, and still not ours to assert
		types.StatusStarting,
		types.StatusDisconnected,
		types.StatusError,
		"",
		"something-unrecognised",
	} {
		status, publish := survivorAnnouncement(recorded)
		if publish {
			t.Errorf("record %q was republished as %q; a surviving worker's stale record must be left alone", recorded, status)
		}
		if status != "" {
			t.Errorf("record %q produced status %q while declining to publish", recorded, status)
		}
	}
}

// Saying nothing is the point: the orchestrator must not invent a connected
// state it cannot observe.
func TestSurvivorAnnouncement_NeverInventsConnected(t *testing.T) {
	for _, recorded := range []string{
		WorkerStatusRecovering,
		types.StatusConnecting,
		types.StatusConnected,
		types.StatusStarting,
		"",
	} {
		if status, publish := survivorAnnouncement(recorded); publish && status == types.StatusConnected {
			t.Errorf("record %q announced %q; the orchestrator cannot observe the WhatsApp session", recorded, status)
		}
	}
}

// The API's connection_status payload accepts only this vocabulary; anything
// else is dead-lettered, and the registry-only "recovering" state must never
// reach it.
func TestRecoveryStatuses_StayWithinTheAPIVocabulary(t *testing.T) {
	accepted := map[string]bool{
		types.StatusError:      true,
		"failed":               true,
		types.StatusConnecting: true,
		types.StatusConnected:  true,
	}

	for _, recorded := range []string{WorkerStatusRecovering, types.StatusConnected, types.StatusStarting} {
		if status, _ := recoveryAnnouncement(recorded); !accepted[status] {
			t.Errorf("recoveryAnnouncement(%q) published unsupported status %q", recorded, status)
		}
	}

	if accepted[WorkerStatusRecovering] {
		t.Error("the registry-only recovering state must not be part of the API vocabulary")
	}
}
