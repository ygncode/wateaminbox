import type { TenantDatabase } from "@wateaminbox/database";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import { env } from "../lib/env.js";
import { getTenantConnection } from "./tenant.service.js";

export type ChannelCredentialKind =
  | "telegram_webhook_secret"
  | "telegram_bot_token";

interface EncryptedCredential {
  encryptedValue: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: string;
}

export class ChannelCredentialCipher {
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(
    serializedKeyring: string,
    readonly activeKeyVersion: string,
  ) {
    this.#keys = parseKeyring(serializedKeyring);
    if (!activeKeyVersion || !this.#keys.has(activeKeyVersion)) {
      throw new Error("active channel credential key is unavailable");
    }
  }

  encrypt(plaintext: string, associatedData: string): EncryptedCredential {
    if (!plaintext) throw new Error("channel credential cannot be empty");
    const key = this.#keys.get(this.activeKeyVersion)!;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(associatedData));
    const encryptedValue = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return {
      encryptedValue,
      nonce,
      authTag: cipher.getAuthTag(),
      keyVersion: this.activeKeyVersion,
    };
  }

  decrypt(encrypted: EncryptedCredential, associatedData: string): string {
    const key = this.#keys.get(encrypted.keyVersion);
    if (!key) throw new Error("channel credential key version is unavailable");
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(encrypted.authTag);
    return Buffer.concat([
      decipher.update(encrypted.encryptedValue),
      decipher.final(),
    ]).toString("utf8");
  }
}

export async function storeChannelCredential(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  channelAccountId: string,
  kind: ChannelCredentialKind,
  plaintext: string,
  cipher = configuredCipher(),
): Promise<void> {
  const encrypted = cipher.encrypt(
    plaintext,
    associatedData(companyId, channelAccountId, kind),
  );
  await tenantDb
    .insertInto("channel_account_credentials")
    .values({
      channel_account_id: channelAccountId,
      credential_kind: kind,
      encrypted_value: encrypted.encryptedValue,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
    })
    .onConflict((oc) =>
      oc.columns(["channel_account_id", "credential_kind"]).doUpdateSet({
        encrypted_value: encrypted.encryptedValue,
        nonce: encrypted.nonce,
        auth_tag: encrypted.authTag,
        key_version: encrypted.keyVersion,
        rotated_at: new Date(),
      }),
    )
    .execute();
}

export async function readChannelCredential(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  channelAccountId: string,
  kind: ChannelCredentialKind,
  cipher = configuredCipher(),
): Promise<string | null> {
  const stored = await tenantDb
    .selectFrom("channel_account_credentials")
    .select(["encrypted_value", "nonce", "auth_tag", "key_version"])
    .where("channel_account_id", "=", channelAccountId)
    .where("credential_kind", "=", kind)
    .executeTakeFirst();
  if (!stored) return null;
  return cipher.decrypt(
    {
      encryptedValue: stored.encrypted_value,
      nonce: stored.nonce,
      authTag: stored.auth_tag,
      keyVersion: stored.key_version,
    },
    associatedData(companyId, channelAccountId, kind),
  );
}

export async function resolveTelegramWebhookSecret(context: {
  companyId: string;
  channelAccountId: string;
}): Promise<string | null> {
  try {
    const tenantDb = await getTenantConnection(context.companyId);
    return await readChannelCredential(
      tenantDb,
      context.companyId,
      context.channelAccountId,
      "telegram_webhook_secret",
    );
  } catch {
    return null;
  }
}

function configuredCipher(): ChannelCredentialCipher {
  return new ChannelCredentialCipher(
    env.CHANNEL_CREDENTIAL_ENCRYPTION_KEYS,
    env.CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION,
  );
}

/**
 * Whether this process can encrypt a provider secret at all.
 *
 * Startup does not require a keyring, because a linked-device-only host never
 * stores one. That leaves a real deployment state - keys unset or malformed -
 * in which every provider connect attempt throws deep inside a transaction
 * and surfaces as a bare 500. Callers use this to refuse the operation up
 * front and say why, the same way they already do for workspace flags and
 * missing indexes.
 */
export function canStoreChannelCredentials(): boolean {
  try {
    configuredCipher();
    return true;
  } catch {
    return false;
  }
}

function associatedData(
  companyId: string,
  channelAccountId: string,
  kind: ChannelCredentialKind,
): string {
  return `channel-credential:v1:${companyId}:${channelAccountId}:${kind}`;
}

function parseKeyring(serialized: string): ReadonlyMap<string, Buffer> {
  const keys = new Map<string, Buffer>();
  for (const entry of serialized.split(",")) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new Error("invalid channel credential keyring");
    const version = entry.slice(0, separator).trim();
    const encoded = entry.slice(separator + 1).trim();
    const key = Buffer.from(encoded, "base64");
    if (!version || key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error("invalid channel credential encryption key");
    }
    if (keys.has(version))
      throw new Error("duplicate channel credential key version");
    keys.set(version, key);
  }
  return keys;
}
