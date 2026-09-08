import { describe, expect, test } from "bun:test";
import { AuthError } from "../lib/errors.js";
import { uploadProfileAvatar } from "./auth.service.js";

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
    companyId: string,
    filename?: string,
  ): Promise<{ key: string }> => {
    calls.push({
      data: Buffer.from(data),
      mimeType,
      companyId,
      filename: filename ?? "",
    });
    return { key: `media/${companyId}/${filename ?? ""}` };
  };
  return { upload, calls };
}

const userId = "123";

describe("uploadProfileAvatar", () => {
  test("uploads a valid PNG, forwarding the decoded bytes and image MIME type", async () => {
    const { upload, calls } = recorder();
    const key = await uploadProfileAvatar(
      userId,
      dataUrl("image/png", pngBytes),
      upload,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: pngBytes,
      mimeType: "image/png",
      companyId: `user-${userId}`,
      filename: "profile-avatar.png",
    });
    expect(key).toBe(`media/user-${userId}/profile-avatar.png`);
  });

  test("uploads a valid JPEG under the .jpg extension", async () => {
    const { upload, calls } = recorder();
    await uploadProfileAvatar(userId, dataUrl("image/jpeg", jpegBytes), upload);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: jpegBytes,
      mimeType: "image/jpeg",
      companyId: `user-${userId}`,
      filename: "profile-avatar.jpg",
    });
  });

  test("uploads a valid WebP image", async () => {
    const { upload, calls } = recorder();
    await uploadProfileAvatar(userId, dataUrl("image/webp", webpBytes), upload);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: webpBytes,
      mimeType: "image/webp",
      companyId: `user-${userId}`,
      filename: "profile-avatar.webp",
    });
  });

  test("rejects a truncated base64 body that decodes to zero bytes without uploading", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadProfileAvatar(userId, "data:image/png;base64,A", upload),
    ).rejects.toThrow("Invalid profile image");
    expect(calls).toHaveLength(0);
  });

  test("rejects well-formed base64 that decodes to non-image bytes", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadProfileAvatar(userId, "data:image/png;base64,AAAA", upload),
    ).rejects.toThrow("Invalid profile image");
    expect(calls).toHaveLength(0);
  });

  test("rejects bytes whose magic bytes do not match the claimed MIME label", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadProfileAvatar(userId, dataUrl("image/jpeg", pngBytes), upload),
    ).rejects.toThrow("Invalid profile image");
    expect(calls).toHaveLength(0);
  });

  test("rejects an unsupported / malformed data-URL prefix", async () => {
    const { upload, calls } = recorder();
    await expect(
      uploadProfileAvatar(userId, "data:image/gif;base64,R0lGOD==", upload),
    ).rejects.toThrow("Invalid profile image");
    await expect(
      uploadProfileAvatar(userId, "data:image/png;base64,", upload),
    ).rejects.toThrow("Invalid profile image");
    expect(calls).toHaveLength(0);
  });

  test("surfaces the rejection as a 400 AuthError", async () => {
    const { upload } = recorder();
    const error = await uploadProfileAvatar(
      userId,
      "data:image/png;base64,A",
      upload,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as { code: string }).code).toBe("INVALID_PROFILE_IMAGE");
    expect((error as { statusCode: number }).statusCode).toBe(400);
  });
});
