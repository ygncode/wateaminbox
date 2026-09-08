import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";

type WorkflowDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/** Resolve the deterministic conversation bridged from a legacy contact. */
export async function conversationIdForContact(
  db: WorkflowDb,
  contactId: string,
): Promise<string | null> {
  const conversation = await db
    .selectFrom("conversations")
    .select("id")
    .where("legacy_contact_id", "=", contactId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return conversation?.id ?? null;
}

/** Resolve the workflow contact bridged from a conversation. */
export async function contactIdForConversation(
  db: WorkflowDb,
  conversationId: string,
): Promise<string | null> {
  const conversation = await db
    .selectFrom("conversations")
    .select("legacy_contact_id")
    .where("id", "=", conversationId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return conversation?.legacy_contact_id ?? null;
}

/** Accept a contact UUID or a conversation UUID and return the workflow contact. */
export async function resolveWorkflowContactId(
  db: WorkflowDb,
  id: string,
): Promise<string | null> {
  const contact = await db
    .selectFrom("contacts")
    .select("id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (contact) return contact.id;
  return contactIdForConversation(db, id);
}
