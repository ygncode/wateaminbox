import { extractPhoneFromJid, normalizeJid } from "@wateaminbox/shared";

/**
 * Contact rows for group members.
 *
 * A group member only ever had a `contacts` row when they also held a direct
 * conversation on the same connection: inbound group messages create a contact
 * for the GROUP jid and keep the author on the message row instead. In a
 * typical group that leaves exactly one member resolvable - whoever also DMs
 * this account - which is why member identities were almost never openable.
 *
 * Backfilling is deliberately narrow. Only a member addressed by phone JID gets
 * a row: WhatsApp also reports members as opaque `@lid` identities when it has
 * not disclosed their number, and inserting a contact keyed on a LID would
 * create the duplicate that collides the moment the same person appears under
 * their phone JID. The worker's own LID repair resolves those members to phone
 * JIDs, and the next sync picks them up here.
 */

export type ParticipantForBackfill = {
  jid: string;
  isAdmin?: boolean;
};

export type PlannedParticipantContact = {
  jid: string;
  phoneNumber: string | null;
  /** WhatsApp's name for this member, or null when none is known yet. */
  pushName: string | null;
};

/** A member WhatsApp addresses only by LID has no stable key to insert under. */
export function isPhoneAddressableJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net");
}

/**
 * The member contacts missing from one connection.
 *
 * Pure so the decision can be tested without a database - the caller performs
 * the insert. Returns at most one row per JID, never the connected account
 * itself, and never a member that already has a contact.
 */
export function planParticipantContactBackfill(options: {
  participants: readonly ParticipantForBackfill[];
  /** JIDs that already have a contact row on this connection. */
  existingContactJids: Iterable<string>;
  /** The connected account's own JID, excluded so no self-conversation appears. */
  connectionJid: string | null;
  /**
   * WhatsApp names keyed by normalised member JID, resolved on this connection
   * only. Missing entries simply leave the new contact unnamed.
   */
  namesByJid?: ReadonlyMap<string, string | null>;
}): PlannedParticipantContact[] {
  const existing = new Set<string>();
  for (const jid of options.existingContactJids) {
    const normalized = normalizeJid(jid);
    if (normalized) existing.add(normalized);
  }

  const ownJid = options.connectionJid
    ? normalizeJid(options.connectionJid)
    : null;

  const planned = new Map<string, PlannedParticipantContact>();
  for (const participant of options.participants) {
    const jid = normalizeJid(participant.jid);
    if (!jid) continue;
    // Groups are their own conversation and are created by the sync itself.
    if (!isPhoneAddressableJid(jid)) continue;
    if (ownJid && jid === ownJid) continue;
    if (existing.has(jid)) continue;
    if (planned.has(jid)) continue;

    planned.set(jid, {
      jid,
      phoneNumber: extractPhoneFromJid(jid),
      pushName: resolveMemberPushName(options.namesByJid?.get(jid), jid),
    });
  }

  return [...planned.values()];
}

/**
 * The name to store on a member contact, or null to leave it unnamed.
 *
 * The group panel resolves a member's name from WhatsApp's address book and
 * from the names carried on their messages, but the contact profile can only
 * read `contacts`. Without a stored `push_name` the panel says "Alice" and the
 * profile it opens says "+6591111111" - the same person under two identities.
 *
 * A candidate that merely repeats the member's own number or opaque identity is
 * rejected: `getContactDisplayName` falls through to the phone number anyway,
 * and storing it would look like a real name that later WhatsApp data must not
 * overwrite.
 */
export function resolveMemberPushName(
  candidate: string | null | undefined,
  jid: string,
): string | null {
  const name = candidate?.trim();
  if (!name) return null;

  const localPart = jid.split("@")[0]?.split(":")[0] ?? "";
  if (name === jid || name === localPart) return null;

  // "+65 9123 4567" for member 6591234567 carries nothing the phone column does
  // not already carry. Judged on what is left after the digits and the
  // punctuation a written phone number uses: a name like "Alice 6591234567"
  // still says something the number alone does not, so it is kept.
  const withoutPhoneShape = name.replace(/[\d\s+().-]/g, "");
  const nameDigits = name.replace(/\D/g, "");
  const localDigits = localPart.replace(/\D/g, "");
  if (
    withoutPhoneShape === "" &&
    localDigits.length > 0 &&
    nameDigits === localDigits
  ) {
    return null;
  }

  return name;
}

/**
 * Whether a member contact that already exists should be given a name.
 *
 * Only ever fills a blank. A hand-chosen `custom_name` outranks `push_name` in
 * every display path, so naming is never a rename - but a member already
 * carrying a WhatsApp name is left alone too, so a stale address-book entry
 * cannot walk back over a fresher one.
 */
export function shouldNameExistingMember(existing: {
  push_name: string | null;
}): boolean {
  return !existing.push_name?.trim();
}

/**
 * Split a backfill into statement-sized batches.
 *
 * A WhatsApp group holds up to 1024 members, and the first sync after this
 * change plans every missing one at once. Batching keeps a single INSERT off
 * the parameter limit and keeps the transaction's locks short.
 */
export function batchPlannedContacts<T>(
  planned: readonly T[],
  batchSize = 200,
): T[][] {
  if (batchSize < 1) throw new Error("batchSize must be at least 1");
  const batches: T[][] = [];
  for (let index = 0; index < planned.length; index += batchSize) {
    batches.push(planned.slice(index, index + batchSize));
  }
  return batches;
}
