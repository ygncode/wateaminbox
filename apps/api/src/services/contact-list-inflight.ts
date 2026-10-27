import type {
  ContactWithLastMessage,
  GetContactsWithLastMessageOptions,
} from "./contact.service.js";

type ContactListResult = {
  contacts: ContactWithLastMessage[];
  total: number;
};

// A browser abort does not cancel the server's database query. Share duplicate
// pending reads so a realtime refetch burst cannot occupy the whole tenant pool.
// Handles (including transactions) must never share work with one another.
const pendingByDatabase = new WeakMap<
  object,
  Map<string, Promise<ContactListResult>>
>();

export function coalesceContactListRead(
  database: object,
  companyId: string,
  options: GetContactsWithLastMessageOptions,
  load: () => Promise<ContactListResult>,
): Promise<ContactListResult> {
  // Assignment-restricted readers must re-evaluate live row visibility. Even
  // a pending read may have selected rows before an assignment was revoked.
  if (options.restrictToAssigned) return load();

  // Include ALL options, especially userId and restrictToAssigned. Sorting
  // property names makes caller insertion order irrelevant without discarding
  // new options when filters are added. Never key this by just the tenant.
  const key = JSON.stringify([
    companyId,
    Object.entries(options).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
  let pending = pendingByDatabase.get(database);
  if (!pending) {
    pending = new Map();
    pendingByDatabase.set(database, pending);
  }
  const existing = pending.get(key);
  if (existing) return existing;

  const result = load().finally(() => {
    pending.delete(key);
  });
  pending.set(key, result);
  return result;
}
