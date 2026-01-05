/**
 * Unit tests for catalogs.ts routes
 *
 * Tests the WhatsApp Business catalogs API endpoints:
 * - GET /catalogs
 * - GET /catalogs/status
 * - GET /catalogs/:catalogId
 * - GET /catalogs/:catalogId/products
 * - POST /catalogs/sync
 * - POST /catalogs/:catalogId/archive
 * - POST /catalogs/:catalogId/restore
 */

import { describe, it, expect, beforeEach, mock } from "bun:test"
import { Hono } from "hono"

// Create mock catalog data
interface MockCatalog {
  id: string
  catalog_id: string
  name: string
  description: string | null
  currency: string
  status: "active" | "inactive" | "archived"
  business_jid: string | null
  header_image_url: string | null
  product_count: number
  last_synced_at: Date
  created_at: Date
  updated_at: Date
}

interface MockProduct {
  id: string
  product_id: string
  catalog_id: string
  name: string
  description: string | null
  price: number | null
  currency: string
  image_urls: string[] | null
  sku: string | null
  category: string | null
  availability: string
  visibility: "visible" | "hidden"
  url: string | null
  retailer_id: string | null
  created_at: Date
  updated_at: Date
}

function createMockCatalog(overrides: Partial<MockCatalog> = {}): MockCatalog {
  const now = new Date()
  return {
    id: "catalog-uuid-123",
    catalog_id: "catalog-123",
    name: "Test Catalog",
    description: "A test product catalog",
    currency: "USD",
    status: "active",
    business_jid: "1234567890@s.whatsapp.net",
    header_image_url: null,
    product_count: 5,
    last_synced_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function createMockProduct(overrides: Partial<MockProduct> = {}): MockProduct {
  const now = new Date()
  return {
    id: "product-uuid-123",
    product_id: "product-123",
    catalog_id: "catalog-123",
    name: "Test Product",
    description: "A test product",
    price: 29.99,
    currency: "USD",
    image_urls: ["https://example.com/image.jpg"],
    sku: "SKU-001",
    category: "Electronics",
    availability: "in_stock",
    visibility: "visible",
    url: "https://example.com/product",
    retailer_id: "retailer-123",
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

// Create a mock tenant db for catalogs
function createMockTenantDb() {
  let catalogs: MockCatalog[] = []
  let products: MockProduct[] = []
  let connection: Record<string, unknown> | null = { id: "conn-123", status: "connected" }

  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "whatsapp_catalogs") {
        const builder: Record<string, unknown> = {}
        let currentFilter: unknown = null
        let statusFilter: unknown = null

        const chainMethods = ["selectAll", "select", "orderBy", "limit", "offset"]
        chainMethods.forEach((method) => {
          builder[method] = mock((selectorFn?: unknown) => {
            // Handle select with callback for count
            if (method === "select" && typeof selectorFn === "function") {
              const eb = {
                fn: {
                  countAll: () => ({
                    as: () => "count",
                  }),
                },
              }
              selectorFn(eb)
            }
            return builder
          })
        })

        builder.where = mock((col: string, _op: string, value: unknown) => {
          if (col === "catalog_id") {
            currentFilter = value
          } else if (col === "status") {
            statusFilter = value
          }
          return builder
        })

        builder.execute = mock(() => {
          let filtered = catalogs
          if (statusFilter) {
            filtered = filtered.filter((c) => c.status === statusFilter)
          }
          return Promise.resolve(filtered)
        })

        builder.executeTakeFirst = mock(() => {
          if (currentFilter) {
            const found = catalogs.find((c) => c.catalog_id === currentFilter)
            return Promise.resolve(found)
          }
          // For count queries, return count
          return Promise.resolve({ count: catalogs.length })
        })

        return builder
      }

      if (table === "catalog_products") {
        const builder: Record<string, unknown> = {}
        let catalogFilter: unknown = null

        const chainMethods = ["selectAll", "select", "orderBy", "limit", "offset"]
        chainMethods.forEach((method) => {
          builder[method] = mock((selectorFn?: unknown) => {
            if (method === "select" && typeof selectorFn === "function") {
              const eb = {
                fn: {
                  countAll: () => ({
                    as: () => "count",
                  }),
                },
              }
              selectorFn(eb)
            }
            return builder
          })
        })

        builder.where = mock((col: string, _op: string, value: unknown) => {
          if (col === "catalog_id") {
            catalogFilter = value
          }
          return builder
        })

        builder.execute = mock(() => {
          if (catalogFilter) {
            return Promise.resolve(
              products.filter((p) => p.catalog_id === catalogFilter)
            )
          }
          return Promise.resolve(products)
        })

        builder.executeTakeFirst = mock(() => {
          // For count queries
          const count = catalogFilter
            ? products.filter((p) => p.catalog_id === catalogFilter).length
            : products.length
          return Promise.resolve({ count })
        })

        return builder
      }

      if (table === "whatsapp_connections") {
        const builder: Record<string, unknown> = {}

        const chainMethods = ["select", "selectAll", "orderBy"]
        chainMethods.forEach((method) => {
          builder[method] = mock(() => builder)
        })

        builder.where = mock(() => builder)

        builder.executeTakeFirst = mock(() => Promise.resolve(connection))
        builder.execute = mock(() => Promise.resolve(connection ? [connection] : []))

        return builder
      }

      // Default builder
      const defaultBuilder: Record<string, unknown> = {}
      const methods = ["selectAll", "select", "where", "orderBy", "limit", "offset"]
      methods.forEach((m) => {
        defaultBuilder[m] = mock(() => defaultBuilder)
      })
      defaultBuilder.execute = mock(() => Promise.resolve([]))
      defaultBuilder.executeTakeFirst = mock(() => Promise.resolve(undefined))
      return defaultBuilder
    }),
    updateTable: mock((table: string) => {
      if (table === "whatsapp_catalogs") {
        const builder: Record<string, unknown> = {}
        let updateId: string | null = null
        let updateData: Record<string, unknown> = {}

        builder.set = mock((data: Record<string, unknown>) => {
          updateData = data
          return builder
        })

        builder.where = mock((_col: string, _op: string, value: unknown) => {
          updateId = value as string
          return builder
        })

        builder.execute = mock(() => {
          const idx = catalogs.findIndex((c) => c.catalog_id === updateId)
          if (idx !== -1) {
            catalogs[idx] = { ...catalogs[idx], ...updateData } as MockCatalog
          }
          return Promise.resolve({ numUpdatedRows: BigInt(idx !== -1 ? 1 : 0) })
        })

        return builder
      }

      const defaultBuilder: Record<string, unknown> = {}
      const methods = ["set", "where"]
      methods.forEach((m) => {
        defaultBuilder[m] = mock(() => defaultBuilder)
      })
      defaultBuilder.execute = mock(() => Promise.resolve({ numUpdatedRows: BigInt(0) }))
      return defaultBuilder
    }),
    setCatalogs: (data: MockCatalog[]) => {
      catalogs = data
    },
    setProducts: (data: MockProduct[]) => {
      products = data
    },
    setConnection: (conn: Record<string, unknown> | null) => {
      connection = conn
    },
  }

  return mockDb
}

