import { describe, expect, test } from "bun:test";
import { db, reconcileTenantSchema } from "@wateaminbox/database";
import { sql } from "kysely";
import type { EmailOptions } from "../lib/email.js";
import {
  connectionAlertRetryMs,
  processConnectionEmailAlerts as processConnectionEmailAlertsImpl,
} from "./connection-email-alerts.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const processConnectionEmailAlerts: typeof processConnectionEmailAlertsImpl = (
  tenantDb,
  companyId,
  options = {},
) =>
  processConnectionEmailAlertsImpl(tenantDb, companyId, {
    publishNotification: async () => {},
    ...options,
  });

const integration = (name: string, run: () => Promise<void>) =>
  (process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip)(
    name,
    run,
    30_000,
  );

async function fixture(
  run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const f = await setup();
  try {
    await run(f);
  } finally {
    await dropTenantSchema(f.companyId);
    await db.deleteFrom("companies").where("id", "=", f.companyId).execute();
    await db
      .deleteFrom("users")
      .where(
        "id",
        "in",
        f.users.map((u) => u.id),
      )
      .execute();
  }
}
async function setup() {
  const companyId = crypto.randomUUID();
  await db
    .insertInto("companies")
    .values({
      id: companyId,
      name: "Alert test",
      schema_name: getSchemaName(companyId),
    })
    .execute();
  const users = await db
    .insertInto("users")
    .values(
      ["owner", "admin", "member", "unverified"].map((role) => ({
        email: `${role}-${crypto.randomUUID()}@example.test`,
        password_hash: "test-only",
        email_verified_at: role === "unverified" ? null : new Date(),
      })),
    )
    .returning(["id", "email"])
    .execute();
  await db
    .insertInto("company_members")
    .values(
      users.map((u, i) => ({
        user_id: u.id,
        company_id: companyId,
        role:
          i === 0
            ? ("owner" as const)
            : i === 2
              ? ("member" as const)
              : ("admin" as const),
      })),
    )
    .execute();
  await createTenantSchema(companyId);
  const tenant = getTenantConnection(companyId);
  const connection = await tenant
    .insertInto("whatsapp_connections")
    .values({ name: "Support", status: "connected", connected_at: new Date() })
    .returning("id")
    .executeTakeFirstOrThrow();
  const update = (values: Record<string, unknown>) =>
    tenant
      .updateTable("whatsapp_connections")
      .set(values)
      .where("id", "=", connection.id)
      .execute();
  const rows = () =>
    tenant
      .selectFrom("connection_email_alerts")
      .selectAll()
      .orderBy("user_id")
      .execute();
  const due = () =>
    tenant
      .updateTable("connection_email_alerts")
      .set({ next_attempt_at: new Date(0) })
      .execute();
  return { companyId, users, tenant, connection, update, rows, due };
}

