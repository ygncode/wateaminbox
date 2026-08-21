package handler

import (
	"context"
	"log"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"
	waClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/client"
	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// handlePresence processes presence updates.
func (h *Handler) handlePresence(presence *events.Presence) {
	// Presence events are commonly emitted with a LID even when contacts are
	// stored by phone-number JID. Resolve the persisted mapping before
	// publishing so the API can match the event to the contact.
	fromJID := h.resolvePreferredJID(presence.From, types.EmptyJID)

	log.Printf("Presence update from %s: unavailable=%v", fromJID.String(), presence.Unavailable)

	presenceEvent := natsClient.PresenceEvent{
		From:        fromJID.String(),
		Unavailable: presence.Unavailable,
		LastSeen:    presence.LastSeen,
		Timestamp:   time.Now(),
	}

	// Publish to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishPresence(presenceEvent); err != nil {
			log.Printf("Failed to publish presence event: %v", err)
		}
	}
}

// handleChatPresence processes typing indicator events.
func (h *Handler) handleChatPresence(presence *events.ChatPresence) {
	// Resolve LIDs for the same reason as regular presence events. Without this,
	// typing updates use a different JID than the selected conversation.
	senderJID := h.resolvePreferredJID(presence.Sender, presence.SenderAlt)
	chatJID := h.resolvePreferredJID(presence.Chat, presence.RecipientAlt)

	// ChatPresence.State is "composing" when typing, "paused" when stopped
	isTyping := presence.State == types.ChatPresenceComposing

	// Determine media type from ChatPresenceMedia
	mediaType := "text"
	if presence.Media == types.ChatPresenceMediaAudio {
		mediaType = "audio"
	}

	log.Printf("Typing indicator from %s in %s: typing=%v, media=%s",
		senderJID.String(), chatJID.String(), isTyping, mediaType)

	typingEvent := natsClient.TypingEvent{
		From:      senderJID.String(),
		ChatJID:   chatJID.String(),
		IsTyping:  isTyping,
		MediaType: mediaType,
		Timestamp: time.Now(),
	}

	// Publish to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishTyping(typingEvent); err != nil {
			log.Printf("Failed to publish typing event: %v", err)
		}
	}
}

// handleConnected is called when connection is established.
func (h *Handler) handleConnected(evt *events.Connected) {
	log.Printf("Worker %s connected to WhatsApp", h.config.WorkerID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Extract phone number and JID from the client. Existing installations may
	// still have own-device Signal sessions under their phone-number identity;
	// migrate them before the first outbound message uses LID addressing.
	var phoneNumber, jid string
	if h.config.Client != nil {
		client := h.config.Client.GetClient()
		if client != nil && client.Store != nil && client.Store.ID != nil {
			jid = client.Store.ID.String()
			// ID.User contains just the phone number (e.g., "6594603306")
			phoneNumber = client.Store.ID.User
			log.Printf("Connected with JID: %s, Phone: %s", jid, phoneNumber)

			if !client.Store.LID.IsEmpty() && client.Store.Sessions != nil {
				if err := client.Store.Sessions.MigratePNToLID(
					ctx,
					client.Store.ID.ToNonAD(),
					client.Store.LID.ToNonAD(),
				); err != nil {
					log.Printf("Failed to migrate own Signal sessions to LID: %v", err)
				}
			}
		}
	}

	// Mark ourselves as available so WhatsApp servers send us presence updates
	// This is required for receiving presence information from contacts

	if h.config.Client != nil {
		if err := h.config.Client.SendPresence(ctx, types.PresenceAvailable); err != nil {
			log.Printf("Failed to send presence: %v", err)
		} else {
			log.Printf("Marked presence as available")
		}

		// WhatsApp presence subscriptions are connection-scoped. Restore them
		// after every reconnect rather than waiting for another history sync or
		// an incoming message.
		go h.subscribeToKnownContacts()
		go h.syncKnownContactNames()
		go h.syncJoinedGroups()
	}

	// Publish connection status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("connected", "", phoneNumber, jid); err != nil {
			log.Printf("Failed to publish connected status: %v", err)
		}
	}
}

