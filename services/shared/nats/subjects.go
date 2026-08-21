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
	SubjectHistorySyncPage = "WHATSAPP.events.%s.%s.history_sync_page"
	SubjectLabels          = "WHATSAPP.events.%s.%s.labels"
	SubjectCatalogs        = "WHATSAPP.events.%s.%s.catalogs"
	SubjectCatalogProducts = "WHATSAPP.events.%s.%s.catalog_products"
	SubjectCommandResult   = "WHATSAPP.events.%s.%s.command_result"
	SubjectGroup           = "WHATSAPP.events.%s.%s.group"

	// On-demand media download subjects
	SubjectDownloadRequest  = "WHATSAPP.download.%s.%s.request"
	SubjectDownloadResponse = "WHATSAPP.events.%s.%s.download_response"

	// WorkerRuntimeStatus is a transient, generation-scoped operational signal.
	// It deliberately lives outside WHATSAPP.events so it cannot enter the API's
	// durable event consumer. Format: company, connection, worker launch ID.
	SubjectWorkerRuntimeStatus = "WHATSAPP.workers.%s.%s.%s.status"

	// Connection status subject - used by orchestrator to notify API of worker status changes
	SubjectConnectionStatus = "WHATSAPP.events.%s.%s.connection_status"
)
