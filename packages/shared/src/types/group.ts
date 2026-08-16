/**
 * WhatsApp group administration contracts shared by the API and the web app.
 *
 * The limits below are WhatsApp's, not ours. Enforcing them before a command
 * leaves the API turns a silent server-side rejection (which would surface much
 * later as a failed command notification) into an immediate validation error,
 * and lets the composer disable a control instead of letting it fail.
 */

/**
 * WhatsApp rejects a group subject longer than 25 characters with a
 * `406 not acceptable`, as documented on whatsmeow's `ReqCreateGroup.Name`.
 */
export const GROUP_NAME_MAX_LENGTH = 25;

/** WhatsApp truncates group descriptions beyond this length. */
export const GROUP_DESCRIPTION_MAX_LENGTH = 512;

/**
 * Maximum members in a WhatsApp group, including the group owner. Adding
 * beyond it fails per-participant rather than rejecting the whole request.
 */
export const GROUP_MAX_PARTICIPANTS = 1024;

/**
 * Participants accepted in a single add/remove/promote/demote request.
 *
 * WhatsApp processes a participant update as one IQ; a very large batch makes
 * the whole call time out rather than partially succeed, and the per-command
 * NATS payload has to stay well inside the default message size limit.
 *
 * Deliberately NOT applied to group creation. Creating a group sends its
 * members as part of the create request itself - there is no way to add them
 * incrementally before the group exists - so the only meaningful bound there is
 * WhatsApp's own group size. Members beyond the first batch are added afterwards
 * through the participant routes, which do respect this limit.
 */
export const GROUP_PARTICIPANT_BATCH_LIMIT = 64;

/** Who may add new participants to a group. */
export const GROUP_MEMBER_ADD_MODES = ["admin_add", "all_member_add"] as const;
export type GroupMemberAddMode = (typeof GROUP_MEMBER_ADD_MODES)[number];

/** Participant mutations WhatsApp supports on an existing group. */
export const GROUP_PARTICIPANT_ACTIONS = [
  "add",
  "remove",
  "promote",
  "demote",
] as const;
export type GroupParticipantAction = (typeof GROUP_PARTICIPANT_ACTIONS)[number];

/** Decisions available on a pending request to join a group. */
export const GROUP_JOIN_REQUEST_ACTIONS = ["approve", "reject"] as const;
export type GroupJoinRequestAction =
  (typeof GROUP_JOIN_REQUEST_ACTIONS)[number];

/**
 * Per-participant outcome of a group participant update.
 *
 * WhatsApp answers a participant update with a status code per participant, so
 * a request can partially succeed - for example when one number has privacy
 * settings that forbid being added to groups. Codes are surfaced verbatim so
 * the UI can explain exactly which members were not applied.
 */
export interface GroupParticipantResult {
  jid: string;
  /**
   * WhatsApp's status code for this participant. Zero means applied: whatsmeow
   * reports success by omitting the `error` attribute entirely, which parses to
   * `0`. Any non-zero value is a per-member refusal.
   */
  code: number;
  applied: boolean;
}

/**
 * WhatsApp exposes no "delete group" or "disband group" operation, and neither
 * does the vendored whatsmeow client. The only way for an account to end its
 * own participation is to leave, which keeps the group alive for everyone else.
 * This message is the single place that wording is defined so the API and the
 * UI can never drift into implying a destructive action exists.
 */
export const GROUP_LEAVE_SEMANTICS =
  "WhatsApp has no delete or disband action for groups. Leaving only ends this account's membership; the group and its history remain for the other members.";
