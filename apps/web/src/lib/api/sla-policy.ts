/**
 * SLA policy API
 * Versioned company SLA response-target policy management.
 */

import type { CreateSlaPolicyInput, SlaPolicy } from "@wateaminbox/shared";
import { api } from "./client";

export async function getCurrentSlaPolicy(
  companyId: string,
): Promise<SlaPolicy> {
  return api.get<SlaPolicy>(`/companies/${companyId}/sla-policy`);
}

export async function getSlaPolicyHistory(
  companyId: string,
): Promise<SlaPolicy[]> {
  return api.get<SlaPolicy[]>(`/companies/${companyId}/sla-policy/history`);
}

export async function createSlaPolicy(
  companyId: string,
  input: CreateSlaPolicyInput,
): Promise<SlaPolicy> {
  return api.post<SlaPolicy>(`/companies/${companyId}/sla-policy`, input);
}
