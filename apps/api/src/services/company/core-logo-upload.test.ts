import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../lib/errors.js";
import { uploadWorkspaceLogo } from "./core.js";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);
const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const webpBytes = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
]);

const dataUrl = (mime: string, bytes: Buffer) =>
  `data:${mime};base64,${bytes.toString("base64")}`;
const companyId = "11111111-1111-4111-8111-111111111111";

interface UploadCall {
  data: Buffer;
  mimeType: string;
  companyId: string;
  filename: string;
}

function recorder() {
  const calls: UploadCall[] = [];
  const upload = async (
    data: Buffer | Uint8Array,
    mimeType: string,
    tenantId: string,
    filename?: string,
  ): Promise<{ key: string }> => {
    calls.push({
      data: Buffer.from(data),
      mimeType,
      companyId: tenantId,
      filename: filename ?? "",
    });
    return { key: `media/${tenantId}/${filename ?? ""}` };
  };
  return { upload, calls };
}

describe("uploadWorkspaceLogo", () => {
  test("uploads a valid PNG logo, forwarding the decoded bytes and image MIME type", async () => {
    const { upload, calls } = recorder();
    const key = await uploadWorkspaceLogo(
      companyId,
      dataUrl("image/png", pngBytes),
      upload,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: pngBytes,
      mimeType: "image/png",
      companyId,
      filename: "workspace-logo.png",
    });
    expect(key).toBe(`media/${companyId}/workspace-logo.png`);
  });

  test("uploads a valid JPEG logo under the .jpg extension", async () => {
    const { upload, calls } = recorder();
    await uploadWorkspaceLogo(
      companyId,
      dataUrl("image/jpeg", jpegBytes),
      upload,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: jpegBytes,
      mimeType: "image/jpeg",
      companyId,
      filename: "workspace-logo.jpg",
    });
  });

  test("uploads a valid WebP logo", async () => {
    const { upload, calls } = recorder();
    await uploadWorkspaceLogo(
      companyId,
      dataUrl("image/webp", webpBytes),
      upload,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: webpBytes,
      mimeType: "image/webp",
      companyId,
      filename: "workspace-logo.webp",
    });
  });

  test("rejects a truncated base64 body that decodes to zero bytes without uploading", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadWorkspaceLogo(companyId, "data:image/png;base64,A", upload),
    ).rejects.toThrow("Invalid workspace logo");
    expect(calls).toHaveLength(0);
  });

  test("rejects well-formed base64 that decodes to non-image bytes", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadWorkspaceLogo(companyId, "data:image/png;base64,AAAA", upload),
    ).rejects.toThrow("Invalid workspace logo");
    expect(calls).toHaveLength(0);
  });

  test("rejects bytes whose magic bytes do not match the claimed MIME label", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadWorkspaceLogo(companyId, dataUrl("image/jpeg", pngBytes), upload),
    ).rejects.toThrow("Invalid workspace logo");
    expect(calls).toHaveLength(0);
  });

  test("rejects an unsupported / malformed data-URL prefix", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadWorkspaceLogo(companyId, "data:image/gif;base64,R0lGOD==", upload),
    ).rejects.toThrow("Invalid workspace logo");
    await expect(
      uploadWorkspaceLogo(companyId, "data:image/png;base64,", upload),
    ).rejects.toThrow("Invalid workspace logo");
    expect(calls).toHaveLength(0);
  });

  test("surfaces the rejection as a 400 ValidationError", async () => {
    const { upload } = recorder();
    const error = await uploadWorkspaceLogo(
      companyId,
      "data:image/png;base64,A",
      upload,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as { statusCode: number }).statusCode).toBe(400);
  });
});
