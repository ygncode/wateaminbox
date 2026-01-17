import type { Kysely } from "kysely";
import type { TenantDatabase } from "@wateaminbox/database";
import { syncEntities } from "../lib/sync-helper.js";

// WhatsApp Business label colors mapping (predefined_id to color)
export const WHATSAPP_LABEL_COLORS: Record<
  number,
  { name: string; hex: string }
> = {
  0: { name: "Light Green", hex: "#00a884" },
  1: { name: "Orange", hex: "#ffa500" },
  2: { name: "Light Yellow", hex: "#fed859" },
  3: { name: "Purple", hex: "#a855f7" },
  4: { name: "Blue", hex: "#3b82f6" },
  5: { name: "Pink", hex: "#ec4899" },
  6: { name: "Teal", hex: "#14b8a6" },
  7: { name: "Red", hex: "#ef4444" },
  8: { name: "Gray", hex: "#6b7280" },
  9: { name: "Light Blue", hex: "#38bdf8" },
  10: { name: "Dark Green", hex: "#22c55e" },
  11: { name: "Brown", hex: "#a16207" },
  12: { name: "Cyan", hex: "#06b6d4" },
  13: { name: "Magenta", hex: "#d946ef" },
  14: { name: "Lime", hex: "#84cc16" },
  15: { name: "Navy", hex: "#1e40af" },
  16: { name: "Rose", hex: "#f43f5e" },
  17: { name: "Amber", hex: "#f59e0b" },
  18: { name: "Indigo", hex: "#6366f1" },
  19: { name: "Slate", hex: "#475569" },
};

export interface WhatsAppLabel {
  labelId: string;
  name: string;
  color: string | null;
  predefinedId: number | null;
}

