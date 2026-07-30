import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { TenantDatabase } from "../tenant.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
} from "../tenant.service.js";
import { importContacts, resolveImportConnection } from "./processing.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function seedConnection(
  tenantDb: Kysely<TenantDatabase>,
  overrides: Partial<{
    status: "connected" | "disconnected";
    archivedAt: Date | null;
    name: string;
  }> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id,
      name: overrides.name ?? "Test line",
      phone_number: `+95977${Math.floor(Math.random() * 1_000_000)}`,
      jid: `9597700${Math.floor(Math.random() * 100_000)}@s.whatsapp.net`,
      status: overrides.status ?? "connected",
      archived_at: overrides.archivedAt ?? null,
    })
    .execute();
  return id;
}

describe("resolveImportConnection", () => {
  integrationTest(
    "auto-selects the sole connected connection, ignoring disconnected and archived ones",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const connectedId = await seedConnection(tenantDb, {
          name: "Active line",
        });
        await seedConnection(tenantDb, { status: "disconnected" });
        await seedConnection(tenantDb, { archivedAt: new Date() });

        const resolved = await resolveImportConnection(tenantDb);
        expect(resolved.id).toBe(connectedId);
        expect(resolved.name).toBe("Active line");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "requires an explicit connectionId when multiple connections are connected",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await seedConnection(tenantDb);
        const secondId = await seedConnection(tenantDb);

        expect(resolveImportConnection(tenantDb)).rejects.toThrow(
          "connectionId is required",
        );

        // An explicit choice resolves the ambiguity.
        const resolved = await resolveImportConnection(tenantDb, secondId);
        expect(resolved.id).toBe(secondId);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "rejects unknown, archived, and disconnected connections; rejects when none exist",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        expect(resolveImportConnection(tenantDb)).rejects.toThrow(
          "No connected WhatsApp account",
        );
        expect(
          resolveImportConnection(tenantDb, crypto.randomUUID()),
        ).rejects.toThrow("WhatsApp connection");

        const disconnectedId = await seedConnection(tenantDb, {
          status: "disconnected",
        });
        expect(
          resolveImportConnection(tenantDb, disconnectedId),
        ).rejects.toThrow("not connected");

        const archivedId = await seedConnection(tenantDb, {
          archivedAt: new Date(),
        });
        expect(resolveImportConnection(tenantDb, archivedId)).rejects.toThrow(
          "WhatsApp connection",
        );
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );
});

describe("importContacts connection linkage", () => {
  const PHONE = "+959791112223";
  const CLEAN_PHONE = "959791112223";
  const JID = `${CLEAN_PHONE}@s.whatsapp.net`;

  integrationTest(
    "links new contacts to the target connection",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const connectionId = await seedConnection(tenantDb);

        const summary = await importContacts(
          tenantDb,
          [{ phone_number: PHONE, custom_name: "Imported" }],
          crypto.randomUUID(),
          { connectionId },
        );

        expect(summary.created).toBe(1);
        expect(summary.errors).toBe(0);
        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", JID)
          .executeTakeFirstOrThrow();
        expect(contact.whatsapp_connection_id).toBe(connectionId);
        expect(contact.custom_name).toBe("Imported");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "scopes duplicate detection to the connection so multi-account contacts stay separate",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const connectionA = await seedConnection(tenantDb);
        const connectionB = await seedConnection(tenantDb);
        const userId = crypto.randomUUID();

        // The same number already exists as connection B's contact.
        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionB,
            jid: JID,
            phone_number: CLEAN_PHONE,
            custom_name: "B's contact",
          })
          .execute();

        // Importing into A must create A's own row, not touch B's.
        const first = await importContacts(
          tenantDb,
          [{ phone_number: PHONE, custom_name: "A's contact" }],
          userId,
          { connectionId: connectionA },
        );
        expect(first.created).toBe(1);
        expect(first.updated).toBe(0);

        // Re-importing into A updates A's row instead of duplicating.
        const second = await importContacts(
          tenantDb,
          [{ phone_number: PHONE, custom_name: "A's contact v2" }],
          userId,
          { connectionId: connectionA },
        );
        expect(second.created).toBe(0);
        expect(second.updated).toBe(1);

        const rows = await tenantDb
          .selectFrom("contacts")
          .select(["whatsapp_connection_id", "custom_name"])
          .where("jid", "=", JID)
          .execute();
        expect(rows).toHaveLength(2);
        const byConnection = new Map(
          rows.map((row) => [row.whatsapp_connection_id, row.custom_name]),
        );
        expect(byConnection.get(connectionA)).toBe("A's contact v2");
        expect(byConnection.get(connectionB)).toBe("B's contact");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "adopts unlinked legacy rows instead of duplicating them",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const connectionId = await seedConnection(tenantDb);

        // A legacy CSV import created this row without a connection.
        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: null,
            jid: JID,
            phone_number: CLEAN_PHONE,
            custom_name: "Orphan",
          })
          .execute();

        const summary = await importContacts(
          tenantDb,
          [{ phone_number: PHONE, custom_name: "Adopted" }],
          crypto.randomUUID(),
          { connectionId },
        );
        expect(summary.updated).toBe(1);
        expect(summary.created).toBe(0);

        const rows = await tenantDb
          .selectFrom("contacts")
          .select(["whatsapp_connection_id", "custom_name"])
          .where("jid", "=", JID)
          .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].whatsapp_connection_id).toBe(connectionId);
        expect(rows[0].custom_name).toBe("Adopted");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "updateExisting=false errors on same-connection duplicates but not cross-connection ones",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const connectionA = await seedConnection(tenantDb);
        const connectionB = await seedConnection(tenantDb);
        const userId = crypto.randomUUID();

        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionA,
            jid: JID,
            phone_number: CLEAN_PHONE,
          })
          .execute();

        const sameConnection = await importContacts(
          tenantDb,
          [{ phone_number: PHONE }],
          userId,
          { connectionId: connectionA, updateExisting: false },
        );
        expect(sameConnection.errors).toBe(1);
        expect(sameConnection.results[0].error).toBe("Contact already exists");

        const otherConnection = await importContacts(
          tenantDb,
          [{ phone_number: PHONE }],
          userId,
          { connectionId: connectionB, updateExisting: false },
        );
        expect(otherConnection.created).toBe(1);
        expect(otherConnection.errors).toBe(0);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );
});
