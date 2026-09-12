import { Hono } from "hono";
import { resolveConversationSchema } from "../../lib/schemas/conversation.js";
import { ConflictError, notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { zValidator } from "../../lib/validator.js";
import { getRouteContext } from "../../middleware/context.js";
import {
  hasContactVisibility,
  requireContactVisibility,
} from "../../middleware/resource-visibility.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { createAuditLog, getClientIp } from "../../services/audit.service.js";
import {
  resolveActiveCase,
  resolveActiveCaseForConversation,
} from "../../services/conversation-case.service.js";
import {
  type CustomerThread,
  resolveCustomerThreads,
} from "../../services/customer-timeline.service.js";

export const customerLifecycleRoutes = new Hono();

// The same body the per-conversation resolve takes, so the two surfaces
// cannot drift on what a resolution has to say about itself.
const resolveCustomerSchema = resolveConversationSchema;

/**
 * POST /contacts/:id/resolve - resolve every thread of one customer.
 *
 * A merged customer reads as one conversation, so "done with this customer"
 * has to mean all of it. The spine RFC keeps workflow state per conversation
 * and this does not change that: each thread keeps its own state row, case and
 * SLA clock, and the same action is applied to each.
 *
 * A thread holding unread inbound is deliberately left open. Resolving a quiet
 * thread is safe, because a later inbound reopens the case automatically; a
 * thread with a question already sitting in it has nothing left to reopen it,
 * so resolving would bury an unanswered customer. The skipped threads are
 * named in the response so the operator is told rather than left to notice.
 */
customerLifecycleRoutes.post(
  "/:id/resolve",
  requireContactVisibility(),
  requireMessageSendPermission,
  zValidator("json", resolveCustomerSchema),
  async (c) => {
    const { tenantDb, user, companyId, permissions } = getRouteContext(c);
    const { outcome, notes } = c.req.valid("json");

    const customer = await resolveCustomerThreads(
      tenantDb,
      companyId,
      c.req.param("id")!,
    );
    if (!customer) return notFound(c, "Contact");

    const visible: CustomerThread[] = [];
    for (const thread of customer.threads) {
      const allowed = thread.contactId
        ? await hasContactVisibility(c, thread.contactId)
        : permissions.can_view_all_chats;
      if (allowed) visible.push(thread);
    }

    const unread = new Map<string, number>();
    for (const thread of visible) {
      const threadId = threadKey(thread);
      if (threadId)
        unread.set(threadId, await unreadInThread(tenantDb, thread));
    }
    const { resolvable, skipped } = partitionByUnread(visible, unread);

    const resolved: string[] = [];
    const alreadyResolved: string[] = [];
    for (const thread of resolvable) {
      const threadId = threadKey(thread)!;
      // A thread that is already resolved is not a failure of this action, it
      // is the state this action wants. Letting its conflict escape failed the
      // whole request after earlier threads had already been committed - the
      // operator saw an error over work that had in fact been done.
      let closed;
      try {
        closed = thread.contactId
          ? await resolveActiveCase(tenantDb, thread.contactId, {
              outcome,
              notes,
              resolvedBy: user.id,
            })
          : await resolveActiveCaseForConversation(
              tenantDb,
              thread.conversationId!,
              { outcome, notes, resolvedBy: user.id },
            );
      } catch (error) {
        if (error instanceof ConflictError) {
          alreadyResolved.push(threadId);
          continue;
        }
        throw error;
      }
      resolved.push(threadId);
      await createAuditLog({
        companyId,
        userId: user.id,
        action: "conversation.resolved",
        entityType: "conversation",
        entityId: threadId,
        details: {
          contactId: thread.contactId,
          conversationId: thread.conversationId,
          caseId: closed.id,
          // Recorded per thread, because each was resolved on its own, and
          // named as a fan-out so the burst is legible in the audit log.
          viaCustomer: customer.canonicalContactId,
        },
        ipAddress: getClientIp(c),
      });
    }

    return successData(c, {
      canonicalContactId: customer.canonicalContactId,
      resolved,
      // Threads that had nothing to resolve. Reported rather than counted as
      // resolved, so the toast cannot claim work it did not do.
      alreadyResolved,
      skipped,
    });
  },
);

/** The id the chat route addresses for a thread. */
export function threadKey(thread: CustomerThread): string | null {
  return thread.conversationId ?? thread.contactId ?? null;
}

/**
 * Which threads may be resolved, and which are being left open.
 *
 * The rule, separated from the database so it can be read and tested on its
 * own: a quiet thread is safe to resolve because a later inbound reopens its
 * case automatically, while a thread already holding an unanswered question
 * has nothing left to reopen it. Resolving that one buries a customer, which
 * is the only way this action can lose work rather than merely close it.
 */
export function partitionByUnread(
  threads: CustomerThread[],
  unreadCounts: ReadonlyMap<string, number>,
): {
  resolvable: CustomerThread[];
  skipped: { threadId: string; unreadCount: number }[];
} {
  const resolvable: CustomerThread[] = [];
  const skipped: { threadId: string; unreadCount: number }[] = [];
  for (const thread of threads) {
    const threadId = threadKey(thread);
    if (!threadId) continue;
    const unreadCount = unreadCounts.get(threadId) ?? 0;
    if (unreadCount > 0) skipped.push({ threadId, unreadCount });
    else resolvable.push(thread);
  }
  return { resolvable, skipped };
}

/**
 * Unread inbound waiting in one thread.
 *
 * Read from whichever key the thread's workflow row uses: a bridged thread is
 * keyed by conversation, one that predates the spine by contact.
 */
async function unreadInThread(
  tenantDb: ReturnType<typeof getRouteContext>["tenantDb"],
  thread: CustomerThread,
): Promise<number> {
  const row = thread.conversationId
    ? await tenantDb
        .selectFrom("conversation_states")
        .select("unread_count")
        .where("conversation_id", "=", thread.conversationId)
        .executeTakeFirst()
    : thread.contactId
      ? await tenantDb
          .selectFrom("conversation_states")
          .select("unread_count")
          .where("contact_id", "=", thread.contactId)
          .where("conversation_id", "is", null)
          .executeTakeFirst()
      : undefined;
  return Number(row?.unread_count ?? 0);
}
