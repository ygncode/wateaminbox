import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useWorkspace } from "../../contexts/workspace-context";
import { useApiTokens } from "../../hooks/useApiTokens";
import { API_BASE_URL } from "../../lib/api/client";
import type { ApiTokenScope, ApiTokenWithSecret } from "../../lib/api/types";
import { resolveMcpEndpointUrl } from "../../lib/mcp-url";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  LoadingSpinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const EXPIRY_OPTIONS = [
  { value: "", labelKey: "apiTokens.expiry.never", label: "Never" },
  { value: "30", labelKey: "apiTokens.expiry.days30", label: "30 days" },
  { value: "90", labelKey: "apiTokens.expiry.days90", label: "90 days" },
  { value: "365", labelKey: "apiTokens.expiry.days365", label: "1 year" },
] as const;

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        className="font-mono text-xs"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function CopyBlock({
  value,
  label,
  caption,
}: {
  value: string;
  label: string;
  caption?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {caption ?? label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          aria-label={label}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              {t("apiTokens.setup.copied", "Copied")}
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              {t("apiTokens.setup.copy", "Copy")}
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function SetupStep({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-sm">{children}</div>
    </li>
  );
}

/**
 * Per-client setup instructions. When `token` is provided (right after
 * creation) the snippets embed the real secret; otherwise they show a
 * placeholder for the user to substitute.
 */
/**
 * Setup instructions, split by how the client authenticates rather than by
 * product name.
 *
 * That split is the whole point. Hosted apps - ChatGPT, Claude, Grok - sign in
 * through the browser and never see a token; local tools - Claude Code, Cursor
 * - carry one in a header. The previous version told everyone to paste a token,
 * which stopped being true when OAuth shipped and left people pasting a token
 * into a field their app does not have.
 */
function McpSetupGuide({
  mcpUrl,
  token,
  grokClientId,
}: {
  mcpUrl: string;
  token?: string;
  grokClientId: string;
}) {
  const { t } = useTranslation();
  const secret = token ?? "wti_YOUR_TOKEN";
  const hasRealToken = Boolean(token);

  const mcpJson = JSON.stringify(
    {
      mcpServers: {
        wateaminbox: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );

  const tokenHint = hasRealToken
    ? null
    : t(
        "apiTokens.setup.placeholderHint",
        "Replace wti_YOUR_TOKEN with a token created below.",
      );

  return (
    <Tabs defaultValue="hosted">
      <TabsList className="mb-3">
        <TabsTrigger value="hosted">
          {t("apiTokens.setup.tabHosted", "ChatGPT & Claude")}
        </TabsTrigger>
        <TabsTrigger value="grok">
          {t("apiTokens.setup.tabGrok", "Grok")}
        </TabsTrigger>
        <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
        <TabsTrigger value="cursor">Cursor</TabsTrigger>
      </TabsList>

      <TabsContent value="hosted">
        <p className="mb-3 rounded-lg bg-primary/5 px-3 py-2 text-sm">
          {t(
            "apiTokens.setup.noTokenNeeded",
            "No token needed. You sign in and approve in the browser, and the connection shows up under Connected AI apps above.",
          )}
        </p>
        <ol className="space-y-4">
          <SetupStep index={1}>
            <p>
              {t(
                "apiTokens.setup.hostedStep1",
                "In ChatGPT: Settings → Connectors → Add. In Claude: Settings → Connectors → Add custom connector. Paste this URL:",
              )}
            </p>
            <CopyBlock
              label="Endpoint URL"
              caption={t("apiTokens.endpointTitle", "MCP endpoint")}
              value={mcpUrl}
            />
          </SetupStep>
          <SetupStep index={2}>
            <p>
              {t(
                "apiTokens.setup.hostedStep2",
                "Leave Client ID and Client Secret empty if the app asks. Continue, sign in to WATeamInbox, choose the workspace, and approve.",
              )}
            </p>
          </SetupStep>
        </ol>
      </TabsContent>

      <TabsContent value="grok">
        <p className="mb-3 rounded-lg bg-primary/5 px-3 py-2 text-sm">
          {t(
            "apiTokens.setup.noTokenNeeded",
            "No token needed. You sign in and approve in the browser, and the connection shows up under Connected AI apps above.",
          )}
        </p>
        <ol className="space-y-4">
          <SetupStep index={1}>
            <p>
              {t(
                "apiTokens.setup.grokStep1",
                "In Grok: Settings → Connectors → Add Connector → Other, and paste this URL:",
              )}
            </p>
            <CopyBlock
              label="Endpoint URL"
              caption={t("apiTokens.endpointTitle", "MCP endpoint")}
              value={mcpUrl}
            />
          </SetupStep>
          <SetupStep index={2}>
            <p>
              {t(
                "apiTokens.setup.grokStep2",
                "Continue, sign in to WATeamInbox, choose the workspace, and approve.",
              )}
            </p>
          </SetupStep>
        </ol>
        {/* Grok now supplies its own Client ID, so this is a fallback rather
            than a step. It stays because older builds still ask, and someone
            facing that prompt has no other way to find the value. */}
        <details className="mt-4 rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            {t(
              "apiTokens.setup.grokClientIdSummary",
              "Grok is asking me for a Client ID",
            )}
          </summary>
          <p className="mt-2">
            {t(
              "apiTokens.setup.grokClientIdBody",
              "Newer versions of Grok fill this in themselves. If yours asks, paste the value below, leave Client Secret empty, and keep PKCE set to S256.",
            )}
          </p>
          <CopyBlock
            label="Client ID"
            caption={t("apiTokens.setup.clientIdCaption", "Client ID")}
            value={grokClientId}
          />
        </details>
      </TabsContent>

      <TabsContent value="claude-code">
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm">
          {t(
            "apiTokens.setup.tokenNeeded",
            "This one needs a token. Create one below first, then run the command.",
          )}
        </p>
        <ol className="space-y-4">
          <SetupStep index={1}>
            <p>
              {t(
                "apiTokens.setup.claudeCodeStep1",
                "Run this once in your terminal:",
              )}
            </p>
            <CopyBlock
              label="Claude Code command"
              caption={t("apiTokens.setup.terminal", "Terminal")}
              value={`claude mcp add --transport http wateaminbox ${mcpUrl} --header "Authorization: Bearer ${secret}"`}
            />
            {tokenHint && (
              <p className="text-xs text-muted-foreground">{tokenHint}</p>
            )}
          </SetupStep>
          <SetupStep index={2}>
            <p>
              {t(
                "apiTokens.setup.claudeCodeStep2",
                "Start a new Claude Code session — the WATeamInbox tools are available right away.",
              )}
            </p>
          </SetupStep>
        </ol>
      </TabsContent>

      <TabsContent value="cursor">
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm">
          {t(
            "apiTokens.setup.tokenNeeded",
            "This one needs a token. Create one below first, then run the command.",
          )}
        </p>
        <ol className="space-y-4">
          <SetupStep index={1}>
            <p>
              {t(
                "apiTokens.setup.cursorStep1",
                "Add this to ~/.cursor/mcp.json (most other MCP clients accept the same shape):",
              )}
            </p>
            <CopyBlock label="mcp.json" caption="mcp.json" value={mcpJson} />
            {tokenHint && (
              <p className="text-xs text-muted-foreground">{tokenHint}</p>
            )}
          </SetupStep>
          <SetupStep index={2}>
            <p>
              {t(
                "apiTokens.setup.cursorStep2",
                "Restart Cursor and enable the server when prompted.",
              )}
            </p>
          </SetupStep>
        </ol>
      </TabsContent>
    </Tabs>
  );
}

export function ApiTokensSection() {
  const { t } = useTranslation();
  const { activeWorkspace } = useWorkspace();
  const isAdmin =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";

  const [showAllForWorkspaceId, setShowAllForWorkspaceId] = useState<
    string | null
  >(null);
  const showAll =
    isAdmin && showAllForWorkspaceId === (activeWorkspace?.id ?? null);
  const {
    tokens,
    isLoading,
    createToken,
    isCreating,
    revokeToken,
    isRevoking,
  } = useApiTokens({ all: showAll });

  const [name, setName] = useState("");
  const [writeScope, setWriteScope] = useState(false);
  const [expiryDays, setExpiryDays] = useState("");
  const [createdToken, setCreatedToken] = useState<ApiTokenWithSecret | null>(
    null,
  );

  const mcpUrl = resolveMcpEndpointUrl(API_BASE_URL, window.location.origin);
  // Derived from the endpoint rather than hardcoded, so a self-hosted or local
  // deployment shows its own id instead of production's.
  const grokClientId = mcpUrl.replace(/\/mcp$/, "/oauth/clients/grok.json");

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("apiTokens.nameRequired", "Give the token a name"));
      return;
    }
    const scopes: ApiTokenScope[] = writeScope ? ["read", "write"] : ["read"];
    const expiresAt = expiryDays
      ? new Date(
          Date.now() + Number(expiryDays) * 24 * 60 * 60 * 1000,
        ).toISOString()
      : undefined;
    try {
      const token = await createToken({ name: name.trim(), scopes, expiresAt });
      setCreatedToken(token);
      setName("");
      setWriteScope(false);
      setExpiryDays("");
    } catch {
      toast.error(t("apiTokens.createFailed", "Failed to create the token"));
    }
  };

  const now = Date.now();
  const activeTokens = tokens.filter(
    (token) =>
      !token.revokedAt &&
      (!token.expiresAt || new Date(token.expiresAt).getTime() > now),
  );

  return (
    <div className="space-y-8">
      {/* Endpoint info */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          {t("apiTokens.endpointTitle", "MCP endpoint")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "apiTokens.endpointDescription",
            "Add this URL to an AI app as a remote MCP server. ChatGPT, Claude and Grok sign in through the browser and need no token; Claude Code, Cursor and scripts use a token from below. Either way, tools respect your workspace role and conversation visibility.",
          )}
        </p>
        <CopyField
          value={mcpUrl}
          label={t("apiTokens.endpointTitle", "MCP endpoint")}
        />
        <div className="pt-2">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            {t("apiTokens.setup.title", "Setup instructions")}
          </h4>
          <McpSetupGuide mcpUrl={mcpUrl} grokClientId={grokClientId} />
        </div>
      </section>

      {/* Create form */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          {t("apiTokens.createTitle", "Create token")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "apiTokens.createDescription",
            "Only for Claude Code, Cursor and scripts. If you are connecting ChatGPT, Claude or Grok, skip this — those sign in through the browser.",
          )}
        </p>
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="api-token-name">
              {t("apiTokens.nameLabel", "Name")}
            </Label>
            <Input
              id="api-token-name"
              value={name}
              maxLength={100}
              placeholder={t(
                "apiTokens.namePlaceholder",
                "e.g. Claude Desktop",
              )}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="api-token-write"
              checked={writeScope}
              onCheckedChange={(checked) => setWriteScope(checked === true)}
            />
            <Label htmlFor="api-token-write" className="text-sm font-normal">
              {t(
                "apiTokens.writeScopeLabel",
                "Allow write actions (send messages, assign, tag, broadcasts)",
              )}
            </Label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-token-expiry">
              {t("apiTokens.expiryLabel", "Expires")}
            </Label>
            <select
              id="api-token-expiry"
              className="block h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value)}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey, option.label)}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={handleCreate} disabled={isCreating}>
            <KeyRound className="mr-2 h-4 w-4" />
            {t("apiTokens.createButton", "Create token")}
          </Button>
        </div>
      </section>

      {/* Token list */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {showAll
              ? t("apiTokens.listAllTitle", "All workspace tokens")
              : t("apiTokens.listTitle", "Your tokens")}
          </h3>
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setShowAllForWorkspaceId(
                  showAll ? null : (activeWorkspace?.id ?? null),
                )
              }
            >
              {showAll
                ? t("apiTokens.showMine", "Show only mine")
                : t("apiTokens.showAll", "Show all workspace tokens")}
            </Button>
          )}
        </div>
        {isLoading ? (
          <LoadingSpinner />
        ) : activeTokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("apiTokens.empty", "No active tokens yet.")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {activeTokens.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {token.name}
                    </span>
                    {token.scopes.includes("write") ? (
                      <Badge variant="secondary">
                        {t("apiTokens.scopeWrite", "read + write")}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        {t("apiTokens.scopeRead", "read-only")}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    <code>{token.tokenPrefix}…</code>
                    {" · "}
                    {token.lastUsedAt
                      ? t("apiTokens.lastUsed", "Last used {{date}}", {
                          date: new Date(token.lastUsedAt).toLocaleString(),
                        })
                      : t("apiTokens.neverUsed", "Never used")}
                    {token.expiresAt &&
                      ` · ${t("apiTokens.expires", "Expires {{date}}", {
                        date: new Date(token.expiresAt).toLocaleDateString(),
                      })}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isRevoking}
                  onClick={async () => {
                    try {
                      await revokeToken(token.id);
                      toast.success(t("apiTokens.revoked", "Token revoked"));
                    } catch {
                      toast.error(
                        t("apiTokens.revokeFailed", "Failed to revoke token"),
                      );
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* One-time secret dialog */}
      <Dialog
        open={Boolean(createdToken)}
        onOpenChange={(open) => {
          if (!open) setCreatedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("apiTokens.secretTitle", "Copy your token now")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "apiTokens.secretDescription",
                "This is the only time the full token is shown. Store it in your agent's MCP configuration.",
              )}
            </DialogDescription>
          </DialogHeader>
          {createdToken && (
            <div className="space-y-4">
              <CopyField
                value={createdToken.token}
                label={t("apiTokens.secretTitle", "Copy your token now")}
              />
              <div className="space-y-1">
                <Label>
                  {t("apiTokens.setup.title", "Setup instructions")}
                </Label>
                <McpSetupGuide
                  mcpUrl={mcpUrl}
                  token={createdToken.token}
                  grokClientId={grokClientId}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedToken(null)}>
              {t("apiTokens.secretDone", "I've copied it")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