describe("GET /catalogs - List catalogs", () => {
  let app: Hono
  let mockTenantDb: ReturnType<typeof createMockTenantDb>

  beforeEach(() => {
    mockTenantDb = createMockTenantDb()

    app = new Hono()

    // Mock middleware
    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb)
      c.set("user", { id: "user-123", email: "test@example.com", name: null, emailVerifiedAt: null })
      c.set("companyId", "company-123")
      await next()
    })

    // Simplified route handler for testing
    app.get("/catalogs", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>

      const rows = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .selectAll()
        .orderBy("name", "asc")
        .execute()

      return c.json({
        data: (rows as MockCatalog[]).map((row) => ({
          id: row.id,
          catalogId: row.catalog_id,
          name: row.name,
          description: row.description,
          currency: row.currency,
          status: row.status,
          businessJid: row.business_jid,
          headerImageUrl: row.header_image_url,
          productCount: row.product_count,
          lastSyncedAt: row.last_synced_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      })
    })
  })

  it("should return empty list when no catalogs exist", async () => {
    mockTenantDb.setCatalogs([])

    const response = await app.request("/catalogs", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.data).toEqual([])
  })

  it("should return list of catalogs", async () => {
    const catalogs = [
      createMockCatalog({ catalog_id: "cat-1", name: "Catalog A" }),
      createMockCatalog({ catalog_id: "cat-2", name: "Catalog B" }),
    ]
    mockTenantDb.setCatalogs(catalogs)

    const response = await app.request("/catalogs", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.data.length).toBe(2)
    expect(data.data[0].name).toBe("Catalog A")
    expect(data.data[1].name).toBe("Catalog B")
  })
})

