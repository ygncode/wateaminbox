import { env } from "../lib/env.js";
import { signConnectionAdmissionRequest } from "./connection-admission-signature.js";
import { normalizeWhatsAppPhone } from "./whatsapp/status.js";

const REQUEST_TIMEOUT_MS = 3_000;

export type ConnectionAdmissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: string;
      message: string;
      paymentRequired: boolean;
    };

function deniedResponse(payload: unknown): ConnectionAdmissionDecision {
  if (!payload || typeof payload !== "object") {
    throw new Error("Connection admission returned an invalid denial");
  }
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
    throw new Error("Connection admission returned an invalid denial");
  }
  return {
    allowed: false,
    code: candidate.code,
    message: candidate.message,
    paymentRequired: true,
  };
}

export async function admitConnectedPhone(input: {
  companyId: string;
  phoneNumber: string;
}): Promise<ConnectionAdmissionDecision> {
  if (!env.CONNECTION_ADMISSION_URL) return { allowed: true };

  const phoneNumber = normalizeWhatsAppPhone(input.phoneNumber);
  if (!/^\d{5,20}$/.test(phoneNumber)) {
    throw new Error("WhatsApp returned an invalid phone identity");
  }
  const body = JSON.stringify({ companyId: input.companyId, phoneNumber });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signConnectionAdmissionRequest(
    env.JWT_SECRET,
    timestamp,
    body,
  );
  const response = await fetch(env.CONNECTION_ADMISSION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wateaminbox-timestamp": timestamp,
      "x-wateaminbox-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.ok) {
    const payload = await response.json().catch(() => null);
    if (
      !payload ||
      typeof payload !== "object" ||
      (payload as Record<string, unknown>).allowed !== true
    ) {
      throw new Error("Connection admission returned an invalid approval");
    }
    return { allowed: true };
  }
  if (response.status === 402) {
    return deniedResponse(await response.json().catch(() => null));
  }
  throw new Error(`Connection admission failed with HTTP ${response.status}`);
}
