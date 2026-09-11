/**
 * Inbox search predicate for the chat sidebar.
 *
 * The sidebar search narrows two different lists at once. Contacts are already
 * filtered by the API (`push_name`, `username`, `custom_name`, `phone_number`),
 * while the channel conversations merged into the same list are never queried
 * with the search term and have to be matched locally.
 *
 * Testing the display name alone looked equivalent while every displayed name
 * was the phone number. The display-name chain puts the WhatsApp push name
 * above the phone number, so a contact whose push name was "Software" was
 * returned by the API for "917981075978" and then dropped right here - the
 * inbox said "No results for 917981075978" while Add Contact answered
 * "already exists" for the same number.
 *
 * Keep this aligned with the fields the contacts API searches, or the client
 * will keep discarding rows the server deliberately matched.
 */

import type { Chat } from "../../types/chat";

/**
 * Digits-only projection, so a formatted search ("+91 79810 75978") can still
 * match the bare digits the API stores and matches on.
 */
function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Whether an inbox row matches the sidebar search box.
 *
 * @param chat - Merged inbox row.
 * @param query - Raw search box value.
 * @returns True when the row should stay visible.
 */
export function chatMatchesSearch(chat: Chat, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const { contact } = chat;
  const named = [contact.name, contact.customName];
  if (named.some((value) => value?.toLowerCase().includes(needle))) {
    return true;
  }
  // The API strips a leading @ before matching usernames ("@acme_billing"
  // looks up "acme_billing"), so the same query has to match here.
  const usernameNeedle = needle.replace(/^@+/, "");
  if (
    usernameNeedle &&
    contact.username?.toLowerCase().includes(usernameNeedle)
  ) {
    return true;
  }

  // A bare name search has no digits to compare, and an empty needle would
  // match every phone number.
  const needleDigits = digitsOnly(needle);
  if (!needleDigits) return false;

  return [contact.phoneNumber, contact.jid].some(
    (value) => value !== undefined && digitsOnly(value).includes(needleDigits),
  );
}
