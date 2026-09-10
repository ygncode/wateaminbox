/**
 * HTTP-level coverage for `POST /api/media/upload`.
 *
 * The route's 50 MiB file-size cap used to be enforced only after
 * `c.req.parseBody()` had already buffered the entire multipart body into RAM,
 * so an oversized request was rejected too late to prevent the memory spike.
 * These tests pin the fixed ordering: an oversized declared body is refused
 * from its Content-Length header before the body is read, a real file just
 * over the cap is still rejected by the post-buffer file-size backstop, and
 * legitimate uploads still succeed end-to-end. The upload path previously had
 * no HTTP coverage.
 *
 * Requires the integration environment: PostgreSQL, NATS, and MinIO (S3), the
 * same services the rest of the route integration suites use. Storage is real
 * so the happy path exercises the actual S3 upload against MinIO; every
 * rejection path returns before `uploadMedia` runs, so no S3 writes occur.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import { MAX_FILE_SIZE, MAX_UPLOAD_BODY_SIZE } from "../config/media.config.js";
import { hashPassword } from "../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
} from "../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

async function loginHeaders(
  email: string,
  companyId: string,
): Promise<Record<string, string>> {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
  };
}

async function withTenant(
  run: (ctx: {
    companyId: string;
    headers: Record<string, string>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const ownerEmail = `media-${ownerId}@example.com`;

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: ownerEmail,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Media upload route test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await createTenantSchema(companyId);

    const headers = await loginHeaders(ownerEmail, companyId);
    await run({ companyId, headers });
  } finally {
    await clearTenantConnection(companyId);
    await dropTenantSchema(companyId);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

/**
 * Headers for the upload, without a content-type so a FormData body can set
 * its own multipart boundary automatically.
 */
function uploadHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return {
    authorization: headers.authorization,
    "x-company-id": headers["x-company-id"],
  };
}

describe("POST /api/media/upload", () => {
  integrationTest(
    "accepts a small allowed-type upload end-to-end",
    async () => {
      await withTenant(async ({ companyId, headers }) => {
        // A minimal 1x1 PNG with an exact image/png content type. A
        // text/plain Blob is rewritten by FormData/Blob to
        // "text/plain;charset=utf-8" on the way out, which the route's
        // allowlist (correctly) does not accept, so a binary image is the
        // smallest representation that survives the multipart round-trip with
        // the exact MIME the allowlist expects.
        const pngBytes = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63,
          0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
          0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
          0x82,
        ]);
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([pngBytes], { type: "image/png" }),
          "tiny.png",
        );

        const response = await app.request("/api/media/upload", {
          method: "POST",
          headers: uploadHeaders(headers),
          body: formData,
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: {
            mediaUrl: string;
            fileName: string;
            fileSize: number;
            mimeType: string;
            key: string;
            mediaReference: string;
          };
        };
        expect(body.data.fileName).toBe("tiny.png");
        expect(body.data.fileSize).toBe(pngBytes.length);
        expect(body.data.mimeType).toBe("image/png");
        // The key is tenant-prefixed so storage is isolated per workspace.
        expect(body.data.key.startsWith(`media/${companyId}/`)).toBe(true);
        expect(body.data.mediaReference.startsWith("s3://")).toBe(true);
        expect(body.data.mediaUrl).toBeTruthy();
      });
    },
  );

  integrationTest(
    "rejects an oversized Content-Length without reading the body",
    async () => {
      await withTenant(async ({ headers }) => {
        // A body stream that errors if it is ever pulled. The pre-buffer
        // Content-Length guard must return 400 before `parseBody()` reads a
        // single chunk; if it regresses to buffering first, `parseBody` would
        // reject here and the response would be 500 instead of the expected
        // 400 — which is exactly the failure this test exists to catch.
        const bodyThatMustNotBeRead = new ReadableStream({
          pull(controller) {
            controller.error(
              new Error(
                "upload body must not be read when Content-Length is over the cap",
              ),
            );
          },
        });

        // `duplex: "half"` is required by fetch for a streamed request body;
        // it is absent from lib.dom's RequestInit but accepted by Bun.
        const init: RequestInit & { duplex?: "half" } = {
          method: "POST",
          headers: {
            ...uploadHeaders(headers),
            "content-type": "multipart/form-data; boundary=----neverread",
            "content-length": String(MAX_UPLOAD_BODY_SIZE + 1),
          },
          body: bodyThatMustNotBeRead,
          duplex: "half",
        };

        const response = await app.request("/api/media/upload", init);

        expect(response.status).toBe(400);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("File too large");
      });
    },
  );

  integrationTest(
    "rejects a real file just over the cap via the post-buffer file-size check",
    async () => {
      // A file of MAX_FILE_SIZE + 1 bytes has an honest Content-Length
      // (~50 MiB plus multipart framing), which is below the 50 MiB + 1 MiB
      // body cap, so the pre-buffer Content-Length guard does not fire. The
      // post-buffer `file.size > MAX_FILE_SIZE` check is what must reject it.
      // This guards the file-size backstop against being removed on the
      // assumption that the pre-buffer guard alone suffices — a spoofed
      // Content-Length would otherwise let a just-over-cap file reach storage.
      await withTenant(async ({ headers }) => {
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([new Uint8Array(MAX_FILE_SIZE + 1)], {
            type: "text/plain",
          }),
          "oversized.txt",
        );

        const response = await app.request("/api/media/upload", {
          method: "POST",
          headers: uploadHeaders(headers),
          body: formData,
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("File too large");
      });
    },
    30_000,
  );
});
