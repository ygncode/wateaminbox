/**
 * Whether the Resolve action should be disabled right now.
 *
 * Root cause of a production report: "resolving 'handled' rejects even
 * though the agent sent a proper reply". `useSendMessage`'s optimistic UI
 * (see useCoreMessageMutations.ts's `onMutate`) shows the reply bubble in
 * the thread INSTANTLY, well before the real `POST /api/messages` request
 * has round-tripped and its transaction has committed. An agent can
 * therefore visually see their reply, open the Resolve dialog, and confirm
 * 'handled' before the reply is actually durable - the backend then
 * correctly (from its own point of view) sees no reply yet and rejects
 * (see conversation-case.service.ts's `hasUnansweredLatestTurn`). The two
 * requests are safely serialized server-side (see the shared contact-row
 * lock both `requireSendAccess` and `resolveActiveCase` take - never
 * corruption), but whichever one's transaction acquires that lock first
 * wins, and that ordering is a pure network/timing race the UI must not
 * expose to the user as an available action.
 *
 * Disabling Resolve for the SAME window the composer input is already
 * disabled (`isSending` - a send for THIS contact is in flight) closes the
 * window entirely: the agent cannot even attempt to resolve until their own
 * send has settled.
 */
export function isResolveActionDisabled(params: {
  isSending: boolean;
  resolveMutationPending: boolean;
}): boolean {
  return params.isSending || params.resolveMutationPending;
}
