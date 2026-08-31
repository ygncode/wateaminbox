import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { ContactEvent } from "../lib/nats/index.js";
import { handleContactEvent } from "./handlers/contact-handlers.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

function randomNumericId(): string {
  const hex = crypto.randomUUID().replaceAll("-", "").slice(0, 15);
  return (BigInt(`0x${hex}`) + 100_000_000_000_000n).toString();
}

/**
 * Naming a group member must touch that member's row and nothing else.
 *
 * The blank-only guard on the naming update is `push_name IS NULL OR
 * btrim(push_name) = ''`. SQL binds AND tighter than OR, so without parentheses
 * it parses as `(id = $1 AND push_name IS NULL) OR btrim(push_name) = ''` -
 * which drops the row scope entirely and stamps the first member's name onto
 * every blank contact in the tenant. That produced a naming result that
 * depended on the order rows came back in, which is what made the group-sync
 * naming test intermittent.
 */
describe("group member naming scope", () => {
  integrationTest(
    "names only the member it resolved a name for, never every blank contact",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const groupJid = "120363000000000999@g.us";
      const ownNumber = randomNumericId();
      const namedMember = randomNumericId();
      const blankMember = randomNumericId();
      const bystander = randomNumericId();

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Primary",
            jid: `${ownNumber}@s.whatsapp.net`,
            status: "connected",
          })
          .execute();

        // Only one of the two members has a name WhatsApp knows.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id, our_jid, their_jid, full_name
          ) VALUES (
            ${connectionId},
            ${`${ownNumber}@s.whatsapp.net`},
            ${`${namedMember}@s.whatsapp.net`},
            'Only This Member'
          )
        `.execute(db);

        // A contact that has nothing to do with this group, carrying a
        // historically blank name. Whitespace rather than NULL is what the
        // broken predicate matched: btrim(NULL) = '' is NULL, not true, so a
        // NULL-named row never showed the bug.
        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: `${bystander}@s.whatsapp.net`,
            phone_number: bystander,
            push_name: "   ",
            is_group: false,
          })
          .execute();

        const contactEvent: ContactEvent = {
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            jid: groupJid,
            displayName: "Scope Group",
            isGroup: true,
            participants: [
              { jid: `${namedMember}@s.whatsapp.net`, isAdmin: false },
              { jid: `${blankMember}@s.whatsapp.net`, isAdmin: false },
            ],
          },
        };
        await handleContactEvent(contactEvent);

        // The first pass creates the member already named, so the guarded
        // update never runs. Blanking it is what a historically unnamed row
        // looks like, and it is the only state in which the naming update
        // fires at all - the same setup the group-sync naming test uses.
        await tenantDb
          .updateTable("contacts")
          .set({ push_name: "   " })
          .where("jid", "=", `${namedMember}@s.whatsapp.net`)
          .where("whatsapp_connection_id", "=", connectionId)
          .execute();

        // A second pass is what re-names the member.
        await handleContactEvent(contactEvent);

        const nameOf = async (number: string) =>
          (
            await tenantDb
              .selectFrom("contacts")
              .select(["push_name"])
              .where("jid", "=", `${number}@s.whatsapp.net`)
              .where("whatsapp_connection_id", "=", connectionId)
              .executeTakeFirstOrThrow()
          ).push_name;

        expect(await nameOf(namedMember)).toBe("Only This Member");

        // The other member has no name anywhere, so it stays unnamed rather
        // than inheriting its neighbour's.
        expect(await nameOf(blankMember)).toBeNull();

        // The regression this test exists for: an unrelated blank contact must
        // be untouched. Without the parentheses it is named "Only This Member".
        expect(await nameOf(bystander)).toBe("   ");
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id = ${connectionId}
        `.execute(db);
      }
    },
  );
});
