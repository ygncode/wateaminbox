import { Check, Eye, Loader2, Send, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { BrandMark } from "../components/brand/BrandMark";
import { WorkspaceAvatar } from "../components/workspace/WorkspaceAvatar";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { api } from "../lib/api/client";
import { resolveConsentSelection } from "../lib/consent-selection";

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
  const { t } = useTranslation();
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
            err instanceof Error ? err.message : t("oauth.verifyFailed"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request.client_id, request.scope]);

  // The membership list is live (refetched on focus and on a poller), so a
  // workspace chosen here can leave the list while the page stays mounted.
  // Reconcile the selection against the current list on every render rather
  // than trusting the stored id: keep it while it is still present, fall back
  // to the lone remaining workspace, and otherwise make the user pick again.
  const selectedCompanyId = useMemo(
    () => resolveConsentSelection(selected, memberships),
    [selected, memberships],
  );

  const submit = async (decision: "approve" | "deny") => {
    setSubmitting(decision);
    setError(null);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>(
        decision === "approve" ? "/oauth/authorize" : "/oauth/authorize/deny",
        decision === "approve"
          ? { ...request, companyId: selectedCompanyId }
          : request,
      );
      window.location.replace(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("oauth.authorizeFailed"));
      setSubmitting(null);
    }
  };

  const name = client?.clientName ?? clientHost(request.client_id);
  const host = clientHost(request.client_id);
  const canWrite = client?.scopes.includes("write") ?? false;
  const busy = submitting !== null;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas px-5 py-10 text-fg">
      <div className="relative mx-auto max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark className="h-10 w-10 shrink-0 rounded-xl object-contain" />
          <span className="text-sm font-semibold tracking-tight">
            WATeamInbox
          </span>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-xs sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
            {t("oauth.authorizeAccess")}
          </p>

          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            {t("oauth.connectName", { name })}
          </h1>

          <p className="mt-3 text-fg-muted">
            {/* The host is the verifiable half of the identity, so it is stated
                rather than tucked into a tooltip. */}
            <Trans
              i18nKey={user?.email ? "oauth.requestingAs" : "oauth.requesting"}
              values={{ host, email: user?.email }}
              components={{
                strong: <span className="font-medium text-fg" />,
              }}
            />
          </p>

          <ul className="mt-6 space-y-3">
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-accent">
                <Eye className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-sm">
                <span className="block font-medium">
                  {t("oauth.readTitle")}
                </span>
                <span className="text-fg-muted">{t("oauth.readDesc")}</span>
              </span>
            </li>

            {canWrite ? (
              <li className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
                  <Send className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm">
                  <span className="block font-medium">
                    {t("oauth.sendTitle")}
                  </span>
                  <span className="text-fg-muted">{t("oauth.sendDesc")}</span>
                </span>
              </li>
            ) : null}

            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-accent">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-sm">
                <span className="block font-medium">
                  {t("oauth.limitTitle")}
                </span>
                <span className="text-fg-muted">{t("oauth.limitDesc")}</span>
              </span>
            </li>
          </ul>

          <fieldset className="mt-7">
            <legend className="text-sm font-semibold">
              {memberships.length === 1
                ? t("oauth.workspace")
                : t("oauth.whichWorkspace")}
            </legend>

            <div className="mt-3 grid gap-2">
              {memberships.map((workspace) => {
                const active = selectedCompanyId === workspace.id;
                return (
                  <label
                    key={workspace.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                      active
                        ? "border-accent bg-accent-soft"
                        : "border-line hover:border-accent"
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
                      <span className="block text-xs capitalize text-fg-muted">
                        {workspace.role}
                      </span>
                    </span>
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                        active
                          ? "border-accent bg-primary text-on-primary"
                          : "border-line-strong"
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
              className="mt-5 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void submit("deny")}
              disabled={busy || !client}
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {submitting === "deny"
                ? t("oauth.cancelling")
                : t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit("approve")}
              disabled={busy || !selectedCompanyId || !client}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-xs transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting === "approve" ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  {t("oauth.connecting")}
                </>
              ) : (
                t("oauth.connectName", { name })
              )}
            </button>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-fg-muted">
          {t("oauth.returnedTo", { host })}
        </p>
      </div>
    </main>
  );
}
