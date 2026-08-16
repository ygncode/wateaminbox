package client

import (
	"context"
	"fmt"
	"strings"

	"go.mau.fi/whatsmeow"
	waTypes "go.mau.fi/whatsmeow/types"

	"github.com/ygncode-lab/whatsapp-web/services/whatsapp/internal/types"
)

// Group administration wrappers around whatsmeow.
//
// Every mutating call here does exactly what it was asked to do and returns;
// none of them update local state. The API's copy of a group is refreshed from
// a snapshot the worker fetches back from WhatsApp AFTER the mutation lands
// (see nats.Subscriber.handleGroupCommand), so a rejected or partially applied
// request can never leave the workspace showing a change WhatsApp did not make.
//
// Note on what is deliberately missing: WhatsApp has no "delete group" or
// "disband group" operation and whatsmeow exposes none, so neither does this
// file. LeaveGroup ends this account's membership only.

// parseGroupJID rejects anything that is not a WhatsApp group address before it
// reaches the wire. A user JID would otherwise be accepted by ParseJID and sent
// as a group IQ, producing an opaque server error.
func parseGroupJID(groupJID string) (waTypes.JID, error) {
	parsed, err := waTypes.ParseJID(groupJID)
	if err != nil {
		return waTypes.EmptyJID, fmt.Errorf("invalid group JID: %w", err)
	}
	if parsed.Server != waTypes.GroupServer {
		return waTypes.EmptyJID, fmt.Errorf("JID %q is not a group", groupJID)
	}
	return parsed.ToNonAD(), nil
}

func parseParticipantJIDs(participantJIDs []string) ([]waTypes.JID, error) {
	if len(participantJIDs) == 0 {
		return nil, fmt.Errorf("no participants supplied")
	}
	parsed := make([]waTypes.JID, 0, len(participantJIDs))
	for _, raw := range participantJIDs {
		jid, err := waTypes.ParseJID(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid participant JID %q: %w", raw, err)
		}
		parsed = append(parsed, jid.ToNonAD())
	}
	return parsed, nil
}

// participantResults maps WhatsApp's per-participant status codes into a flat
// result list. WhatsApp reports success by omitting the error attribute, which
// parseParticipant surfaces as a zero Error.
func participantResults(participants []waTypes.GroupParticipant) []types.GroupParticipantResult {
	results := make([]types.GroupParticipantResult, 0, len(participants))
	for _, participant := range participants {
		jid := participant.JID
		if jid.IsEmpty() {
			jid = participant.PhoneNumber
		}
		results = append(results, types.GroupParticipantResult{
			JID:     jid.ToNonAD().String(),
			Code:    participant.Error,
			Applied: participant.Error == 0,
		})
	}
	return results
}

// preferPhoneJID collapses WhatsApp's two addresses for one person into the
// single form the workspace stores.
//
// `GroupParticipant.JID` is whichever address the group is addressed by - a LID
// in a LID-addressed group, a phone number otherwise. Storing whatever arrives
// would make the SAME member look like two different people depending on which
// code path produced the snapshot, and the API resolves group membership (and
// therefore admin rights) by comparing against the connection's phone JID. So
// the phone number always wins when WhatsApp supplies one.
func preferPhoneJID(primary, phoneNumber waTypes.JID) waTypes.JID {
	if primary.IsEmpty() {
		primary = phoneNumber
	}
	if isLIDServer(primary.Server) && !phoneNumber.IsEmpty() {
		return phoneNumber
	}
	return primary
}

// isLIDServer reports whether a JID is one of WhatsApp's link-ID addresses.
// Both hosted and ordinary LIDs are opaque identities that map to a phone
// number, and the handler's own resolver treats them the same way - missing
// HostedLIDServer here would leave that one form un-collapsed.
func isLIDServer(server string) bool {
	return server == waTypes.HiddenUserServer || server == waTypes.HostedLIDServer
}

