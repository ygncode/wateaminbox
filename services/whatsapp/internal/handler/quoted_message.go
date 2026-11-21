package handler

import (
	"strings"
	"unicode/utf8"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"

	natsClient "github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/nats"
)

// maxQuotedSnapshotBytes bounds the stored quote text. A preview line is all
// the inbox renders, and an unbounded quote would bloat every reply row.
const maxQuotedSnapshotBytes = 1024

// quotedSnapshotContext returns the context info that carries the quote, if
// any. It is the same carrier getQuotedMessageID reads the stanza id from.
func quotedSnapshotContext(message *waE2E.Message) *waE2E.ContextInfo {
	if message == nil {
		return nil
	}
	for _, carrier := range messageContextCarriers(message) {
		if contextInfo := carrier.GetContextInfo(); contextInfo != nil && contextInfo.GetStanzaID() != "" {
			return contextInfo
		}
	}
	return nil
}

// getQuotedMessageSnapshot builds a text-only snapshot of the quoted message
// from WhatsApp's own copy in the reply's context info. Media is not fetched:
// only its type and caption are kept. Returns nil when WhatsApp sent no copy.
func (h *Handler) getQuotedMessageSnapshot(message *waE2E.Message) *natsClient.QuotedMessagePayload {
	contextInfo := quotedSnapshotContext(message)
	if contextInfo == nil {
		return nil
	}
	quoted := unwrapMediaAlbumMessage(contextInfo.GetQuotedMessage())
	if quoted == nil {
		return nil
	}

	messageType, content := quotedTypeAndContent(quoted)
	if messageType == "" {
		return nil
	}
	snapshot := &natsClient.QuotedMessagePayload{
		MessageType: messageType,
		Content:     truncateUTF8(strings.TrimSpace(content), maxQuotedSnapshotBytes),
	}
	if participant := contextInfo.GetParticipant(); participant != "" {
		if jid, err := types.ParseJID(participant); err == nil {
			snapshot.SenderJID = h.resolvePreferredJID(jid, types.EmptyJID).String()
		}
	}
	return snapshot
}

func quotedTypeAndContent(message *waE2E.Message) (string, string) {
	switch {
	case message.Conversation != nil:
		return "text", message.GetConversation()
	case message.ExtendedTextMessage != nil:
		return "text", message.GetExtendedTextMessage().GetText()
	case message.ImageMessage != nil:
		return "image", message.GetImageMessage().GetCaption()
	case message.VideoMessage != nil:
		return "video", message.GetVideoMessage().GetCaption()
	case message.AudioMessage != nil:
		return "audio", ""
	case message.DocumentMessage != nil:
		document := message.GetDocumentMessage()
		if caption := document.GetCaption(); caption != "" {
			return "document", caption
		}
		return "document", document.GetFileName()
	case message.StickerMessage != nil:
		return "sticker", ""
	case message.LocationMessage != nil:
		return "location", message.GetLocationMessage().GetName()
	case message.ContactMessage != nil:
		return "contact", message.GetContactMessage().GetDisplayName()
	case message.AlbumMessage != nil:
		return "image", ""
	default:
		return "", ""
	}
}

// truncateUTF8 cuts s to at most max bytes without splitting a rune.
func truncateUTF8(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}
