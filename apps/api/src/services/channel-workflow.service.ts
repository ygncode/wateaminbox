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

export interface WorkflowIdentity {
  contactId: string | null;
  conversationId: string | null;
  isGroup: boolean;
  subject: string | null;
}

/** Accept a contact UUID or a conversation UUID and return both identities. */
export async function resolveWorkflowIdentity(
  db: WorkflowDb,
  id: string,
): Promise<WorkflowIdentity | null> {
  const contact = await db
    .selectFrom("contacts")
    .select(["id", "is_group"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (contact) {
    return {
      contactId: contact.id,
      conversationId: await conversationIdForContact(db, contact.id),
      isGroup: contact.is_group,
      subject: null,
    };
  }
  const conversation = await db
    .selectFrom("conversations")
    .select(["id", "kind", "subject", "legacy_contact_id"])
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (!conversation) return null;
  return {
    contactId: conversation.legacy_contact_id,
    conversationId: conversation.id,
    isGroup: conversation.kind !== "direct",
    subject: conversation.subject,
  };
}
