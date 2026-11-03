import type { ContactEvent } from "../../lib/nats/types/index.js";

// Called only after the existing connection fence and contact lookup. Avoid
// writes/fan-out for a redundant name-cache replay, not full contact snapshots
// or explicit metadata changes. The outer history handler still records its
// application receipt before acknowledging the broker event.
export function isUnchangedNameOnlyContact(
  payload: ContactEvent["payload"],
  storedName: string | null,
  syncedName: string | null,
  shouldClearRedactedName: boolean,
): boolean {
  return (
    payload.nameOnly === true &&
    !shouldClearRedactedName &&
    payload.username === undefined &&
    payload.isGroup === undefined &&
    payload.profilePictureUrl === undefined &&
    (syncedName === null || syncedName === storedName)
  );
}
