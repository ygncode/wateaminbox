/**
 * WhatsApp API
 * WhatsApp connection management API functions
 */

import { fetchWithAuth } from "./client.js";
import type {
  WhatsAppConnection,
  WhatsAppConnectionStatus,
  WhatsAppConnectResponse,
} from "./types.js";

// Single connection API (legacy)
export async function connectWhatsApp(): Promise<WhatsAppConnectResponse> {
  return fetchWithAuth<WhatsAppConnectResponse>("/whatsapp/connect", {
    method: "POST",
  });
}

export async function disconnectWhatsApp(): Promise<{ message: string }> {
  return fetchWithAuth<{ message: string }>("/whatsapp/disconnect", {
    method: "POST",
  });
}

export async function getWhatsAppStatus(): Promise<WhatsAppConnectionStatus> {
  return fetchWithAuth<WhatsAppConnectionStatus>("/whatsapp/status");
}

// Multi-connection API
export async function listWhatsAppConnections(): Promise<WhatsAppConnection[]> {
  // Note: fetchWithAuth already unwraps { success, data } format
  // So response is already the array of connections
  return fetchWithAuth<WhatsAppConnection[]>("/whatsapp/connections");
}

export async function getWhatsAppConnection(
  connectionId: string,
): Promise<WhatsAppConnection> {
  // Note: fetchWithAuth already unwraps { success, data } format
  return fetchWithAuth<WhatsAppConnection>(
    `/whatsapp/connections/${connectionId}`,
  );
}

export async function createWhatsAppConnection(
  name?: string,
): Promise<WhatsAppConnection> {
  // Note: fetchWithAuth already unwraps { success, data } format
  return fetchWithAuth<WhatsAppConnection>("/whatsapp/connections", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function reconnectWhatsAppConnection(
  connectionId: string,
): Promise<{ message: string }> {
  return fetchWithAuth<{ message: string }>(
    `/whatsapp/connections/${connectionId}/reconnect`,
    {
      method: "POST",
    },
  );
}

export async function disconnectWhatsAppConnection(
  connectionId: string,
): Promise<{ message: string }> {
  return fetchWithAuth<{ message: string }>(
    `/whatsapp/connections/${connectionId}/disconnect`,
    {
      method: "POST",
    },
  );
}

export async function deleteWhatsAppConnection(
  connectionId: string,
): Promise<{ message: string }> {
  return fetchWithAuth<{ message: string }>(
    `/whatsapp/connections/${connectionId}`,
    {
      method: "DELETE",
    },
  );
}

export async function updateWhatsAppConnection(
  connectionId: string,
  data: { name?: string },
): Promise<WhatsAppConnection> {
  // Note: fetchWithAuth already unwraps { success, data } format
  return fetchWithAuth<WhatsAppConnection>(
    `/whatsapp/connections/${connectionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}
