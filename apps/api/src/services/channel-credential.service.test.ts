import { describe, expect, test } from "bun:test";
import { ChannelCredentialCipher } from "./channel-credential.service";

const key = Buffer.alloc(32, 7).toString("base64");

describe("channel credential envelope encryption", () => {
  test("round trips with authenticated workspace/account/kind context", () => {
    const cipher = new ChannelCredentialCipher(`v1:${key}`, "v1");
    const encrypted = cipher.encrypt("super-secret", "tenant:account:webhook");
    expect(encrypted.encryptedValue.toString("utf8")).not.toContain(
      "super-secret",
    );
    expect(cipher.decrypt(encrypted, "tenant:account:webhook")).toBe(
      "super-secret",
    );
    expect(() => cipher.decrypt(encrypted, "other:account:webhook")).toThrow();
  });

  test("reads old versions while writing only the active version", () => {
    const oldKey = Buffer.alloc(32, 8).toString("base64");
    const oldCipher = new ChannelCredentialCipher(`old:${oldKey}`, "old");
    const encrypted = oldCipher.encrypt("token", "aad");
    const rotated = new ChannelCredentialCipher(
      `old:${oldKey},new:${key}`,
      "new",
    );
    expect(rotated.decrypt(encrypted, "aad")).toBe("token");
    expect(rotated.encrypt("next", "aad").keyVersion).toBe("new");
  });

  test("rejects absent and malformed key material", () => {
    expect(() => new ChannelCredentialCipher("", "v1")).toThrow();
    expect(() => new ChannelCredentialCipher("v1:not-base64", "v1")).toThrow();
  });
});
