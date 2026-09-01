import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ShieldCheck } from "lucide-react";
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
 * The authorization screen an AI client sends the user to.
 *
 * The API has already validated the request before redirecting here, so this
 * page's job is to name the client honestly, let the user pick which workspace
 * to expose, and get an explicit decision. It deliberately does not fall back
 * to a default workspace: connecting the wrong one is the mistake that matters.
 */
export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { memberships } = useWorkspace();

  const [client, setClient] = useState<ClientInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const approve = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>(
        "/oauth/authorize",
        { ...request, companyId: selected },
      );
      // Hand control back to the client that started the flow.
      window.location.replace(redirectTo);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not complete authorization",
      );
      setSubmitting(false);
    }
  };

  const deny = () => {
    // Refusal is reported to the client rather than leaving it hanging, which
    // is what lets it show "cancelled" instead of timing out.
    if (!request.redirect_uri) return;
    const url = new URL(request.redirect_uri);
    url.searchParams.set("error", "access_denied");
    if (request.state) url.searchParams.set("state", request.state);
    window.location.replace(url.toString());
  };

  const name = client?.clientName ?? client?.clientId ?? "An application";
  const canWrite = client?.scopes.includes("write") ?? false;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <BrandMark />

      <div className="rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-3">
          <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Connect {name}</h1>
        </div>

        <p className="text-muted-foreground mb-4 text-sm">
          {name} is asking to connect to your WhatsApp inbox
          {user?.email ? ` as ${user.email}` : ""}.
        </p>

        <ul className="mb-6 space-y-2 text-sm">
          <li>Read your conversations, contacts and notes</li>
          {canWrite ? (
            <li className="font-medium">
              Send messages and change conversations on your behalf
            </li>
          ) : null}
          <li className="text-muted-foreground">
            It sees only what you can see, and you can disconnect it at any time
            in Settings.
          </li>
        </ul>

        <fieldset className="mb-6">
          <legend className="mb-2 text-sm font-medium">Which workspace?</legend>
          <div className="space-y-2">
            {memberships.map((membership) => (
              <label
                key={membership.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3"
              >
                <input
                  type="radio"
                  name="workspace"
                  value={membership.id}
                  checked={selected === membership.id}
                  onChange={() => setSelected(membership.id)}
                />
                <WorkspaceAvatar workspace={membership} />
                <span className="text-sm">{membership.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={deny}
            className="flex-1 rounded-md border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={approve}
            disabled={!selected || submitting || !client}
            className="bg-primary text-primary-foreground flex-1 rounded-md px-4 py-2 text-sm disabled:opacity-50"
          >
            {submitting ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
