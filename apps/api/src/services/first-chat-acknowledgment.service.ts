import type { Kysely, Transaction } from "kysely";
import { NotFoundError } from "../lib/errors.js";
import type { TenantDatabase } from "./tenant.service.js";

export const FIRST_CHAT_NOTICE_VERSION = "2026-09-07-v2";
export const FIRST_CHAT_NOTICE_URL =
  "https://faq.whatsapp.com/361005896189245?locale=en_US";
export const FIRST_CHAT_NOTICE =
  "Introduce your business and explain why you’re reaching out. Keep your message relevant, contact people who expect to hear from you, and respect requests to stop. WhatsApp uses automated systems and user reports to detect spam and may restrict accounts for unwanted or bulk messaging. Avoid unsolicited promotions when starting a new conversation.";
export const FIRST_CHAT_ACTION = "contact.first_chat_acknowledged";

/**
 * Whether the WhatsApp first-contact notice must be shown before sending.
 *
 * The notice states WhatsApp's own policy and links to WhatsApp's FAQ, so it
 * applies only to WhatsApp. Any other channel returns false rather than
 * raising: an id that names a conversation with no contact row is the normal
 * shape of a Telegram thread, and treating it as a missing contact blocked
 * the send behind an error the user could do nothing about.
 */
export async function needsFirstChatAcknowledgment(
  tenantDb: Kysely<TenantDatabase> | Transaction<TenantDatabase>,
  contactId: string,
): Promise<boolean> {
  const contact = await tenantDb
    .selectFrom("contacts")
    .select("is_group")
    .where("id", "=", contactId)
    .executeTakeFirst();
  if (!contact) {
    // Another channel is out of scope for the WhatsApp notice. So is a
    // conversation with no contact row: the acknowledgment is recorded
    // against a contact, so requiring one that cannot be recorded would
    // deadlock the send. Only a genuinely unknown id still raises.
    const resolved = await resolveAcknowledgmentContactId(tenantDb, contactId);
    if (!resolved) return false;
    return needsFirstChatAcknowledgment(tenantDb, resolved);
  }
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
  contactOrConversationId: string,
  userId: string,
  ipAddress?: string,
): Promise<void> {
  await tenantDb.transaction().execute(async (trx) => {
    // The notice is recorded against the contact, so a conversation id has to
    // resolve to one first - the same resolution the requirement check uses,
    // or an acknowledged notice would be filed under an id nothing reads.
    const contactId = await resolveAcknowledgmentContactId(
      trx,
      contactOrConversationId,
    );
    if (!contactId) return;
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

/**
 * The contact the WhatsApp notice applies to, or `null` when it does not
 * apply at all. Accepts a contact id or a conversation id.
 */
async function resolveAcknowledgmentContactId(
  tenantDb: Kysely<TenantDatabase> | Transaction<TenantDatabase>,
  id: string,
): Promise<string | null> {
  const contact = await tenantDb
    .selectFrom("contacts")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (contact) return contact.id;
  const conversation = await tenantDb
    .selectFrom("conversations as conversation")
    .innerJoin(
      "channel_accounts as account",
      "account.id",
      "conversation.channel_account_id",
    )
    .select(["account.channel", "conversation.legacy_contact_id"])
    .where("conversation.id", "=", id)
    .where("conversation.archived_at", "is", null)
    .executeTakeFirst();
  if (!conversation) throw new NotFoundError("Contact");
  if (conversation.channel !== "whatsapp") return null;
  return conversation.legacy_contact_id;
}