export interface SyncedLabel {
  id: string;
  labelId: string;
  name: string;
  color: string | null;
  predefinedId: number | null;
  syncedTagId: string | null;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LabelSyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

/**
 * Get all WhatsApp labels from the database with optional pagination
 */
export async function getWhatsAppLabels(
  tenantDb: Kysely<TenantDatabase>,
  pagination?: { limit: number; offset: number },
): Promise<SyncedLabel[]> {
  let query = tenantDb
    .selectFrom("whatsapp_labels")
    .selectAll()
    .orderBy("name", "asc");

  if (pagination) {
    query = query.limit(pagination.limit).offset(pagination.offset);
  }

  const labels = await query.execute();

  return labels.map((label) => ({
    id: label.id,
    labelId: label.label_id,
    name: label.name,
    color: label.color,
    predefinedId: label.predefined_id,
    syncedTagId: label.synced_tag_id,
    lastSyncedAt: label.last_synced_at,
    createdAt: label.created_at,
    updatedAt: label.updated_at,
  }));
}

/**
 * Get total count of WhatsApp labels
 */
export async function getWhatsAppLabelsCount(
  tenantDb: Kysely<TenantDatabase>,
): Promise<number> {
  const result = await tenantDb
    .selectFrom("whatsapp_labels")
    .select((eb) => eb.fn.countAll<string>().as("total"))
    .executeTakeFirst();

  return Number(result?.total || 0);
}

/**
 * Get a single WhatsApp label by label ID
 */
export async function getWhatsAppLabelByLabelId(
  tenantDb: Kysely<TenantDatabase>,
  labelId: string,
): Promise<SyncedLabel | null> {
  const label = await tenantDb
    .selectFrom("whatsapp_labels")
    .selectAll()
    .where("label_id", "=", labelId)
    .executeTakeFirst();

  if (!label) return null;

  return {
    id: label.id,
    labelId: label.label_id,
    name: label.name,
    color: label.color,
    predefinedId: label.predefined_id,
    syncedTagId: label.synced_tag_id,
    lastSyncedAt: label.last_synced_at,
    createdAt: label.created_at,
    updatedAt: label.updated_at,
  };
}

/**
 * Sync WhatsApp labels from Go service into the database
 * This processes labels fetched from WhatsApp Business API
 */
export async function syncLabelsFromWhatsApp(
  tenantDb: Kysely<TenantDatabase>,
  labels: WhatsAppLabel[],
): Promise<LabelSyncResult> {
  // Get existing labels
  const existingLabels = await tenantDb
    .selectFrom("whatsapp_labels")
    .select(["id", "label_id", "name", "color"])
    .execute();

  // Helper to resolve color from predefined ID
  const resolveColor = (label: WhatsAppLabel): string | null => {
    return (
      label.color ||
      (label.predefinedId !== null
        ? WHATSAPP_LABEL_COLORS[label.predefinedId]?.hex
        : null) ||
      null
    );
  };

  return syncEntities(
    {
      getId: (label) => label.labelId,
      getExistingId: (label) => label.label_id,
      insert: async (label) => {
        await tenantDb
          .insertInto("whatsapp_labels")
          .values({
            label_id: label.labelId,
            name: label.name,
            color: resolveColor(label),
            predefined_id: label.predefinedId,
            last_synced_at: new Date(),
          })
          .execute();
      },
      update: async (label) => {
        await tenantDb
          .updateTable("whatsapp_labels")
          .set({
            name: label.name,
            color: resolveColor(label),
            predefined_id: label.predefinedId,
            last_synced_at: new Date(),
            updated_at: new Date(),
          })
          .where("label_id", "=", label.labelId)
          .execute();
      },
      remove: async (label) => {
        // Clear whatsapp_label_id reference in tags before deleting
        await tenantDb
          .updateTable("tags")
          .set({ whatsapp_label_id: null, synced_at: null })
          .where("whatsapp_label_id", "=", label.label_id)
          .execute();

        await tenantDb
          .deleteFrom("whatsapp_labels")
          .where("label_id", "=", label.label_id)
          .execute();
      },
      // Only update if name or color actually changed
      isUnchanged: (incoming, existing) => {
        const color = resolveColor(incoming);
        return existing.name === incoming.name && existing.color === color;
      },
    },
    existingLabels,
    labels,
  );
}

/**
 * Link a custom tag to a WhatsApp label
 * This creates a bidirectional sync relationship
 */
export async function linkTagToLabel(
  tenantDb: Kysely<TenantDatabase>,
  tagId: string,
  labelId: string,
): Promise<{ success: boolean; error?: string }> {
  // Verify the label exists
  const label = await tenantDb
    .selectFrom("whatsapp_labels")
    .select(["id", "label_id", "synced_tag_id"])
    .where("label_id", "=", labelId)
    .executeTakeFirst();

  if (!label) {
    return { success: false, error: "WhatsApp label not found" };
  }

  // Verify the tag exists
  const tag = await tenantDb
    .selectFrom("tags")
    .select(["id", "whatsapp_label_id"])
    .where("id", "=", tagId)
    .executeTakeFirst();

  if (!tag) {
    return { success: false, error: "Tag not found" };
  }

  // Check if tag is already linked to another label
  if (tag.whatsapp_label_id && tag.whatsapp_label_id !== labelId) {
    return {
      success: false,
      error: "Tag is already linked to another WhatsApp label",
    };
  }

  // Check if label is already linked to another tag
  if (label.synced_tag_id && label.synced_tag_id !== tagId) {
    return {
      success: false,
      error: "WhatsApp label is already linked to another tag",
    };
  }

  // Create the bidirectional link
  await tenantDb
    .updateTable("tags")
    .set({
      whatsapp_label_id: labelId,
      synced_at: new Date(),
    })
    .where("id", "=", tagId)
    .execute();

  await tenantDb
    .updateTable("whatsapp_labels")
    .set({
      synced_tag_id: tagId,
      updated_at: new Date(),
    })
    .where("label_id", "=", labelId)
    .execute();

  return { success: true };
}

/**
 * Unlink a tag from its WhatsApp label
 */
export async function unlinkTagFromLabel(
  tenantDb: Kysely<TenantDatabase>,
  tagId: string,
): Promise<{ success: boolean; error?: string }> {
  const tag = await tenantDb
    .selectFrom("tags")
    .select(["id", "whatsapp_label_id"])
    .where("id", "=", tagId)
    .executeTakeFirst();

  if (!tag) {
    return { success: false, error: "Tag not found" };
  }

  if (!tag.whatsapp_label_id) {
    return { success: false, error: "Tag is not linked to any WhatsApp label" };
  }

  // Remove the bidirectional link
  await tenantDb
    .updateTable("whatsapp_labels")
    .set({
      synced_tag_id: null,
      updated_at: new Date(),
    })
    .where("label_id", "=", tag.whatsapp_label_id)
    .execute();

  await tenantDb
    .updateTable("tags")
    .set({
      whatsapp_label_id: null,
      synced_at: null,
    })
    .where("id", "=", tagId)
    .execute();

  return { success: true };
}

/**
 * Get tags with their WhatsApp label sync status
 */
export async function getTagsWithLabelStatus(
  tenantDb: Kysely<TenantDatabase>,
): Promise<
  Array<{
    id: string;
    name: string;
    color: string | null;
    createdBy: string | null;
    createdAt: Date;
    whatsappLabelId: string | null;
    syncedAt: Date | null;
    linkedLabel: { labelId: string; name: string; color: string | null } | null;
  }>
> {
  const tags = await tenantDb
    .selectFrom("tags")
    .leftJoin(
      "whatsapp_labels",
      "tags.whatsapp_label_id",
      "whatsapp_labels.label_id",
    )
    .select([
      "tags.id",
      "tags.name",
      "tags.color",
      "tags.created_by",
      "tags.created_at",
      "tags.whatsapp_label_id",
      "tags.synced_at",
      "whatsapp_labels.label_id as wa_label_id",
      "whatsapp_labels.name as wa_label_name",
      "whatsapp_labels.color as wa_label_color",
    ])
    .orderBy("tags.name", "asc")
    .execute();

  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    createdBy: tag.created_by,
    createdAt: tag.created_at,
    whatsappLabelId: tag.whatsapp_label_id,
    syncedAt: tag.synced_at,
    linkedLabel: tag.wa_label_id
      ? {
          labelId: tag.wa_label_id,
          name: tag.wa_label_name!,
          color: tag.wa_label_color,
        }
      : null,
  }));
}

