import type { TenantDatabase } from "@wateaminbox/database";
import type { SlaPolicy } from "@wateaminbox/shared";
import { toDbDate } from "@wateaminbox/shared";
import type { Transaction } from "kysely";
import { NotFoundError } from "../lib/errors.js";
import type { UpdateAutoReplySettingsInput } from "../lib/schemas/quick-replies.js";
import { isWithinBusinessHours } from "./sla-policy/calendar.js";
import { getCurrentSlaPolicy } from "./sla-policy/policy.service.js";
import { getTenantConnection } from "./tenant.service.js";

export type AutoReplySendMode = "always" | "outside_business_hours";

export interface AutoReplySettings {
  enabled: boolean;
  quickReplyId: string | null;
  quickReplyTitle: string | null;
  delayMinutes: number;
  sendMode: AutoReplySendMode;
  businessHoursTimezone: string;
}

interface AutoReplyCandidate {
  quickReplyId: string;
  content: string;
  delayMinutes: number;
  updatedBy: string;
}

async function currentBusinessHours(companyId: string): Promise<SlaPolicy> {
  return getCurrentSlaPolicy(companyId);
}

export async function getAutoReplySettings(
  companyId: string,
): Promise<AutoReplySettings> {
  const tenantDb = getTenantConnection(companyId);
  const [row, policy] = await Promise.all([
    tenantDb
      .selectFrom("auto_reply_settings as settings")
      .leftJoin("quick_replies as reply", "reply.id", "settings.quick_reply_id")
      .select([
        "settings.enabled",
        "settings.quick_reply_id",
        "settings.delay_minutes",
        "settings.send_mode",
        "reply.title as quick_reply_title",
      ])
      .where("settings.id", "=", 1)
      .executeTakeFirst(),
    currentBusinessHours(companyId),
  ]);

  return {
    enabled: Boolean(row?.enabled && row.quick_reply_id),
    quickReplyId: row?.quick_reply_id ?? null,
    quickReplyTitle: row?.quick_reply_title ?? null,
    delayMinutes: row?.delay_minutes ?? 5,
    sendMode: row?.send_mode ?? "always",
    businessHoursTimezone: policy.timezone,
  };
}

export async function updateAutoReplySettings(
  companyId: string,
  userId: string,
  input: UpdateAutoReplySettingsInput,
): Promise<AutoReplySettings> {
  const tenantDb = getTenantConnection(companyId);
  if (input.quickReplyId) {
    const reply = await tenantDb
      .selectFrom("quick_replies")
      .select("id")
      .where("id", "=", input.quickReplyId)
      .executeTakeFirst();
    if (!reply) throw new NotFoundError("Quick reply");
  }

  await tenantDb.transaction().execute(async (trx) => {
    await trx
      .insertInto("auto_reply_settings")
      .values({
        id: 1,
        enabled: input.enabled,
        quick_reply_id: input.quickReplyId,
        delay_minutes: input.delayMinutes,
        send_mode: input.sendMode,
        updated_by: userId,
        updated_at: toDbDate(),
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          enabled: input.enabled,
          quick_reply_id: input.quickReplyId,
          delay_minutes: input.delayMinutes,
          send_mode: input.sendMode,
          updated_by: userId,
          updated_at: toDbDate(),
        }),
      )
      .execute();

    // A queued reply is a snapshot of the old configuration. Cancel it when
    // the rule changes; future first contacts use the new rule.
    await trx
      .updateTable("scheduled_messages")
      .set({
        status: "canceled",
        canceled_at: toDbDate(),
        updated_at: toDbDate(),
      })
      .where("auto_reply_trigger_message_id", "is not", null)
      .where("status", "in", ["scheduled", "processing"])
      .execute();
  });

  return getAutoReplySettings(companyId);
}

/** Resolve a live inbound against the current rule before its insert tx. */
export async function getAutoReplyCandidate(
  companyId: string,
  receivedAt: Date,
): Promise<AutoReplyCandidate | null> {
  const tenantDb = getTenantConnection(companyId);
  const row = await tenantDb
    .selectFrom("auto_reply_settings as settings")
    .innerJoin("quick_replies as reply", "reply.id", "settings.quick_reply_id")
    .select([
      "settings.quick_reply_id",
      "settings.delay_minutes",
      "settings.send_mode",
      "settings.updated_by",
      "reply.content",
    ])
    .where("settings.id", "=", 1)
    .where("settings.enabled", "=", true)
    .executeTakeFirst();
  if (!row || !row.quick_reply_id) return null;

  if (row.send_mode === "outside_business_hours") {
    const policy = await currentBusinessHours(companyId);
    if (isWithinBusinessHours(policy, receivedAt)) return null;
  }

  return {
    quickReplyId: row.quick_reply_id,
    content: row.content,
    delayMinutes: row.delay_minutes,
    updatedBy: row.updated_by,
  };
}

/** Queue at most one lifetime first-contact reply for a direct contact. */
export async function scheduleFirstContactAutoReply(
  trx: Transaction<TenantDatabase>,
  contactId: string,
  triggerMessageId: string,
  candidate: AutoReplyCandidate,
): Promise<void> {
  const previousMessage = await trx
    .selectFrom("messages")
    .select("id")
    .where("contact_id", "=", contactId)
    .where("id", "!=", triggerMessageId)
    .limit(1)
    .executeTakeFirst();
  if (previousMessage) return;

  const scheduledAt = new Date(Date.now() + candidate.delayMinutes * 60_000);
  await trx
    .insertInto("scheduled_messages")
    .values({
      contact_id: contactId,
      content: candidate.content,
      message_type: "text",
      scheduled_at: scheduledAt,
      next_attempt_at: scheduledAt,
      created_by: candidate.updatedBy,
      auto_reply_trigger_message_id: triggerMessageId,
      auto_reply_quick_reply_id: candidate.quickReplyId,
    })
    // The partial unique index on contact_id is the final concurrency guard.
    .onConflict((oc) => oc.doNothing())
    .execute();
}
