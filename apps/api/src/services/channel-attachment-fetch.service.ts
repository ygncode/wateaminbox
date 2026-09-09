import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { downloadTelegramFile } from "../channel-spine/providers/telegram-bot/api.js";
import { createLogger, formatError } from "../lib/logger.js";
import { deleteMedia, uploadMedia } from "../lib/storage.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "./channel-spine-authority.service.js";
import { readChannelCredential } from "./channel-credential.service.js";
import { getTenantConnection } from "./tenant.service.js";

const logger = createLogger("ChannelAttachmentFetch");
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 6;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;

interface AttachmentClaim {
  companyId: string;
  attachmentId: string;
  messageId: string;
  channelAccountId: string;
  providerAttachmentId: string;
  fileName: string | null;
  contentType: string | null;
  attempts: number;
  leaseToken: string;
}

export async function dispatchNextChannelAttachmentFetch(): Promise<number> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
  for (const company of companies) {
    const authority = await getChannelSpineWorkspaceAuthority(company.id);
    if (
      authority.writeAuthority !== "neutral" ||
      !isChannelProviderEnabled(authority, "telegram_bot")
    ) {
      continue;
    }
    const tenantDb = await getTenantConnection(company.id);
    const claim = await tenantDb.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("message_attachments as attachment")
        .innerJoin("messages as message", "message.id", "attachment.message_id")
        .innerJoin(
          "channel_accounts as account",
          "account.id",
          "message.channel_account_id",
        )
        .select([
          "attachment.id",
          "attachment.message_id",
          "attachment.provider_attachment_id",
          "attachment.file_name",
          "attachment.content_type",
          "attachment.fetch_attempts",
          "account.id as channel_account_id",
        ])
        .where("attachment.status", "=", "pending")
        .where("attachment.provider_attachment_id", "is not", null)
        .where("attachment.next_fetch_at", "<=", new Date())
        .where((eb) =>
          eb.or([
            eb("attachment.fetch_lease_token", "is", null),
            eb("attachment.fetch_lease_expires_at", "<", new Date()),
          ]),
        )
        .where("account.provider", "=", "telegram_bot")
        .where("account.archived_at", "is", null)
        .orderBy("attachment.next_fetch_at")
        .orderBy("attachment.created_at")
        .forUpdate("attachment")
        .skipLocked()
        .executeTakeFirst();
      if (!row?.provider_attachment_id) return null;
      const leaseToken = crypto.randomUUID();
      await trx
        .updateTable("message_attachments")
        .set({
          fetch_attempts: sql`fetch_attempts + 1`,
          fetch_lease_token: leaseToken,
          fetch_lease_expires_at: new Date(Date.now() + LEASE_MS),
          updated_at: new Date(),
        })
        .where("id", "=", row.id)
        .execute();
      return {
        companyId: company.id,
        attachmentId: row.id,
        messageId: row.message_id,
        channelAccountId: row.channel_account_id,
        providerAttachmentId: row.provider_attachment_id,
        fileName: row.file_name,
        contentType: row.content_type,
        attempts: row.fetch_attempts + 1,
        leaseToken,
      } satisfies AttachmentClaim;
    });
    if (!claim) continue;
    await fetchClaim(claim);
    return 1;
  }
  return 0;
}

