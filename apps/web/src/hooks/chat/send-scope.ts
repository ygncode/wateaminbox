/**
 * Whether an in-flight send mutation belongs to the CURRENTLY selected
 * contact. `useSendMessage` is a single mutation instance shared across
 * every chat ChatPage ever selects (it doesn't remount on chat switch), so
 * `mutation.isPending` alone reflects ANY in-flight send, not necessarily
 * one for the contact on screen right now - an agent sending in chat A,
 * then switching to chat B before A's send settles, must not see chat B's
 * composer/Resolve action disabled for a send that isn't even for this
 * contact.
 */
export function isSendPendingForContact(params: {
  isPending: boolean;
  pendingContactId: string | null | undefined;
  selectedChatId: string | null | undefined;
}): boolean {
  return Boolean(
    params.isPending &&
      params.selectedChatId &&
      params.pendingContactId === params.selectedChatId,
  );
}