/**
 * Auto-create tags from WhatsApp labels that are not yet linked
 * Useful for initial sync where user wants all labels as tags
 */
export async function autoCreateTagsFromLabels(
  tenantDb: Kysely<TenantDatabase>,
  userId: string,
): Promise<{ created: number; linked: number }> {
  // Get unlinked WhatsApp labels
  const unlinkedLabels = await tenantDb
    .selectFrom("whatsapp_labels")
    .selectAll()
    .where("synced_tag_id", "is", null)
    .execute();

  let created = 0;
  let linked = 0;

  for (const label of unlinkedLabels) {
    // Check if a tag with the same name already exists
    const existingTag = await tenantDb
      .selectFrom("tags")
      .select(["id", "whatsapp_label_id"])
      .where("name", "ilike", label.name)
      .executeTakeFirst();

    if (existingTag) {
      // Link existing tag if not already linked
      if (!existingTag.whatsapp_label_id) {
        await linkTagToLabel(tenantDb, existingTag.id, label.label_id);
        linked++;
      }
    } else {
      // Create new tag with WhatsApp label link
      const newTag = await tenantDb
        .insertInto("tags")
        .values({
          name: label.name,
          color: label.color,
          whatsapp_label_id: label.label_id,
          synced_at: new Date(),
          created_by: userId,
        })
        .returning(["id"])
        .executeTakeFirst();

      if (newTag) {
        // Update label with synced_tag_id
        await tenantDb
          .updateTable("whatsapp_labels")
          .set({
            synced_tag_id: newTag.id,
            updated_at: new Date(),
          })
          .where("label_id", "=", label.label_id)
          .execute();

        created++;
      }
    }
  }

  return { created, linked };
}

/**
 * Get sync status summary
 */
export async function getLabelSyncStatus(
  tenantDb: Kysely<TenantDatabase>,
): Promise<{
  totalLabels: number;
  linkedLabels: number;
  unlinkedLabels: number;
  totalTags: number;
  linkedTags: number;
  lastSyncAt: Date | null;
}> {
  const [
    labelsResult,
    linkedLabelsResult,
    tagsResult,
    linkedTagsResult,
    lastSyncResult,
  ] = await Promise.all([
    tenantDb
      .selectFrom("whatsapp_labels")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirst(),
    tenantDb
      .selectFrom("whatsapp_labels")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("synced_tag_id", "is not", null)
      .executeTakeFirst(),
    tenantDb
      .selectFrom("tags")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirst(),
    tenantDb
      .selectFrom("tags")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("whatsapp_label_id", "is not", null)
      .executeTakeFirst(),
    tenantDb
      .selectFrom("whatsapp_labels")
      .select(["last_synced_at"])
      .orderBy("last_synced_at", "desc")
      .executeTakeFirst(),
  ]);

  const totalLabels = Number(labelsResult?.count ?? 0);
  const linkedLabels = Number(linkedLabelsResult?.count ?? 0);
  const totalTags = Number(tagsResult?.count ?? 0);
  const linkedTags = Number(linkedTagsResult?.count ?? 0);

  return {
    totalLabels,
    linkedLabels,
    unlinkedLabels: totalLabels - linkedLabels,
    totalTags,
    linkedTags,
    lastSyncAt: lastSyncResult?.last_synced_at ?? null,
  };
}
