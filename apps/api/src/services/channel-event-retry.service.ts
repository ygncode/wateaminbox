import { db } from "@wateaminbox/database";
import {
  assertNormalizedChannelEvent,
  type NormalizedChannelEvent,
} from "@wateaminbox/shared";
import { applyNormalizedChannelEvent } from "../channel-spine/application/event-processor.js";
import { createLogger, formatError } from "../lib/logger.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "./channel-spine-authority.service.js";
import { getTenantConnection } from "./tenant.service.js";

const logger = createLogger("ChannelEventRetry");
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;

export async function dispatchNextChannelEventRetry(): Promise<number> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
  for (const company of companies) {
    const authority = await getChannelSpineWorkspaceAuthority(company.id);
    if (authority.writeAuthority !== "neutral") continue;
    const tenantDb = await getTenantConnection(company.id);
    const row = await tenantDb
      .selectFrom("channel_event_inbox")
      .select([
        "channel_account_id",
        "external_event_scope",
        "external_event_id",
        "normalized_event",
      ])
      .where("status", "=", "pending")
      .where("next_attempt_at", "<=", new Date())
      .where("external_event_scope", "in", authority.enabledProviders)
      .orderBy("next_attempt_at")
      .orderBy("received_at")
      .executeTakeFirst();
    if (!row) continue;
    let event: NormalizedChannelEvent;
    try {
      event = row.normalized_event as unknown as NormalizedChannelEvent;
      assertNormalizedChannelEvent(event);
      if (
        event.companyId !== company.id ||
        event.channelAccountId !== row.channel_account_id ||
        event.provider !== row.external_event_scope ||
        event.eventId !== row.external_event_id ||
        !isChannelProviderEnabled(authority, event.provider)
      ) {
        throw new Error("stored event envelope mismatch");
      }
    } catch {
      await tenantDb
        .updateTable("channel_event_inbox")
        .set({
          status: "quarantined",
          last_error_code: "invalid_stored_event",
        })
        .where("channel_account_id", "=", row.channel_account_id)
        .where("external_event_scope", "=", row.external_event_scope)
        .where("external_event_id", "=", row.external_event_id)
        .execute();
      return 1;
    }
    try {
      await applyNormalizedChannelEvent(tenantDb, event);
    } catch (error) {
      logger.warn(
        {
          err: formatError(error),
          companyId: company.id,
          eventId: row.external_event_id,
        },
        "Channel event remains queued for retry",
      );
    }
    return 1;
  }
  return 0;
}

async function poll(): Promise<void> {
  if (running || stopping) return;
  running = true;
  let processed = 0;
  try {
    processed = await dispatchNextChannelEventRetry();
  } catch (error) {
    logger.warn(
      { err: formatError(error) },
      "Channel event retry polling failed",
    );
  } finally {
    running = false;
    if (!stopping) timer = setTimeout(poll, processed ? 25 : 1_000);
  }
}

export function initializeChannelEventRetry(): void {
  stopping = false;
  if (!timer && !running) timer = setTimeout(poll, 0);
}

export async function shutdownChannelEventRetry(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  while (running) await new Promise((resolve) => setTimeout(resolve, 25));
}
