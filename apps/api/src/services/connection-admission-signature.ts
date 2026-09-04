import { createHmac } from "node:crypto";

const SIGNATURE_VERSION = "wateaminbox-connection-admission-v1";

export function signConnectionAdmissionRequest(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION}\n${timestamp}\n${body}`)
    .digest("hex");
}