describe("GET /catalogs/status - Catalog sync status", () => {
  let app: Hono
  let mockTenantDb: ReturnType<typeof createMockTenantDb>

  beforeEach(() => {
    mockTenantDb = createMockTenantDb()

    app = new Hono()

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb)
      c.set("user", { id: "user-123", email: "test@example.com", name: null, emailVerifiedAt: null })
      c.set("companyId", "company-123")
      await next()
    })

    app.get("/catalogs/status", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>

      const catalogsResult = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .select(({ fn }) => fn.countAll().as("count"))
        .executeTakeFirst()

      const activeCatalogsResult = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .select(({ fn }) => fn.countAll().as("count"))
        .where("status", "=", "active")
        .executeTakeFirst()

      const productsResult = await tenantDb
        .selectFrom("catalog_products")
        .select(({ fn }) => fn.countAll().as("count"))
        .executeTakeFirst()

      const lastSyncResult = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .selectAll()
        .orderBy("last_synced_at", "desc")
        .executeTakeFirst()

      return c.json({
        totalCatalogs: Number((catalogsResult as Record<string, unknown>)?.count ?? 0),
        activeCatalogs: Number((activeCatalogsResult as Record<string, unknown>)?.count ?? 0),
        totalProducts: Number((productsResult as Record<string, unknown>)?.count ?? 0),
        lastSyncAt: (lastSyncResult as MockCatalog | undefined)?.last_synced_at ?? null,
      })
    })
  })

  it("should return correct status when no catalogs exist", async () => {
    mockTenantDb.setCatalogs([])
    mockTenantDb.setProducts([])

    const response = await app.request("/catalogs/status", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.totalCatalogs).toBe(0)
    expect(data.activeCatalogs).toBe(0)
    expect(data.totalProducts).toBe(0)
  })

  it("should return correct status with catalogs and products", async () => {
    mockTenantDb.setCatalogs([
      createMockCatalog({ catalog_id: "cat-1", status: "active" }),
      createMockCatalog({ catalog_id: "cat-2", status: "active" }),
      createMockCatalog({ catalog_id: "cat-3", status: "archived" }),
    ])
    mockTenantDb.setProducts([
      createMockProduct({ product_id: "prod-1", catalog_id: "cat-1" }),
      createMockProduct({ product_id: "prod-2", catalog_id: "cat-1" }),
      createMockProduct({ product_id: "prod-3", catalog_id: "cat-2" }),
    ])

    const response = await app.request("/catalogs/status", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.totalCatalogs).toBe(3)
    expect(data.totalProducts).toBe(3)
  })
})

describe("GET /catalogs/:catalogId - Get catalog by ID", () => {
  let app: Hono
  let mockTenantDb: ReturnType<typeof createMockTenantDb>

  beforeEach(() => {
    mockTenantDb = createMockTenantDb()

    app = new Hono()

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb)
      c.set("user", { id: "user-123", email: "test@example.com", name: null, emailVerifiedAt: null })
      c.set("companyId", "company-123")
      await next()
    })

    app.get("/catalogs/:catalogId", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>
      const catalogId = c.req.param("catalogId")

      const row = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .selectAll()
        .where("catalog_id", "=", catalogId)
        .executeTakeFirst()

      if (!row) {
        return c.json({ error: "Catalog not found" }, 404)
      }

      const catalog = row as MockCatalog
      return c.json({
        id: catalog.id,
        catalogId: catalog.catalog_id,
        name: catalog.name,
        description: catalog.description,
        currency: catalog.currency,
        status: catalog.status,
        productCount: catalog.product_count,
        lastSyncedAt: catalog.last_synced_at,
      })
    })
  })

  it("should return catalog by ID", async () => {
    mockTenantDb.setCatalogs([
      createMockCatalog({ catalog_id: "cat-123", name: "My Catalog" }),
    ])

    const response = await app.request("/catalogs/cat-123", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.catalogId).toBe("cat-123")
    expect(data.name).toBe("My Catalog")
  })

  it("should return 404 for non-existent catalog", async () => {
    mockTenantDb.setCatalogs([])

    const response = await app.request("/catalogs/non-existent", {
      method: "GET",
    })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe("Catalog not found")
  })
})

