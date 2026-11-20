import {
  SYSTEM_SUPPRESSION_ACTOR,
  type TenantDatabase,
} from "@wateaminbox/database";
import type { InboundVolumeClass } from "@wateaminbox/shared";
import { sql, type Transaction } from "kysely";
import { applySuppression } from "./contact-policy.js";

/**
 * Per-sender inbound flood limits (contact blocking, phase 5).
 *
 * Owner-approved defaults (2026-11-20). They are deliberately high so a real
 * customer never trips them, only a script does:
 *
 * | Class | Quiet after          | Quiet for | Auto-mute (off by default) |
 * |-------|----------------------|-----------|----------------------------|
 * | chat  | 30 messages / minute | 10 min    | 200 in 10 min -> 1 hour    |
 * | email | 10 messages / minute | 30 min    | 50 in 10 min -> 1 hour     |
 *
 * Over the limit a message is still stored but arrives quietly (no unread,
 * case open, push or auto-reply). The quiet period is an expiring
 * `mute_inbound` suppression with reason `auto:flood`, so it is visible in the
 * profile and an operator can lift it. Never an automatic block: a block also
 * stops the workspace's own replies, and that stays a human decision.
 */
export interface FloodLimits {
  perMinute: number;
  quietMinutes: number;
  autoMute: {
    enabled: boolean;
    messages: number;
    windowMinutes: number;
    muteMinutes: number;
  };
}

export const FLOOD_LIMITS: Record<InboundVolumeClass, FloodLimits> = {
  chat: {
    perMinute: 30,
    quietMinutes: 10,
    autoMute: {
      enabled: false,
      messages: 200,
      windowMinutes: 10,
      muteMinutes: 60,
    },
  },
  email: {
    perMinute: 10,
    quietMinutes: 30,
    autoMute: {
      enabled: false,
      messages: 50,
      windowMinutes: 10,
      muteMinutes: 60,
    },
  },
};

export const FLOOD_REASON = "auto:flood";

/**
 * The volume class for a channel. Adapters declare the same value in
 * `ResolvedCapabilities.inboundVolumeClass` (asserted by the conformance
 * suite); the application derives it from the channel so the event path does
 * not depend on the provider registry.
 */
export function volumeClassForChannel(channel: string): InboundVolumeClass {
  return channel === "email" ? "email" : "chat";
}

/** Windows older than this are pruned; the longest look-back is 10 minutes. */
const RETAIN_MINUTES = 30;

export interface FloodVerdict {
  /** This message is over the limit and should arrive quietly. */
  silence: boolean;
  /** A quiet period was started by this message (raise one notice). */
  startedQuietPeriod: boolean;
}

/**
 * Count one inbound message from `contactId` and decide whether it is part of
 * a flood. Runs in the event's own transaction, so a retried or rolled-back
 * event never counts twice. Group and system traffic is not counted by the
 * caller.
 */
export async function recordInboundForFlood(
  trx: Transaction<TenantDatabase>,
  input: {
    contactId: string;
    channel: string;
    volumeClass: InboundVolumeClass;
    at: Date;
    limits?: FloodLimits;
  },
): Promise<FloodVerdict> {
  const limits = input.limits ?? FLOOD_LIMITS[input.volumeClass];
  const minute = new Date(Math.floor(input.at.getTime() / 60_000) * 60_000);

  const counted = await trx
    .insertInto("inbound_flood_windows")
    .values({
      contact_id: input.contactId,
      channel: input.channel,
      window_start: minute,
      message_count: 1,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["contact_id", "channel", "window_start"])
        .doUpdateSet((eb) => ({
          message_count: sql<number>`LEAST(${eb.ref("inbound_flood_windows.message_count")} + 1, 2147483647)`,
        })),
    )
    .returning("message_count")
    .executeTakeFirstOrThrow();

  // Cheap housekeeping on the same person's rows only.
  await trx
    .deleteFrom("inbound_flood_windows")
    .where("contact_id", "=", input.contactId)
    .where(
      "window_start",
      "<",
      new Date(minute.getTime() - RETAIN_MINUTES * 60_000),
    )
    .execute();

  if (counted.message_count <= limits.perMinute) {
    return { silence: false, startedQuietPeriod: false };
  }

  let muteMinutes = limits.quietMinutes;
  if (limits.autoMute.enabled) {
    const since = new Date(
      minute.getTime() - (limits.autoMute.windowMinutes - 1) * 60_000,
    );
    const total = await trx
      .selectFrom("inbound_flood_windows")
      .select((eb) => eb.fn.sum<string>("message_count").as("n"))
      .where("contact_id", "=", input.contactId)
      .where("channel", "=", input.channel)
      .where("window_start", ">=", since)
      .executeTakeFirst();
    if (Number(total?.n ?? 0) >= limits.autoMute.messages) {
      muteMinutes = Math.max(muteMinutes, limits.autoMute.muteMinutes);
    }
  }

  const expiresAt = new Date(input.at.getTime() + muteMinutes * 60_000);
  const applied = await applySuppression(trx, {
    contactId: input.contactId,
    scope: "mute_inbound",
    reason: FLOOD_REASON,
    actorUserId: SYSTEM_SUPPRESSION_ACTOR,
    expiresAt,
    now: input.at,
  });
  if (!applied.created) {
    // A flood that keeps going keeps its own quiet period running (and an
    // escalation lengthens it). Only an automatic mute is extended: a mute an
    // operator set is their decision, and an open-ended one is already longer.
    await trx
      .updateTable("contact_suppressions")
      .set({ expires_at: expiresAt })
      .where("id", "=", applied.suppressionId)
      .where("reason", "=", FLOOD_REASON)
      .where("expires_at", "is not", null)
      .where("expires_at", "<", expiresAt)
      .execute();
  }
  return { silence: true, startedQuietPeriod: applied.created };
}
