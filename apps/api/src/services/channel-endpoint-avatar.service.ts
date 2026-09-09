import { db, getTenantSchemaName } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  downloadTelegramFile,
  getTelegramProfilePhotoFileId,
} from "../channel-spine/providers/telegram-bot/api.js";
import { createLogger, formatError } from "../lib/logger.js";
import { uploadMedia } from "../lib/storage.js";
import { readChannelCredential } from "./channel-credential.service.js";
import { getTenantConnection } from "./tenant.service.js";

const logger = createLogger("ChannelEndpointAvatar");

/**
 * How long an endpoint's avatar is trusted before it is looked up again.
 *
 * A profile photo changes rarely and every check is a provider API call, so
 * this is deliberately long. The timestamp is written on every attempt,
 * including one that finds no photo, so someone without a picture is not
 * re-checked on every inbound message.
 */
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;

interface AvatarClaim {
  companyId: string;
  endpointId: string;
  channelAccountId: string;
  externalId: string;
}

/**
 * Refresh one stale Telegram endpoint avatar.
 *
 * Only Telegram is handled: it is the only provider whose adapter can resolve
 * a profile photo today. Other channels are left untouched rather than
 * claimed and failed.
 */
export async function dispatchNextEndpointAvatar(): Promise<number> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
  for (const company of companies) {
    const claim = await claimStaleEndpoint(company.id);
    if (!claim) continue;
    await refresh(claim);
    return 1;
  }
  return 0;
}

async function claimStaleEndpoint(
  companyId: string,
): Promise<AvatarClaim | null> {
  const tenantDb = getTenantConnection(companyId);
  try {
    // The timestamp is claimed before the network call, so two replicas
    // cannot fetch the same avatar and a failure still backs off.
    const claimed = await sql<{
      id: string;
      channel_account_id: string;
      external_id: string;
    }>`
      UPDATE ${sql.table(`${getTenantSchemaName(companyId)}.contact_endpoints`)}
      SET avatar_fetched_at = now()
      WHERE id = (
        SELECT id FROM ${sql.table(`${getTenantSchemaName(companyId)}.contact_endpoints`)}
        WHERE provider = 'telegram_bot'
          AND endpoint_kind = 'person'
          AND channel_account_id IS NOT NULL
          AND (avatar_fetched_at IS NULL
               OR avatar_fetched_at < now() - ${sql.lit(`${AVATAR_TTL_MS} milliseconds`)}::interval)
        ORDER BY avatar_fetched_at NULLS FIRST
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, channel_account_id, external_id`.execute(tenantDb);
    const row = claimed.rows[0];
    if (!row) return null;
    return {
      companyId,
      endpointId: row.id,
      channelAccountId: row.channel_account_id,
      externalId: row.external_id,
    };
  } catch {
    // A tenant whose schema predates the avatar columns simply has nothing to
    // claim; it must not stall every other workspace.
    return null;
  }
}

async function refresh(claim: AvatarClaim): Promise<void> {
  const tenantDb = getTenantConnection(claim.companyId);
  try {
    const token = await readChannelCredential(
      tenantDb,
      claim.companyId,
      claim.channelAccountId,
      "telegram_bot_token",
    );
    if (!token) return;
    const fileId = await getTelegramProfilePhotoFileId(token, claim.externalId);
    if (!fileId) {
      // No photo, or not visible to this bot. The claimed timestamp already
      // recorded the attempt, so this backs off on its own.
      return;
    }
    const downloaded = await downloadTelegramFile(
      token,
      fileId,
      MAX_AVATAR_BYTES,
    );
    // Telegram profile photos are always JPEG; never trust a provider-declared
    // type for something rendered in an <img>.
    const uploaded = await uploadMedia(
      downloaded.data,
      "image/jpeg",
      claim.companyId,
      `avatar-${claim.endpointId}.jpg`,
    );
    await tenantDb
      .updateTable("contact_endpoints")
      .set({ avatar_url: uploaded.reference, updated_at: new Date() })
      .where("id", "=", claim.endpointId)
      .execute();
  } catch (error) {
    logger.warn(
      {
        err: formatError(error),
        companyId: claim.companyId,
        endpointId: claim.endpointId,
      },
      "Endpoint avatar refresh failed",
    );
  }
}

async function poll(): Promise<void> {
  if (stopping || running) return;
  running = true;
  let processed = 0;
  try {
    processed = await dispatchNextEndpointAvatar();
  } catch (error) {
    logger.warn({ err: formatError(error) }, "Endpoint avatar poll failed");
  } finally {
    running = false;
    if (!stopping) {
      timer = setTimeout(poll, processed ? 250 : 60_000);
    }
  }
}

export function initializeChannelEndpointAvatars(): void {
  stopping = false;
  if (!timer && !running) timer = setTimeout(poll, 5_000);
}

export async function shutdownChannelEndpointAvatars(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  while (running) await new Promise((resolve) => setTimeout(resolve, 25));
}
