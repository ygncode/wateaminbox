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

// The regression this guards: worker_registry is written once, at spawn, and
// never advanced as the session comes up, so a worker connected for hours still
// carries "connecting". Republishing that on recovery pushed a connection the
// API had as "connected" back to "connecting", where nothing corrected it —
// the process survived, so it never re-announced itself.
//
// No registry status is exempt, including the shutdown marker. See
// TestSurvivorAnnouncement_RecoveringIsAlsoDeclined.
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

// The easy mistake, and the one an earlier revision of this code made: treating
// "recovering" as authoritative because this orchestrator's own shutdown wrote
// it. That marker means a stop was requested — but survivorAnnouncement is only
// consulted when the process is still alive, so the stop did not take effect.
// The worker never left, its WhatsApp session is still up, and announcing
// "connecting" would downgrade a live connection exactly as the spawn-time
// default did.
func TestSurvivorAnnouncement_RecoveringIsAlsoDeclined(t *testing.T) {
	status, publish := survivorAnnouncement(WorkerStatusRecovering)
	if publish {
		t.Errorf("a surviving worker marked %q was announced as %q; the stop never took effect, so the session is still up",
			WorkerStatusRecovering, status)
	}
	if status != "" {
		t.Errorf("survivorAnnouncement(%q) produced status %q while declining to publish", WorkerStatusRecovering, status)
	}
}

// A dead process is a different question and must still be announced, so the
// two paths cannot be collapsed.
func TestRecoveryAnnouncement_StillSpeaksForDeadProcesses(t *testing.T) {
	if status, _ := recoveryAnnouncement(WorkerStatusRecovering); status != types.StatusConnecting {
		t.Errorf("a dead worker marked for recovery announced %q, want %q", status, types.StatusConnecting)
	}
	if status, _ := recoveryAnnouncement(types.StatusConnected); status != types.StatusError {
		t.Errorf("a dead unmarked worker announced %q, want %q", status, types.StatusError)
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