async function fetchClaim(claim: AttachmentClaim): Promise<void> {
  const tenantDb = await getTenantConnection(claim.companyId);
  try {
    const token = await readChannelCredential(
      tenantDb,
      claim.companyId,
      claim.channelAccountId,
      "telegram_bot_token",
    );
    if (!token) throw new Error("telegram_credential_unavailable");
    const downloaded = await downloadTelegramFile(
      token,
      claim.providerAttachmentId,
    );
    const contentType = storedContentType(
      downloaded.contentType,
      claim.contentType,
    );
    const uploaded = await uploadMedia(
      downloaded.data,
      contentType,
      claim.companyId,
      claim.fileName ?? undefined,
    );
    const stored = await tenantDb.transaction().execute(async (trx) => {
      const attachment = await trx
        .updateTable("message_attachments")
        .set({
          storage_uri: uploaded.reference,
          content_type: contentType,
          byte_size: downloaded.data.byteLength.toString(),
          status: "available",
          error_code: null,
          fetch_lease_token: null,
          fetch_lease_expires_at: null,
          updated_at: new Date(),
        })
        .where("id", "=", claim.attachmentId)
        .where("fetch_lease_token", "=", claim.leaseToken)
        .returning("message_id")
        .executeTakeFirst();
      if (!attachment) return false;
      await trx
        .updateTable("messages")
        .set({
          media_url: uploaded.reference,
          media_mime_type: contentType,
          media_size: downloaded.data.byteLength,
          media_download_status: "completed",
          media_downloaded_at: new Date(),
        })
        .where("id", "=", claim.messageId)
        .execute();
      const message = await trx
        .selectFrom("messages")
        .select(["channel_account_id", "conversation_id"])
        .where("id", "=", claim.messageId)
        .executeTakeFirst();
      if (message?.channel_account_id && message.conversation_id) {
        await sql`INSERT INTO public.channel_message_delivery_outbox
            (company_id, channel_account_id, conversation_id, message_id, kind, case_event)
          VALUES (${claim.companyId}::uuid, ${message.channel_account_id}::uuid,
            ${message.conversation_id}::uuid, ${claim.messageId}::uuid, 'realtime', NULL)
          ON CONFLICT DO NOTHING`.execute(trx);
      }
      return true;
    });
    if (!stored) await deleteMedia(uploaded.key);
  } catch (error) {
    const permanent =
      error instanceof Error &&
      (error.message.includes("exceeds the download limit") ||
        error.message.includes("invalid file"));
    await tenantDb
      .updateTable("message_attachments")
      .set({
        status:
          permanent || claim.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        error_code: permanent
          ? "attachment_too_large_or_invalid"
          : "attachment_fetch_failed",
        next_fetch_at: new Date(
          Date.now() +
            Math.min(15 * 60_000, 5_000 * 2 ** Math.min(claim.attempts, 8)),
        ),
        fetch_lease_token: null,
        fetch_lease_expires_at: null,
        updated_at: new Date(),
      })
      .where("id", "=", claim.attachmentId)
      .where("fetch_lease_token", "=", claim.leaseToken)
      .execute();
    logger.warn(
      {
        err: formatError(error),
        companyId: claim.companyId,
        attachmentId: claim.attachmentId,
      },
      "Channel attachment fetch failed",
    );
  }
}

async function poll(): Promise<void> {
  if (running || stopping) return;
  running = true;
  let processed = 0;
  try {
    processed = await dispatchNextChannelAttachmentFetch();
  } catch (error) {
    logger.warn(
      { err: formatError(error) },
      "Channel attachment polling failed",
    );
  } finally {
    running = false;
    if (!stopping) timer = setTimeout(poll, processed ? 25 : 1_000);
  }
}

/** Persist only inert media types. Provider-declared HTML/SVG/script types are ignored. */
export function storedContentType(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const type = candidate?.split(";")[0]?.trim().toLowerCase();
    if (!type) continue;
    if (
      type === "image/svg+xml" ||
      type === "image/svg" ||
      type.startsWith("image/svg") ||
      type.endsWith("+xml") ||
      type.startsWith("text/") ||
      type.includes("javascript") ||
      type.includes("ecmascript")
    ) {
      continue;
    }
    if (
      type.startsWith("image/") ||
      type.startsWith("audio/") ||
      type.startsWith("video/") ||
      type === "application/pdf" ||
      type === "application/octet-stream"
    ) {
      return type;
    }
  }
  return "application/octet-stream";
}

export function initializeChannelAttachmentFetch(): void {
  stopping = false;
  if (!timer && !running) timer = setTimeout(poll, 0);
}

export async function shutdownChannelAttachmentFetch(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  while (running) await new Promise((resolve) => setTimeout(resolve, 25));
}
