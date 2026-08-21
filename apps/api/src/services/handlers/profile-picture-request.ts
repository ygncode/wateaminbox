interface ProfilePictureRequestInput {
  isGroupMessage: boolean;
  isHistorySync: boolean;
  fromMe: boolean;
  contactJid: string;
  contactProfilePictureUrl: string | null;
  senderJid: string | null;
}

/**
 * Select the WhatsApp identity whose missing profile picture should be fetched
 * after a message is stored. Direct history sync already fetches conversation
 * pictures in the worker, so only live direct messages use the fallback. Group
 * participants retain their existing on-demand behavior.
 */
export function getProfilePictureRequestJid({
  isGroupMessage,
  isHistorySync,
  fromMe,
  contactJid,
  contactProfilePictureUrl,
  senderJid,
}: ProfilePictureRequestInput): string | null {
  if (isGroupMessage) {
    return !fromMe && senderJid && !senderJid.includes("@g.us")
      ? senderJid
      : null;
  }

  if (!isHistorySync && !contactProfilePictureUrl) {
    return contactJid;
  }

  return null;
}
