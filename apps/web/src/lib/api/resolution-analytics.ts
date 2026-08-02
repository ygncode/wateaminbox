/**
 * Resolution (case-cycle) analytics API - business-minute resolution
 * duration/compliance, overdue active work, and team attribution.
 */

import { fetchWithAuth } from "./client.js";
import type {
  CaseResolutionStats,
  CaseResolutionTrendPoint,
  OverdueCase,
  TeamCaseResolutionStats,
} from "./types.js";

function dateRangeQuery(startDate?: Date, endDate?: Date): string {
  const params = new URLSearchParams();
  if (startDate) params.append("startDate", startDate.toISOString());
  if (endDate) params.append("endDate", endDate.toISOString());
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getCaseResolutionStats(
  startDate?: Date,
  endDate?: Date,
): Promise<CaseResolutionStats> {
  return fetchWithAuth(
    `/conversations/stats/resolution${dateRangeQuery(startDate, endDate)}`,
  );
}

export async function getCaseResolutionTrend(
  startDate?: Date,
  endDate?: Date,
): Promise<{
  trend: CaseResolutionTrendPoint[];
  meta: { startDate: string; endDate: string };
}> {
  return fetchWithAuth(
    `/conversations/stats/resolution-trend${dateRangeQuery(startDate, endDate)}`,
  );
}

export async function getTeamCaseResolutionStats(
  startDate?: Date,
  endDate?: Date,
): Promise<{
  stats: TeamCaseResolutionStats[];
  meta: { startDate: string; endDate: string };
}> {
  return fetchWithAuth(
    `/conversations/stats/resolution-team${dateRangeQuery(startDate, endDate)}`,
  );
}

export async function getOverdueActiveCases(): Promise<OverdueCase[]> {
  return fetchWithAuth("/conversations/stats/resolution-breaches");
}
