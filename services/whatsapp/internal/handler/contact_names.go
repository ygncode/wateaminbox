package handler

import (
	"context"
	"log"
	"strings"
	"time"
	"unicode"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// isRedactedContactLabel detects WhatsApp privacy labels such as
// "+65∙∙∙∙∙∙06". These are not names and should never replace the full phone
// number used as the UI fallback.
func isRedactedContactLabel(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}

	digits, redactions := 0, 0
	for _, char := range value {
		switch char {
		case '∙', '•', '·', '*':
			redactions++
		default:
			if unicode.IsDigit(char) {
				digits++
			}
		}
	}
	return digits >= 2 && redactions >= 2
}

func mergeContactInfo(current, incoming types.ContactInfo) types.ContactInfo {
	if current.FirstName == "" {
		current.FirstName = incoming.FirstName
	}
	if current.FullName == "" {
		current.FullName = incoming.FullName
	}
	if current.PushName == "" {
		current.PushName = incoming.PushName
	}
	if current.BusinessName == "" {
		current.BusinessName = incoming.BusinessName
	}
	current.Found = current.Found || incoming.Found
	return current
}

func (h *Handler) publishContactInfo(jid, alternative types.JID, info types.ContactInfo) {
	if h.publisher == nil {
		return
	}

	resolved := h.resolvePreferredJID(jid, alternative)
	if resolved.Server != types.DefaultUserServer || resolved.User == "" {
		return
	}

	// A redacted phone is metadata, not a person's name. Push names can also
	// contain the redacted value in some history-sync conversation records.
	if isRedactedContactLabel(info.FirstName) {
		info.FirstName = ""
	}
	if isRedactedContactLabel(info.FullName) {
		info.FullName = ""
	}
	if isRedactedContactLabel(info.PushName) {
		info.PushName = ""
	}
	if isRedactedContactLabel(info.BusinessName) {
		info.BusinessName = ""
	}
	if info.FirstName == "" && info.FullName == "" && info.PushName == "" && info.BusinessName == "" {
		return
	}

	if err := h.publisher.PublishContactName(
		resolved.String(),
		info.FirstName,
		info.FullName,
		info.PushName,
		info.BusinessName,
	); err != nil {
		log.Printf("Failed to publish name for contact %s: %v", resolved.String(), err)
	}
}

// syncKnownContactNames copies whatsmeow's durable contact-name cache into the
// tenant contacts used by the inbox. It runs on connection and after the first
// app-state contact sync, repairing names even when the worker was restarted.
func (h *Handler) syncKnownContactNames() {
	if h.config.Client == nil || h.publisher == nil {
		return
	}
	client := h.config.Client.GetClient()
	if client == nil || client.Store == nil || client.Store.Contacts == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	contacts, err := client.Store.Contacts.GetAllContacts(ctx)
	if err != nil {
		log.Printf("Failed to load cached WhatsApp contact names: %v", err)
		return
	}

	// A person may be cached under both a private LID and a phone-number JID.
	// Resolve and merge first so event ordering cannot replace a saved name with
	// a lower-quality push name.
	merged := make(map[types.JID]types.ContactInfo, len(contacts))
	for jid, info := range contacts {
		resolved := h.resolvePreferredJID(jid, types.EmptyJID)
		if resolved.Server != types.DefaultUserServer || resolved.User == "" {
			continue
		}
		resolved = resolved.ToNonAD()
		merged[resolved] = mergeContactInfo(merged[resolved], info)
	}

	published := 0
	for jid, info := range merged {
		before := info
		h.publishContactInfo(jid, types.EmptyJID, info)
		if before.FirstName != "" || before.FullName != "" || before.PushName != "" || before.BusinessName != "" {
			published++
		}
	}
	log.Printf("Published cached names for %d WhatsApp contacts", published)
}

func (h *Handler) publishContactUsername(jid, alternative types.JID, username *string) {
	if h.publisher == nil || username == nil {
		return
	}
	resolved := h.resolvePreferredJID(jid, alternative).ToNonAD()
	if resolved.User == "" || (resolved.Server != types.DefaultUserServer && resolved.Server != types.HiddenUserServer && resolved.Server != types.HostedLIDServer) {
		return
	}
	if err := h.publisher.PublishContactUsername(resolved.String(), username); err != nil {
		log.Printf("Failed to publish username for contact %s: %v", resolved.String(), err)
	}
}

func (h *Handler) handleContactName(evt *events.Contact) {
	if evt == nil || evt.Action == nil {
		return
	}

	primary := evt.JID
	alternative := types.EmptyJID
	if pn, err := types.ParseJID(evt.Action.GetPnJID()); err == nil && !pn.IsEmpty() {
		primary = pn
	}
	if lid, err := types.ParseJID(evt.Action.GetLidJID()); err == nil && !lid.IsEmpty() {
		alternative = lid
	}

	h.publishContactInfo(primary, alternative, types.ContactInfo{
		FirstName: evt.Action.GetFirstName(),
		FullName:  evt.Action.GetFullName(),
	})
	h.publishContactUsername(primary, alternative, evt.Action.Username)
}

func lidFromAppStateIndex(index []string) types.JID {
	for i := len(index) - 1; i >= 0; i-- {
		value := strings.TrimSpace(index[i])
		if value == "" {
			continue
		}
		if strings.Contains(value, "@") {
			jid, err := types.ParseJID(value)
			if err == nil && (jid.Server == types.HiddenUserServer || jid.Server == types.HostedLIDServer) {
				return jid.ToNonAD()
			}
			continue
		}
		if len(value) >= 8 && strings.IndexFunc(value, func(char rune) bool { return char < '0' || char > '9' }) == -1 {
			return types.NewJID(value, types.HiddenUserServer)
		}
	}
	return types.EmptyJID
}

// LidContactAction currently has no dedicated high-level whatsmeow event. The
// generic app-state event carries the LID in its index and the public username
// in the action, so preserve it without treating the LID as a phone number.
func (h *Handler) handleLIDContactAction(evt *events.AppState) {
	if evt == nil || evt.GetLidContactAction() == nil {
		return
	}
	jid := lidFromAppStateIndex(evt.Index)
	if jid.IsEmpty() {
		return
	}
	h.publishContactUsername(jid, types.EmptyJID, evt.GetLidContactAction().Username)
}

func (h *Handler) getCachedContactInfo(jids ...types.JID) types.ContactInfo {
	var info types.ContactInfo
	if h.config.Client == nil {
		return info
	}
	client := h.config.Client.GetClient()
	if client == nil || client.Store == nil || client.Store.Contacts == nil {
		return info
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for _, jid := range jids {
		if jid.IsEmpty() {
			continue
		}
		cached, err := client.Store.Contacts.GetContact(ctx, jid)
		if err == nil {
			info = mergeContactInfo(info, cached)
		}
	}
	return info
}

func (h *Handler) handlePushName(evt *events.PushName) {
	if evt == nil {
		return
	}
	info := h.getCachedContactInfo(evt.JID, evt.JIDAlt)
	info.PushName = evt.NewPushName
	h.publishContactInfo(evt.JID, evt.JIDAlt, info)
}

func (h *Handler) handleBusinessName(evt *events.BusinessName) {
	if evt == nil {
		return
	}
	info := h.getCachedContactInfo(evt.JID)
	info.BusinessName = evt.NewBusinessName
	h.publishContactInfo(evt.JID, types.EmptyJID, info)
}