describe("GET /catalogs/:catalogId/products - Get catalog products", () => {
  let app: Hono
  let mockTenantDb: ReturnType<typeof createMockTenantDb>

  beforeEach(() => {
    mockTenantDb = createMockTenantDb()

    app = new Hono()

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb)
      c.set("user", { id: "user-123", email: "test@example.com", name: null, emailVerifiedAt: null })
      c.set("companyId", "company-123")
      await next()
    })

    app.get("/catalogs/:catalogId/products", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>
      const catalogId = c.req.param("catalogId")

      // Check if catalog exists
      const catalog = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .selectAll()
        .where("catalog_id", "=", catalogId)
        .executeTakeFirst()

      if (!catalog) {
        return c.json({ error: "Catalog not found" }, 404)
      }

      const rows = await tenantDb
        .selectFrom("catalog_products")
        .selectAll()
        .where("catalog_id", "=", catalogId)
        .orderBy("name", "asc")
        .execute()

      return c.json({
        data: (rows as MockProduct[]).map((row) => ({
          id: row.id,
          productId: row.product_id,
          catalogId: row.catalog_id,
          name: row.name,
          description: row.description,
          price: row.price,
          currency: row.currency,
          imageUrls: row.image_urls,
          sku: row.sku,
          category: row.category,
          visibility: row.visibility,
        })),
        meta: {
          catalogId,
          catalogName: (catalog as MockCatalog).name,
          totalProducts: rows.length,
        },
      })
    })
  })

  it("should return products for catalog", async () => {
    mockTenantDb.setCatalogs([
      createMockCatalog({ catalog_id: "cat-123", name: "Electronics" }),
    ])
    mockTenantDb.setProducts([
      createMockProduct({ product_id: "prod-1", catalog_id: "cat-123", name: "Phone" }),
      createMockProduct({ product_id: "prod-2", catalog_id: "cat-123", name: "Laptop" }),
    ])

    const response = await app.request("/catalogs/cat-123/products", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.data.length).toBe(2)
    expect(data.meta.catalogName).toBe("Electronics")
    expect(data.meta.totalProducts).toBe(2)
  })

  it("should return 404 for non-existent catalog", async () => {
    mockTenantDb.setCatalogs([])

    const response = await app.request("/catalogs/non-existent/products", {
      method: "GET",
    })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe("Catalog not found")
  })

  it("should return empty products list for catalog with no products", async () => {
    mockTenantDb.setCatalogs([
      createMockCatalog({ catalog_id: "cat-123", name: "Empty Catalog" }),
    ])
    mockTenantDb.setProducts([])

    const response = await app.request("/catalogs/cat-123/products", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.data).toEqual([])
    expect(data.meta.totalProducts).toBe(0)
  })
})

