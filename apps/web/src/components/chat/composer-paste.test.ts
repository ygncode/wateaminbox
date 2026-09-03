import { describe, expect, it } from "bun:test";
import { nameForPastedFile, pickPastedAttachment } from "./composer-paste";

function clipboard(files: File[], text = "") {
  return {
    types: files.length ? ["Files"] : ["text/plain"],
    files,
    getData: () => text,
  };
}

const NOW = 1_700_000_000_000;

describe("pickPastedAttachment", () => {
  it("returns null when the clipboard carries text", () => {
    const png = new File(["x"], "image.png", { type: "image/png" });
    expect(pickPastedAttachment(clipboard([png], "hello"), NOW)).toBeNull();
  });

  it("returns null for an empty or missing clipboard", () => {
    expect(pickPastedAttachment(null, NOW)).toBeNull();
    expect(pickPastedAttachment(clipboard([]), NOW)).toBeNull();
  });

  it("ignores zero-byte entries", () => {
    const empty = new File([], "image.png", { type: "image/png" });
    expect(pickPastedAttachment(clipboard([empty]), NOW)).toBeNull();
  });

  it("routes images and video through the image path", () => {
    const png = new File(["x"], "shot.png", { type: "image/png" });
    const mp4 = new File(["x"], "clip.mp4", { type: "video/mp4" });
    expect(pickPastedAttachment(clipboard([png]), NOW)?.type).toBe("image");
    expect(pickPastedAttachment(clipboard([mp4]), NOW)?.type).toBe("image");
  });

  it("routes everything else through the document path", () => {
    const pdf = new File(["x"], "invoice.pdf", { type: "application/pdf" });
    expect(pickPastedAttachment(clipboard([pdf]), NOW)?.type).toBe("document");
  });

  it("preserves the file's bytes and MIME type", () => {
    const png = new File(["x"], "image.png", { type: "image/png" });
    const picked = pickPastedAttachment(clipboard([png]), NOW);
    expect(picked?.file.type).toBe("image/png");
    expect(picked?.file.size).toBe(1);
  });
});

// Naming is asserted through the pure helper rather than the File the picker
// builds: bun's test-runtime `File` constructor does not honour the name
// argument reliably, which browsers do.
describe("nameForPastedFile", () => {
  it("renames generic screenshot names", () => {
    const shot = new File(["x"], "image.png", { type: "image/png" });
    expect(nameForPastedFile(shot, NOW)).toBe(`pasted-${NOW}.png`);
  });

  it("keeps a name the user chose", () => {
    const named = new File(["x"], "quarterly-chart.png", { type: "image/png" });
    expect(nameForPastedFile(named, NOW)).toBe("quarterly-chart.png");
  });

  it("derives an extension from the MIME type when the name has none", () => {
    const blob = new File(["x"], "", { type: "image/webp" });
    expect(nameForPastedFile(blob, NOW)).toBe(`pasted-${NOW}.webp`);
  });
});