// syncJoinedGroups repairs group metadata after every worker restart. Unlike
// history sync, GetJoinedGroups is available for established sessions, so
// existing workspaces do not need to re-pair to recover names and participants.
func (h *Handler) syncJoinedGroups() {
	if h.config.Client == nil || h.publisher == nil {
		return
	}
	client := h.config.Client.GetClient()
	if client == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	groups, err := client.GetJoinedGroups(ctx)
	if err != nil {
		log.Printf("Failed to refresh joined groups: %v", err)
		return
	}

	for _, group := range groups {
		if group == nil || group.JID.IsEmpty() {
			continue
		}
		snapshot := waClient.SnapshotFromGroupInfo(group, h.resolvePreferredJID)
		if err := h.publisher.PublishGroupSnapshot("", sharednats.GroupActionSnapshot, snapshot); err != nil {
			log.Printf("Failed to publish metadata for group %s: %v", group.JID.String(), err)
		}
	}
	log.Printf("Refreshed metadata for %d joined groups", len(groups))
}

// refreshGroup re-reads one group from WhatsApp and republishes it.
//
// A change notification (events.GroupInfo) only names what changed and reports
// members by JID without their admin status, so applying it directly would
// leave the workspace with a partial participant list. Re-reading is the only
// way to keep the stored group identical to WhatsApp's own view.
func (h *Handler) refreshGroup(groupJID types.JID) {
	if h.config.Client == nil || h.publisher == nil || groupJID.IsEmpty() {
		return
	}
	client := h.config.Client.GetClient()
	if client == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	info, err := client.GetGroupInfo(ctx, groupJID.ToNonAD())
	if err != nil {
		log.Printf("Failed to refresh group %s: %v", groupJID.String(), err)
		return
	}
	snapshot := waClient.SnapshotFromGroupInfo(info, h.resolvePreferredJID)
	if err := h.publisher.PublishGroupSnapshot("", sharednats.GroupActionSnapshot, snapshot); err != nil {
		log.Printf("Failed to publish refreshed group %s: %v", groupJID.String(), err)
	}
}

// runGroupRefresh performs one refresh. Indirected through a field so the
// coalescing logic above can be exercised without a live WhatsApp connection.
func (h *Handler) runGroupRefresh(groupJID types.JID) {
	if h.refreshGroupFn != nil {
		h.refreshGroupFn(groupJID)
		return
	}
	h.refreshGroup(groupJID)
}

// handleGroupInfo processes a live group change made by anyone, including from
// the linked phone or another admin's device.
func (h *Handler) handleGroupInfo(evt *events.GroupInfo) {
	if evt == nil || h.publisher == nil {
		return
	}
	// A group being removed from this account is expressed as this account
	// appearing in Leave. That is a membership change, not a deletion: WhatsApp
	// keeps the group for its other members and offers no way to disband it.
	if h.isSelfLeaving(evt) {
		log.Printf("Left group %s", evt.JID.String())
		if err := h.publisher.PublishGroupLeft("", evt.JID.ToNonAD().String()); err != nil {
			log.Printf("Failed to publish group departure for %s: %v", evt.JID.String(), err)
		}
		return
	}
	h.scheduleGroupRefresh(evt.JID)
}

// scheduleGroupRefresh coalesces refreshes for one group and caps how many run
// at once.
//
// A busy group emits a burst of GroupInfo events (each add, each promote), and
// an offline-sync replay delivers the whole backlog at once. Spawning a
// detached goroutine and a 30-second IQ per event would put the worker into a
// self-inflicted request storm against WhatsApp. Collapsing a burst into one
// refresh is also strictly more correct: the refresh re-reads current state, so
// the last one would have superseded the others anyway.
func (h *Handler) scheduleGroupRefresh(groupJID types.JID) {
	if groupJID.IsEmpty() {
		return
	}
	key := groupJID.ToNonAD().String()

	h.groupRefreshMu.Lock()
	if h.groupRefreshPending == nil {
		h.groupRefreshPending = make(map[string]bool)
	}
	if queued, inFlight := h.groupRefreshPending[key]; inFlight {
		// Already running: mark it so the in-flight refresh re-reads once more
		// after it finishes, rather than starting a competing one.
		if !queued {
			h.groupRefreshPending[key] = true
		}
		h.groupRefreshMu.Unlock()
		return
	}
	h.groupRefreshPending[key] = false
	h.groupRefreshMu.Unlock()

	go func() {
		for {
			// A Handler built without New() has no semaphore; a refresh is still
			// correct without the cap, so degrade rather than deadlock.
			if h.groupRefreshSlots != nil {
				h.groupRefreshSlots <- struct{}{}
			}
			h.runGroupRefresh(groupJID)
			if h.groupRefreshSlots != nil {
				<-h.groupRefreshSlots
			}

			// Deciding to stop and releasing the key MUST be one critical
			// section. Splitting them leaves a window where a new event sees
			// the key still present, records "run again", and returns without
			// starting anything - and the release then discards that request,
			// stranding the group on stale membership until something
			// unrelated happens to refresh it.
			h.groupRefreshMu.Lock()
			if !h.groupRefreshPending[key] {
				delete(h.groupRefreshPending, key)
				h.groupRefreshMu.Unlock()
				return
			}
			h.groupRefreshPending[key] = false
			h.groupRefreshMu.Unlock()
		}
	}()
}

