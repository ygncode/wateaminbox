import { afterEach, describe, expect, test } from "bun:test";
import { archiveCatalog, getCatalogProducts } from "./catalogs";
import { getWhatsAppLabels, linkTagToLabel } from "./labels";
import type { CatalogProduct } from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("WhatsApp business settings API contracts", () => {
  test("reads catalog products from the API's products field", async () => {
    const product: CatalogProduct = {
      id: "product-row-1",
      connectionId: "connection-1",
      productId: "product-1",
      catalogId: "catalog-1",
      name: "Canvas bag",
      description: null,
      price: 24,
      currency: "USD",
      imageUrls: null,
      sku: null,
      category: null,
      availability: "in_stock",
      visibility: "visible",
      url: null,
      retailerId: null,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    };

    globalThis.fetch = (async (_input) =>
      Response.json({
        data: {
          products: [product],
          meta: {
            catalogId: "catalog-1",
            catalogName: "Summer",
            totalProducts: 1,
          },
        },
      })) as typeof fetch;

    const response = await getCatalogProducts("catalog-1", "connection-1");
    expect(response.products).toEqual([product]);
  });

  test("sends connection scope and pagination on label requests", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return Response.json({
        data: [],
        pagination: {
          total: 75,
          limit: 50,
          offset: 50,
          hasMore: false,
        },
      });
    }) as typeof fetch;

    const response = await getWhatsAppLabels("connection-2", 50, 50);
    expect(response.pagination.total).toBe(75);
    expect(requestedUrl).toContain("limit=50");
    expect(requestedUrl).toContain("offset=50");
    expect(requestedUrl).toContain("connectionId=connection-2");
  });

  test("accepts message-only action responses", async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), method: init?.method });
      return Response.json({ message: "Updated" });
    }) as typeof fetch;

    await expect(archiveCatalog("catalog-1", "connection-1")).resolves.toEqual({
      message: "Updated",
    });
    await expect(
      linkTagToLabel("label-1", "tag-1", "connection-1"),
    ).resolves.toEqual({ message: "Updated" });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain("connectionId=connection-1");
    expect(requests[1]?.url).toContain("connectionId=connection-1");
  });
});