describe("durable connection emails", () => {
  test("retry delay backs off and is bounded", () => {
    expect(connectionAlertRetryMs(1)).toBe(60_000);
    expect(connectionAlertRetryMs(2)).toBe(120_000);
    expect(connectionAlertRetryMs(100)).toBe(3_600_000);
  });
  integration(
    "grace period survives duplicate events and reconnect cancels queued mail",
    () =>
      fixture(async (f) => {
        await f.update({ status: "disconnected" });
        const rows = await f.rows();
        expect(rows).toHaveLength(2);
        expect(
          rows.every(
            (r) =>
              r.next_attempt_at.getTime() - r.occurred_at.getTime() === 300_000,
          ),
        ).toBe(true);
        await f.update({ status: "disconnected" });
        expect((await f.rows()).map((r) => r.id)).toEqual(
          rows.map((r) => r.id),
        );
        const sent: EmailOptions[] = [];
        const sender = async (mail: EmailOptions) => {
          sent.push(mail);
          return { success: true };
        };
        await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
        expect(sent).toHaveLength(0);
        await f.update({ status: "connected" });
        expect(await f.rows()).toHaveLength(0);
        await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
        expect(sent).toHaveLength(0);
      }),
  );
  integration(
    "logout escalates immediately, deduplicates replays and rearms after recovery",
    () =>
      fixture(async (f) => {
        await f.update({ status: "disconnected" });
        const old = await f.rows();
        await f.update({ logged_out_at: new Date() });
        const logout = await f.rows();
        expect(
          logout.every(
            (r) =>
              r.kind === "logged_out" &&
              r.next_attempt_at.getTime() === r.occurred_at.getTime(),
          ),
        ).toBe(true);
        expect(logout[0].id).not.toBe(old[0].id);
        await f.update({ logged_out_at: new Date() });
        expect((await f.rows()).map((r) => r.id)).toEqual(
          logout.map((r) => r.id),
        );
        const sent: EmailOptions[] = [];
        const sender = async (mail: EmailOptions) => {
          sent.push(mail);
          return { success: true };
        };
        await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
        await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
        expect(sent).toHaveLength(2);
        expect(new Set(sent.map((m) => m.to))).toEqual(
          new Set(f.users.slice(0, 2).map((u) => u.email)),
        );
        await f.update({ status: "connected", logged_out_at: null });
        await f.update({ status: "disconnected", logged_out_at: new Date() });
        await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
        expect(sent).toHaveLength(4);
      }),
  );
  integration(
    "competing replicas claim recipients once and failed mail retries independently",
    () =>
      fixture(async (f) => {
        await f.update({ status: "disconnected", logged_out_at: new Date() });
        const sent: string[] = [];
        const sender = async (mail: EmailOptions) => {
          sent.push(mail.to);
          await Bun.sleep(30);
          return { success: mail.to !== f.users[1].email };
        };
        await Promise.all([
          processConnectionEmailAlerts(f.tenant, f.companyId, { sender }),
          processConnectionEmailAlerts(f.tenant, f.companyId, { sender }),
        ]);
        expect(sent).toHaveLength(2);
        const rows = await f.rows();
        expect(rows.filter((r) => r.sent_at)).toHaveLength(1);
        expect(rows.filter((r) => !r.sent_at)[0].attempts).toBe(1);
        await f.due();
        await processConnectionEmailAlerts(f.tenant, f.companyId, {
          sender: async (mail) => {
            sent.push(mail.to);
            return { success: true };
          },
        });
        expect(sent).toHaveLength(3);
        expect(sent[2]).toBe(f.users[1].email);
      }),
  );
  integration(
    "archive cancels; never-connected pairing failures never queue",
    () =>
      fixture(async (f) => {
        await f.update({
          status: "disconnected",
          archived_at: new Date(),
          logged_out_at: new Date(),
        });
        expect(await f.rows()).toHaveLength(0);
        const pending = await f.tenant
          .insertInto("whatsapp_connections")
          .values({ status: "pending" })
          .returning("id")
          .executeTakeFirstOrThrow();
        await f.tenant
          .updateTable("whatsapp_connections")
          .set({ status: "disconnected" })
          .where("id", "=", pending.id)
          .execute();
        expect(await f.rows()).toHaveLength(0);
      }),
  );
  integration(
    "revoked recipients are dropped and reconnecting does not reset the outage",
    () =>
      fixture(async (f) => {
        await f.update({ status: "disconnected" });
        const original = await f.rows();
        await f.update({ status: "pending" });
        expect((await f.rows()).map((r) => r.id)).toEqual(
          original.map((r) => r.id),
        );
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", f.companyId)
          .where("user_id", "=", f.users[1].id)
          .execute();
        await f.due();
        const sent: string[] = [];
        await processConnectionEmailAlerts(f.tenant, f.companyId, {
          sender: async (mail) => {
            sent.push(mail.to);
            return { success: true };
          },
        });
        expect(sent).toEqual([f.users[0].email]);
      }),
  );
  integration(
    "existing-schema installation is idempotent and does not backfill old outages",
    () =>
      fixture(async (f) => {
        const schema = getSchemaName(f.companyId);
        await sql`DROP TRIGGER connection_email_alerts_changed ON ${sql.table(`${schema}.whatsapp_connections`)}`.execute(
          db,
        );
        await f.update({ status: "disconnected", logged_out_at: new Date() });
        await reconcileTenantSchema(db, schema);
        await reconcileTenantSchema(db, schema);
        expect(await f.rows()).toHaveLength(0);
        await f.update({ status: "connected", logged_out_at: null });
        await f.update({ status: "disconnected" });
        expect(await f.rows()).toHaveLength(2);
      }),
  );
});

integration(
  "tenant recipients stay isolated and expired process claims recover",
  () =>
    fixture(async (first) => {
      await fixture(async (second) => {
        await first.update({
          status: "disconnected",
          logged_out_at: new Date(),
        });
        await second.update({
          status: "disconnected",
          logged_out_at: new Date(),
        });
        await first.tenant
          .updateTable("connection_email_alerts")
          .set({ attempts: 1, next_attempt_at: new Date(Date.now() + 120_000) })
          .execute();
        const sent: string[] = [];
        const sender = async (mail: EmailOptions) => {
          sent.push(mail.to);
          return { success: true };
        };
        await processConnectionEmailAlerts(first.tenant, first.companyId, {
          sender,
        });
        expect(sent).toHaveLength(0);
        await first.due();
        await processConnectionEmailAlerts(first.tenant, first.companyId, {
          sender,
        });
        expect(new Set(sent)).toEqual(
          new Set(first.users.slice(0, 2).map((u) => u.email)),
        );
        expect(
          (await first.rows()).every((r) => r.attempts === 2 && r.sent_at),
        ).toBe(true);
        expect(
          (await second.rows()).every((r) => r.attempts === 0 && !r.sent_at),
        ).toBe(true);
      });
    }),
);

