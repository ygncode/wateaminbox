import type { MessageType } from "./message";

/**
 * Bulk broadcast job types. A bulk job is the parent of one scheduled_messages
 * leaf per recipient; job progress is always derived from leaf states, never
 * stored counters (total/skipped are immutable snapshot facts, not progress).
 */

/**
 * "completed" means every snapshotted recipient was handed to the send
 * pipeline. "completed_with_errors" is the honest partial outcome: at least
 * one recipient failed or was skipped (at snapshot or at dispatch).
 */
export type BulkJobStatus =
  | "scheduled"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "canceled";

/**
 * The audience definition captured at job creation. Recipients are the union
 * of contacts carrying any of tagIds and the explicit contactIds, optionally
 * restricted to a single WhatsApp connection.
 */
export interface BulkJobAudience {
  tagIds: string[];
  contactIds: string[];
  /** Restrict recipients to contacts on this WhatsApp connection. */
  connectionId?: string;
}

/** Why a resolved audience member did not receive (or will not receive) a send. */
export type BulkRecipientSkipReason =
  | "no_jid"
  | "no_connection"
  | "connection_archived"
  | "connection_filtered"
  | "connection_changed"
  | "blocked"
  | "is_group"
  | "duplicate_jid"
  | "contact_missing";

/** Per-recipient leaf counts, derived from scheduled_messages states. */
export interface BulkJobProgress {
  total: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  canceled: number;
  skipped: number;
}

export interface BulkJob {
  id: string;
  name: string;
  status: BulkJobStatus;
  content: string;
  messageType: MessageType;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  audience: BulkJobAudience;
  scheduledAt: string;
  totalRecipients: number;
  progress: BulkJobProgress;
  createdBy: string;
  createdByName?: string;
  canceledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One row of the job detail's paginated recipient outcomes. */
export interface BulkJobRecipient {
  id: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  skipReason: string | null;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
}

/** Preview of the audience a job would snapshot right now. */
export interface BulkJobPreview {
  /** Recipients that will get a leaf eligible for sending. */
  recipientCount: number;
  /** Resolved audience members that will be snapshotted as skipped. */
  skippedCount: number;
  perConnection: Array<{
    connectionId: string;
    connectionName: string | null;
    recipientCount: number;
  }>;
  skippedByReason: Partial<Record<BulkRecipientSkipReason, number>>;
  /**
   * Deterministic hash of the eligible recipient set. Passing it to create
   * guards against audience drift between preview and confirmation.
   */
  audienceHash: string;
  /** Conservative estimate assuming the configured per-connection pacing. */
  estimatedDurationSeconds: number;
  /** Effective pacing/caps so the UI can explain the estimate. */
  limits: {
    sendIntervalSeconds: number;
    maxRecipientsPerJob: number;
    dailyCapPerConnection: number;
  };
}
