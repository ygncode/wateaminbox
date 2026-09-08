import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { type Kysely, sql } from "kysely";
import {
  muteContact,
  unmuteContact,
} from "./notification-preferences.service.js";
import {
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const ENABLED = process.env.RUN_DB_INTEGRATION === "1";

// Contacts that normalize to distinct JIDs.
const jidA = "15550000@s.whatsapp.net";
const jidB = "15551110@s.whatsapp.net";
const jidC = "15552220@s.whatsapp.net";
// Two device-suffix spellings of the same underlying JID, used to assert that
// concurrent mutes collapse to a single deduplicated entry.
const jidDSuffix1 = "15551234567:4@s.whatsapp.net";
const jidDSuffix2 = "15551234567:1@s.whatsapp.net";
const jidDNormalized = "15551234567@s.whatsapp.net";

describe("notification preferences mute/unmute concurrency", () => {
  const userId = crypto.randomUUID();
  let companyId!: string;
  let schema!: string;
  let tenantDb!: Kysely<TenantDatabase>;

  beforeAll(async () => {
    if (!ENABLED) return;
    companyId = crypto.randomUUID();
    schema = getSchemaName(companyId);
    await createTenantSchema(companyId);
    tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("notification_preferences")
      .values({ user_id: userId, muted_contacts: [] })
      .execute();
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
  });

  async function setMutedContacts(contacts: string[]): Promise<void> {
    await tenantDb
      .updateTable("notification_preferences")
      .set({ muted_contacts: contacts })
      .where("user_id", "=", userId)
      .execute();
  }

  async function readMutedContacts(): Promise<string[]> {
    return (
      (
        await tenantDb
          .selectFrom("notification_preferences")
          .select("muted_contacts")
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow()
      ).muted_contacts ?? []
    );
  }

  integrationTest(
    "mutes two different contacts concurrently without losing either",
    async () => {
      // The lost-update repro: both calls read the same stale [] snapshot and,
      // before the fix, overwrote the whole array, dropping one contact.
      // Re-running many iterations keeps the interleaving tight so a regression
      // would surface reliably rather than nondeterministically.
      for (let i = 0; i < 50; i += 1) {
        await setMutedContacts([]);
        const [a, b] = await Promise.all([
          muteContact(companyId, userId, jidA),
          muteContact(companyId, userId, jidB),
        ]);
        // Both calls resolve successfully (no throw) and report their own
        // contact muted.
        expect(a.mutedContacts).toContain(jidA);
        expect(b.mutedContacts).toContain(jidB);
        // The persisted array retains BOTH contacts (the property the old
        // read-modify-write violated).
        const persisted = (await readMutedContacts()).sort();
        expect(persisted).toEqual([jidA, jidB].sort());
      }
    },
    30_000,
  );

  integrationTest(
    "mutes many contacts concurrently without losing any",
    async () => {
      const contacts = [jidA, jidB, jidC];
      await setMutedContacts([]);
      await Promise.all(
        contacts.map((jid) => muteContact(companyId, userId, jid)),
      );
      expect((await readMutedContacts()).sort()).toEqual([...contacts].sort());
    },
    10_000,
  );

  integrationTest(
    "unmutes two different contacts concurrently without losing either",
    async () => {
      await setMutedContacts([jidA, jidB]);
      const [a, b] = await Promise.all([
        unmuteContact(companyId, userId, jidA),
        unmuteContact(companyId, userId, jidB),
      ]);
      // Both calls resolve successfully and no longer report their contact muted.
      expect(a.mutedContacts).not.toContain(jidA);
      expect(b.mutedContacts).not.toContain(jidB);
      // The persisted array retains neither contact.
      expect(await readMutedContacts()).toEqual([]);
    },
    10_000,
  );

  integrationTest(
    "concurrent mute and unmute of different contacts commute",
    async () => {
      await setMutedContacts([jidB]);
      await Promise.all([
        muteContact(companyId, userId, jidA),
        unmuteContact(companyId, userId, jidB),
      ]);
      // A is muted, B is unmuted, neither operation was lost.
      expect((await readMutedContacts()).sort()).toEqual([jidA]);
    },
    10_000,
  );

  integrationTest(
    "concurrent mutes of the same normalized JID do not create a duplicate",
    async () => {
      await setMutedContacts([]);
      await Promise.all([
        muteContact(companyId, userId, jidDSuffix1),
        muteContact(companyId, userId, jidDSuffix2),
      ]);
      expect(await readMutedContacts()).toEqual([jidDNormalized]);
    },
    10_000,
  );

  integrationTest(
    "mute is idempotent for an already-muted contact",
    async () => {
      await setMutedContacts([jidA]);
      const result = await muteContact(companyId, userId, jidA);
      expect(result.mutedContacts).toEqual([jidA]);
      expect(await readMutedContacts()).toEqual([jidA]);
    },
  );

  integrationTest("unmute is a no-op for a non-muted contact", async () => {
    await setMutedContacts([jidA]);
    const result = await unmuteContact(companyId, userId, jidB);
    expect(result.mutedContacts).toEqual([jidA]);
    expect(await readMutedContacts()).toEqual([jidA]);
  });

  integrationTest(
    "muteContact creates the preferences row when missing and mutes the contact",
    async () => {
      const freshUserId = crypto.randomUUID();
      const result = await muteContact(companyId, freshUserId, jidA);
      expect(result.mutedContacts).toEqual([jidA]);
      expect(
        (
          await tenantDb
            .selectFrom("notification_preferences")
            .select("muted_contacts")
            .where("user_id", "=", freshUserId)
            .executeTakeFirstOrThrow()
        ).muted_contacts,
      ).toEqual([jidA]);

      await tenantDb
        .deleteFrom("notification_preferences")
        .where("user_id", "=", freshUserId)
        .execute();
    },
    10_000,
  );

  integrationTest(
    "concurrent mute and unmute of the same contact lands on a consistent state",
    async () => {
      // Opposite operations on the same contact serialize to a single final
      // value; the fix guarantees neither write is lost and the array never
      // contains a dangling/duplicate entry.
      for (let i = 0; i < 25; i += 1) {
        await setMutedContacts([jidA]);
        await Promise.all([
          muteContact(companyId, userId, jidA),
          unmuteContact(companyId, userId, jidA),
        ]);
        const persisted = await readMutedContacts();
        // Either muted or unmuted (order-dependent), but exactly one entry
        // or none - never a duplicate and never undefined state.
        const count = persisted.filter((jid) => jid === jidA).length;
        expect(count).toBeLessThanOrEqual(1);
        expect(persisted.filter((jid) => jid === jidB)).toEqual([]);
      }
    },
    30_000,
  );
});
