/**
 * Analytics API
 * Response time analytics and SLA breach API functions
 */

import { fetchWithAuth } from "./client.js";
import type {
  ResponseTimeStats,
  ResponseTimeByDate,
  TeamResponseTimeStats,
  SlaBreach,
} from "./types.js";

export async function getResponseTimeStats(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number,
): Promise<{
  data: ResponseTimeStats;
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number };
}> {
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
  data: ResponseTimeByDate[];
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
  data: TeamResponseTimeStats[];
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
  data: SlaBreach[];
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
