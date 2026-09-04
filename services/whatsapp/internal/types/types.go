package types

import "time"

// SendResponse contains the response data from sending a message.
type SendResponse struct {
	ID        string    // WhatsApp message ID
	Timestamp time.Time // Server timestamp from WhatsApp
}

// MediaAlbumContext identifies one image/video child in a WhatsApp album.
// The first child sends the album manifest before sending itself.
type MediaAlbumContext struct {
	ID         string
	Index      int
	Count      int
	ImageCount int
	VideoCount int
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

// GroupParticipant is one member of a group as WhatsApp reports it.
type GroupParticipant struct {
	JID     string `json:"jid"`
	IsAdmin bool   `json:"isAdmin"`
}

// GroupSnapshot is WhatsApp's authoritative view of a group.
//
// Pointer fields separate "WhatsApp did not mention this" from "WhatsApp said
// false". A change notification only reports what changed, so a snapshot built
// from one must leave every untouched field nil rather than defaulting it.
type GroupSnapshot struct {
	JID                    string             `json:"jid"`
	Name                   *string            `json:"name,omitempty"`
	Description            *string            `json:"description,omitempty"`
	OwnerJID               string             `json:"ownerJid,omitempty"`
	Participants           []GroupParticipant `json:"participants,omitempty"`
	ParticipantCount       *int               `json:"participantCount,omitempty"`
	IsAnnounce             *bool              `json:"isAnnounce,omitempty"`
	IsLocked               *bool              `json:"isLocked,omitempty"`
	IsEphemeral            *bool              `json:"isEphemeral,omitempty"`
	DisappearingTimer      *uint32            `json:"disappearingTimer,omitempty"`
	IsJoinApprovalRequired *bool              `json:"isJoinApprovalRequired,omitempty"`
	MemberAddMode          string             `json:"memberAddMode,omitempty"`
	IsMember               *bool              `json:"isMember,omitempty"`
}

// GroupParticipantResult is WhatsApp's per-participant answer to a participant
// update. WhatsApp applies such a request member by member, so one rejected
// number (privacy settings, no WhatsApp account, already an admin) must not be
// reported as a failure of the whole request.
type GroupParticipantResult struct {
	JID     string `json:"jid"`
	Code    int    `json:"code"`
	Applied bool   `json:"applied"`
}

// GroupJoinRequest is a pending request to join a group with approval enabled.
type GroupJoinRequest struct {
	JID         string    `json:"jid"`
	RequestedAt time.Time `json:"requestedAt"`
}

// GroupSettingsUpdate carries the group settings a command asked to change.
// A nil field means "leave this setting as it is"; WhatsApp needs a separate
// request per setting, so only the non-nil ones are sent.
type GroupSettingsUpdate struct {
	Name                   *string
	Description            *string
	IsAnnounce             *bool
	IsLocked               *bool
	IsJoinApprovalRequired *bool
	MemberAddMode          *string
}

// IsEmpty reports whether the update would change nothing.
func (u GroupSettingsUpdate) IsEmpty() bool {
	return u.Name == nil &&
		u.Description == nil &&
		u.IsAnnounce == nil &&
		u.IsLocked == nil &&
		u.IsJoinApprovalRequired == nil &&
		u.MemberAddMode == nil
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
