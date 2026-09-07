export function getPushMessagePreview(
  messageType: string | undefined,
  content: string | null | undefined,
): string {
  switch (messageType) {
    case "image":
      return "Sent an image";
    case "video":
      return "Sent a video";
    case "audio":
      return "Sent an audio message";
    case "document":
      return "Sent a document";
    case "location":
      return "Shared a location";
    default:
      return content?.slice(0, 100) || "New message";
  }
}
