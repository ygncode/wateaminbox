import { getTenantConnection } from "./tenant.service.js";

/**
 * Sound choice options
 */
export type SoundChoice = "default" | "chime" | "bell" | "pop" | "none";

/**
 * Notification preferences interface
 */
export interface NotificationPreferences {
  id: string;
  userId: string;
  soundEnabled: boolean;
  soundChoice: SoundChoice;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  mutedContacts: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for updating notification preferences
 */
export interface UpdateNotificationPreferencesInput {
  soundEnabled?: boolean;
  soundChoice?: SoundChoice;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  mutedContacts?: string[];
}

/**
 * Default notification preferences
 */
const DEFAULT_PREFERENCES: Omit<
  NotificationPreferences,
  "id" | "userId" | "createdAt" | "updatedAt"
> = {
  soundEnabled: true,
  soundChoice: "default",
  quietHoursStart: null,
  quietHoursEnd: null,
  mutedContacts: [],
};

/**
 * Maps database row to NotificationPreferences interface
 */
function mapRowToPreferences(row: {
  id: string;
  user_id: string;
  sound_enabled: boolean;
  sound_choice: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  muted_contacts: string[] | null;
  created_at: Date;
  updated_at: Date;
}): NotificationPreferences {
  return {
    id: row.id,
    userId: row.user_id,
    soundEnabled: row.sound_enabled,
    soundChoice: row.sound_choice as SoundChoice,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    mutedContacts: row.muted_contacts || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Gets notification preferences for a user, creating defaults if not exists
 */
export async function getNotificationPreferences(
  companyId: string,
  userId: string,
): Promise<NotificationPreferences> {
  const tenantDb = getTenantConnection(companyId);

  // Try to get existing preferences
  const existing = await tenantDb
    .selectFrom("notification_preferences")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (existing) {
    return mapRowToPreferences(existing);
  }

  // Create default preferences if not exists
  const created = await tenantDb
    .insertInto("notification_preferences")
    .values({
      user_id: userId,
      sound_enabled: DEFAULT_PREFERENCES.soundEnabled,
      sound_choice: DEFAULT_PREFERENCES.soundChoice,
      quiet_hours_start: DEFAULT_PREFERENCES.quietHoursStart,
      quiet_hours_end: DEFAULT_PREFERENCES.quietHoursEnd,
      muted_contacts: DEFAULT_PREFERENCES.mutedContacts,
    })
    .returningAll()
    .executeTakeFirst();

  if (!created) {
    throw new Error("Failed to create default notification preferences");
  }

  return mapRowToPreferences(created);
}

/**
 * Updates notification preferences for a user
 */
export async function updateNotificationPreferences(
  companyId: string,
  userId: string,
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferences> {
  const tenantDb = getTenantConnection(companyId);

  // Ensure preferences exist first
  await getNotificationPreferences(companyId, userId);

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {
    updated_at: new Date(),
  };

  if (input.soundEnabled !== undefined) {
    updateData.sound_enabled = input.soundEnabled;
  }

  if (input.soundChoice !== undefined) {
    updateData.sound_choice = input.soundChoice;
  }

  if (input.quietHoursStart !== undefined) {
    updateData.quiet_hours_start = input.quietHoursStart;
  }

  if (input.quietHoursEnd !== undefined) {
    updateData.quiet_hours_end = input.quietHoursEnd;
  }

  if (input.mutedContacts !== undefined) {
    updateData.muted_contacts = input.mutedContacts;
  }

  const updated = await tenantDb
    .updateTable("notification_preferences")
    .set(updateData)
    .where("user_id", "=", userId)
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    throw new Error("Failed to update notification preferences");
  }

  return mapRowToPreferences(updated);
}

/**
 * Mutes a contact for a user
 */
export async function muteContact(
  companyId: string,
  userId: string,
  contactJid: string,
): Promise<NotificationPreferences> {
  const preferences = await getNotificationPreferences(companyId, userId);

  if (preferences.mutedContacts.includes(contactJid)) {
    return preferences;
  }

  return updateNotificationPreferences(companyId, userId, {
    mutedContacts: [...preferences.mutedContacts, contactJid],
  });
}

/**
 * Unmutes a contact for a user
 */
export async function unmuteContact(
  companyId: string,
  userId: string,
  contactJid: string,
): Promise<NotificationPreferences> {
  const preferences = await getNotificationPreferences(companyId, userId);

  if (!preferences.mutedContacts.includes(contactJid)) {
    return preferences;
  }

  return updateNotificationPreferences(companyId, userId, {
    mutedContacts: preferences.mutedContacts.filter(
      (jid) => jid !== contactJid,
    ),
  });
}