// resolveLID turns a link-ID into the phone number the workspace stores.
//
// `preferPhoneJID` can only use the phone number WhatsApp put in the same
// response, and WhatsApp omits it for anonymous members of announcement groups.
// The stored LID mapping - learned from messages and earlier fetches - is the
// second source, and it is what the event path has always consulted. Without it
// the command path would keep writing LIDs for exactly those members, and the
// two paths would go back to overwriting each other.
func (c *Client) resolveLID(ctx context.Context, primary, phoneNumber waTypes.JID) waTypes.JID {
	resolved := preferPhoneJID(primary, phoneNumber)
	if !isLIDServer(resolved.Server) {
		return resolved
	}
	if c.client == nil || c.client.Store == nil || c.client.Store.LIDs == nil {
		return resolved
	}
	phone, err := c.client.Store.LIDs.GetPNForLID(ctx, resolved.ToNonAD())
	if err != nil || phone.IsEmpty() {
		// No mapping known yet. The LID is a real, usable identity, so keep it
		// rather than dropping the member.
		return resolved
	}
	return phone
}

// groupJIDResolver binds a context so the snapshot builder can consult the
// stored LID mapping without taking a context parameter of its own.
func (c *Client) groupJIDResolver(ctx context.Context) func(waTypes.JID, waTypes.JID) waTypes.JID {
	return func(primary, phoneNumber waTypes.JID) waTypes.JID {
		return c.resolveLID(ctx, primary, phoneNumber)
	}
}

// snapshotFromGroupInfo converts whatsmeow's group metadata into the snapshot
// the API persists. Every field is populated because a GetGroupInfo response is
// complete by definition - unlike a change notification, which is partial.
//
// `resolve` is the second pass that consults the stored LID mapping. Both the
// command path and the event path supply one, and its result is fed back
// through preferPhoneJID, so neither path can end up storing a LID for a member
// the other stores by phone number.
func snapshotFromGroupInfo(info *waTypes.GroupInfo, resolve func(waTypes.JID, waTypes.JID) waTypes.JID) types.GroupSnapshot {
	name := info.Name
	description := info.Topic
	if info.TopicDeleted {
		description = ""
	}
	isAnnounce := info.IsAnnounce
	isLocked := info.IsLocked
	isEphemeral := info.IsEphemeral
	disappearingTimer := info.DisappearingTimer
	joinApproval := info.IsJoinApprovalRequired
	isMember := true

	// One address rule for every JID in the snapshot - members and owner alike.
	// Applying it in only some places is what let the two paths diverge before.
	collapse := func(primary, phoneNumber waTypes.JID) waTypes.JID {
		collapsed := preferPhoneJID(primary, phoneNumber)
		if resolve == nil {
			return collapsed
		}
		return preferPhoneJID(resolve(collapsed, phoneNumber), phoneNumber)
	}

	participants := make([]types.GroupParticipant, 0, len(info.Participants))
	for _, participant := range info.Participants {
		primary := collapse(participant.JID, participant.PhoneNumber)
		if primary.User == "" || primary.Server == "" {
			continue
		}
		participants = append(participants, types.GroupParticipant{
			JID:     primary.ToNonAD().String(),
			IsAdmin: participant.IsAdmin || participant.IsSuperAdmin,
		})
	}

	participantCount := info.ParticipantCount
	if participantCount <= 0 {
		participantCount = len(participants)
	}

	// The owner is subject to the same two-address problem, and is compared
	// against connection JIDs by anything that asks "do we own this group".
	owner := collapse(info.OwnerJID, info.OwnerPN)

	return types.GroupSnapshot{
		JID:                    info.JID.ToNonAD().String(),
		Name:                   &name,
		Description:            &description,
		OwnerJID:               ownerJIDString(owner),
		Participants:           participants,
		ParticipantCount:       &participantCount,
		IsAnnounce:             &isAnnounce,
		IsLocked:               &isLocked,
		IsEphemeral:            &isEphemeral,
		DisappearingTimer:      &disappearingTimer,
		IsJoinApprovalRequired: &joinApproval,
		MemberAddMode:          string(info.MemberAddMode),
		IsMember:               &isMember,
	}
}

func ownerJIDString(owner waTypes.JID) string {
	if owner.IsEmpty() {
		return ""
	}
	return owner.ToNonAD().String()
}

