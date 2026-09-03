package handler

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
)

const (
	// IsOnWhatsApp performs a lighter USync than GetUserInfo: it asks for LID
	// addressing without fetching profile pictures, statuses, device lists, or
	// privacy tokens. Keep requests small and paced to protect real accounts.
	groupLIDRepairBatchSize     = 50
	groupLIDRepairMaxCandidates = 3000
	groupLIDRepairPause         = 5 * time.Second
	groupLIDRepairTimeout       = 10 * time.Minute
	groupLIDRepairMaxAttempts   = 2
)

type groupLIDDirectory interface {
	KnownLIDs(context.Context, []types.JID) (map[types.JID]types.JID, error)
	ResolveLIDs(context.Context, []types.JID) error
}

type whatsmeowGroupLIDDirectory struct {
	client *whatsmeow.Client
}

func (directory whatsmeowGroupLIDDirectory) KnownLIDs(
	ctx context.Context,
	phoneJIDs []types.JID,
) (map[types.JID]types.JID, error) {
	return directory.client.Store.LIDs.GetManyLIDsForPNs(ctx, phoneJIDs)
}

func lidMappingsFromDirectoryResponses(
	responses []types.IsOnWhatsAppResponse,
) []waStore.LIDMapping {
	mappings := make([]waStore.LIDMapping, 0, len(responses))
	for _, response := range responses {
		isLID := response.JID.Server == types.HiddenUserServer ||
			response.JID.Server == types.HostedLIDServer
		if isLID && response.PhoneNumber.Server == types.DefaultUserServer {
			mappings = append(mappings, waStore.LIDMapping{
				LID: response.JID.ToNonAD(),
				PN:  response.PhoneNumber.ToNonAD(),
			})
		}
	}
	return mappings
}

func (directory whatsmeowGroupLIDDirectory) ResolveLIDs(
	ctx context.Context,
	phoneJIDs []types.JID,
) error {
	phones := make([]string, len(phoneJIDs))
	for index, jid := range phoneJIDs {
		phones[index] = "+" + strings.TrimPrefix(jid.User, "+")
	}
	responses, err := directory.client.IsOnWhatsApp(ctx, phones)
	if err != nil {
		return err
	}
	// whatsmeow currently persists ordinary @lid responses itself, but not
	// @hosted.lid. Persist both forms explicitly and surface store failures.
	return directory.client.Store.LIDs.PutManyLIDMappings(
		ctx,
		lidMappingsFromDirectoryResponses(responses),
	)
}

type groupLIDRepairStats struct {
	Candidates    int
	Missing       int
	Attempted     int
	Resolved      int
	Unresolved    int
	Skipped       int
	FailedBatches int
}

func groupParticipantPhoneJIDs(groups []*types.GroupInfo) []types.JID {
	unique := make(map[types.JID]struct{})
	add := func(jid types.JID) {
		jid = jid.ToNonAD()
		if jid.User != "" && jid.Server == types.DefaultUserServer {
			unique[jid] = struct{}{}
		}
	}

	for _, group := range groups {
		if group == nil {
			continue
		}
		add(group.OwnerPN)
		for _, participant := range group.Participants {
			if !participant.PhoneNumber.IsEmpty() {
				add(participant.PhoneNumber)
			} else {
				add(participant.JID)
			}
		}
	}

	phoneJIDs := make([]types.JID, 0, len(unique))
	for jid := range unique {
		phoneJIDs = append(phoneJIDs, jid)
	}
	sort.Slice(phoneJIDs, func(i, j int) bool {
		return phoneJIDs[i].String() < phoneJIDs[j].String()
	})
	return phoneJIDs
}

