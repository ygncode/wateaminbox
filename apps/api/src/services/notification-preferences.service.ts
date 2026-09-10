import { normalizeJid } from "@wateaminbox/shared";
import { AppError } from "../lib/errors.js";
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
  notificationsEnabled: boolean;
  timezone: string | null;
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
  notificationsEnabled?: boolean;
  timezone?: string | null;
  soundEnabled?: boolean;
  soundChoice?: SoundChoice;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  mutedContacts?: string[];
}

/**
 * Default notification preferences
 */
export const DEFAULT_PREFERENCES: Omit<
  NotificationPreferences,
  "id" | "userId" | "createdAt" | "updatedAt"
> = {
  notificationsEnabled: true,
  timezone: null,
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
  notifications_enabled: boolean;
  timezone: string | null;
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
    notificationsEnabled: row.notifications_enabled,
    timezone: row.timezone,
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
      notifications_enabled: DEFAULT_PREFERENCES.notificationsEnabled,
      timezone: DEFAULT_PREFERENCES.timezone,
      sound_enabled: DEFAULT_PREFERENCES.soundEnabled,
      sound_choice: DEFAULT_PREFERENCES.soundChoice,
      quiet_hours_start: DEFAULT_PREFERENCES.quietHoursStart,
      quiet_hours_end: DEFAULT_PREFERENCES.quietHoursEnd,
      muted_contacts: DEFAULT_PREFERENCES.mutedContacts,
    })
    .onConflict((oc) => oc.column("user_id").doNothing())
    .returningAll()
    .executeTakeFirst();

  if (!created) {
    const existing = await tenantDb
      .selectFrom("notification_preferences")
      .selectAll()
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();
    return mapRowToPreferences(existing);
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

  const updateData = buildPreferenceUpdateData(input);

  const updated = await tenantDb
    .updateTable("notification_preferences")
    .set(updateData)
    .where("user_id", "=", userId)
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    throw new AppError("Failed to update notification preferences", 500);
  }

  return mapRowToPreferences(updated);
}

export function buildPreferenceUpdateData(
  input: UpdateNotificationPreferencesInput,
  updatedAt: Date = new Date(),
): Record<string, unknown> {
  const updateData: Record<string, unknown> = { updated_at: updatedAt };
  if (input.notificationsEnabled !== undefined)
    updateData.notifications_enabled = input.notificationsEnabled;
  if (input.timezone !== undefined) updateData.timezone = input.timezone;
  if (input.soundEnabled !== undefined)
    updateData.sound_enabled = input.soundEnabled;
  if (input.soundChoice !== undefined)
    updateData.sound_choice = input.soundChoice;
  if (input.quietHoursStart !== undefined)
    updateData.quiet_hours_start = input.quietHoursStart;
  if (input.quietHoursEnd !== undefined)
    updateData.quiet_hours_end = input.quietHoursEnd;
  if (input.mutedContacts !== undefined) {
    updateData.muted_contacts = [
      ...new Set(input.mutedContacts.map(normalizeMuteToken)),
    ];
  }
  return updateData;
}

/**
 * Mutes a contact for a user
 */
export async function muteContact(
  companyId: string,
  userId: string,
  token: string,
): Promise<NotificationPreferences> {
  const normalized = normalizeMuteToken(token);
  const preferences = await getNotificationPreferences(companyId, userId);

  if (preferences.mutedContacts.includes(normalized)) {
    return preferences;
  }

  return updateNotificationPreferences(companyId, userId, {
    mutedContacts: [...preferences.mutedContacts, normalized],
  });
}

/**
 * Unmutes a contact for a user
 */
export async function unmuteContact(
  companyId: string,
  userId: string,
  token: string,
): Promise<NotificationPreferences> {
  const normalized = normalizeMuteToken(token);
  const preferences = await getNotificationPreferences(companyId, userId);

  if (!preferences.mutedContacts.includes(normalized)) {
    return preferences;
  }

  return updateNotificationPreferences(companyId, userId, {
    mutedContacts: preferences.mutedContacts.filter(
      (value) => value !== normalized,
    ),
  });
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMuteUuid(value: string): boolean {
  return uuidPattern.test(value);
}

export function normalizeMuteToken(token: string): string {
  const trimmed = token.trim();
  if (isMuteUuid(trimmed)) return trimmed.toLowerCase();
  return normalizeContactJid(trimmed);
}

export function normalizeContactJid(contactJid: string): string {
  const normalized = normalizeJid(contactJid.trim());
  if (!normalized) {
    throw new AppError("Invalid contact JID", 400);
  }
  return normalized;
}
