import { z } from "zod";

/**
 * Zod v3 validated with new URL(value) but returned the original string. Zod v4
 * also strips whitespace/control characters. Keep the existing wire value;
 * protocol/host restrictions still belong to each caller (e.g. Web Push).
 */
export const urlStringSchema = z
  .string()
  .refine((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }, "Invalid url")
  .meta({ format: "uri" });

// Keep the v3 datetime contract: optional seconds and (where enabled) basic
// or colon-separated offsets. v4's RFC 3339 validator requires seconds and a
// colon in offsets. Calendar dates and clock times remain validated; these
// schemas do not normalize the caller's string or replace scheduling policy.
// Explicit format metadata preserves v3's advertised JSON Schema annotations;
// it does not replace these runtime checks or tighten the legacy wire contract.
const date = z.regexes.date.source.slice(1, -1);
const time = "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?";
export const utcDateTimeSchema = z
  .string()
  .regex(new RegExp(`^${date}T${time}Z$`), "Invalid datetime")
  .meta({ format: "date-time" });
export const offsetDateTimeSchema = z
  .string()
  .regex(
    new RegExp(`^${date}T${time}(?:Z|[+-]\\d{2}:?\\d{2})$`),
    "Invalid datetime",
  )
  .meta({ format: "date-time" });
