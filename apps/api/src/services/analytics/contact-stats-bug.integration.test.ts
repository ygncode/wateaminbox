/**
 * Regression test for the contact-stats denominator mismatch.
 *
 * `getContactStats` describes `total` over direct contacts only
 * (`contacts.is_group = false`). Its `assigned` count must share that exact
 * denominator, otherwise the active `contact_assignments` rows that WhatsApp
 * group creation writes for every user-created group (via
 * `assignCreatedGroupToItsCreator`) are pulled into a direct-contact split,
 * inflating `assigned` past `total` and driving `unassigned = total - assigned`
 * negative.
 *
 * This drives the real group-creation handler so the group assignments come
 * from the production code path, then asserts `getContactStats` keeps them out
 * of the direct-contact `assigned` / `unassigned` split.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { GroupEvent } from "../../lib/nats/index.js";
import { assignContactToUser } from "../contact.service.js";
import { handleGroupEvent } from "../handlers/group-handlers.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../tenant.service.js";
import { getContactStats } from "./index.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const OWN_JID = "15550000001@s.whatsapp.net";

function groupEvent(
  companyId: string,
  connectionId: string,
  payload: GroupEvent["payload"],
): GroupEvent {
  return {
    contractVersion: 1,
    type: "group",
    companyId,
    connectionId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

async function withTenant(
  run: (ctx: {
    companyId: string;
    connectionId: string;
    sessionId: string;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const schema = getSchemaName(companyId);

  try {
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Contact stats bug test",
        jid: OWN_JID,
        status: "connected",
      })
      .execute();
    // Commands address a session, which is what their `connection_id` holds.
    const session = await tenantDb
      .insertInto("whatsapp_connection_sessions")
      .values({
        whatsapp_connection_id: connectionId,
        status: "connected",
        started_at: new Date(),
        connected_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await run({ companyId, connectionId, sessionId: session.id });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
  }
}

/** Records a `group_create` command so the handler can attribute the group. */
async function recordGroupCreateCommand(
  companyId: string,
  sessionId: string,
  userId: string,
): Promise<string> {
  const commandId = crypto.randomUUID();
  await getTenantConnection(companyId)
    .insertInto("nats_outbox")
    .values({
      id: commandId,
      subject: "WHATSAPP.commands.test",
      payload: {
        type: "group_create",
        connection_id: sessionId,
        user_id: userId,
        command_id: commandId,
      },
      status: "published",
    })
    .execute();
  return commandId;
}

async function createGroupViaEvent(
  companyId: string,
  connectionId: string,
  groupJid: string,
  commandId: string,
): Promise<void> {
  await handleGroupEvent(
    groupEvent(companyId, connectionId, {
      action: "created",
      jid: groupJid,
      commandId,
      snapshot: {
        jid: groupJid,
        name: "Ops group",
        participants: [{ jid: OWN_JID, isAdmin: true }],
      },
    }),
  );
}

describe("getContactStats - group assignment contamination", () => {
  integrationTest(
    "group auto-assignments stay out of the direct-contact assigned/unassigned split",
    async () => {
      await withTenant(async ({ companyId, connectionId, sessionId }) => {
        const tenantDb = getTenantConnection(companyId);
        const creatorUserId = crypto.randomUUID();

        // Each created group is auto-assigned to its creator via
        // assignCreatedGroupToItsCreator, writing an active contact_assignments
        // row for a group (is_group = true) contact.
        for (let i = 0; i < 3; i++) {
          const groupJid = `1203630000000${String(i).padStart(4, "0")}@g.us`;
          const commandId = await recordGroupCreateCommand(
            companyId,
            sessionId,
            creatorUserId,
          );
          await createGroupViaEvent(
            companyId,
            connectionId,
            groupJid,
            commandId,
          );
        }

        // Two direct contacts - the set `total` describes.
        const [directAssigned, directUnassigned] = await tenantDb
          .insertInto("contacts")
          .values([
            {
              whatsapp_connection_id: connectionId,
              jid: "1555000010000@s.whatsapp.net",
              is_group: false,
            },
            {
              whatsapp_connection_id: connectionId,
              jid: "1555000010001@s.whatsapp.net",
              is_group: false,
            },
          ])
          .returning("id")
          .execute();

        // Assign only one of them, through the same service production uses.
        await assignContactToUser(
          tenantDb,
          directAssigned.id,
          creatorUserId,
          creatorUserId,
        );

        // Precondition: three group assignments + one direct assignment are all
        // active. This is exactly the contamination the unfiltered assigned
        // query used to pull into a direct-contact split.
        const activeAssignmentCount = await tenantDb
          .selectFrom("contact_assignments")
          .select((eb) => eb.fn.countAll().as("count"))
          .where("unassigned_at", "is", null)
          .executeTakeFirst();
        expect(Number(activeAssignmentCount?.count)).toBe(4);

        const directContactCount = await tenantDb
          .selectFrom("contacts")
          .select((eb) => eb.fn.countAll().as("count"))
          .where("is_group", "=", false)
          .executeTakeFirst();
        expect(Number(directContactCount?.count)).toBe(2);

        const stats = await getContactStats(companyId);

        // `total` still describes only direct contacts.
        expect(stats.total).toBe(2);

        // `assigned` shares `total`'s denominator: only the one assigned
        // direct contact, NOT the three group auto-assignments.
        expect(stats.assigned).toBe(1);
        expect(stats.assigned).toBeLessThanOrEqual(stats.total);

        // `unassigned` is therefore the remaining direct contact, never
        // negative even though groups outnumber unassigned direct contacts.
        expect(stats.unassigned).toBe(1);
        expect(stats.unassigned).toBeGreaterThanOrEqual(0);

        // The split must always sum to the direct-contact total.
        expect(stats.assigned + stats.unassigned).toBe(stats.total);

        // Guard against the direct-specific contact we did not touch leaking
        // in as an assignment it does not have.
        expect(directUnassigned.id).not.toBe(directAssigned.id);
      });
    },
  );

  integrationTest(
    "a tenant with only group assignments reports zero assigned direct contacts",
    async () => {
      await withTenant(async ({ companyId, connectionId, sessionId }) => {
        const creatorUserId = crypto.randomUUID();
        const groupJid = "12036300000009999@g.us";
        const commandId = await recordGroupCreateCommand(
          companyId,
          sessionId,
          creatorUserId,
        );
        await createGroupViaEvent(companyId, connectionId, groupJid, commandId);

        // One group assignment exists and is active, but there are no direct
        // contacts at all, so neither `total` nor `assigned` should see it.
        const activeAssignmentCount = await getTenantConnection(companyId)
          .selectFrom("contact_assignments")
          .select((eb) => eb.fn.countAll().as("count"))
          .where("unassigned_at", "is", null)
          .executeTakeFirst();
        expect(Number(activeAssignmentCount?.count)).toBe(1);

        const stats = await getContactStats(companyId);
        expect(stats.total).toBe(0);
        expect(stats.assigned).toBe(0);
        expect(stats.unassigned).toBe(0);
        expect(stats.assigned).toBeLessThanOrEqual(stats.total);
        expect(stats.unassigned).toBeGreaterThanOrEqual(0);
      });
    },
  );
});
