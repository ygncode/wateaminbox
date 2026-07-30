package handler

import (
	"sync"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type recordedSyncStatus struct {
	status        string
	messageCount  int
	conversations int
}

type recordingSyncPublisher struct {
	mu     sync.Mutex
	events []recordedSyncStatus
}

type recordedHistoryPage struct {
	chatJID      string
	messageCount int
	status       string
}

type recordingHistoryPagePublisher struct {
	events []recordedHistoryPage
}

func (p *recordingHistoryPagePublisher) PublishHistorySyncPage(chatJID string, messageCount int, status string) error {
	p.events = append(p.events, recordedHistoryPage{
		chatJID: chatJID, messageCount: messageCount, status: status,
	})
	return nil
}

func (p *recordingSyncPublisher) PublishSyncStatus(status string, messageCount, conversations int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, recordedSyncStatus{
		status:        status,
		messageCount:  messageCount,
		conversations: conversations,
	})
	return nil
}

func (p *recordingSyncPublisher) snapshot() []recordedSyncStatus {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]recordedSyncStatus(nil), p.events...)
}

func historySyncEvent(
	syncType waHistorySync.HistorySync_HistorySyncType,
	progress uint32,
	conversationCount int,
) *events.HistorySync {
	conversations := make([]*waHistorySync.Conversation, 0, conversationCount)
	for i := 0; i < conversationCount; i++ {
		conversations = append(conversations, &waHistorySync.Conversation{
			ID: proto.String("15550000000@s.whatsapp.net"),
		})
	}
	return &events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType:      &syncType,
		Progress:      proto.Uint32(progress),
		Conversations: conversations,
	}}
}

func TestOfflineCatchUpDoesNotDriveHistorySyncLifecycle(t *testing.T) {
	publisher := &recordingSyncPublisher{}
	h := New(Config{SyncStatusPublisher: publisher})

	h.handleOfflineSyncPreview(&events.OfflineSyncPreview{Messages: 3, Notifications: 1})
	h.handleOfflineSyncCompleted(&events.OfflineSyncCompleted{Count: 4})

	if got := publisher.snapshot(); len(got) != 0 {
		t.Fatalf("offline catch-up published history lifecycle events: %#v", got)
	}
}

func TestHistorySyncPublishesCumulativeProgressThenCompletes(t *testing.T) {
	publisher := &recordingSyncPublisher{}
	h := New(Config{SyncStatusPublisher: publisher})

	h.handleHistorySync(historySyncEvent(waHistorySync.HistorySync_INITIAL_BOOTSTRAP, 100, 2))
	h.handleHistorySync(historySyncEvent(waHistorySync.HistorySync_FULL, 100, 3))
	h.handleHistorySync(historySyncEvent(waHistorySync.HistorySync_RECENT, 100, 1))

	got := publisher.snapshot()
	want := []recordedSyncStatus{
		{status: "starting", conversations: 0},
		{status: "progress", conversations: 2},
		{status: "progress", conversations: 5},
		{status: "progress", conversations: 6},
		{status: "completed", conversations: 6},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d lifecycle events (%#v), want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("event %d = %#v, want %#v", i, got[i], want[i])
		}
	}
}

func TestLateChunkAfterIdleCompletionStartsAndCompletesNewLifecycle(t *testing.T) {
	publisher := &recordingSyncPublisher{}
	h := New(Config{SyncStatusPublisher: publisher})
	h.historySyncIdleTimeout = 15 * time.Millisecond

	h.handleHistorySync(historySyncEvent(waHistorySync.HistorySync_FULL, 50, 1))
	deadline := time.Now().Add(time.Second)
	for {
		events := publisher.snapshot()
		if len(events) >= 3 && events[2].status == "completed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("idle fallback did not complete lifecycle: %#v", events)
		}
		time.Sleep(5 * time.Millisecond)
	}
	h.handleHistorySync(historySyncEvent(waHistorySync.HistorySync_RECENT, 100, 2))

	got := publisher.snapshot()
	statuses := make([]string, 0, len(got))
	for _, event := range got {
		statuses = append(statuses, event.status)
	}
	want := []string{"starting", "progress", "completed", "starting", "progress", "completed"}
	if len(statuses) != len(want) {
		t.Fatalf("statuses = %#v, want %#v", statuses, want)
	}
	for i := range want {
		if statuses[i] != want[i] {
			t.Errorf("status %d = %q, want %q", i, statuses[i], want[i])
		}
	}
}

func TestUntrackedHistoryTypesDoNotOpenGlobalSyncLifecycle(t *testing.T) {
	publisher := &recordingSyncPublisher{}
	h := New(Config{SyncStatusPublisher: publisher})

	h.handleHistorySync(historySyncEvent(waHistorySync.HistorySync_PUSH_NAME, 100, 0))
	h.handleHistorySync(historySyncEvent(waHistorySync.HistorySync_ON_DEMAND, 100, 1))

	if got := publisher.snapshot(); len(got) != 0 {
		t.Fatalf("untracked history types published lifecycle events: %#v", got)
	}
}

func TestOnDemandHistoryPublishesConversationResult(t *testing.T) {
	pagePublisher := &recordingHistoryPagePublisher{}
	syncType := waHistorySync.HistorySync_ON_DEMAND
	endType := waHistorySync.Conversation_COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY
	h := New(Config{HistoryPagePublisher: pagePublisher})

	h.handleHistorySync(&events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType: &syncType,
		Conversations: []*waHistorySync.Conversation{{
			ID:                       proto.String("15550000000@s.whatsapp.net"),
			EndOfHistoryTransferType: &endType,
		}},
	}})

	if len(pagePublisher.events) != 1 {
		t.Fatalf("got %d page events, want 1", len(pagePublisher.events))
	}
	got := pagePublisher.events[0]
	if got.chatJID != "15550000000@s.whatsapp.net" ||
		got.messageCount != 0 ||
		got.status != "available" {
		t.Fatalf("unexpected page event: %#v", got)
	}
}

func TestRemoteHistoryStatusMapping(t *testing.T) {
	tests := []struct {
		transfer waHistorySync.Conversation_EndOfHistoryTransferType
		want     string
	}{
		{waHistorySync.Conversation_COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY, "available"},
		{waHistorySync.Conversation_COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY, "exhausted"},
		{waHistorySync.Conversation_COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY, "available"},
		{waHistorySync.Conversation_COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS, "unavailable"},
	}
	for _, test := range tests {
		conv := &waHistorySync.Conversation{EndOfHistoryTransferType: &test.transfer}
		if got := remoteHistoryStatus(conv); got != test.want {
			t.Errorf("%s mapped to %q, want %q", test.transfer, got, test.want)
		}
	}
}
