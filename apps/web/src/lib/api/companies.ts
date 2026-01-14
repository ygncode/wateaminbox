/**
 * Companies API
 * Company management API functions
 */

import { fetchWithAuth } from "./client.js";
import type { CompanyWithRole } from "./types.js";

export async function getUserCompanies(): Promise<CompanyWithRole[]> {
  const response = await fetchWithAuth<{ data: CompanyWithRole[] }>(
    "/companies",
  );
  return response.data;
}