// handleJoinedGroup processes joining or creating a group. The event already
// carries complete metadata, so no extra round trip is needed.
func (h *Handler) handleJoinedGroup(evt *events.JoinedGroup) {
	if evt == nil || h.publisher == nil || evt.JID.IsEmpty() {
		return
	}
	log.Printf("Joined group %s (reason=%s type=%s)", evt.JID.String(), evt.Reason, evt.Type)
	snapshot := waClient.SnapshotFromGroupInfo(&evt.GroupInfo, h.resolvePreferredJID)
	if err := h.publisher.PublishGroupSnapshot("", sharednats.GroupActionSnapshot, snapshot); err != nil {
		log.Printf("Failed to publish joined group %s: %v", evt.JID.String(), err)
	}
}

// isSelfLeaving reports whether this account is among the members leaving.
func (h *Handler) isSelfLeaving(evt *events.GroupInfo) bool {
	if len(evt.Leave) == 0 || h.config.Client == nil {
		return false
	}
	client := h.config.Client.GetClient()
	if client == nil || client.Store == nil {
		return false
	}
	own := make(map[types.JID]struct{}, 2)
	if client.Store.ID != nil {
		own[client.Store.ID.ToNonAD()] = struct{}{}
	}
	if !client.Store.LID.IsEmpty() {
		own[client.Store.LID.ToNonAD()] = struct{}{}
	}
	for _, jid := range evt.Leave {
		if _, isSelf := own[jid.ToNonAD()]; isSelf {
			return true
		}
	}
	return false
}

// subscribeToKnownContacts restores presence subscriptions after a connection
// is established. The contacts store survives worker restarts, while server
// subscriptions do not.
func (h *Handler) subscribeToKnownContacts() {
	client := h.config.Client.GetClient()
	if client == nil || client.Store == nil || client.Store.Contacts == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	contacts, err := client.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		log.Printf("Failed to load contacts for presence subscriptions: %v", err)
		return
	}

	ownJID := types.EmptyJID
	if client.Store.ID != nil {
		ownJID = client.Store.ID.ToNonAD()
	}

	seen := make(map[string]struct{}, len(contacts))
	subscribed := 0
	for jid := range contacts {
		resolved := h.resolvePreferredJID(jid, types.EmptyJID)
		if resolved.Server != types.DefaultUserServer || resolved.User == "" || resolved == ownJID {
			continue
		}

		key := resolved.String()
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		if err := h.config.Client.SubscribePresence(ctx, resolved); err != nil {
			log.Printf("Failed to restore presence subscription for %s: %v", key, err)
		} else {
			subscribed++
		}

		// Avoid sending a large contact list as a burst to WhatsApp.
		select {
		case <-ctx.Done():
			log.Printf("Presence subscription restore stopped after %d contacts: %v", subscribed, ctx.Err())
			return
		case <-time.After(25 * time.Millisecond):
		}
	}

	log.Printf("Restored presence subscriptions for %d contacts", subscribed)
}

// handleDisconnected is called when connection is lost.
func (h *Handler) handleDisconnected(evt *events.Disconnected) {
	log.Printf("Worker %s disconnected from WhatsApp", h.config.WorkerID)

	// Publish disconnection status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("disconnected", "connection_lost", "", ""); err != nil {
			log.Printf("Failed to publish disconnected status: %v", err)
		}
	}

	// An unpaired device has no session to reconnect. Retrying its socket can
	// return before the protocol handshake fails and incorrectly mark it as
	// connected. Leave it disconnected so the user can deliberately restart QR
	// pairing; paired devices continue with automatic recovery.
	if h.config.Client != nil {
		client := h.config.Client.GetClient()
		if client == nil || client.Store == nil || client.Store.ID == nil {
			log.Printf("Worker %s lost an unpaired QR session; waiting for a new pairing attempt", h.config.WorkerID)
			return
		}
		go h.config.Client.HandleReconnect(h.config.Ctx)
	}
}

