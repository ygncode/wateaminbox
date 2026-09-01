import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import { mcpAuthMiddleware } from "../../middleware/mcp-auth.js";
import { createConditionalRateLimiter } from "../../middleware/rate-limit.js";
import {
  type McpToolDefinition,
  requirePermission,
  toToolErrorMessage,
} from "./tool-context.js";
import { readTools } from "./tools/read.js";
import { writeTools } from "./tools/write.js";

export const mcpRoutes = new Hono();

mcpRoutes.use("/*", mcpAuthMiddleware);

// Keyed by token id so each token gets its own budget.
const mcpRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.resource.mcp,
    keyStrategy: "user",
    keyPrefix: "resource-mcp",
    generateKey: (c) => c.get("apiToken")?.id ?? "unknown",
  },
  rateLimitConfig.enabled,
);

const ALL_TOOLS: McpToolDefinition[] = [...readTools, ...writeTools];

/**
 * POST /mcp - Stateless Streamable HTTP MCP endpoint.
 *
 * A fresh server + transport is created per request: tool listing is
 * filtered by the token's scopes, and permissions are re-checked live in
 * each tool call. Statelessness keeps every exchange a short POST, which
 * is required behind the cloud gateway's 90s upstream timeout.
 */
/**
 * Advertised to clients in the initialize response.
 *
 * Bump this whenever the tool surface changes. Clients cache the tool list, and
 * at least one keeps serving a stale one after a reconnect and a fresh
 * authorization - a version that never moves gives them no reason to refetch.
 * mcp-server-version.test.ts fails when the tools change without this changing,
 * so it cannot be forgotten silently.
 */
export const MCP_SERVER_VERSION = "1.1.0";

mcpRoutes.post("/", mcpRateLimiter, async (c) => {
  const scopes = c.get("apiToken").scopes;

  const server = new McpServer({
    name: "wateaminbox",
    version: MCP_SERVER_VERSION,
  });

  for (const tool of ALL_TOOLS) {
    if (!scopes.includes(tool.scope)) {
      continue;
    }
    // The SDK's registerTool generics blow up TS instantiation depth on a
    // dynamic ZodRawShape; validation still happens at runtime.
    const registerTool = server.registerTool.bind(server) as (
      name: string,
      config: unknown,
      cb: unknown,
    ) => void;
    registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, never>) => {
        try {
          if (tool.permission) {
            requirePermission(c, tool.permission);
          }
          const result = await tool.handler(args, c);
          // Postgres counts surface as BigInt; JSON.stringify throws on them.
          const text = JSON.stringify(result, (_key, value) =>
            typeof value === "bigint" ? Number(value) : value,
          );
          return {
            content: [{ type: "text" as const, text }],
          };
        } catch (error) {
          return {
            content: [
              { type: "text" as const, text: toToolErrorMessage(error) },
            ],
            isError: true,
          };
        }
      },
    );
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// Stateless mode: no SSE stream or session lifecycle endpoints.
mcpRoutes.get("/", (c) =>
  c.json(
    { error: "Method Not Allowed", message: "Use POST (stateless MCP)" },
    405,
  ),
);
mcpRoutes.delete("/", (c) =>
  c.json(
    { error: "Method Not Allowed", message: "Use POST (stateless MCP)" },
    405,
  ),
);
