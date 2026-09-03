import { describe, expect, test } from "bun:test";
import {
  buildContentDisposition,
  fileNameFromMediaKey,
  resolveDownloadContentType,
  resolveDownloadFileName,
} from "./media-download-name.js";

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("resolveDownloadContentType", () => {
  test("keeps a type the sender declared", () => {
    expect(resolveDownloadContentType("book.xlsx", XLSX)).toBe(XLSX);
  });

  test("upgrades an opaque type using the extension", () => {
    expect(
      resolveDownloadContentType("book.xlsx", "application/octet-stream"),
    ).toBe(XLSX);
    expect(resolveDownloadContentType("book.XLSX", "")).toBe(XLSX);
    expect(resolveDownloadContentType("legacy.xls", null)).toBe(
      "application/vnd.ms-excel",
    );
  });

  test("falls back to octet-stream when nothing is known", () => {
    expect(resolveDownloadContentType("mystery", null)).toBe(
      "application/octet-stream",
    );
  });
});

describe("resolveDownloadFileName", () => {
  test("keeps the sender's name", () => {
    expect(resolveDownloadFileName("Q3 report.xlsx", XLSX)).toBe(
      "Q3 report.xlsx",
    );
  });

  test("adds the extension when the name lost it", () => {
    expect(resolveDownloadFileName("Q3 report", XLSX)).toBe("Q3 report.xlsx");
  });

  test("names an unnamed document from its type", () => {
    expect(resolveDownloadFileName(null, XLSX)).toBe("document.xlsx");
    expect(resolveDownloadFileName("", "application/pdf")).toBe("document.pdf");
  });

  test("keeps a non-Latin name intact", () => {
    expect(resolveDownloadFileName("รายงาน.xlsx", XLSX)).toBe("รายงาน.xlsx");
  });

  test("strips directory components and control characters", () => {
    expect(resolveDownloadFileName("../../etc/passwd.xlsx", XLSX)).toBe(
      "passwd.xlsx",
    );
    expect(resolveDownloadFileName("re\nport.xlsx", XLSX)).toBe("report.xlsx");
  });

  test("has something to offer when nothing at all is known", () => {
    expect(resolveDownloadFileName(null, null)).toBe("document");
  });
});

describe("buildContentDisposition", () => {
  test("carries both an ASCII fallback and the real name", () => {
    expect(buildContentDisposition("report.xlsx")).toBe(
      `attachment; filename="report.xlsx"; filename*=UTF-8''report.xlsx`,
    );
  });

  test("transliterates the fallback for non-Latin names", () => {
    const header = buildContentDisposition("รายงาน.xlsx");
    expect(header).toContain(`filename="______.xlsx"`);
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent("รายงาน.xlsx")}`,
    );
  });

  test("cannot break out of the quoted fallback", () => {
    const header = buildContentDisposition('evil"; x="y.xlsx');
    expect(header).toContain(`filename="evil_; x=_y.xlsx"`);
  });

  test("supports an inline disposition for previewable documents", () => {
    expect(buildContentDisposition("manual.pdf", "inline")).toStartWith(
      "inline;",
    );
  });
});

describe("fileNameFromMediaKey", () => {
  test("recovers the name the worker embedded in the key", () => {
    expect(
      fileNameFromMediaKey(
        "s3://whatsapp-media/media/company/2026/08/30/a1b2c3d4-Q3_report.xlsx",
      ),
    ).toBe("Q3_report.xlsx");
  });

  test("recovers the name the API embedded in the key", () => {
    expect(
      fileNameFromMediaKey(
        "s3://whatsapp-media/media/company/1756512000000_k3j4h5g6j7h8_budget.xlsx",
      ),
    ).toBe("budget.xlsx");
  });

  test("declines keys that carry no name", () => {
    expect(
      fileNameFromMediaKey(
        "s3://whatsapp-media/media/company/2026/08/30/1f0a5c6e-6b3a-4a1e-9f2b-2c1d3e4f5a6b.bin",
      ),
    ).toBeNull();
    expect(fileNameFromMediaKey(null)).toBeNull();
    expect(fileNameFromMediaKey("")).toBeNull();
  });
});

describe("fileNameFromMediaKey on a signed URL", () => {
  test("decodes the key segment and ignores the signature", () => {
    expect(
      fileNameFromMediaKey(
        "https://acct.r2.cloudflarestorage.com/whatsapp-media/media/c/2026/08/30/a1b2c3d4-Q3%20report.xlsx?X-Amz-Signature=abc",
      ),
    ).toBe("Q3 report.xlsx");
  });
});
