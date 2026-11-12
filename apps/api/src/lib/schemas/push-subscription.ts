import { z } from "zod";
import { urlStringSchema } from "./string-contracts.js";

const endpointSchema = urlStringSchema.max(4096).refine((value) => {
  // Refinements can run after a failed format check; never throw on input.
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}, "Push endpoint must use HTTPS");

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(1024),
    auth: z.string().min(1).max(1024),
  }),
});

export const deletePushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
});