// SnapshotFromGroupInfo exposes the conversion for callers that already hold
// group metadata (the connection-level joined-group refresh), so a snapshot is
// built exactly one way regardless of where the metadata came from.
func SnapshotFromGroupInfo(info *waTypes.GroupInfo, resolve func(waTypes.JID, waTypes.JID) waTypes.JID) types.GroupSnapshot {
	return snapshotFromGroupInfo(info, resolve)
}

// GetGroupSnapshot fetches WhatsApp's current view of a group.
func (c *Client) GetGroupSnapshot(ctx context.Context, groupJID string) (types.GroupSnapshot, error) {
	group, err := parseGroupJID(groupJID)
	if err != nil {
		return types.GroupSnapshot{}, err
	}
	info, err := c.client.GetGroupInfo(ctx, group)
	if err != nil {
		return types.GroupSnapshot{}, fmt.Errorf("failed to fetch group info: %w", err)
	}
	return snapshotFromGroupInfo(info, c.groupJIDResolver(ctx)), nil
}

// CreateGroup creates a group with the given subject and initial members.
//
// WhatsApp adds the creating account implicitly, so the caller must not include
// its own JID. The returned snapshot is WhatsApp's own description of the new
// group, including the members it refused to add.
func (c *Client) CreateGroup(ctx context.Context, name string, participantJIDs []string) (types.GroupSnapshot, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return types.GroupSnapshot{}, fmt.Errorf("group name is required")
	}
	participants, err := parseParticipantJIDs(participantJIDs)
	if err != nil {
		return types.GroupSnapshot{}, err
	}
	info, err := c.client.CreateGroup(ctx, whatsmeow.ReqCreateGroup{
		Name:         trimmed,
		Participants: participants,
	})
	if err != nil {
		return types.GroupSnapshot{}, fmt.Errorf("failed to create group: %w", err)
	}
	return snapshotFromGroupInfo(info, c.groupJIDResolver(ctx)), nil
}

// UpdateGroupParticipants adds, removes, promotes or demotes group members.
func (c *Client) UpdateGroupParticipants(
	ctx context.Context,
	groupJID string,
	participantJIDs []string,
	action string,
) ([]types.GroupParticipantResult, error) {
	group, err := parseGroupJID(groupJID)
	if err != nil {
		return nil, err
	}
	participants, err := parseParticipantJIDs(participantJIDs)
	if err != nil {
		return nil, err
	}
	change, err := parseParticipantChange(action)
	if err != nil {
		return nil, err
	}
	updated, err := c.client.UpdateGroupParticipants(ctx, group, participants, change)
	if err != nil {
		return nil, fmt.Errorf("failed to %s group participants: %w", action, err)
	}
	return participantResults(updated), nil
}

func parseParticipantChange(action string) (whatsmeow.ParticipantChange, error) {
	switch action {
	case string(whatsmeow.ParticipantChangeAdd),
		string(whatsmeow.ParticipantChangeRemove),
		string(whatsmeow.ParticipantChangePromote),
		string(whatsmeow.ParticipantChangeDemote):
		return whatsmeow.ParticipantChange(action), nil
	default:
		return "", fmt.Errorf("unsupported participant action %q", action)
	}
}

