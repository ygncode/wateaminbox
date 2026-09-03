/**
 * Rules for turning a clipboard paste into a composer attachment.
 *
 * Kept free of React so the "is this paste an attachment or just text" decision
 * stays unit-testable: it runs on every paste into the composer, and getting it
 * wrong either swallows an ordinary text paste or silently drops a screenshot.
 */

/** Minimal shape of the parts of `DataTransfer` this decision needs. */
export interface PastedClipboard {
  types: readonly string[];
  /** `ArrayLike` so a real `FileList` satisfies it as-is. */
  files: ArrayLike<File>;
  getData(format: string): string;
}

export interface PastedAttachment {
  file: File;
  type: "image" | "document";
}

/** Clipboard entries with a generic name get a stable, unique one instead. */
const GENERIC_NAMES = new Set(["", "image.png", "image.jpeg", "image.jpg"]);

function extensionFor(file: File): string {
  const name = file.name ?? "";
  const fromName = name.split(".").pop();
  if (fromName && fromName !== name) return fromName.toLowerCase();
  const fromType = file.type.split("/").pop();
  return fromType ? fromType.split("+")[0] : "bin";
}

/**
 * Screenshots arrive from the OS as `image.png` every single time, so a chat
 * with several of them would show an identical filename on each - and every
 * upload would collide on the same storage key. Anything the user actually
 * named is left alone.
 */
export function nameForPastedFile(file: File, now: number): string {
  const name = file.name ?? "";
  if (!GENERIC_NAMES.has(name.toLowerCase())) return name;
  return `pasted-${now}.${extensionFor(file)}`;
}

/**
 * Picks the attachment a paste should produce, or `null` to let the browser
 * handle it as an ordinary text paste.
 *
 * Text wins whenever the clipboard carries any: copying from a rich editor puts
 * both a string and a rendering of it on the clipboard, and the user pressing
 * Cmd+V over a text field means the text. Only a clipboard that is purely a
 * file - a screenshot, a Finder copy, a drag from another app - becomes an
 * attachment.
 */
export function pickPastedAttachment(
  clipboard: PastedClipboard | null | undefined,
  now: number,
): PastedAttachment | null {
  if (!clipboard) return null;
  if (clipboard.getData("text/plain").length > 0) return null;

  const file: File | undefined = clipboard.files[0];
  if (!file || file.size === 0) return null;

  // Mirrors the attachment menu's split: the image input accepts image/video,
  // everything else goes through the document path.
  const type =
    file.type.startsWith("image/") || file.type.startsWith("video/")
      ? "image"
      : "document";

  const name = nameForPastedFile(file, now);
  const renamed =
    name === file.name
      ? file
      : // Sliced rather than wrapped directly: `new File([aFile], name)`
        // keeps the source file's name on some runtimes, which would silently
        // undo the rename.
        new File([file.slice(0, file.size, file.type)], name, {
          type: file.type,
          lastModified: file.lastModified,
        });

  return { file: renamed, type };
}
