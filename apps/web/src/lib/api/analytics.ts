/**
 * Analytics API
 * Response time analytics and SLA breach API functions
 */

import { fetchWithAuth } from "./client.js";
import type {
  ResponseTimeByDate,
  ResponseTimeStats,
  SlaBreach,
  TeamResponseTimeStats,
} from "./types.js";

export async function getResponseTimeStats(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number,
): Promise<
  ResponseTimeStats & {
    meta: { startDate: string; endDate: string; slaThresholdMinutes: number };
  }
> {
  const params = new URLSearchParams();
  if (startDate) params.append("startDate", startDate.toISOString());
  if (endDate) params.append("endDate", endDate.toISOString());
  if (slaThreshold) params.append("slaThreshold", String(slaThreshold));

  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchWithAuth(`/analytics/response-time${query}`);
}

export async function getResponseTimeTrend(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number,
): Promise<{
  trend: ResponseTimeByDate[];
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number };
}> {
  const params = new URLSearchParams();
  if (startDate) params.append("startDate", startDate.toISOString());
  if (endDate) params.append("endDate", endDate.toISOString());
  if (slaThreshold) params.append("slaThreshold", String(slaThreshold));

  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchWithAuth(`/analytics/response-time/trend${query}`);
}

export async function getTeamResponseTimeStats(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number,
): Promise<{
  stats: TeamResponseTimeStats[];
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number };
}> {
  const params = new URLSearchParams();
  if (startDate) params.append("startDate", startDate.toISOString());
  if (endDate) params.append("endDate", endDate.toISOString());
  if (slaThreshold) params.append("slaThreshold", String(slaThreshold));

  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchWithAuth(`/analytics/response-time/team${query}`);
}

export async function getSlaBreaches(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number,
  limit?: number,
): Promise<{
  breaches: SlaBreach[];
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number };
}> {
  const params = new URLSearchParams();
  if (startDate) params.append("startDate", startDate.toISOString());
  if (endDate) params.append("endDate", endDate.toISOString());
  if (slaThreshold) params.append("slaThreshold", String(slaThreshold));
  if (limit) params.append("limit", String(limit));

  const query = params.toString() ? `?${params.toString()}` : "";
  return fetchWithAuth(`/analytics/sla-breaches${query}`);
}
