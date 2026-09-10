import { describe, expect, test } from "bun:test";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import { hashPassword } from "../lib/password.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:4450";
const S3_BUCKET = process.env.S3_BUCKET || "whatsapp-media";
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
  },
});

async function countObjects(prefix: string): Promise<number> {
  let count = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );
    count += (page.Contents ?? []).length;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return count;
}

async function cleanupPrefix(prefix: string): Promise<void> {
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );
    for (const obj of page.Contents ?? []) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key! }),
      );
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

const pngMagic = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);
const webpMagic = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
]);
const pdfMagic = Buffer.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xb5, 0xb5, 0xb5,
  0xb5,
]);

const dataUrl = (mime: string, bytes: Buffer) =>
  `data:${mime};base64,${bytes.toString("base64")}`;

interface LoginResponse {
  tokens: { accessToken: string };
}

async function bootstrapUser(): Promise<{
  userId: string;
  email: string;
  accessToken: string;
}> {
  const userId = crypto.randomUUID();
  const email = `e2e-avatar-${userId}@example.com`;
  const password = "Correct-Horse-123!";
  await db
    .insertInto("users")
    .values({
      id: userId,
      email,
      name: "E2E Avatar User",
      password_hash: await hashPassword(password),
      email_verified_at: new Date(),
    })
    .execute();
  const loginResponse = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(loginResponse.status).toBe(200);
  const login = (await loginResponse.json()) as LoginResponse;
  return { userId, email, accessToken: login.tokens.accessToken };
}

