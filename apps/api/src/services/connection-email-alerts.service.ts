import { db } from "@wateaminbox/database";
import { type Kysely, sql } from "kysely";
import { renderConnectionAlertEmail } from "../lib/connection-alert-email.js";
import {
  type EmailOptions,
  type EmailResult,
  sendEmail,
} from "../lib/email.js";
import { createLogger, formatError } from "../lib/logger.js";
import { persistConnectionSystemNotification } from "./connection-system-notifications.service.js";
import { publishNotificationInvalidation } from "./notification-delivery.service.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";

const logger = createLogger("ConnectionEmailAlerts");
const INTERVAL_MS = 15_000;
const CLAIM_MS = 120_000;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let stopping = false;

export function connectionAlertRetryMs(attempts: number): number {
  return Math.min(
    60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6),
    3_600_000,
  );
}

type Sender = (options: EmailOptions) => Promise<EmailResult>;

/** One durable claim at a time, so a slow batch cannot outlive later leases. */
export async function processConnectionEmailAlerts(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: {
    sender?: Sender;
    publicDb?: typeof db;
    publishNotification?: typeof publishNotificationInvalidation;
    limit?: number;
    shouldStop?: () => boolean;
  } = {},
): Promise<void> {
  const publicDb = options.publicDb ?? db;
  const sender = options.sender ?? sendEmail;
  for (let i = 0; i < (options.limit ?? 25); i++) {
    if (options.shouldStop?.()) return;
    const alert = await tenantDb.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("connection_email_alerts")
        .selectAll()
        .where((eb) =>
          eb.or([
            eb("sent_at", "is", null),
            eb("notification_created_at", "is", null),
          ]),
        )
        .where("next_attempt_at", "<=", sql<Date>`now()`)
        .orderBy("next_attempt_at")
        .forUpdate()
        .skipLocked()
        .limit(1)
        .executeTakeFirst();
      if (!row) return;
      return trx
        .updateTable("connection_email_alerts")
        .set({
          next_attempt_at: sql<Date>`now() + ${CLAIM_MS} * interval '1 millisecond'`,
          attempts: row.attempts + 1,
        })
        .where("id", "=", row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    if (!alert) return;
    try {
      // Re-read after claiming. Recovery/archive deletes the queue; escalation
      // replaces its id. Removed/demoted recipients cannot receive queued mail.
      const connection = await tenantDb
        .selectFrom("connection_email_alerts as a")
        .innerJoin("whatsapp_connections as c", "c.id", "a.connection_id")
        .select(["c.name", "c.status"])
        .where("a.id", "=", alert.id)
        .where("c.archived_at", "is", null)
        .where("c.status", "!=", "connected")
        .executeTakeFirst();
      const recipient = await publicDb
        .selectFrom("company_members as m")
        .innerJoin("users as u", "u.id", "m.user_id")
        .innerJoin("companies as c", "c.id", "m.company_id")
        .select(["u.email", "c.name as workspaceName"])
        .where("m.company_id", "=", companyId)
        .where("m.user_id", "=", alert.user_id)
        .where("m.role", "in", ["owner", "admin"])
        .where("u.email_verified_at", "is not", null)
        .where("c.status", "=", "active")
        .executeTakeFirst();
      if (!connection || !recipient) {
        await tenantDb
          .deleteFrom("connection_email_alerts")
          .where("id", "=", alert.id)
          .execute();
        continue;
      }
      const notification = await persistConnectionSystemNotification(
        tenantDb,
        companyId,
        alert.id,
        connection.name || "WhatsApp connection",
      );
      if (!notification) continue;
      if (notification.created) {
        try {
          await (
            options.publishNotification ?? publishNotificationInvalidation
          )(companyId, alert.user_id, notification.id, "system");
        } catch {
          // History is authoritative; an unavailable realtime transport must
          // neither remove the saved notification nor block email delivery.
          logger.warn(
            { companyId },
            "Connection notification saved; realtime invalidation failed",
          );
        }
      }
      if (alert.sent_at) continue;
      const result = await sender({
        to: recipient.email,
        ...renderConnectionAlertEmail({
          kind: alert.kind,
          workspaceId: companyId,
          workspaceName: recipient.workspaceName,
          connectionName: connection.name || "WhatsApp connection",
          occurredAt: alert.occurred_at,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!result.success)
        throw new Error("Mail provider did not accept connection alert");
      await tenantDb
        .updateTable("connection_email_alerts")
        .set({ sent_at: new Date() })
        .where("id", "=", alert.id)
        .execute();
      logger.info(
        { companyId, kind: alert.kind },
        "Connection alert email accepted",
      );
    } catch {
      // Keep provider responses, email addresses and connection names out of logs.
      await tenantDb
        .updateTable("connection_email_alerts")
        .set({
          next_attempt_at: sql<Date>`now() + ${connectionAlertRetryMs(alert.attempts)} * interval '1 millisecond'`,
        })
        .where("id", "=", alert.id)
        .execute();
      logger.warn(
        { companyId, kind: alert.kind, attempt: alert.attempts },
        "Connection alert email will retry",
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
      await processConnectionEmailAlerts(
        getTenantConnection(company.id),
        company.id,
        { shouldStop: () => stopping },
      );
    } catch (error) {
      logger.error(
        { companyId: company.id, err: formatError(error) },
        "Connection alert processing failed",
      );
    }
  }
}

export function initializeConnectionEmailAlerts(): void {
  if (timer) return;
  stopping = false;
  const run = () => {
    if (inFlight || stopping) return;
    inFlight = executeCycle()
      .catch((error) => {
        logger.error(
          { err: formatError(error) },
          "Connection alert cycle failed",
        );
      })
      .finally(() => {
        inFlight = null;
      });
  };
  run();
  timer = setInterval(run, INTERVAL_MS);
}

export async function shutdownConnectionEmailAlerts(): Promise<void> {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  await inFlight;
}