// handleLoggedOut is called when session is terminated.
func (h *Handler) handleLoggedOut(evt *events.LoggedOut) {
	reason := "unknown"
	if evt.Reason != 0 {
		reason = evt.Reason.String()
	}
	log.Printf("Worker %s logged out: %s", h.config.WorkerID, reason)

	// Publish logged out status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("logged_out", reason, "", ""); err != nil {
			log.Printf("Failed to publish logged out status: %v", err)
		}
	}
}

// handleQR is called when QR code is available.
// Note: QR codes are published via the callback set in main.go (SetQRCallback).
// This handler only logs the event to avoid duplicate publishing.
func (h *Handler) handleQR(evt *events.QR) {
	log.Printf("QR code event for worker %s: %d codes available", h.config.WorkerID, len(evt.Codes))
}

// handlePairSuccess is called when device pairing succeeds.
func (h *Handler) handlePairSuccess(evt *events.PairSuccess) {
	log.Printf("Worker %s paired successfully with %s", h.config.WorkerID, evt.ID.String())

	// Extract phone number from the paired JID
	jid := evt.ID.String()
	phoneNumber := evt.ID.User

	// Publish pair success status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("paired", "", phoneNumber, jid); err != nil {
			log.Printf("Failed to publish pair success status: %v", err)
		}
	}
}

// handleStreamReplaced is called when the stream is replaced (logged in elsewhere).
func (h *Handler) handleStreamReplaced(evt *events.StreamReplaced) {
	log.Printf("Worker %s: stream replaced (logged in elsewhere)", h.config.WorkerID)

	// Publish stream replaced status to NATS
	if h.publisher != nil {
		if err := h.publisher.PublishConnectionStatus("disconnected", "stream_replaced", "", ""); err != nil {
			log.Printf("Failed to publish stream replaced status: %v", err)
		}
	}
}

// handlePicture processes profile picture updates.
func (h *Handler) handlePicture(evt *events.Picture) {
	// Picture events may identify a person by their private LID while contacts
	// are stored by phone-number JID. Resolve the same canonical identity used
	// by message and history handling before fetching or publishing.
	canonicalJID := h.resolvePreferredJID(evt.JID, types.EmptyJID).ToNonAD()
	cacheKey := canonicalJID.String()
	log.Printf("Profile picture update for %s (remove: %v)", cacheKey, evt.Remove)

	// A WhatsApp change event supersedes any command-driven cache entry.
	h.profilePictureCache.Delete(cacheKey)
	var profilePictureURL string
	if !evt.Remove {
		var err error
		profilePictureURL, err = h.fetchProfilePicture(canonicalJID)
		if err != nil {
			log.Printf("Failed to fetch new profile picture for %s: %v", cacheKey, err)
			return
		}
		if profilePictureURL == "" {
			// The change notification can arrive before the new CDN URL becomes
			// readable. Preserve the last known picture rather than clearing it.
			log.Printf("New profile picture is not yet available for %s", cacheKey)
			return
		}
		h.profilePictureCache.Store(cacheKey, profilePictureCacheEntry{url: profilePictureURL})
	}

	if h.publisher != nil {
		if err := h.publisher.PublishProfilePicture(cacheKey, profilePictureURL, evt.Remove, evt.Timestamp); err != nil {
			log.Printf("Failed to publish profile picture update: %v", err)
		}
	}
}

// Offline sync is WhatsApp's short catch-up of missed live events. It is
// independent from the downloadable history transfer, so these events must not
// drive the history-sync overlay lifecycle.
func (h *Handler) handleOfflineSyncPreview(evt *events.OfflineSyncPreview) {
	log.Printf("Offline catch-up starting: %d messages, %d notifications expected",
		evt.Messages, evt.Notifications)
}

func (h *Handler) handleOfflineSyncCompleted(evt *events.OfflineSyncCompleted) {
	log.Printf("Offline catch-up completed: %d events", evt.Count)
}