const authed = (accessToken: string, body?: unknown, method = "PATCH") => ({
  method,
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

describe("avatar and workspace logo upload guards (e2e)", () => {
  integrationTest(
    "PATCH /me rejects a 0-byte-decoding avatar and writes nothing to S3",
    async () => {
      const { userId, accessToken } = await bootstrapUser();
      const prefix = `media/user-${userId}/`;
      await cleanupPrefix(prefix);
      const before = await countObjects(prefix);

      const res = await app.request(
        "/api/auth/me",
        authed(accessToken, { avatarDataUrl: "data:image/png;base64,A" }),
      );
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe("INVALID_PROFILE_IMAGE");
      expect(json.message).toBe("Invalid profile image");

      const after = await countObjects(prefix);
      expect(after).toBe(before);

      const user = await db
        .selectFrom("users")
        .where("id", "=", userId)
        .select("avatar_key")
        .executeTakeFirstOrThrow();
      expect(user.avatar_key).toBeNull();

      await cleanupPrefix(prefix);
      await db.deleteFrom("users").where("id", "=", userId).execute();
    },
  );

  integrationTest(
    "PATCH /me rejects PNG bytes labelled image/jpeg",
    async () => {
      const { userId, accessToken } = await bootstrapUser();
      const prefix = `media/user-${userId}/`;
      await cleanupPrefix(prefix);
      const before = await countObjects(prefix);

      const res = await app.request(
        "/api/auth/me",
        authed(accessToken, {
          avatarDataUrl: dataUrl("image/jpeg", pngMagic),
        }),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        "INVALID_PROFILE_IMAGE",
      );
      expect(await countObjects(prefix)).toBe(before);

      await db.deleteFrom("users").where("id", "=", userId).execute();
    },
  );

  integrationTest(
    "PATCH /me accepts a valid WebP avatar, persists the key, and serves the image",
    async () => {
      const { userId, accessToken } = await bootstrapUser();
      const prefix = `media/user-${userId}/`;
      await cleanupPrefix(prefix);

      const res = await app.request(
        "/api/auth/me",
        authed(accessToken, {
          avatarDataUrl: dataUrl("image/webp", webpMagic),
        }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        user: { avatarUrl: string; hasCustomAvatar: boolean };
      };
      expect(json.user.hasCustomAvatar).toBe(true);

      const user = await db
        .selectFrom("users")
        .where("id", "=", userId)
        .select("avatar_key")
        .executeTakeFirstOrThrow();
      expect(user.avatar_key).not.toBeNull();
      expect(user.avatar_key).toMatch(new RegExp(`^media/user-${userId}/`));

      const objects = await countObjects(prefix);
      expect(objects).toBe(1);

      const imageRes = await fetch(json.user.avatarUrl);
      expect(imageRes.status).toBe(200);
      const buf = Buffer.from(await imageRes.arrayBuffer());
      expect(buf.length).toBe(webpMagic.length);
      expect(buf).toEqual(webpMagic);

      await cleanupPrefix(prefix);
      await db.deleteFrom("users").where("id", "=", userId).execute();
    },
  );

  integrationTest(
    "POST /companies rejects a 0-byte-decoding logo and writes nothing",
    async () => {
      const { userId, accessToken } = await bootstrapUser();
      const headers = {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      };

      const res = await app.request("/api/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Logo Reject Co",
          logoDataUrl: "data:image/png;base64,A",
        }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Invalid workspace logo");

      const companies = await db
        .selectFrom("companies")
        .where("name", "=", "Logo Reject Co")
        .select(["id", "logo_key"])
        .execute();
      expect(companies).toHaveLength(0);

      await db.deleteFrom("users").where("id", "=", userId).execute();
    },
  );

  integrationTest(
    "POST /companies accepts a valid WebP logo and serves it",
    async () => {
      const { userId, accessToken } = await bootstrapUser();
      const headers = {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      };

      const res = await app.request("/api/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Logo Accept Co",
          logoDataUrl: dataUrl("image/webp", webpMagic),
        }),
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as {
        data: { id: string; logoUrl: string };
      };
      const companyId = json.data.id;
      expect(json.data.logoUrl).toBeTruthy();

      const company = await db
        .selectFrom("companies")
        .where("id", "=", companyId)
        .select("logo_key")
        .executeTakeFirstOrThrow();
      expect(company.logo_key).not.toBeNull();
      expect(company.logo_key).toMatch(new RegExp(`^media/${companyId}/`));

      const objects = await countObjects(`media/${companyId}/`);
      expect(objects).toBe(1);

      const imageRes = await fetch(json.data.logoUrl);
      expect(imageRes.status).toBe(200);
      const buf = Buffer.from(await imageRes.arrayBuffer());
      expect(buf).toEqual(webpMagic);

      await cleanupPrefix(`media/${companyId}/`);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    },
  );

  integrationTest(
    "PATCH /companies/:id rejects a malformed logo and leaves logo_key unchanged",
    async () => {
      const { userId, accessToken } = await bootstrapUser();
      const headers = {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      };

      const createRes = await app.request("/api/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Patch Logo Co",
          logoDataUrl: dataUrl("image/webp", webpMagic),
        }),
      });
      expect(createRes.status).toBe(201);
      const companyId = ((await createRes.json()) as { data: { id: string } })
        .data.id;
      const originalLogoKey = (
        await db
          .selectFrom("companies")
          .where("id", "=", companyId)
          .select("logo_key")
          .executeTakeFirstOrThrow()
      ).logo_key;
      expect(originalLogoKey).not.toBeNull();
      const objectsBefore = await countObjects(`media/${companyId}/`);

      const patchRes = await app.request(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          logoDataUrl: "data:image/png;base64,AAAA",
        }),
      });
      expect(patchRes.status).toBe(400);
      expect(((await patchRes.json()) as { error: string }).error).toBe(
        "Invalid workspace logo",
      );

      const company = await db
        .selectFrom("companies")
        .where("id", "=", companyId)
        .select("logo_key")
        .executeTakeFirstOrThrow();
      expect(company.logo_key).toBe(originalLogoKey);
      expect(await countObjects(`media/${companyId}/`)).toBe(objectsBefore);

      await cleanupPrefix(`media/${companyId}/`);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    },
  );

  integrationTest(
    "POST /media/upload still accepts a non-image PDF (uploadMedia non-image path unchanged)",
    async () => {
      const { userId, accessToken } = await bootstrapUser();
      const headers = {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      };

      const createRes = await app.request("/api/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Media Co" }),
      });
      expect(createRes.status).toBe(201);
      const companyId = ((await createRes.json()) as { data: { id: string } })
        .data.id;

      const form = new FormData();
      form.append(
        "file",
        new Blob([pdfMagic], { type: "application/pdf" }),
        "doc.pdf",
      );
      const uploadRes = await app.request("/api/media/upload", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "x-company-id": companyId,
        },
        body: form,
      });
      expect(uploadRes.status).toBe(200);
      const uploaded = (await uploadRes.json()) as {
        data: { key: string; mediaUrl: string };
      };
      expect(uploaded.data.key).toMatch(new RegExp(`^media/${companyId}/`));
      const objects = await countObjects(`media/${companyId}/`);
      expect(objects).toBe(1);

      await cleanupPrefix(`media/${companyId}/`);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    },
  );
});
