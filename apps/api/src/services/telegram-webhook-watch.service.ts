import { getTelegramWebhookInfo } from "@wateaminbox/adapter-telegram";
import { db } from "@wateaminbox/database";
import type { Kysely } from "kysely";
import { telegramIngressUrlPrefix } from "../lib/channel-ingress-url.js";
import {
  type EmailOptions,
  type EmailResult,
  sendEmail,
} from "../lib/email.js";
import { createLogger, formatError } from "../lib/logger.js";
import { renderTelegramWebhookAlertEmail } from "../lib/telegram-webhook-alert-email.js";
import { readChannelCredential } from "./channel-credential.service.js";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "./channel-spine-authority.service.js";
import { createAndPublishNotifications } from "./notification-delivery.service.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";

const logger = createLogger("TelegramWebhookWatch");

/**
 * A bot has exactly one webhook, and anything holding its token can replace
 * it with one call. Telegram tells nobody, deliveries simply go elsewhere, and
 * our side sees silence rather than an error. Asking Telegram is the only way
 * to notice, so ask it on a timer.
 *
 * Ten minutes bounds how long a takeover goes unnoticed without spending a
 * meaningful share of the bot's API budget.
 */
const CYCLE_INTERVAL_MS = 10 * 60_000;
const FIRST_CYCLE_DELAY_MS = 60_000;

export type TelegramWebhookProblem = "webhook_taken_over" | "webhook_missing";

type Sender = (options: EmailOptions) => Promise<EmailResult>;

