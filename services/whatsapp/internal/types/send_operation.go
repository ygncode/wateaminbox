package types

import (
	"context"
	"crypto/sha256"
	"fmt"
)

type sendOperationKey struct{}

// SendOperation carries a durable identity and a write-ahead hook to the exact
// boundary at which a command may become visible on WhatsApp.
type SendOperation struct {
	ID         string
	BeforeSend func(context.Context) error
}

func CommandMessageID(companyID, connectionID, commandID string) string {
	sum := sha256.Sum256([]byte(companyID + "\x00" + connectionID + "\x00" + commandID))
	return fmt.Sprintf("3EB0%X", sum[:14])
}

func WithSendOperation(ctx context.Context, operation SendOperation) context.Context {
	return context.WithValue(ctx, sendOperationKey{}, operation)
}

func SendOperationFromContext(ctx context.Context) SendOperation {
	operation, _ := ctx.Value(sendOperationKey{}).(SendOperation)
	return operation
}

// UnknownSendOutcome means the transport was invoked but acceptance could not
// be established. Retrying it as a fresh send risks duplicating a customer message.
type UnknownSendOutcome struct{ Err error }

func (e *UnknownSendOutcome) Error() string { return "send outcome unknown: " + e.Err.Error() }
func (e *UnknownSendOutcome) Unwrap() error { return e.Err }