func waitForGroupLIDRepair(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return ctx.Err()
	}
	jitter := delay / 5
	if jitter > 0 {
		delay = delay - jitter + time.Duration(rand.Int63n(int64(2*jitter)+1))
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func repairMissingGroupLIDs(
	ctx context.Context,
	directory groupLIDDirectory,
	groups []*types.GroupInfo,
	maxCandidates int,
	batchSize int,
	pause time.Duration,
) (groupLIDRepairStats, error) {
	phoneJIDs := groupParticipantPhoneJIDs(groups)
	stats := groupLIDRepairStats{Candidates: len(phoneJIDs)}
	if len(phoneJIDs) == 0 {
		return stats, nil
	}
	if batchSize <= 0 {
		batchSize = len(phoneJIDs)
	}

	known, err := directory.KnownLIDs(ctx, phoneJIDs)
	if err != nil {
		return stats, err
	}
	missing := make([]types.JID, 0, len(phoneJIDs))
	for _, jid := range phoneJIDs {
		if _, exists := known[jid]; !exists {
			missing = append(missing, jid)
		}
	}
	stats.Missing = len(missing)
	if len(missing) == 0 {
		return stats, nil
	}
	if maxCandidates > 0 && len(missing) > maxCandidates {
		stats.Skipped = len(missing) - maxCandidates
		missing = missing[:maxCandidates]
	}
	selected := len(missing)

	var batchErrors []error
	for start := 0; start < len(missing); start += batchSize {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		end := min(start+batchSize, len(missing))
		stats.Attempted += end - start
		stats.Unresolved = stats.Attempted - stats.Resolved
		var batchErr error
		for attempt := 1; attempt <= groupLIDRepairMaxAttempts; attempt++ {
			batchErr = directory.ResolveLIDs(ctx, missing[start:end])
			if batchErr == nil {
				break
			}
			if ctx.Err() != nil {
				return stats, ctx.Err()
			}
			if attempt < groupLIDRepairMaxAttempts {
				if err := waitForGroupLIDRepair(ctx, pause); err != nil {
					return stats, err
				}
			}
		}
		if batchErr != nil {
			stats.FailedBatches++
			batchErrors = append(batchErrors, batchErr)
		}
		batchKnown, knownErr := directory.KnownLIDs(ctx, missing[start:end])
		if knownErr != nil {
			return stats, knownErr
		}
		stats.Resolved += len(batchKnown)
		stats.Unresolved = stats.Attempted - stats.Resolved
		if end < selected {
			if err := waitForGroupLIDRepair(ctx, pause); err != nil {
				return stats, err
			}
		}
	}

	if len(batchErrors) > 0 {
		return stats, fmt.Errorf(
			"%d group LID lookup batches failed: %w",
			stats.FailedBatches,
			errors.Join(batchErrors...),
		)
	}
	return stats, nil
}

func (h *Handler) startJoinedGroupSync() {
	parent := h.config.Ctx
	if parent == nil {
		parent = context.Background()
	}

	h.groupSyncMu.Lock()
	if h.groupSyncCancel != nil {
		h.groupSyncCancel()
	}
	ctx, cancel := context.WithCancel(parent)
	h.groupSyncCancel = cancel
	h.groupSyncMu.Unlock()

	go h.syncJoinedGroups(ctx)
}

func (h *Handler) cancelJoinedGroupSync() {
	h.groupSyncMu.Lock()
	if h.groupSyncCancel != nil {
		h.groupSyncCancel()
		h.groupSyncCancel = nil
	}
	h.groupSyncMu.Unlock()
}

func (h *Handler) beginGroupLIDRepair(parent context.Context) (context.Context, func(), bool) {
	h.groupSyncMu.Lock()
	if h.groupLIDRepairStarted || h.groupLIDRepairInProgress || parent.Err() != nil {
		h.groupSyncMu.Unlock()
		return nil, nil, false
	}
	h.groupLIDRepairStarted = true
	h.groupLIDRepairInProgress = true
	ctx, cancel := context.WithTimeout(parent, groupLIDRepairTimeout)
	h.groupSyncMu.Unlock()

	finish := func() {
		cancel()
		h.groupSyncMu.Lock()
		h.groupLIDRepairInProgress = false
		h.groupSyncMu.Unlock()
	}
	return ctx, finish, true
}
