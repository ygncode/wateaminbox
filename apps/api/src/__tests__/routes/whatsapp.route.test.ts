
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { createMockQueryBuilder } from "../mocks";

// Create a mutable mock DB object that we can manipulate in tests
const mockTenantDb = {
  selectFrom: mock(() => createMockQueryBuilder([])),
  updateTable: mock(() => createMockQueryBuilder()),
  // Add other methods if needed
};

// Mock middlewares
mock.module("../../middleware/auth.js", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("user", { id: "user-123" });
    await next();
  },
}));

mock.module("../../middleware/tenant.js", () => ({
  tenantFromHeader: () => async (c: any, next: any) => {
    c.set("companyId", "company-123");
    // Inject our mock DB
    c.set("tenantDb", mockTenantDb);
    await next();
  },
}));

// Mock NATS
mock.module("../../lib/nats.js", () => ({
  publishCommand: mock(async () => {}),
  publishSpawnCommand: mock(async () => {}),
  publishKillCommand: mock(async () => {}),
  publishSendMessage: mock(async () => {}),
  getNatsConnection: mock(async () => ({ status: 'ok' })),
}));

// Mock logger
mock.module("../../lib/logger.js", () => ({
  createLogger: () => ({
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  }),
  formatError: (e: any) => e,
}));

// Mock rate limit middleware
mock.module("../../middleware/rate-limit.js", () => ({
  createRateLimitMiddleware: () => async (c: any, next: any) => await next(),
}));

// Mock rate limit store
mock.module("../../lib/rate-limit-store.js", () => ({
  rateLimitConfig: { enabled: false, tiers: { messaging: { whatsapp: {} } } },
  rateLimitStore: {},
}));

let whatsappRoutes: any;

describe("WhatsApp Route", () => {
  beforeEach(async () => {
    // Import the route handler dynamically to ensure mocks are applied
    const mod = await import("../../routes/whatsapp");
    whatsappRoutes = mod.whatsappRoutes;

    // Reset mocks
    mockTenantDb.selectFrom = mock(() => createMockQueryBuilder([]));
    
    // Setup updateTable mock to handle the chain
    // .updateTable().set().where().execute()
    const mockExecute = mock(() => Promise.resolve());
    const mockWhere = mock(() => ({ execute: mockExecute }));
    const mockSet = mock(() => ({ where: mockWhere }));
    mockTenantDb.updateTable = mock(() => ({ set: mockSet }));
  });

  it("should return active sync connections and filter out stale ones", async () => {
    const app = new Hono();
    app.route("/", whatsappRoutes);

    const now = new Date();
    const staleTime = new Date(now.getTime() - 10 * 60 * 1000); // 10 mins ago (stale)
    const activeTime = new Date(now.getTime() - 1 * 60 * 1000); // 1 min ago (active)

    const connections = [
      {
        id: "conn-active",
        name: "Active Connection",
        phone_number: "123",
        sync_status: "syncing",
        updated_at: activeTime,
      },
      {
        id: "conn-stale",
        name: "Stale Connection",
        phone_number: "456",
        sync_status: "syncing",
        updated_at: staleTime,
      },
    ];

    // Mock select query to return our connections
    mockTenantDb.selectFrom = mock(() => {
      const builder = createMockQueryBuilder(connections);
      // We need to ensure execute() returns the array
      builder.execute = mock(() => Promise.resolve(connections));
      return builder;
    });

    // Mock update query to capture calls
    const mockExecute = mock(() => Promise.resolve());
    const mockWhere = mock(() => ({ execute: mockExecute }));
    const mockSet = mock(() => ({ where: mockWhere }));
    mockTenantDb.updateTable = mock(() => ({ set: mockSet }));

    const req = new Request("http://localhost/sync-status", {
      headers: { "X-Company-ID": "company-123" },
    });
    const res = await app.request(req);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    
    // Should only contain the active connection
    expect(body.data.connections).toHaveLength(1);
    expect(body.data.connections[0].id).toBe("conn-active");
    expect(body.data.syncing).toBe(true);

    // Verify DB update was called
    expect(mockTenantDb.updateTable).toHaveBeenCalled();
    // In a real mock we could verify arguments, but here we just check it was called
    // because our mock setup is simple
  });

  it("should return empty list if all connections are stale", async () => {
    const app = new Hono();
    app.route("/", whatsappRoutes);

    const now = new Date();
    const staleTime = new Date(now.getTime() - 10 * 60 * 1000);

    const connections = [
      {
        id: "conn-stale",
        sync_status: "syncing",
        updated_at: staleTime,
      },
    ];

    mockTenantDb.selectFrom = mock(() => {
      const builder = createMockQueryBuilder(connections);
      builder.execute = mock(() => Promise.resolve(connections));
      return builder;
    });

    const req = new Request("http://localhost/sync-status", {
      headers: { "X-Company-ID": "company-123" },
    });
    const res = await app.request(req);
    const body = await res.json() as any;

    expect(body.data.connections).toHaveLength(0);
    expect(body.data.syncing).toBe(false);
  });
});
