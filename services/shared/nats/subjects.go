package nats

// Subject patterns for WhatsApp services.
// Use fmt.Sprintf with companyId and connectionId to build full subjects.
const (
	// Command subjects
	SubjectCommands = "WHATSAPP.commands"

	// Event subject patterns - Format: WHATSAPP.events.{companyId}.{connectionId}.{type}
	SubjectQR              = "WHATSAPP.events.%s.%s.qr"
	SubjectStatus          = "WHATSAPP.events.%s.%s.status"
	SubjectMessage         = "WHATSAPP.events.%s.%s.message"
	SubjectReceipt         = "WHATSAPP.events.%s.%s.receipt"
	SubjectPresence        = "WHATSAPP.events.%s.%s.presence"
	SubjectContact         = "WHATSAPP.events.%s.%s.contact"
	SubjectProfilePicture  = "WHATSAPP.events.%s.%s.profile_picture"
	SubjectMessageRevoke   = "WHATSAPP.events.%s.%s.message_revoke"
	SubjectSendConfirm     = "WHATSAPP.events.%s.%s.send_confirmation"
	SubjectTyping          = "WHATSAPP.events.%s.%s.typing"
	SubjectReaction        = "WHATSAPP.events.%s.%s.reaction"
	SubjectSyncStatus      = "WHATSAPP.events.%s.%s.sync_status"

	// On-demand media download subjects
	SubjectDownloadRequest  = "WHATSAPP.download.%s.%s.request"
	SubjectDownloadResponse = "WHATSAPP.events.%s.%s.download_response"
)
