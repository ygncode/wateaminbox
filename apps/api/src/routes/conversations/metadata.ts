import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { forbidden, notFound } from "../../lib/errors.js";
import { successData } from "../../lib/response.js";
import { getRouteContext } from "../../middleware/context.js";
import { getChannelSpineWorkspaceAuthority } from "../../services/channel-spine-authority.service.js";
import { resolveWorkflowIdentity } from "../../services/channel-workflow.service.js";
import { getUserNames } from "../../services/user.service.js";

const noteSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  visibility: z.enum(["shared", "private"]).default("shared"),
});
const tagSchema = z.object({ tagId: z.string().uuid() });

export const metadataRoutes = new Hono();

async function requireConversationId(c: Context): Promise<string | null> {
  const { tenantDb, companyId } = getRouteContext(c);
  if (
    !(await getChannelSpineWorkspaceAuthority(companyId)).neutralReadsEnabled
  ) {
    return null;
  }
  const identity = await resolveWorkflowIdentity(tenantDb, c.req.param("id")!);
  return identity?.conversationId ?? null;
}

metadataRoutes.get("/:id/notes", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const conversationId = await requireConversationId(c);
  if (!conversationId) return notFound(c, "Conversation notes");
  const notes = await tenantDb
    .selectFrom("conversation_notes")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .where((eb) =>
      eb.or([
        eb("visibility", "=", "shared"),
        eb("author_user_id", "=", user.id),
      ]),
    )
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const names = await getUserNames(
    notes.map(({ author_user_id }) => author_user_id),
  );
  return successData(
    c,
    notes.map((note) => ({
      id: note.id,
      conversationId: note.conversation_id,
      authorUserId: note.author_user_id,
      authorName: names.get(note.author_user_id) ?? null,
      visibility: note.visibility,
      content: note.content,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    })),
  );
});

metadataRoutes.post("/:id/notes", zValidator("json", noteSchema), async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const conversationId = await requireConversationId(c);
  if (!conversationId) return notFound(c, "Conversation notes");
  const body = c.req.valid("json");
  const note = await tenantDb
    .insertInto("conversation_notes")
    .values({
      conversation_id: conversationId,
      author_user_id: user.id,
      visibility: body.visibility,
      content: body.content,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return successData(c, note, 201);
});

metadataRoutes.patch(
  "/:id/notes/:noteId",
  zValidator("json", noteSchema.pick({ content: true })),
  async (c) => {
    const { tenantDb, user } = getRouteContext(c);
    const conversationId = await requireConversationId(c);
    if (!conversationId) return notFound(c, "Conversation notes");
    const note = await tenantDb
      .selectFrom("conversation_notes")
      .select("author_user_id")
      .where("id", "=", c.req.param("noteId"))
      .where("conversation_id", "=", conversationId)
      .executeTakeFirst();
    if (!note) return notFound(c, "Note");
    if (note.author_user_id !== user.id) return forbidden(c);
    const updated = await tenantDb
      .updateTable("conversation_notes")
      .set({ content: c.req.valid("json").content, updated_at: new Date() })
      .where("id", "=", c.req.param("noteId"))
      .returningAll()
      .executeTakeFirstOrThrow();
    return successData(c, updated);
  },
);

metadataRoutes.delete("/:id/notes/:noteId", async (c) => {
  const { tenantDb, user } = getRouteContext(c);
  const conversationId = await requireConversationId(c);
  if (!conversationId) return notFound(c, "Conversation notes");
  const note = await tenantDb
    .selectFrom("conversation_notes")
    .select("author_user_id")
    .where("id", "=", c.req.param("noteId"))
    .where("conversation_id", "=", conversationId)
    .executeTakeFirst();
  if (!note) return notFound(c, "Note");
  if (note.author_user_id !== user.id) return forbidden(c);
  await tenantDb
    .deleteFrom("conversation_notes")
    .where("id", "=", c.req.param("noteId"))
    .execute();
  return c.json({ success: true });
});

metadataRoutes.get("/:id/tags", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const conversationId = await requireConversationId(c);
  if (!conversationId) return notFound(c, "Conversation tags");
  const tags = await tenantDb
    .selectFrom("conversation_tags as link")
    .innerJoin("tags as tag", "tag.id", "link.tag_id")
    .select(["tag.id", "tag.name", "tag.color"])
    .where("link.conversation_id", "=", conversationId)
    .orderBy("tag.name")
    .execute();
  return successData(c, tags);
});

metadataRoutes.post("/:id/tags", zValidator("json", tagSchema), async (c) => {
  const { tenantDb } = getRouteContext(c);
  const conversationId = await requireConversationId(c);
  if (!conversationId) return notFound(c, "Conversation tags");
  const { tagId } = c.req.valid("json");
  const tag = await tenantDb
    .selectFrom("tags")
    .select("id")
    .where("id", "=", tagId)
    .executeTakeFirst();
  if (!tag) return notFound(c, "Tag");
  await tenantDb
    .insertInto("conversation_tags")
    .values({ conversation_id: conversationId, tag_id: tagId })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return c.json({ success: true }, 201);
});

metadataRoutes.delete("/:id/tags/:tagId", async (c) => {
  const { tenantDb } = getRouteContext(c);
  const conversationId = await requireConversationId(c);
  if (!conversationId) return notFound(c, "Conversation tags");
  await tenantDb
    .deleteFrom("conversation_tags")
    .where("conversation_id", "=", conversationId)
    .where("tag_id", "=", c.req.param("tagId"))
    .execute();
  return c.json({ success: true });
});
