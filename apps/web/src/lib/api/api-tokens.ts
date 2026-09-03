/**
 * API Tokens API
 * Personal MCP/API token management functions
 */

import { fetchWithAuth, buildQueryString } from "./client.js";
import type {
  ApiToken,
  ApiTokenWithSecret,
  ConnectedApp,
  CreateApiTokenInput,
} from "./types.js";

export async function getApiTokens(options?: {
  all?: boolean;
}): Promise<ApiToken[]> {
  const query = options?.all ? buildQueryString({ all: "true" }) : "";
  return fetchWithAuth<ApiToken[]>(`/api-tokens${query}`);
}

export async function createApiToken(
  input: CreateApiTokenInput,
): Promise<ApiTokenWithSecret> {
  return fetchWithAuth<ApiTokenWithSecret>("/api-tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  await fetchWithAuth<{ message: string }>(`/api-tokens/${tokenId}`, {
    method: "DELETE",
  });
}

export async function getConnectedApps(): Promise<ConnectedApp[]> {
  return fetchWithAuth<ConnectedApp[]>("/api-tokens/connected-apps");
}

export async function disconnectApp(grantId: string): Promise<void> {
  await fetchWithAuth<{ message: string }>(
    `/api-tokens/connected-apps/${grantId}`,
    { method: "DELETE" },
  );
}