integration(
  "persistent alerts survive email failure, reading, dismissal and recovery",
  () =>
    fixture(async (f) => {
      await f.update({ status: "disconnected", logged_out_at: new Date() });
      const history = () =>
        f.tenant.selectFrom("notification_history").selectAll().execute();
      let published = 0;
      const sender = async () => ({ success: false });
      await processConnectionEmailAlerts(f.tenant, f.companyId, {
        sender,
        publishNotification: async () => {
          published++;
          throw new Error("offline");
        },
      });
      const notifications = await history();
      expect(notifications).toHaveLength(2);
      expect(published).toBe(2);
      expect(new Set(notifications.map((n) => n.user_id))).toEqual(
        new Set(f.users.slice(0, 2).map((u) => u.id)),
      );
      expect(
        notifications.every(
          (n) =>
            n.notification_type === "system" &&
            !n.is_read &&
            n.action_url === `/w/${f.companyId}/settings/connections`,
        ),
      ).toBe(true);
      expect(notifications[0].metadata).toMatchObject({
        connectionId: f.connection.id,
        connectionAlertKind: "logged_out",
      });
      await f.tenant
        .updateTable("notification_history")
        .set({ is_read: true })
        .where("id", "=", notifications[0].id)
        .execute();
      await f.tenant
        .deleteFrom("notification_history")
        .where("id", "=", notifications[1].id)
        .execute();
      await f.due();
      await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
      expect(await history()).toHaveLength(1);
      expect((await history())[0].is_read).toBe(true);
      await f.update({ status: "connected", logged_out_at: null });
      expect(await f.rows()).toHaveLength(0);
      expect(await history()).toHaveLength(1);
      await f.update({ status: "disconnected", logged_out_at: new Date() });
      await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
      expect(await history()).toHaveLength(3);
    }),
);

integration(
  "escalation rearms persistent alerts and existing mail is not resent",
  () =>
    fixture(async (f) => {
      await f.update({ status: "disconnected" });
      await f.due();
      await f.tenant
        .updateTable("connection_email_alerts")
        .set({ sent_at: new Date() })
        .execute();
      let sent = 0;
      const sender = async () => {
        sent++;
        return { success: true };
      };
      await processConnectionEmailAlerts(f.tenant, f.companyId, { sender });
      expect(sent).toBe(0);
      expect((await f.rows()).every((r) => r.notification_created_at)).toBe(
        true,
      );
      await f.update({ logged_out_at: new Date() });
      expect(
        (await f.rows()).every((r) => r.notification_created_at === null),
      ).toBe(true);
      await Promise.all([
        processConnectionEmailAlerts(f.tenant, f.companyId, { sender }),
        processConnectionEmailAlerts(f.tenant, f.companyId, { sender }),
      ]);
      expect(sent).toBe(2);
      const history = await f.tenant
        .selectFrom("notification_history")
        .selectAll()
        .execute();
      expect(history).toHaveLength(4);
      expect(
        history.filter((n) => n.title === "WhatsApp logged out"),
      ).toHaveLength(2);
    }),
);

integration(
  "upgrades an existing email queue without losing incident or delivery state",
  () =>
    fixture(async (f) => {
      const schema = getSchemaName(f.companyId);
      await f.update({ status: "disconnected", logged_out_at: new Date() });
      await f.tenant
        .updateTable("connection_email_alerts")
        .set({ sent_at: new Date() })
        .execute();
      const before = await f.rows();
      await sql`DROP TRIGGER connection_notification_reset ON ${sql.table(`${schema}.connection_email_alerts`)}`.execute(
        db,
      );
      await sql`ALTER TABLE ${sql.table(`${schema}.connection_email_alerts`)} DROP COLUMN notification_created_at`.execute(
        db,
      );
      await reconcileTenantSchema(db, schema);
      await reconcileTenantSchema(db, schema);
      const after = await f.rows();
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
      expect(
        after.every((r) => r.sent_at && r.notification_created_at === null),
      ).toBe(true);
    }),
);
