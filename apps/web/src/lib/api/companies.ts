/**
 * Companies API
 * Company management API functions
 */

import { fetchWithAuth } from "./client.js";
import type { CompanyWithRole } from "./types.js";

// Coalesce concurrent callers onto a single in-flight request. On a cold boot
// the workspace list is otherwise fetched only after /me resolves, so the auth
// sequence runs serially: refresh -> me -> companies -> inbox data. The auth
// bootstrap prewarms this the moment the access token is ready (see
// prewarmUserCompanies), and WorkspaceProvider's own call - which still waits
// for /me - then attaches to that already-running request instead of starting
// a second, serial one. Cleared on settle, so later refreshes (e.g. a
// workspace switch) always fetch fresh.
let inFlight: Promise<CompanyWithRole[]> | null = null;

export async function getUserCompanies(): Promise<CompanyWithRole[]> {
  if (inFlight) return inFlight;
  const request = fetchWithAuth<CompanyWithRole[]>("/companies");
  inFlight = request;
  try {
    return await request;
  } finally {
    if (inFlight === request) inFlight = null;
  }
}

/**
 * Start loading the workspace list without awaiting it, so it runs in parallel
 * with /me during the cold-boot auth sequence. Call only once the access token
 * is available. Errors are swallowed here; the real consumer (WorkspaceProvider)
 * surfaces them when it awaits the coalesced request.
 */
export function prewarmUserCompanies(): void {
  void getUserCompanies().catch(() => undefined);
}
