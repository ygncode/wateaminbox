/**
 * Contact utilities for display name resolution
 */

export interface ContactNameFields {
  custom_name?: string | null;
  customName?: string | null;
  push_name?: string | null;
  pushName?: string | null;
  phone_number?: string | null;
  phoneNumber?: string | null;
  jid?: string | null;
  name?: string | null;
}

/**
 * Get the display name for a contact using the standard fallback chain:
 * custom_name -> push_name -> phone_number -> phone from JID -> fallback
 *
 * @param contact - Contact object with name fields (supports both snake_case and camelCase)
 * @param fallback - Fallback value if no name is available (default: "Unknown")
 * @returns The best available display name
 */
export function getContactDisplayName(
  contact: ContactNameFields,
  fallback: string = "Unknown",
): string {
  // Support both snake_case (backend) and camelCase (frontend) field names
  const customName = contact.custom_name ?? contact.customName;
  const pushName = contact.push_name ?? contact.pushName;
  const phoneNumber = contact.phone_number ?? contact.phoneNumber;
  const phoneFromJid = contact.jid?.split("@")[0] ?? null;

  return (
    customName ||
    pushName ||
    phoneNumber ||
    phoneFromJid ||
    contact.name ||
    fallback
  );
}

/**
 * Get the name for a contact (without "Unknown" fallback)
 * Returns null if no name is available
 *
 * @param contact - Contact object with name fields
 * @returns The best available name or null
 */
export function getContactName(contact: ContactNameFields): string | null {
  const customName = contact.custom_name ?? contact.customName;
  const pushName = contact.push_name ?? contact.pushName;
  const phoneNumber = contact.phone_number ?? contact.phoneNumber;
  const phoneFromJid = contact.jid?.split("@")[0] ?? null;

  return (
    customName ||
    pushName ||
    phoneNumber ||
    phoneFromJid ||
    contact.name ||
    null
  );
}

/**
 * Get the display name for a group using the standard fallback chain:
 * custom_name -> group_name -> fallback
 *
 * @param group - Group object with name fields
 * @param fallback - Fallback value if no name is available (default: "Unknown Group")
 * @returns The best available display name
 */
export function getGroupDisplayName(
  group: {
    custom_name?: string | null;
    customName?: string | null;
    group_name?: string | null;
    groupName?: string | null;
    name?: string | null;
  },
  fallback: string = "Unknown Group",
): string {
  const customName = group.custom_name ?? group.customName;
  const groupName = group.group_name ?? group.groupName ?? group.name;

  return customName || groupName || fallback;
}
