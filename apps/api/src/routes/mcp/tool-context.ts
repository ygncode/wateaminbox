import type { Context } from "hono";
import type { ZodRawShape } from "zod";
import { AppError } from "../../lib/errors.js";
import { getRouteContext } from "../../middleware/context.js";
import type { Permission } from "../../services/permission.service.js";

/**
 * A single MCP tool backed by the same services the REST routes use.
 * `scope` gates registration by token scope; `permission` is re-checked
 * against the owner's live workspace permissions on every call.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  scope: "read" | "write";
  permission?: Permission;
  // Method syntax keeps parameter bivariance so each tool can type its own args.
  // biome-ignore lint/suspicious/noExplicitAny: args are validated by inputSchema at the protocol layer
  handler(args: any, c: Context): Promise<unknown>;
}

export class McpToolError extends Error {}

/** Throws unless the token owner currently holds the permission. */
export function requirePermission(c: Context, permission: Permission): void {
  const { permissions } = getRouteContext(c);
  if (permissions[permission] !== true) {
    throw new McpToolError(
      `Your workspace role does not grant the '${permission}' permission required by this tool`,
    );
  }
}

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;
export const MAX_TEXT_LENGTH = 2000;

export function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIST_LIMIT;
  return Math.min(limit, MAX_LIST_LIMIT);
}

export function truncateText(text: string | null): {
  text: string | null;
  truncated?: boolean;
} {
  if (text && text.length > MAX_TEXT_LENGTH) {
    return { text: text.slice(0, MAX_TEXT_LENGTH), truncated: true };
  }
  return { text };
}

/** Maps thrown errors to a safe, agent-readable message. */
export function toToolErrorMessage(error: unknown): string {
  if (error instanceof McpToolError) {
    return error.message;
  }
  if (error instanceof AppError) {
    return error.message;
  }
  return "The tool call failed due to an internal error";
}
