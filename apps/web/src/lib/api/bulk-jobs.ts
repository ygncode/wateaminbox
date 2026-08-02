/**
 * Bulk Broadcast Jobs API
 * Preview an audience, create a broadcast job, inspect progress, reschedule, cancel.
 */

import type {
  BulkJob,
  BulkJobAudience,
  BulkJobPreview,
  BulkJobRecipient,
} from "@wateaminbox/shared";
import { buildQueryString, fetchWithAuth } from "./client.js";

export interface PreviewBulkJobInput {
  audience: BulkJobAudience;
  content?: string;
}

export interface CreateBulkJobInput {
  name: string;
  audience: BulkJobAudience;
  /** Message text/caption; supports {{name}} and {{firstName}}. */
  content: string;
  messageType?: "text" | "image" | "video" | "document";
  /** Presigned URL from POST /media/upload; required for media types. */
  mediaUrl?: string;
  /** ISO 8601 timestamp for when sending should begin. */
  scheduledAt: string;
  /** Hash from the preview; the server rejects a drifted audience with 409. */
  audienceHash: string;
  /** Client-generated key making retries return the original job. */
  idempotencyKey: string;
}

export interface BulkJobListPage {
  data: BulkJob[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface BulkJobRecipientsPage {
  data: BulkJobRecipient[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export async function previewBulkJob(
  input: PreviewBulkJobInput,
): Promise<BulkJobPreview> {
  return fetchWithAuth<BulkJobPreview>("/bulk-jobs/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createBulkJob(
  input: CreateBulkJobInput,
): Promise<BulkJob> {
  return fetchWithAuth<BulkJob>("/bulk-jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getBulkJobs(params: {
  limit?: number;
  offset?: number;
}): Promise<BulkJobListPage> {
  return fetchWithAuth<BulkJobListPage>(
    `/bulk-jobs${buildQueryString(params)}`,
  );
}

export async function getBulkJob(id: string): Promise<BulkJob> {
  return fetchWithAuth<BulkJob>(`/bulk-jobs/${id}`);
}

export async function getBulkJobRecipients(
  id: string,
  params: { limit?: number; offset?: number; status?: string },
): Promise<BulkJobRecipientsPage> {
  return fetchWithAuth<BulkJobRecipientsPage>(
    `/bulk-jobs/${id}/recipients${buildQueryString(params)}`,
  );
}

export async function rescheduleBulkJob(
  id: string,
  scheduledAt: string,
): Promise<BulkJob> {
  return fetchWithAuth<BulkJob>(`/bulk-jobs/${id}/schedule`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledAt }),
  });
}

export async function cancelBulkJob(
  id: string,
): Promise<{ canceledLeaves: number; stillProcessing: number }> {
  return fetchWithAuth<{ canceledLeaves: number; stillProcessing: number }>(
    `/bulk-jobs/${id}/cancel`,
    { method: "POST" },
  );
}
