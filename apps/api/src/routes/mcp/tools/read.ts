import { getContactDisplayName } from "@wateaminbox/shared";
import type { Context } from "hono";
import { z } from "zod";
import { getRouteContext } from "../../../middleware/context.js";
import { hasContactVisibility } from "../../../middleware/resource-visibility.js";
import {
  formatBulkJob,
  getBulkJobProgress,
  getBulkJobProgressMap,
} from "../../../services/bulk-job.service.js";
import { getMembers } from "../../../services/company/index.js";
import {
  type ContactWithLastMessage,
  getContactsWithLastMessage,
  getCurrentAssignment,
} from "../../../services/contact.service.js";
import { globalSearch } from "../../../services/search.service.js";
import { getUserNames } from "../../../services/user.service.js";
import {
  clampLimit,
  MAX_LIST_LIMIT,
  type McpToolDefinition,
  McpToolError,
  truncateText,
} from "../tool-context.js";

const limitField = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIST_LIMIT)
  .optional()
  .describe("Max results (default 20, max 50)");
const offsetField = z.number().int().min(0).optional();

/** Throws the same non-disclosing error the REST routes use (a 404). */
export async function requireVisibleContact(
  c: Context,
  contactId: string,
): Promise<void> {
  if (!(await hasContactVisibility(c, contactId))) {
    throw new McpToolError("Contact not found");
  }
}

function compactConversation(contact: ContactWithLastMessage) {
  return {
    contactId: contact.id,
    name: getContactDisplayName(contact, "Unknown"),
    phoneNumber: contact.phone_number,
    isGroup: contact.is_group,
    status: contact.conversation_status ?? "resolved",
    unreadCount: Number(contact.unread_count),
    assignedTo: contact.assigned_to,
    lastMessageAt: contact.last_message_at,
    lastMessage: contact.last_message
      ? {
          ...truncateText(contact.last_message.content),
          fromMe: contact.last_message.fromMe,
          type: contact.last_message.messageType,
          timestamp: contact.last_message.timestamp,
        }
      : null,
  };
}

export function memberDisplayName(name: string | null | undefined): string {
  return name?.trim() || "Team member";
}

export function fallbackInboundSenderLabel(senderJid: string): string {
  const [identifier, domain] = senderJid.split("@");
  if (identifier && (domain === "s.whatsapp.net" || domain === "c.us")) {
    return `+${identifier}`;
  }
  return senderJid;
}

