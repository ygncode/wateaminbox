/**
 * Search Panel Types
 *
 * Shared types used across search components.
 */

export type SearchTab = "all" | "messages" | "contacts";

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "location";

export type DateRange = "7d" | "30d" | "90d" | "all";
