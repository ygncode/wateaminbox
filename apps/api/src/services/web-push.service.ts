import webPush from "web-push";
import { env } from "../lib/env.js";
import { createLogger, formatError } from "../lib/logger.js";
import { getTenantConnection } from "./tenant.service.js";

const logger = createLogger("WebPush");
let vapidConfigured = false;

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

export interface PushPayload {
  version: 1;
  type: "message" | "notification";
  title: string;
  body: string;
  tag: string;
  actionUrl: string;
  icon?: string;
  badge?: string;
}

export interface PushDeliverySummary {
  attempted: number;
  succeeded: number;
  failed: number;
  staleRemoved: number;
}

export function isWebPushConfigured(): boolean {
  return Boolean(
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT,
  );
}

function configureVapid(): boolean {
  if (!isWebPushConfigured()) return false;
  if (!vapidConfigured) {
    webPush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    vapidConfigured = true;
  }
  return true;
}

export function isStalePushError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function removeStalePushSubscription(
  error: unknown,
  remove: () => Promise<unknown>,
): Promise<boolean> {
  if (!isStalePushError(error)) return false;
  await remove();
  return true;
}

export async function getPushStatus(companyId: string, userId: string) {
  const tenantDb = getTenantConnection(companyId);
  const subscription = await tenantDb
    .selectFrom("push_subscriptions")
    .select("endpoint")
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return {
    configured: isWebPushConfigured(),
    subscribed: Boolean(subscription),
    publicKey: isWebPushConfigured() ? env.VAPID_PUBLIC_KEY : null,
  };
}

export async function upsertPushSubscription(
  companyId: string,
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  const tenantDb = getTenantConnection(companyId);
  await tenantDb
    .insertInto("push_subscriptions")
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      user_agent: input.userAgent ?? null,
      last_used_at: new Date(),
    })
    .onConflict((conflict) =>
      conflict.column("endpoint").doUpdateSet({
        user_id: userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        user_agent: input.userAgent ?? null,
        updated_at: new Date(),
        last_used_at: new Date(),
      }),
    )
    .execute();
}

export async function deletePushSubscription(
  companyId: string,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const result = await getTenantConnection(companyId)
    .deleteFrom("push_subscriptions")
    .where("user_id", "=", userId)
    .where("endpoint", "=", endpoint)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

export async function deleteAllPushSubscriptionsForUser(
  companyId: string,
  userId: string,
): Promise<number> {
  const result = await getTenantConnection(companyId)
    .deleteFrom("push_subscriptions")
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

export async function sendPushToUsers(
  companyId: string,
  userIds: string[],
  payload: PushPayload,
): Promise<PushDeliverySummary> {
  const uniqueUserIds = [...new Set(userIds)];
  if (!configureVapid() || uniqueUserIds.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, staleRemoved: 0 };
  }

  const tenantDb = getTenantConnection(companyId);
  const subscriptions = await tenantDb
    .selectFrom("push_subscriptions")
    .select(["endpoint", "p256dh", "auth", "user_id"])
    .where("user_id", "in", uniqueUserIds)
    .execute();

  const outcomes = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 },
        );
        await tenantDb
          .updateTable("push_subscriptions")
          .set({ last_used_at: new Date(), updated_at: new Date() })
          .where("endpoint", "=", subscription.endpoint)
          .where("user_id", "=", subscription.user_id)
          .execute();
        return "success" as const;
      } catch (error) {
        if (
          await removeStalePushSubscription(error, () =>
            tenantDb
              .deleteFrom("push_subscriptions")
              .where("endpoint", "=", subscription.endpoint)
              .where("user_id", "=", subscription.user_id)
              .execute(),
          )
        ) {
          return "stale" as const;
        }
        logger.warn(
          {
            error: formatError(error),
            companyId,
            userId: subscription.user_id,
            transport: "web-push",
          },
          "Web Push delivery failed",
        );
        return "failed" as const;
      }
    }),
  );

  const summary: PushDeliverySummary = {
    attempted: subscriptions.length,
    succeeded: outcomes.filter((outcome) => outcome === "success").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    staleRemoved: outcomes.filter((outcome) => outcome === "stale").length,
  };
  logger.info(
    { companyId, transport: "web-push", ...summary },
    "Web Push batch completed",
  );
  return summary;
}
