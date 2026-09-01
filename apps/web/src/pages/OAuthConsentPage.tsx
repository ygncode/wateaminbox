import { Check, Eye, Loader2, Send, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { BrandMark } from "../components/brand/BrandMark";
import { WorkspaceAvatar } from "../components/workspace/WorkspaceAvatar";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { api } from "../lib/api/client";

interface ClientInfo {
  clientId: string;
  clientName: string | null;
  scopes: string[];
}

/**
 * The host of the client's metadata document.
 *
 * Shown next to the name because the name is self-declared and the host is
 * not: anything can call itself ChatGPT, but only chatgpt.com can serve its
 * document. On a screen whose whole job is deciding whether to trust a
 * stranger, that distinction is the most useful thing on the page.
 */
function clientHost(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}

export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { memberships } = useWorkspace();

  const [client, setClient] = useState<ClientInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);

  const request = useMemo(
    () => ({
      response_type: params.get("response_type") ?? "",
      client_id: params.get("client_id") ?? "",
      redirect_uri: params.get("redirect_uri") ?? "",
      code_challenge: params.get("code_challenge") ?? "",
      code_challenge_method: params.get("code_challenge_method") ?? "",
      state: params.get("state") ?? undefined,
      scope: params.get("scope") ?? undefined,
      resource: params.get("resource") ?? undefined,
    }),
    [params],
  );

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ client_id: request.client_id });
    if (request.scope) query.set("scope", request.scope);
    api
      .get<ClientInfo>(`/oauth/client-info?${query.toString()}`)
      .then((info) => {
        if (!cancelled) setClient(info);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "This application could not be verified",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request.client_id, request.scope]);

  // Selecting the only workspace for the user saves a click without hiding the
  // choice: the card still shows which one, and several workspaces still
  // require a deliberate pick.
  useEffect(() => {
    if (memberships.length === 1 && selected === null) {
      setSelected(memberships[0].id);
    }
  }, [memberships, selected]);

  const submit = async (decision: "approve" | "deny") => {
    setSubmitting(decision);
    setError(null);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>(
        decision === "approve" ? "/oauth/authorize" : "/oauth/authorize/deny",
        decision === "approve" ? { ...request, companyId: selected } : request,
      );
      window.location.replace(redirectTo);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not complete authorization",
      );
      setSubmitting(null);
    }
  };

  const name = client?.clientName ?? clientHost(request.client_id);
  const host = clientHost(request.client_id);
  const canWrite = client?.scopes.includes("write") ?? false;
  const busy = submitting !== null;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f5f7f4] px-5 py-10 text-[#10211b] dark:bg-dark-primary dark:text-dark-text-primary">
      <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#dcefe7] blur-3xl dark:bg-emerald-500/10" />

      <div className="relative mx-auto max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark className="h-10 w-10 shrink-0 rounded-xl object-contain" />
          <span className="text-sm font-semibold tracking-tight">
            WATeamInbox
          </span>
        </div>

        <div className="rounded-2xl border border-[#dce3de] bg-white p-6 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0b7a55]">
            Authorize access
          </p>

          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            Connect {name}
          </h1>

          <p className="mt-3 text-[#65736d] dark:text-dark-text-secondary">
            {/* The host is the verifiable half of the identity, so it is stated
                rather than tucked into a tooltip. */}
            <span className="font-medium text-[#10211b] dark:text-dark-text-primary">
              {host}
            </span>{" "}
            is requesting access to your WhatsApp inbox
            {user?.email ? (
              <>
                {" as "}
                <span className="font-medium text-[#10211b] dark:text-dark-text-primary">
                  {user.email}
                </span>
              </>
            ) : null}
            .
          </p>

          <ul className="mt-6 space-y-3">
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#edf1ed] text-[#315348] dark:bg-dark-tertiary dark:text-emerald-200">
                <Eye className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-sm">
                <span className="block font-medium">
                  Read your conversations
                </span>
                <span className="text-[#65736d] dark:text-dark-text-secondary">
                  Messages, contacts and notes
                </span>
              </span>
            </li>

            {canWrite ? (
              <li className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#fdeeda] text-[#8a5300] dark:bg-amber-500/15 dark:text-amber-200">
                  <Send className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm">
                  <span className="block font-medium">
                    Send messages as you
                  </span>
                  <span className="text-[#65736d] dark:text-dark-text-secondary">
                    Replies go out from your WhatsApp number
                  </span>
                </span>
              </li>
            ) : null}

            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#edf1ed] text-[#315348] dark:bg-dark-tertiary dark:text-emerald-200">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-sm">
                <span className="block font-medium">
                  Never more than you can see
                </span>
                <span className="text-[#65736d] dark:text-dark-text-secondary">
                  Disconnect any time in Settings
                </span>
              </span>
            </li>
          </ul>

          <fieldset className="mt-7">
            <legend className="text-sm font-semibold">
              {memberships.length === 1
                ? "Workspace"
                : "Which workspace should it use?"}
            </legend>

            <div className="mt-3 grid gap-2">
              {memberships.map((workspace) => {
                const active = selected === workspace.id;
                return (
                  <label
                    key={workspace.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                      active
                        ? "border-[#0b7a55] bg-[#f2fbf7] dark:border-emerald-400 dark:bg-emerald-500/10"
                        : "border-[#dce3de] hover:border-[#9bcab8] dark:border-dark-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="workspace"
                      value={workspace.id}
                      checked={active}
                      onChange={() => setSelected(workspace.id)}
                      className="sr-only"
                    />
                    {/* Sized explicitly: WorkspaceAvatar has no intrinsic
                        dimensions, so without this a workspace logo renders at
                        its natural size and tears the card apart. */}
                    <WorkspaceAvatar
                      workspace={workspace}
                      className="h-10 w-10 rounded-lg text-xs"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {workspace.name}
                      </span>
                      <span className="block text-xs capitalize text-[#65736d] dark:text-dark-text-secondary">
                        {workspace.role}
                      </span>
                    </span>
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                        active
                          ? "border-[#0b7a55] bg-[#0b7a55] text-white dark:border-emerald-400 dark:bg-emerald-400"
                          : "border-[#c4d0ca] dark:border-dark-border"
                      }`}
                      aria-hidden="true"
                    >
                      {active ? <Check className="h-3 w-3" /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error ? (
            <p
              role="alert"
              className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void submit("deny")}
              disabled={busy || !client}
              className="flex-1 rounded-xl border border-[#dce3de] px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[#f5f7f4] disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-tertiary"
            >
              {submitting === "deny" ? "Cancelling…" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => void submit("approve")}
              disabled={busy || !selected || !client}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0b7a55] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(16,33,27,.06)] transition-colors hover:bg-[#096544] disabled:opacity-50"
            >
              {submitting === "approve" ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Connecting…
                </>
              ) : (
                `Connect ${name}`
              )}
            </button>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-[#65736d] dark:text-dark-text-secondary">
          You will be returned to {host} after connecting.
        </p>
      </div>
    </main>
  );
}
