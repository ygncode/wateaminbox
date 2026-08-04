import { describe, expect, test } from "bun:test";
import {
  aggregateTenantMediaUsage,
  getAuthorizedMediaUrl,
  getPrivateMediaReference,
  resolveMediaKeyForCompany,
} from "./storage.js";

const companyA = "11111111-1111-4111-8111-111111111111";
const companyB = "22222222-2222-4222-8222-222222222222";
const keyA = `media/${companyA}/file.jpg`;

describe("authoritative tenant media usage", () => {
  test("aggregates paginated object sizes without trusting client values", async () => {
    const pages = [
      {
        contents: [
          { key: `${keyA}`, size: 10 },
          { key: `media/${companyA}/b`, size: 20 },
        ],
        truncated: true,
        nextToken: "next",
      },
      {
        contents: [{ key: `media/${companyA}/c`, size: 30 }],
        truncated: false,
      },
    ];
    const usage = await aggregateTenantMediaUsage(
      `media/${companyA}/`,
      async (token) => pages[token ? 1 : 0]!,
    );
    expect(usage).toEqual({ bytes: 60n, objects: 3n });
  });

  test("rejects cross-tenant keys, unsafe sizes, and broken pagination", async () => {
    expect(
      aggregateTenantMediaUsage(`media/${companyA}/`, async () => ({
        contents: [{ key: `media/${companyB}/secret`, size: 1 }],
        truncated: false,
      })),
    ).rejects.toThrow("outside the tenant prefix");
    expect(
      aggregateTenantMediaUsage(`media/${companyA}/`, async () => ({
        contents: [{ key: keyA, size: Number.MAX_SAFE_INTEGER + 1 }],
        truncated: false,
      })),
    ).rejects.toThrow("unsafe object size");
    expect(
      aggregateTenantMediaUsage(`media/${companyA}/`, async () => ({
        contents: [],
        truncated: true,
      })),
    ).rejects.toThrow("token is missing");
  });
});

describe("private media references", () => {
  test("resolves stable private references for the owning tenant", () => {
    const reference = getPrivateMediaReference(keyA);
    expect(reference).toBe(`s3://whatsapp-media/${keyA}`);
    expect(resolveMediaKeyForCompany(reference, companyA)).toBe(keyA);
  });

  test("resolves API-issued path-style presigned URLs without trusting expiry", () => {
    const url = `http://localhost:4450/whatsapp-media/${keyA}?X-Amz-Signature=expired`;
    expect(resolveMediaKeyForCompany(url, companyA)).toBe(keyA);
  });

  test("authorized access is short-lived and signed", async () => {
    const signed = await getAuthorizedMediaUrl(
      getPrivateMediaReference(keyA),
      companyA,
      60,
    );
    const url = new URL(signed!);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();

    const capped = await getAuthorizedMediaUrl(
      getPrivateMediaReference(keyA),
      companyA,
      24 * 60 * 60,
    );
    expect(new URL(capped!).searchParams.get("X-Amz-Expires")).toBe("300");
  });

  test("rejects another tenant and lookalike storage origins", () => {
    const reference = getPrivateMediaReference(keyA);
    expect(() => resolveMediaKeyForCompany(reference, companyB)).toThrow(
      "active tenant",
    );
    expect(() =>
      resolveMediaKeyForCompany(
        `http://localhost.evil.test:4450/whatsapp-media/${keyA}`,
        companyA,
      ),
    ).toThrow("configured object storage");
    expect(() =>
      resolveMediaKeyForCompany(
        `http://localhost:4450/not-whatsapp-media/${keyA}`,
        companyA,
      ),
    ).toThrow("media bucket");
  });

  test("rejects traversal and encoded separator tricks", () => {
    expect(() =>
      resolveMediaKeyForCompany(
        `s3://whatsapp-media/media/${companyA}/%2e%2e/${companyB}/secret`,
        companyA,
      ),
    ).toThrow();
    expect(() =>
      resolveMediaKeyForCompany(
        `s3://whatsapp-media/media/${companyA}/folder%5csecret`,
        companyA,
      ),
    ).toThrow();
  });
});
