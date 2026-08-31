/**
 * Identify a stored file from its bytes.
 *
 * Documents received before the original filename was persisted are stored as
 * `<uuid>.bin` with `application/octet-stream`, and nothing in the database
 * says what they are. The bytes still do: this recovers enough to give the
 * download a correct extension, which is what decides whether Excel or Word
 * agrees to open the file at all.
 */

export interface SniffedType {
  extension: string;
  mimeType: string;
}

const OOXML_MARKERS: Array<[string, SniffedType]> = [
  [
    "xl/workbook.xml",
    {
      extension: "xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ],
  [
    "word/document.xml",
    {
      extension: "docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  ],
  [
    "ppt/presentation.xml",
    {
      extension: "pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
  ],
];

/**
 * OLE2 compound files (the pre-2007 Office formats) name their streams in
 * UTF-16LE inside the directory sector, so the marker is the interleaved form.
 */
const OLE_MARKERS: Array<[string, SniffedType]> = [
  [
    "W\0o\0r\0k\0b\0o\0o\0k\0",
    { extension: "xls", mimeType: "application/vnd.ms-excel" },
  ],
  ["B\0o\0o\0k\0", { extension: "xls", mimeType: "application/vnd.ms-excel" }],
  [
    "W\0o\0r\0d\0D\0o\0c\0u\0m\0e\0n\0t\0",
    { extension: "doc", mimeType: "application/msword" },
  ],
  [
    "P\0o\0w\0e\0r\0P\0o\0i\0n\0t\0",
    { extension: "ppt", mimeType: "application/vnd.ms-powerpoint" },
  ],
];

function startsWith(bytes: Buffer, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Identify a file from a prefix and a suffix of its bytes.
 *
 * Both are needed for OOXML: the ZIP signature is at the front, but the entry
 * names that separate a workbook from a document live in the central directory
 * at the end. Callers that only have the head can pass an empty tail and will
 * get the generic ZIP answer.
 */
export function sniffMediaType(
  head: Buffer,
  tail: Buffer = Buffer.alloc(0),
): SniffedType | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) {
    return { extension: "pdf", mimeType: "application/pdf" };
  }

  // OLE2 / Compound File Binary: D0 CF 11 E0 A1 B1 1A E1
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const searchable = Buffer.concat([head, tail]).toString("binary");
    for (const [marker, type] of OLE_MARKERS) {
      if (searchable.includes(marker)) return type;
    }
    // A compound file we cannot name is still not a `.bin`; leave it be rather
    // than guessing an application that would then fail to open it.
    return null;
  }

  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const searchable = Buffer.concat([head, tail]).toString("binary");
    for (const [marker, type] of OOXML_MARKERS) {
      if (searchable.includes(marker)) return type;
    }
    return { extension: "zip", mimeType: "application/zip" };
  }

  if (startsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
    return { extension: "rar", mimeType: "application/vnd.rar" };
  }
  if (startsWith(head, [0x7b, 0x5c, 0x72, 0x74, 0x66])) {
    return { extension: "rtf", mimeType: "application/rtf" };
  }
  if (startsWith(head, [0x1f, 0x8b])) {
    return { extension: "gz", mimeType: "application/gzip" };
  }
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }

  return null;
}
