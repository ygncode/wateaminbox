import type { Kysely } from "kysely";
import { NotFoundError } from "../lib/errors.js";
import type { TenantDatabase } from "./tenant.service.js";

export const FIRST_CHAT_NOTICE_VERSION = "2026-09-07-v2";
export const FIRST_CHAT_NOTICE_URL =
  "https://faq.whatsapp.com/361005896189245?locale=en_US";
export const FIRST_CHAT_NOTICE =
  "Introduce your business and explain why you’re reaching out. Keep your message relevant, contact people who expect to hear from you, and respect requests to stop. WhatsApp uses automated systems and user reports to detect spam and may restrict accounts for unwanted or bulk messaging. Avoid unsolicited promotions when starting a new conversation.";
export const FIRST_CHAT_ACTION = "contact.first_chat_acknowledged";

export async function needsFirstChatAcknowledgment(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<boolean> {
  const contact = await tenantDb
    .selectFrom("contacts")
    .select("is_group")
    .where("id", "=", contactId)
    .executeTakeFirst();
  if (!contact) throw new NotFoundError("Contact");
  if (contact.is_group) return false;
  const message = await tenantDb
    .selectFrom("messages")
    .select("id")
    .where("contact_id", "=", contactId)
    .limit(1)
    .executeTakeFirst();
  if (message) return false;
  const acknowledgment = await tenantDb
    .selectFrom("audit_logs")
    .select("id")
    .where("entity_type", "=", "contact")
    .where("entity_id", "=", contactId)
    .where("action", "=", FIRST_CHAT_ACTION)
    .limit(1)
    .executeTakeFirst();
  return !acknowledgment;
}

export async function acknowledgeFirstChat(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  userId: string,
  ipAddress?: string,
): Promise<void> {
  await tenantDb.transaction().execute(async (trx) => {
    // Serialize duplicate clicks and concurrent users; never swallow audit failures.
    const contact = await trx
      .selectFrom("contacts")
      .select("id")
      .where("id", "=", contactId)
      .forUpdate()
      .executeTakeFirst();
    if (!contact) throw new NotFoundError("Contact");
    if (!(await needsFirstChatAcknowledgment(trx, contactId))) return;
    await trx
      .insertInto("audit_logs")
      .values({
        user_id: userId,
        action: FIRST_CHAT_ACTION,
        entity_type: "contact",
        entity_id: contactId,
        details: {
          checked: true,
          noticeVersion: FIRST_CHAT_NOTICE_VERSION,
          notice: FIRST_CHAT_NOTICE,
          guidanceUrl: FIRST_CHAT_NOTICE_URL,
          source: "inbox",
        },
        ip_address: ipAddress ?? null,
      })
      .execute();
  });
}