export interface TelegramWebhookWatchOptions {
  sender?: Sender;
  notify?: typeof createAndPublishNotifications;
  shouldStop?: () => boolean;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let stopping = false;

/**
 * What the registered URL means for this account.
 *
 * Only a successful answer from Telegram is evidence. Any URL outside our
 * ingress prefix - another app, an old domain, a typo - means our route
 * receives nothing, which is the failure an operator must hear about. The
 * route key itself cannot be compared: only its hash is stored.
 */
export function classifyTelegramWebhook(
  registeredUrl: string,
  ingressPrefix = telegramIngressUrlPrefix(),
): TelegramWebhookProblem | null {
  if (!registeredUrl) return "webhook_missing";
  return registeredUrl.startsWith(ingressPrefix) ? null : "webhook_taken_over";
}

/**
 * Check one workspace's connected Telegram bots.
 *
 * The account is only marked when it is still the same connection that was
 * checked (`connected_at` unchanged): a reconnect that lands while Telegram is
 * being asked registers our webhook again and must not be overwritten. That
 * conditional update is also what makes several API replicas safe - only the
 * one that flips the row sends the alert.
 */
export async function checkTelegramWebhooks(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: TelegramWebhookWatchOptions = {},
): Promise<number> {
  const accounts = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id", "display_name", "connected_at"])
    .where("provider", "=", "telegram_bot")
    .where("status", "=", "connected")
    .where("archived_at", "is", null)
    .execute();
  let flagged = 0;
  for (const account of accounts) {
    if (options.shouldStop?.()) break;
    let problem: TelegramWebhookProblem | null;
    try {
      const token = await readChannelCredential(
        tenantDb,
        companyId,
        account.id,
        "telegram_bot_token",
      );
      if (!token) continue;
      problem = classifyTelegramWebhook(
        (await getTelegramWebhookInfo(token)).url,
      );
    } catch (error) {
      // Telegram unavailable, a revoked token, an unreadable credential: none
      // of them say where deliveries go, so none of them change the account.
      logger.warn(
        { err: formatError(error), companyId, channelAccountId: account.id },
        "Telegram webhook check skipped",
      );
      continue;
    }
    if (!problem) continue;

    let marked = tenantDb
      .updateTable("channel_accounts")
      .set({
        status: "error",
        provider_status: problem,
        updated_at: new Date(),
      })
      .where("id", "=", account.id)
      .where("status", "=", "connected");
    marked = account.connected_at
      ? marked.where("connected_at", "=", account.connected_at)
      : marked.where("connected_at", "is", null);
    const result = await marked.executeTakeFirst();
    if (!result.numUpdatedRows) continue;
    flagged += 1;
    logger.warn(
      { companyId, channelAccountId: account.id, problem },
      "Telegram webhook no longer points at this server",
    );
    await alertAdmins(
      companyId,
      account.id,
      account.display_name || "Telegram bot",
      problem,
      options,
    );
  }
  return flagged;
}

async function alertAdmins(
  companyId: string,
  channelAccountId: string,
  accountName: string,
  problem: TelegramWebhookProblem,
  options: TelegramWebhookWatchOptions,
): Promise<void> {
  const recipients = await db
    .selectFrom("company_members as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .innerJoin("companies as c", "c.id", "m.company_id")
    .select(["m.user_id", "u.email", "u.email_verified_at", "c.name"])
    .where("m.company_id", "=", companyId)
    .where("m.role", "in", ["owner", "admin"])
    .execute();
  if (recipients.length === 0) return;
  const takenOver = problem === "webhook_taken_over";
  try {
    await (options.notify ?? createAndPublishNotifications)(
      companyId,
      recipients.map((recipient) => ({
        userId: recipient.user_id,
        notificationType: "system",
        title: takenOver
          ? "Telegram bot is sending messages elsewhere"
          : "Telegram bot webhook was removed",
        message: takenOver
          ? `“${accountName}” no longer delivers messages here: another app registered its own webhook with this bot's token. Open Connections and reconnect it.`
          : `“${accountName}” no longer delivers messages here: its webhook was removed. Open Connections and reconnect it.`,
        actionUrl: `/w/${encodeURIComponent(companyId)}/settings/connections`,
        metadata: { channelAccountId, providerStatus: problem },
      })),
    );
  } catch (error) {
    logger.error(
      { err: formatError(error), companyId, channelAccountId },
      "Telegram webhook alert notification failed",
    );
  }
  const sender = options.sender ?? sendEmail;
  for (const recipient of recipients) {
    if (!recipient.email_verified_at) continue;
    try {
      const result = await sender({
        to: recipient.email,
        ...renderTelegramWebhookAlertEmail({
          problem,
          workspaceId: companyId,
          workspaceName: recipient.name,
          accountName,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!result.success)
        throw new Error("Mail provider did not accept alert");
    } catch (error) {
      // The account state and the in-app notification are the durable record;
      // a lost email does not hide the problem.
      logger.warn(
        { err: formatError(error), companyId, channelAccountId },
        "Telegram webhook alert email failed",
      );
    }
  }
}

async function executeCycle(): Promise<void> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .execute();
  for (const company of companies) {
    if (stopping) return;
    try {
      const authority = await getChannelSpineWorkspaceAuthority(company.id);
      if (
        authority.writeAuthority !== "neutral" ||
        !isChannelProviderEnabled(authority, "telegram_bot")
      ) {
        continue;
      }
      await checkTelegramWebhooks(getTenantConnection(company.id), company.id, {
        shouldStop: () => stopping,
      });
    } catch (error) {
      logger.error(
        { companyId: company.id, err: formatError(error) },
        "Telegram webhook check failed",
      );
    }
  }
}

function schedule(delay: number): void {
  timer = setTimeout(() => {
    timer = null;
    if (stopping) return;
    inFlight = executeCycle()
      .catch((error) => {
        logger.error(
          { err: formatError(error) },
          "Telegram webhook watch cycle failed",
        );
      })
      .finally(() => {
        inFlight = null;
        if (!stopping) schedule(CYCLE_INTERVAL_MS);
      });
  }, delay);
}

export function initializeTelegramWebhookWatch(): void {
  if (timer || inFlight) return;
  stopping = false;
  schedule(FIRST_CYCLE_DELAY_MS);
}

export async function shutdownTelegramWebhookWatch(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  await inFlight;
}
