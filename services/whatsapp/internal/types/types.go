package types

import "time"

// SendResponse contains the response data from sending a message.
type SendResponse struct {
	ID        string    // WhatsApp message ID
	Timestamp time.Time // Server timestamp from WhatsApp
}