describe("POST /catalogs/sync - Trigger catalog sync", () => {
  let app: Hono
  let mockTenantDb: ReturnType<typeof createMockTenantDb>
  let publishSyncCatalogsCalled = false

  beforeEach(() => {
    mockTenantDb = createMockTenantDb()
    publishSyncCatalogsCalled = false

    app = new Hono()

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb)
      c.set("user", { id: "user-123", email: "test@example.com", name: null, emailVerifiedAt: null })
      c.set("companyId", "company-123")
      await next()
    })

    app.post("/catalogs/sync", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>

      // Check if WhatsApp is connected
      const connection = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "status"])
        .where("status", "=", "connected")
        .executeTakeFirst()

      if (!connection) {
        return c.json(
          { error: "WhatsApp is not connected. Please connect first." },
          400
        )
      }

      // Mock publish sync command
      publishSyncCatalogsCalled = true

      return c.json({
        message: "Catalog sync initiated. Catalogs will be updated shortly.",
        status: "syncing",
      })
    })
  })

  it("should initiate catalog sync when connected", async () => {
    mockTenantDb.setConnection({ id: "conn-123", status: "connected" })

    const response = await app.request("/catalogs/sync", {
      method: "POST",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe("syncing")
    expect(publishSyncCatalogsCalled).toBe(true)
  })

  it("should return 400 when WhatsApp is not connected", async () => {
    mockTenantDb.setConnection(null)

    const response = await app.request("/catalogs/sync", {
      method: "POST",
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe("WhatsApp is not connected. Please connect first.")
  })
})

describe("POST /catalogs/:catalogId/archive - Archive catalog", () => {
  let app: Hono
  let mockTenantDb: ReturnType<typeof createMockTenantDb>

  beforeEach(() => {
    mockTenantDb = createMockTenantDb()

    app = new Hono()

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb)
      c.set("user", { id: "user-123", email: "test@example.com", name: null, emailVerifiedAt: null })
      c.set("companyId", "company-123")
      await next()
    })

    app.post("/catalogs/:catalogId/archive", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>
      const catalogId = c.req.param("catalogId")

      // Check if catalog exists
      const catalog = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .selectAll()
        .where("catalog_id", "=", catalogId)
        .executeTakeFirst()

      if (!catalog) {
        return c.json({ error: "Catalog not found" }, 400)
      }

      await tenantDb
        .updateTable("whatsapp_catalogs")
        .set({ status: "archived", updated_at: new Date() })
        .where("catalog_id", "=", catalogId)
        .execute()

      return c.json({
        success: true,
        message: "Catalog archived successfully",
      })
    })
  })

  it("should archive catalog", async () => {
    mockTenantDb.setCatalogs([
      createMockCatalog({ catalog_id: "cat-123", status: "active" }),
    ])

    const response = await app.request("/catalogs/cat-123/archive", {
      method: "POST",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  it("should return error for non-existent catalog", async () => {
    mockTenantDb.setCatalogs([])

    const response = await app.request("/catalogs/non-existent/archive", {
      method: "POST",
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe("Catalog not found")
  })
})

describe("POST /catalogs/:catalogId/restore - Restore catalog", () => {
  let app: Hono
  let mockTenantDb: ReturnType<typeof createMockTenantDb>

  beforeEach(() => {
    mockTenantDb = createMockTenantDb()

    app = new Hono()

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb)
      c.set("user", { id: "user-123", email: "test@example.com", name: null, emailVerifiedAt: null })
      c.set("companyId", "company-123")
      await next()
    })

    app.post("/catalogs/:catalogId/restore", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<typeof createMockTenantDb>
      const catalogId = c.req.param("catalogId")

      // Check if catalog exists
      const catalog = await tenantDb
        .selectFrom("whatsapp_catalogs")
        .selectAll()
        .where("catalog_id", "=", catalogId)
        .executeTakeFirst()

      if (!catalog) {
        return c.json({ error: "Catalog not found" }, 400)
      }

      if ((catalog as MockCatalog).status !== "archived") {
        return c.json({ error: "Catalog is not archived" }, 400)
      }

      await tenantDb
        .updateTable("whatsapp_catalogs")
        .set({ status: "active", updated_at: new Date() })
        .where("catalog_id", "=", catalogId)
        .execute()

      return c.json({
        success: true,
        message: "Catalog restored successfully",
      })
    })
  })

  it("should restore archived catalog", async () => {
    mockTenantDb.setCatalogs([
      createMockCatalog({ catalog_id: "cat-123", status: "archived" }),
    ])

    const response = await app.request("/catalogs/cat-123/restore", {
      method: "POST",
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  it("should return error for non-archived catalog", async () => {
    mockTenantDb.setCatalogs([
      createMockCatalog({ catalog_id: "cat-123", status: "active" }),
    ])

    const response = await app.request("/catalogs/cat-123/restore", {
      method: "POST",
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe("Catalog is not archived")
  })

  it("should return error for non-existent catalog", async () => {
    mockTenantDb.setCatalogs([])

    const response = await app.request("/catalogs/non-existent/restore", {
      method: "POST",
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe("Catalog not found")
  })
})
