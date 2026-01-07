/**
 * Companies API
 * Company management API functions
 */

import { fetchWithAuth } from "./client.js"
import type { CompanyWithRole } from "./types.js"

export async function getUserCompanies(): Promise<CompanyWithRole[]> {
  // fetchWithAuth automatically unwraps the { success, data } response
  return fetchWithAuth<CompanyWithRole[]>("/companies")
}
