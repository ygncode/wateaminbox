/** A temporary stanza or an uncertain send cannot identify a WhatsApp quote. */
export function isConfirmedQuote(message: {
  message_id: string | null;
  from_me: boolean;
  status: string | null;
}): boolean {
  return Boolean(
    message.message_id &&
      !message.message_id.startsWith("pending_") &&
      (!message.from_me ||
        ["sent", "delivered", "read"].includes(message.status ?? "")),
  );
}
