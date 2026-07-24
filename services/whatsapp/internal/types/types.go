package types

import "time"

// SendResponse contains the response data from sending a message.
type SendResponse struct {
	ID        string    // WhatsApp message ID
	Timestamp time.Time // Server timestamp from WhatsApp
}

type WhatsAppLabel struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Color        int32  `json:"color"`
	PredefinedID int32  `json:"predefinedId"`
}

type Catalog struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Currency    string    `json:"currency,omitempty"`
	Products    []Product `json:"products"`
}

type Product struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description,omitempty"`
	Price        int64    `json:"price,omitempty"`
	Currency     string   `json:"currency,omitempty"`
	ImageURLs    []string `json:"imageUrls,omitempty"`
	SKU          string   `json:"sku,omitempty"`
	Availability string   `json:"availability,omitempty"`
	URL          string   `json:"url,omitempty"`
	RetailerID   string   `json:"retailerId,omitempty"`
}
