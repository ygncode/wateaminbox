/**
 * The version advertised to MCP clients in the initialize response.
 *
 * Bump this whenever the tool surface changes. Clients cache the tool list, and
 * at least one keeps serving a stale one after a reconnect and a fresh
 * authorization - a version that never moves gives them no reason to refetch.
 * mcp-server-version.test.ts fails when the tools change without this changing,
 * so it cannot be forgotten silently.
 *
 * It lives alone rather than in the route module because reading a constant
 * should not require importing that module's rate limiter and its database
 * work; a test that did so disturbed an unrelated concurrency test.
 */
export const MCP_SERVER_VERSION = "1.1.0";