export const readTools: McpToolDefinition[] = [
  {
    name: "search",
    description:
      "Search messages and contacts in the workspace by text. Returns compact matches; use get_conversation_messages for full context.",
    scope: "read",
    inputSchema: {
      query: z.string().min(2).describe("Search text (min 2 characters)"),
      limit: limitField,
    },
    handler: async (args: { query: string; limit?: number }, c) => {
      const { companyId, user, permissions } = getRouteContext(c);
      const results = await globalSearch(companyId, args.query.trim(), {
        limit: clampLimit(args.limit),
        assignedUserId: permissions.can_view_all_chats ? undefined : user.id,
      });
      return {
        messages: results.messages.map((m) => ({
          contactId: m.contactId,
          contactName: m.contactName,
          messageId: m.id,
          ...truncateText(m.content),
          type: m.messageType,
          timestamp: m.timestamp,
        })),
        contacts: results.contacts,
      };
    },
  },
  {
    name: "list_conversations",
    description:
      "List conversations (contacts with their latest message and state), newest activity first. Members without view-all permission only see conversations assigned to them.",
    scope: "read",
    inputSchema: {
      status: z
        .enum(["open", "pending", "resolved", "all"])
        .optional()
        .describe("Filter by conversation status (default all)"),
      search: z.string().optional().describe("Filter by contact name/number"),
      unreadOnly: z
        .boolean()
        .optional()
        .describe("Only conversations with unread messages"),
      limit: limitField,
      offset: offsetField,
    },
    handler: async (
      args: {
        status?: "open" | "pending" | "resolved" | "all";
        search?: string;
        unreadOnly?: boolean;
        limit?: number;
        offset?: number;
      },
      c,
    ) => {
      const { tenantDb, companyId, user, permissions } = getRouteContext(c);
      const limit = clampLimit(args.limit);
      const { contacts, total } = await getContactsWithLastMessage(
        tenantDb,
        companyId,
        {
          search: args.search,
          limit,
          offset: args.offset ?? 0,
          includeGroups: true,
          conversationStatus: args.status ?? "all",
          unreadOnly: args.unreadOnly ?? false,
          userId: user.id,
          restrictToAssigned: !permissions.can_view_all_chats,
        },
      );
      return {
        conversations: contacts.map(compactConversation),
        total,
        hasMore: (args.offset ?? 0) + contacts.length < total,
      };
    },
  },
  {
    name: "get_conversation_messages",
    description:
      "Read a conversation's messages, newest first, with cursor pagination. Long message bodies are truncated to 2000 characters. sentBy is the teammate name for outbound messages and the best stored contact/sender name (or a safe JID label) for inbound ones, including group participants; senderJid identifies inbound senders stably.",
    scope: "read",
    inputSchema: {
      contactId: z.string().uuid().describe("The conversation's contact id"),
      limit: limitField,
      cursor: z
        .string()
        .uuid()
        .optional()
        .describe("nextCursor from a previous call"),
    },
    handler: async (
      args: { contactId: string; limit?: number; cursor?: string },
      c,
    ) => {
      const { tenantDb } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);
      const limit = clampLimit(args.limit);

      let query = tenantDb
        .selectFrom("messages")
        .select([
          "id",
          "from_me",
          "sender_jid",
          "sender_name",
          "sent_by_user_id",
          "message_type",
          "content",
          "status",
          "timestamp",
        ])
        .where("contact_id", "=", args.contactId)
        .orderBy("timestamp", "desc")
        .orderBy("id", "desc")
        .limit(limit);

      if (args.cursor) {
        const cur = await tenantDb
          .selectFrom("messages")
          .select(["id", "timestamp"])
          .where("id", "=", args.cursor)
          .where("contact_id", "=", args.contactId)
          .executeTakeFirst();
        if (!cur) {
          throw new McpToolError("Invalid cursor");
        }
        query = query.where((eb) =>
          eb.or([
            eb("timestamp", "<", cur.timestamp),
            eb.and([
              eb("timestamp", "=", cur.timestamp),
              eb("id", "<", cur.id),
            ]),
          ]),
        );
      }

      const messages = await query.execute();
      const senderIds = messages
        .map((m) => m.sent_by_user_id)
        .filter((id): id is string => Boolean(id));
      const userNames = await getUserNames(senderIds);

      // Attribute inbound group messages: prefer the workspace contact name,
      // then the sender name captured with the message, and only then a safe
      // JID label. Opaque LIDs must never be presented as phone numbers.
      const senderJids = [
        ...new Set(
          messages
            .filter((m) => !m.from_me && m.sender_jid)
            .map((m) => m.sender_jid as string),
        ),
      ];
      const jidNames = new Map<string, string>();
      if (senderJids.length > 0) {
        const senderContacts = await tenantDb
          .selectFrom("contacts")
          .select([
            "jid",
            "custom_name",
            "push_name",
            "username",
            "phone_number",
          ])
          .where("jid", "in", senderJids)
          .execute();
        for (const senderContact of senderContacts) {
          if (senderContact.jid) {
            jidNames.set(
              senderContact.jid,
              getContactDisplayName(senderContact, senderContact.jid),
            );
          }
        }
      }
      const conversationName = getContactDisplayName(
        await tenantDb
          .selectFrom("contacts")
          .select([
            "custom_name",
            "push_name",
            "username",
            "phone_number",
            "jid",
          ])
          .where("id", "=", args.contactId)
          .executeTakeFirstOrThrow(),
        "Unknown",
      );
      const inboundSenderName = (m: {
        sender_jid: string | null;
        sender_name: string | null;
      }): string => {
        if (!m.sender_jid) return m.sender_name?.trim() || conversationName;
        return (
          jidNames.get(m.sender_jid) ||
          m.sender_name?.trim() ||
          fallbackInboundSenderLabel(m.sender_jid)
        );
      };

      return {
        messages: messages.map((m) => ({
          id: m.id,
          fromMe: m.from_me,
          sentBy: m.from_me
            ? m.sent_by_user_id
              ? (userNames.get(m.sent_by_user_id) ?? m.sent_by_user_id)
              : null
            : inboundSenderName(m),
          senderJid: m.from_me ? null : m.sender_jid,
          type: m.message_type,
          ...truncateText(m.content),
          status: m.status,
          timestamp: m.timestamp,
        })),
        hasMore: messages.length === limit,
        nextCursor:
          messages.length === limit
            ? (messages[messages.length - 1]?.id ?? null)
            : null,
      };
    },
  },
  {
    name: "list_contacts",
    description:
      "List workspace contacts. Members without view-all permission only see contacts assigned to them.",
    scope: "read",
    inputSchema: {
      search: z.string().optional(),
      includeGroups: z.boolean().optional().describe("Default false"),
      limit: limitField,
      offset: offsetField,
    },
    handler: async (
      args: {
        search?: string;
        includeGroups?: boolean;
        limit?: number;
        offset?: number;
      },
      c,
    ) => {
      const { tenantDb, companyId, user, permissions } = getRouteContext(c);
      const limit = clampLimit(args.limit);
      const { contacts, total } = await getContactsWithLastMessage(
        tenantDb,
        companyId,
        {
          search: args.search,
          limit,
          offset: args.offset ?? 0,
          includeGroups: args.includeGroups ?? false,
          conversationStatus: "all",
          userId: user.id,
          restrictToAssigned: !permissions.can_view_all_chats,
        },
      );
      return {
        contacts: contacts.map((contact) => ({
          contactId: contact.id,
          name: getContactDisplayName(contact, "Unknown"),
          phoneNumber: contact.phone_number,
          isGroup: contact.is_group,
          assignedTo: contact.assigned_to,
        })),
        total,
        hasMore: (args.offset ?? 0) + contacts.length < total,
      };
    },
  },
  {
    name: "get_contact",
    description:
      "Get a contact's profile: name, phone number, assignment, tags, and the 5 most recent notes (shared + your private ones). Use list_contact_notes for the full note history.",
    scope: "read",
    inputSchema: {
      contactId: z.string().uuid(),
    },
    handler: async (args: { contactId: string }, c) => {
      const { tenantDb } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);

      const contact = await tenantDb
        .selectFrom("contacts")
        .select([
          "id",
          "jid",
          "phone_number",
          "push_name",
          "username",
          "custom_name",
          "is_group",
          "notes_shared",
          "created_at",
        ])
        .where("id", "=", args.contactId)
        .executeTakeFirst();
      if (!contact) {
        throw new McpToolError("Contact not found");
      }

      const assignment = await getCurrentAssignment(tenantDb, args.contactId);

      const [tags, sharedNotes, privateNotes] = await Promise.all([
        tenantDb
          .selectFrom("contact_tags")
          .innerJoin("tags", "tags.id", "contact_tags.tag_id")
          .select(["tags.id", "tags.name", "tags.color"])
          .where("contact_tags.contact_id", "=", args.contactId)
          .execute(),
        tenantDb
          .selectFrom("contact_notes_shared")
          .select(["id", "author_name", "content", "created_at"])
          .where("contact_id", "=", args.contactId)
          .orderBy("created_at", "desc")
          .limit(5)
          .execute(),
        tenantDb
          .selectFrom("contact_notes_private")
          .select(["id", "content", "created_at"])
          .where("contact_id", "=", args.contactId)
          .where("user_id", "=", c.get("user").id)
          .orderBy("created_at", "desc")
          .limit(5)
          .execute(),
      ]);

      const assignedNames = assignment
        ? await getUserNames([assignment.assigned_to])
        : null;

      return {
        contactId: contact.id,
        name: getContactDisplayName(contact, "Unknown"),
        phoneNumber: contact.phone_number,
        isGroup: contact.is_group,
        // Legacy free-text field on the contact profile, distinct from the
        // note entries below (contact_notes_shared / contact_notes_private).
        profileNote: truncateText(contact.notes_shared).text,
        recentSharedNotes: sharedNotes.map((note) => ({
          id: note.id,
          author: note.author_name,
          ...truncateText(note.content),
          createdAt: note.created_at,
        })),
        recentPrivateNotes: privateNotes.map((note) => ({
          id: note.id,
          ...truncateText(note.content),
          createdAt: note.created_at,
        })),
        assignedTo: assignment?.assigned_to ?? null,
        assignedToName: assignment
          ? (assignedNames?.get(assignment.assigned_to) ?? null)
          : null,
        tags,
        createdAt: contact.created_at,
      };
    },
  },
  {
    name: "list_contact_notes",
    description:
      "List a contact's notes, newest first. type 'shared' (default) lists team-visible notes; 'private' lists only your own private notes.",
    scope: "read",
    inputSchema: {
      contactId: z.string().uuid(),
      type: z.enum(["shared", "private"]).optional(),
      limit: limitField,
      offset: offsetField,
    },
    handler: async (
      args: {
        contactId: string;
        type?: "shared" | "private";
        limit?: number;
        offset?: number;
      },
      c,
    ) => {
      const { tenantDb, user } = getRouteContext(c);
      await requireVisibleContact(c, args.contactId);
      const limit = clampLimit(args.limit);
      const offset = args.offset ?? 0;

      if (args.type === "private") {
        const notes = await tenantDb
          .selectFrom("contact_notes_private")
          .select(["id", "content", "created_at", "updated_at"])
          .where("contact_id", "=", args.contactId)
          .where("user_id", "=", user.id)
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return {
          notes: notes.map((note) => ({
            id: note.id,
            ...truncateText(note.content),
            createdAt: note.created_at,
            updatedAt: note.updated_at,
          })),
          hasMore: notes.length === limit,
        };
      }

      const notes = await tenantDb
        .selectFrom("contact_notes_shared")
        .select(["id", "author_name", "content", "created_at", "updated_at"])
        .where("contact_id", "=", args.contactId)
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute();
      return {
        notes: notes.map((note) => ({
          id: note.id,
          author: note.author_name,
          ...truncateText(note.content),
          createdAt: note.created_at,
          updatedAt: note.updated_at,
        })),
        hasMore: notes.length === limit,
      };
    },
  },
  {
    name: "list_members",
    description:
      "List the minimal workspace member identity directory (id and display name). Use member ids as targets for assign_contact.",
    scope: "read",
    inputSchema: {},
    handler: async (_args, c) => {
      const { companyId } = getRouteContext(c);
      const members = await getMembers(companyId);
      return {
        members: members.map((member) => ({
          userId: member.user_id,
          name: memberDisplayName(member.name),
        })),
      };
    },
  },
  {
    name: "list_tags",
    description:
      "List workspace tags. Check this before create_tag to avoid near-duplicate tags.",
    scope: "read",
    inputSchema: {
      search: z.string().optional(),
    },
    handler: async (args: { search?: string }, c) => {
      const { tenantDb } = getRouteContext(c);
      const tags = await tenantDb
        .selectFrom("tags")
        .select(["id", "name", "color"])
        .$if(Boolean(args.search), (qb) =>
          qb.where("name", "ilike", `%${args.search}%`),
        )
        .orderBy("name", "asc")
        .limit(200)
        .execute();
      return { tags };
    },
  },
  {
    name: "list_broadcasts",
    description:
      "List bulk broadcast jobs with status and delivery progress, newest first.",
    scope: "read",
    permission: "can_send_bulk_messages",
    inputSchema: {
      limit: limitField,
      offset: offsetField,
    },
    handler: async (args: { limit?: number; offset?: number }, c) => {
      const { tenantDb } = getRouteContext(c);
      const limit = clampLimit(args.limit);
      const rows = await tenantDb
        .selectFrom("bulk_jobs")
        .selectAll()
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(args.offset ?? 0)
        .execute();
      const progressMap = await getBulkJobProgressMap(
        tenantDb,
        rows.map((row) => row.id),
      );
      return {
        broadcasts: rows.map((row) => {
          const job = formatBulkJob(
            row,
            progressMap.get(row.id) ?? {
              total: 0,
              pending: 0,
              processing: 0,
              sent: 0,
              failed: 0,
              canceled: 0,
              skipped: 0,
            },
          );
          return {
            id: job.id,
            name: job.name,
            status: job.status,
            scheduledAt: job.scheduledAt,
            totalRecipients: job.totalRecipients,
            progress: job.progress,
          };
        }),
        hasMore: rows.length === limit,
      };
    },
  },
  {
    name: "get_broadcast_status",
    description: "Get one broadcast job's full status and delivery progress.",
    scope: "read",
    permission: "can_send_bulk_messages",
    inputSchema: {
      broadcastId: z.string().uuid(),
    },
    handler: async (args: { broadcastId: string }, c) => {
      const { tenantDb } = getRouteContext(c);
      const row = await tenantDb
        .selectFrom("bulk_jobs")
        .selectAll()
        .where("id", "=", args.broadcastId)
        .executeTakeFirst();
      if (!row) {
        throw new McpToolError("Broadcast not found");
      }
      const progress = await getBulkJobProgress(tenantDb, row.id);
      const job = formatBulkJob(row, progress);
      return {
        id: job.id,
        name: job.name,
        status: job.status,
        content: truncateText(job.content).text,
        messageType: job.messageType,
        scheduledAt: job.scheduledAt,
        totalRecipients: job.totalRecipients,
        progress: job.progress,
        canceledAt: job.canceledAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
      };
    },
  },
] as McpToolDefinition[];
