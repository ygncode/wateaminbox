package client

import (
	"context"
	"fmt"
	"time"

	waTypes "go.mau.fi/whatsmeow/types"
)

// RequestHistory asks the primary WhatsApp device for messages immediately
// before the supplied conversation anchor.
func (c *Client) RequestHistory(
	ctx context.Context,
	chatJID string,
	oldestMessageID string,
	oldestFromMe bool,
	oldestTimestamp time.Time,
	count int,
) error {
	if !c.client.IsConnected() {
		return fmt.Errorf("WhatsApp is not connected")
	}
	chat, err := waTypes.ParseJID(chatJID)
	if err != nil || chat.IsEmpty() {
		return fmt.Errorf("invalid history chat JID %q", chatJID)
	}
	if oldestMessageID == "" {
		return fmt.Errorf("oldest message ID is required")
	}
	if oldestTimestamp.IsZero() {
		return fmt.Errorf("oldest message timestamp is required")
	}
	if count < 1 {
		count = 1
	} else if count > 50 {
		count = 50
	}

	request := c.client.BuildHistorySyncRequest(&waTypes.MessageInfo{
		MessageSource: waTypes.MessageSource{
			Chat:     chat.ToNonAD(),
			IsFromMe: oldestFromMe,
			IsGroup:  chat.Server == waTypes.GroupServer,
		},
		ID:        waTypes.MessageID(oldestMessageID),
		Timestamp: oldestTimestamp,
	}, count)
	if _, err = c.client.SendPeerMessage(ctx, request); err != nil {
		return fmt.Errorf("request older WhatsApp history: %w", err)
	}
	return nil
}
