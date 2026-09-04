export const MAX_MEDIA_GALLERY_ITEMS = 30;

export interface PendingAttachment {
  file: File;
  type: "image" | "document";
}

function fileIdentity(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join(":");
}

export function appendGalleryFiles(
  current: PendingAttachment[],
  selected: Iterable<File>,
): { attachments: PendingAttachment[]; omitted: number } {
  const attachments = [...current];
  const identities = new Set(
    current.map((attachment) => fileIdentity(attachment.file)),
  );
  let omitted = 0;

  for (const file of selected) {
    const identity = fileIdentity(file);
    if (identities.has(identity)) continue;
    if (attachments.length >= MAX_MEDIA_GALLERY_ITEMS) {
      omitted += 1;
      continue;
    }
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      omitted += 1;
      continue;
    }
    identities.add(identity);
    attachments.push({ file, type: "image" });
  }

  return { attachments, omitted };
}

export function createWhatsAppAlbumId(
  bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(9)),
): string {
  if (bytes.length !== 9) throw new Error("Album IDs require 9 random bytes");
  return `3EB0${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}
