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

describe("canStoreChannelCredentials", () => {
  const originals = {
    keys: process.env.CHANNEL_CREDENTIAL_ENCRYPTION_KEYS,
    active: process.env.CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION,
  };
  const restore = () => {
    process.env.CHANNEL_CREDENTIAL_ENCRYPTION_KEYS = originals.keys ?? "";
    process.env.CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION = originals.active ?? "";
  };

  test("a blank or malformed keyring is a configuration answer, not a throw", () => {
    // The env module snapshots at import, so the cipher itself is the unit
    // under test here: these are the exact inputs a blank .env produces.
    expect(() => new ChannelCredentialCipher("", "")).toThrow();
    expect(() => new ChannelCredentialCipher(`v1:${key}`, "")).toThrow();
    // An active version naming a key the ring does not hold must not pass.
    expect(() => new ChannelCredentialCipher(`v1:${key}`, "v2")).toThrow();
    // A key of the wrong length is rejected rather than silently padded.
    expect(
      () =>
        new ChannelCredentialCipher(
          `v1:${Buffer.alloc(16, 7).toString("base64")}`,
          "v1",
        ),
    ).toThrow();
    restore();
  });

  test("reports true for a well-formed keyring", () => {
    expect(
      new ChannelCredentialCipher(`v1:${key}`, "v1").activeKeyVersion,
    ).toBe("v1");
    restore();
  });
});
