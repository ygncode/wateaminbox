import { db } from "@wateaminbox/database";
import { normalizeJid } from "@wateaminbox/shared";
import {
  getEffectivePermissions,
  type MemberPermissions,
} from "./permission.service.js";
import { getTenantConnection } from "./tenant.service.js";

export interface NotificationRecipientCandidate {
  userId: string;
  permissions: MemberPermissions;
  isAssignee: boolean;
  notificationsEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
  mutedContacts: string[];
}

function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isWithinQuietHours(input: {
  now: Date;
  start: string | null;
  end: string | null;
  timezone: string | null;
}): boolean {
  if (!input.start || !input.end || input.start === input.end) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(input.now);
    const hours = Number(parts.find((part) => part.type === "hour")?.value);
    const minutes = Number(parts.find((part) => part.type === "minute")?.value);
    const current = hours * 60 + minutes;
    const start = minutesFromTime(input.start);
    const end = minutesFromTime(input.end);
    return start > end
      ? current >= start || current < end
      : current >= start && current < end;
  } catch {
    // A malformed persisted timezone must fail closed rather than leak a push.
    return true;
  }
}

export function selectIncomingMessageRecipientIds(input: {
  candidates: NotificationRecipientCandidate[];
  contactJid: string;
  fromMe: boolean;
  isHistorySync: boolean;
  now?: Date;
}): string[] {
  if (input.fromMe || input.isHistorySync) return [];
  const normalizedContactJid =
    normalizeJid(input.contactJid) ?? input.contactJid;
  const now = input.now ?? new Date();
  const recipients = new Set<string>();

  for (const candidate of input.candidates) {
    if (!candidate.permissions.can_view_all_chats && !candidate.isAssignee)
      continue;
    if (!candidate.notificationsEnabled) continue;
    if (
      candidate.mutedContacts.some(
        (jid) => (normalizeJid(jid) ?? jid) === normalizedContactJid,
      )
    )
      continue;
    if (
      isWithinQuietHours({
        now,
        start: candidate.quietHoursStart,
        end: candidate.quietHoursEnd,
        timezone: candidate.timezone,
      })
    )
      continue;
    recipients.add(candidate.userId);
  }
  return [...recipients];
}

export async function resolveIncomingMessageRecipients(input: {
  companyId: string;
  contactId: string;
  contactJid: string;
  fromMe: boolean;
  isHistorySync: boolean;
  now?: Date;
}): Promise<string[]> {
  if (input.fromMe || input.isHistorySync) return [];
  const tenantDb = getTenantConnection(input.companyId);
  const [members, assignment] = await Promise.all([
    db
      .selectFrom("company_members")
      .select(["user_id", "role", "permissions"])
      .where("company_id", "=", input.companyId)
      .execute(),
    tenantDb
      .selectFrom("contact_assignments")
      .select("assigned_to")
      .where("contact_id", "=", input.contactId)
      .where("unassigned_at", "is", null)
      .executeTakeFirst(),
  ]);
  const memberIds = members.map((member) => member.user_id);
  const preferences = memberIds.length
    ? await tenantDb
        .selectFrom("notification_preferences")
        .select([
          "user_id",
          "notifications_enabled",
          "quiet_hours_start",
          "quiet_hours_end",
          "timezone",
          "muted_contacts",
        ])
        .where("user_id", "in", memberIds)
        .execute()
    : [];
  const preferencesByUser = new Map(
    preferences.map((pref) => [pref.user_id, pref]),
  );

  return selectIncomingMessageRecipientIds({
    contactJid: input.contactJid,
    fromMe: input.fromMe,
    isHistorySync: input.isHistorySync,
    now: input.now,
    candidates: members.map((member) => {
      const preference = preferencesByUser.get(member.user_id);
      return {
        userId: member.user_id,
        permissions: getEffectivePermissions(
          member.role,
          (member.permissions ?? {}) as Partial<MemberPermissions>,
        ),
        isAssignee: assignment?.assigned_to === member.user_id,
        notificationsEnabled: preference?.notifications_enabled ?? true,
        quietHoursStart: preference?.quiet_hours_start ?? null,
        quietHoursEnd: preference?.quiet_hours_end ?? null,
        timezone: preference?.timezone ?? null,
        mutedContacts: preference?.muted_contacts ?? [],
      };
    }),
  });
}
