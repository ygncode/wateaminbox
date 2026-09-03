import { normalizeJid } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";

export interface GroupMentionValidationResult {
  mentionedJids: string[];
  error?: string;
}

export function validateGroupMentionRequest(
  contact: { jid: string; isGroup: boolean },
  content: string,
  requestedJids: string[] | undefined,
): GroupMentionValidationResult {
  if (!requestedJids?.length) return { mentionedJids: [] };
  if (!contact.isGroup || !contact.jid.endsWith("@g.us")) {
    return {
      mentionedJids: [],
      error: "Mentions are only supported in group conversations",
    };
  }

  const mentionedJids = [
    ...new Set(
      requestedJids
        .map((jid) => normalizeJid(jid))
        .filter((jid): jid is string => Boolean(jid)),
    ),
  ];
  if (
    mentionedJids.some((jid) => {
      const mentionId = jid.split("@")[0];
      return !new RegExp(`@${mentionId}(?=$|\\D)`).test(content);
    })
  ) {
    return {
      mentionedJids: [],
      error: "Every mentioned JID must have a matching @token in the message",
    };
  }
  return { mentionedJids };
}

export function areGroupMentionJidsCurrentMembers(
  mentionedJids: string[],
  participantJids: string[],
): boolean {
  const memberJids = new Set(
    participantJids
      .map((jid) => normalizeJid(jid))
      .filter((jid): jid is string => Boolean(jid)),
  );
  return mentionedJids.every((jid) => memberJids.has(jid));
}

/**
 * Fail closed unless every outbound mention belongs to the destination group.
 * This keeps a caller from using the generic send endpoint to notify arbitrary
 * WhatsApp identities through forged ContextInfo metadata.
 */
export async function validateGroupMentionJids(
  tenantDb: Kysely<TenantDatabase>,
  contact: { id: string; jid: string; isGroup: boolean },
  content: string,
  requestedJids: string[] | undefined,
): Promise<GroupMentionValidationResult> {
  const requestValidation = validateGroupMentionRequest(
    contact,
    content,
    requestedJids,
  );
  if (requestValidation.error || requestValidation.mentionedJids.length === 0) {
    return requestValidation;
  }
  const memberRows = await tenantDb
    .selectFrom("groups")
    .innerJoin("group_participants", "group_participants.group_id", "groups.id")
    .select("group_participants.participant_jid")
    .where("groups.contact_id", "=", contact.id)
    .execute();
  if (
    !areGroupMentionJidsCurrentMembers(
      requestValidation.mentionedJids,
      memberRows.map((member) => member.participant_jid),
    )
  ) {
    return {
      mentionedJids: [],
      error: "Every mentioned JID must be a current member of the group",
    };
  }
  return requestValidation;
}
