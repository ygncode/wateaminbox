import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ChatList } from "../../../apps/web/src/components/chat/ChatList";
import { TooltipProvider } from "../../../apps/web/src/components/ui/tooltip";
import { AuthProvider } from "../../../apps/web/src/contexts/auth-context";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../apps/web/src/contexts/workspace-context";
import { RealtimeProvider } from "../../../apps/web/src/contexts/RealtimeProvider";
import { invalidateChatList } from "../../../apps/web/src/contexts/realtime/cache-utils";
import { hasPendingInboxRefresh } from "../../../apps/web/src/contexts/realtime/inbox-refresh";
import { setAuthToken } from "../../../apps/web/src/lib/api/client";
import "../../../apps/web/src/lib/i18n";
import "./style.css";

const params = new URLSearchParams(location.search);
const total = Number(params.get("total") ?? 10000);
const channelTotal = Number(params.get("channels") ?? 0);
const delayMs = Number(params.get("delay") ?? 40);
const sparseUnread = params.get("sparseUnread") === "1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000002";
const channelId = "00000000-0000-4000-8000-000000000003";
const connection = {
  id: accountId,
  name: "Synthetic WhatsApp",
  phoneNumber: "65000000000",
  status: "connected",
};
const baseTime = Date.now();
type RequestMetric = {
  endpoint: string;
  offset: number;
  started: number;
  elapsedMs?: number;
  bytes?: number;
  aborted?: boolean;
};
const requests: RequestMetric[] = [];
const longTasks: number[] = [];
const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 300_000, retry: 1 } },
});

new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) longTasks.push(entry.duration);
}).observe({ type: "longtask", buffered: true });

function contact(index: number) {
  const id = `synthetic-${String(index).padStart(6, "0")}`;
  const timestamp = new Date(baseTime - index * 60_000).toISOString();
  return {
    id,
    jid: `${index}@s.whatsapp.net`,
    phoneNumber: `650${String(index).padStart(8, "0")}`,
    pushName: `Synthetic ${index}`,
    displayName: `Synthetic ${index}`,
    customName: null,
    isGroup: index % 10 === 0,
    profilePictureUrl: null,
    notesShared: null,
    lastMessageAt: timestamp,
    lastMessage: {
      id: `message-${id}`,
      messageId: `message-${id}`,
      fromMe: false,
      messageType: "text",
      content: "Synthetic benchmark preview. ".repeat(4),
      status: "delivered",
      timestamp,
      sentByUserId: null,
      sentByUserName: null,
    },
    unreadCount: sparseUnread
      ? index >= total - 10
        ? 1
        : 0
      : index % 10 === 0
        ? 1
        : 0,
    assignedTo: null,
    isOnline: false,
    lastSeen: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    connection,
    conversationStatus: "open",
    activeCaseId: null,
  };
}
function channel(index: number) {
  return {
    id: `channel-${index}`,
    channelAccountId: channelId,
    channel: "telegram",
    provider: "telegram_bot",
    kind: "direct",
    subject: `Channel ${index}`,
    externalThreadId: String(index),
    firstMessageAt: null,
    lastMessageAt: new Date(baseTime - (index + 0.5) * 60_000).toISOString(),
    lastMessagePreview: "Synthetic channel preview",
    unreadCount: 0,
    conversationStatus: "open",
    legacyContactId: null,
    account: {
      displayName: "Synthetic Telegram",
      username: null,
      status: "connected",
    },
    counterpart: null,
  };
}