// UpdateGroupSettings applies the requested subset of group settings.
//
// WhatsApp has no combined "update group" request, so each setting is its own
// IQ. The first failure aborts, which leaves earlier settings applied - the
// snapshot the caller fetches afterwards is what makes that state visible
// rather than silently diverging.
func (c *Client) UpdateGroupSettings(
	ctx context.Context,
	groupJID string,
	update types.GroupSettingsUpdate,
) error {
	group, err := parseGroupJID(groupJID)
	if err != nil {
		return err
	}
	if update.IsEmpty() {
		return fmt.Errorf("no group settings supplied")
	}
	if update.Name != nil {
		if err = c.client.SetGroupName(ctx, group, *update.Name); err != nil {
			return fmt.Errorf("failed to update group name: %w", err)
		}
	}
	if update.Description != nil {
		if err = c.client.SetGroupDescription(ctx, group, *update.Description); err != nil {
			return fmt.Errorf("failed to update group description: %w", err)
		}
	}
	if update.IsAnnounce != nil {
		if err = c.client.SetGroupAnnounce(ctx, group, *update.IsAnnounce); err != nil {
			return fmt.Errorf("failed to update who can send messages: %w", err)
		}
	}
	if update.IsLocked != nil {
		if err = c.client.SetGroupLocked(ctx, group, *update.IsLocked); err != nil {
			return fmt.Errorf("failed to update who can edit group info: %w", err)
		}
	}
	if update.IsJoinApprovalRequired != nil {
		if err = c.client.SetGroupJoinApprovalMode(ctx, group, *update.IsJoinApprovalRequired); err != nil {
			return fmt.Errorf("failed to update join approval mode: %w", err)
		}
	}
	if update.MemberAddMode != nil {
		mode := waTypes.GroupMemberAddMode(*update.MemberAddMode)
		if err = c.client.SetGroupMemberAddMode(ctx, group, mode); err != nil {
			return fmt.Errorf("failed to update who can add members: %w", err)
		}
	}
	return nil
}

// LeaveGroup ends this account's membership.
//
// This is NOT a delete: WhatsApp offers no way to remove a group for its other
// members, and the group continues to exist without this account.
func (c *Client) LeaveGroup(ctx context.Context, groupJID string) error {
	group, err := parseGroupJID(groupJID)
	if err != nil {
		return err
	}
	if err = c.client.LeaveGroup(ctx, group); err != nil {
		return fmt.Errorf("failed to leave group: %w", err)
	}
	return nil
}

// GetGroupInviteLink returns the group's invite link. When reset is true the
// previous link is revoked first, so any link already shared stops working.
func (c *Client) GetGroupInviteLink(ctx context.Context, groupJID string, reset bool) (string, error) {
	group, err := parseGroupJID(groupJID)
	if err != nil {
		return "", err
	}
	link, err := c.client.GetGroupInviteLink(ctx, group, reset)
	if err != nil {
		return "", fmt.Errorf("failed to get group invite link: %w", err)
	}
	return link, nil
}

// GetGroupJoinRequests lists the pending membership approval requests.
func (c *Client) GetGroupJoinRequests(ctx context.Context, groupJID string) ([]types.GroupJoinRequest, error) {
	group, err := parseGroupJID(groupJID)
	if err != nil {
		return nil, err
	}
	requests, err := c.client.GetGroupRequestParticipants(ctx, group)
	if err != nil {
		return nil, fmt.Errorf("failed to list group join requests: %w", err)
	}
	result := make([]types.GroupJoinRequest, 0, len(requests))
	for _, request := range requests {
		if request.JID.IsEmpty() {
			continue
		}
		result = append(result, types.GroupJoinRequest{
			JID:         request.JID.ToNonAD().String(),
			RequestedAt: request.RequestedAt,
		})
	}
	return result, nil
}

// UpdateGroupJoinRequests approves or rejects pending requests to join.
func (c *Client) UpdateGroupJoinRequests(
	ctx context.Context,
	groupJID string,
	participantJIDs []string,
	action string,
) ([]types.GroupParticipantResult, error) {
	group, err := parseGroupJID(groupJID)
	if err != nil {
		return nil, err
	}
	participants, err := parseParticipantJIDs(participantJIDs)
	if err != nil {
		return nil, err
	}
	change, err := parseRequestChange(action)
	if err != nil {
		return nil, err
	}
	updated, err := c.client.UpdateGroupRequestParticipants(ctx, group, participants, change)
	if err != nil {
		return nil, fmt.Errorf("failed to %s group join requests: %w", action, err)
	}
	return participantResults(updated), nil
}

func parseRequestChange(action string) (whatsmeow.ParticipantRequestChange, error) {
	switch action {
	case string(whatsmeow.ParticipantChangeApprove),
		string(whatsmeow.ParticipantChangeReject):
		return whatsmeow.ParticipantRequestChange(action), nil
	default:
		return "", fmt.Errorf("unsupported join request action %q", action)
	}
}
