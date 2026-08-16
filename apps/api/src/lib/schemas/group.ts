/**
 * Group validation schemas
 *
 * Schemas for group-related API endpoints.
 *
 * The participant schemas normalize JIDs at the validation boundary, so every
 * route below it compares and stores members in exactly one form. Without that,
 * `1234:5@s.whatsapp.net` and `1234@s.whatsapp.net` would look like different
 * people to a membership check while being the same person to WhatsApp.
 */
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_JOIN_REQUEST_ACTIONS,
  GROUP_MAX_PARTICIPANTS,
  GROUP_MEMBER_ADD_MODES,
  GROUP_NAME_MAX_LENGTH,
  GROUP_PARTICIPANT_BATCH_LIMIT,
  normalizeJid,
} from "@wateaminbox/shared";
import { z } from "zod";

/**
 * Query params for listing groups
 */
export const listGroupsQuerySchema = z.object({
  search: z.string().optional(),
  connectionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;

/**
 * Update group custom name
 */
export const updateGroupSchema = z.object({
  customName: z.string().min(1).max(200).optional(),
});

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

/**
 * A WhatsApp user JID, normalized to its device-free form.
 *
 * Group members are addressed either by phone-number JID or by LID, so both
 * servers are accepted. A group JID is rejected: a group cannot be a member of
 * another group, and letting one through would send WhatsApp a request it can
 * only answer with an opaque error.
 */
export const participantJidSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((value) => normalizeJid(value) ?? value)
  .refine(
    (value) => value.endsWith("@s.whatsapp.net") || value.endsWith("@lid"),
    { message: "Participant must be a WhatsApp user JID" },
  );

/**
 * A batch of participants: non-empty, de-duplicated and inside the batch limit.
 */
export const participantJidsSchema = z
  .array(participantJidSchema)
  .min(1, "At least one participant is required")
  .max(
    GROUP_PARTICIPANT_BATCH_LIMIT,
    `At most ${GROUP_PARTICIPANT_BATCH_LIMIT} participants can be changed at once`,
  )
  .transform((jids) => [...new Set(jids)]);

/**
 * Create a group.
 *
 * The connected account is added by WhatsApp implicitly, so the caller supplies
 * only the other members. The cap is one below WhatsApp's group maximum for
 * that reason.
 */
export const createGroupSchema = z.object({
  connectionId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Group name is required")
    .max(
      GROUP_NAME_MAX_LENGTH,
      `WhatsApp group names are limited to ${GROUP_NAME_MAX_LENGTH} characters`,
    ),
  participantJids: z
    .array(participantJidSchema)
    .min(1, "A group needs at least one other member")
    .max(
      GROUP_MAX_PARTICIPANTS - 1,
      `A WhatsApp group holds at most ${GROUP_MAX_PARTICIPANTS} members`,
    )
    .transform((jids) => [...new Set(jids)]),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

/** Add, remove, promote or demote a batch of members. */
export const groupParticipantsSchema = z.object({
  participantJids: participantJidsSchema,
});

export type GroupParticipantsInput = z.infer<typeof groupParticipantsSchema>;

/**
 * Update group settings (profile and permissions).
 *
 * Every field is optional and only the supplied ones are changed; the route
 * rejects an empty body so a no-op never reaches WhatsApp as a command.
 */
export const updateGroupSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(GROUP_NAME_MAX_LENGTH).optional(),
    // An empty string is a real value here: it clears the description.
    description: z.string().max(GROUP_DESCRIPTION_MAX_LENGTH).optional(),
    /** Only admins may send messages. */
    isAnnounce: z.boolean().optional(),
    /** Only admins may edit the group's name, icon and description. */
    isLocked: z.boolean().optional(),
    /** New members must be approved by an admin before joining. */
    isJoinApprovalRequired: z.boolean().optional(),
    memberAddMode: z.enum(GROUP_MEMBER_ADD_MODES).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "At least one group setting must be provided",
  });

export type UpdateGroupSettingsInput = z.infer<
  typeof updateGroupSettingsSchema
>;

/** Fetch or rotate the group's invite link. */
export const groupInviteLinkSchema = z.object({
  /** Revoke the current link before issuing a new one. */
  reset: z.boolean().default(false),
});

export type GroupInviteLinkInput = z.infer<typeof groupInviteLinkSchema>;

/** Approve or reject pending requests to join. */
export const groupJoinRequestDecisionSchema = z.object({
  requesterJids: participantJidsSchema,
  decision: z.enum(GROUP_JOIN_REQUEST_ACTIONS),
});

export type GroupJoinRequestDecisionInput = z.infer<
  typeof groupJoinRequestDecisionSchema
>;