// Synthetic responses are generated per page, not held as a giant fixture in
// memory. No backend, real credentials, customer data, or external fetches.
const syntheticFetch = async (
  input: Parameters<typeof window.fetch>[0],
  init?: Parameters<typeof window.fetch>[1],
) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    location.origin,
  );
  if (!url.pathname.startsWith("/api/"))
    throw new Error(`Unexpected benchmark fetch: ${url.pathname}`);
  const endpoint = url.pathname.slice(5);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const metric: RequestMetric = {
    endpoint,
    offset,
    started: performance.now(),
  };
  requests.push(metric);
  const signal = init?.signal;
  if (signal?.aborted) {
    metric.aborted = true;
    throw new DOMException("Aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      metric.aborted = true;
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  let body: unknown;
  switch (endpoint) {
    case "auth/me":
      body = {
        user: {
          id: "synthetic-user",
          name: "Synthetic User",
          email: "synthetic@example.invalid",
          hasCustomAvatar: false,
        },
      };
      break;
    case "companies":
      body = [
        {
          id: workspaceId,
          name: "Synthetic benchmark",
          status: "active",
          role: "owner",
          permissions: {
            can_manage_connections: true,
            can_view_all_chats: true,
          },
        },
      ];
      break;
    case "whatsapp/connections":
      body = [connection];
      break;
    case "channel-accounts":
      body = channelTotal
        ? [
            {
              id: channelId,
              channel: "telegram",
              provider: "telegram_bot",
              displayName: "Synthetic Telegram",
              status: "connected",
            },
          ]
        : [];
      break;
    case "tags":
      body = { data: [], pagination: { total: 0, hasMore: false } };
      break;
    case "conversations":
      body = {
        data: Array.from(
          {
            length:
              url.searchParams.get("unreadOnly") === "true"
                ? 0
                : Math.max(0, Math.min(limit, channelTotal - offset)),
          },
          (_, i) => channel(offset + i),
        ),
      };
      break;
    case "contacts": {
      const unreadOnly = url.searchParams.get("unreadOnly") === "true";
      const matching = unreadOnly
        ? sparseUnread
          ? Math.min(10, total)
          : Math.ceil(total / 10)
        : total;
      body = {
        data: Array.from(
          { length: Math.max(0, Math.min(limit, matching - offset)) },
          (_, i) =>
            contact(
              unreadOnly
                ? sparseUnread
                  ? total - matching + offset + i
                  : (offset + i) * 10
                : offset + i,
            ),
        ),
        pagination: {
          limit,
          offset,
          total: matching,
          hasMore: offset + limit < matching,
        },
      };
      break;
    }
    default:
      throw new Error(`Unhandled synthetic endpoint: ${endpoint}`);
  }
  const encoded = JSON.stringify(body);
  metric.bytes = new TextEncoder().encode(encoded).length;
  metric.elapsedMs = performance.now() - metric.started;
  return new Response(encoded, {
    headers: { "content-type": "application/json" },
  });
};
// Bun's ambient fetch type includes preconnect; browsers never use it here.
window.fetch = Object.assign(syntheticFetch, { preconnect: () => {} });
setAuthToken("synthetic-benchmark-token-not-a-real-credential");

function Harness() {
  const { activeWorkspace } = useWorkspace();
  if (!activeWorkspace) return <p>Preparing synthetic workspace…</p>;
  return (
    <div style={{ width: 420, height: 900 }}>
      <ChatList onChatSelect={() => {}} />
    </div>
  );
}

function snapshot() {
  const queries = client
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey.includes("infinite"));
  const cached = queries.map((query) => {
    const data = query.state.data as
      | { pages?: { chats?: unknown[] }[]; pageParams?: number[] }
      | undefined;
    return {
      key: query.queryKey,
      pages: data?.pages?.length ?? 0,
      firstOffset: data?.pageParams?.[0] ?? 0,
      endOffset:
        (data?.pageParams?.at(-1) ?? 0) +
        (Array.isArray(data?.pages?.at(-1))
          ? (data!.pages!.at(-1) as unknown[]).length
          : (data?.pages?.at(-1)?.chats?.length ?? 0)),
      rows:
        data?.pages?.reduce(
          (sum, page) =>
            sum +
            (Array.isArray(page) ? page.length : (page.chats?.length ?? 0)),
          0,
        ) ?? 0,
    };
  });
  return {
    cached,
    isFetching: client.isFetching(),
    pendingRefresh: hasPendingInboxRefresh(client),
    renderedRows: document.querySelectorAll('[role="option"]').length,
    domNodes: document.querySelectorAll("*").length,
    requests: [...requests],
    longTasks: [...longTasks],
  };
}

// Only this standalone benchmark exposes instrumentation; product code does not.
Object.assign(window, {
  chatBenchmark: {
    snapshot,
    invalidate: () => invalidateChatList(client),
    clearMetrics: () => {
      requests.length = 0;
      longTasks.length = 0;
    },
    config: { total, channelTotal, delayMs, sparseUnread },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <AuthProvider>
        <WorkspaceProvider>
          <RealtimeProvider autoConnect={false}>
            <TooltipProvider>
              <Harness />
            </TooltipProvider>
          </RealtimeProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>,
);
