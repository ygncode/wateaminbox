import {
  Bell,
  Building2,
  CircleAlert,
  Clock,
  Database,
  Globe2,
  ImagePlus,
  Keyboard,
  KeyRound,
  LoaderCircle,
  MessageSquareHeart,
  MessageSquareText,
  Package,
  Plug,
  Save,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { type ComponentType, type ReactNode, useRef, useState } from "react";
import { Navigate, NavLink, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { AnalyticsPreferences } from "../components/analytics";
import { ThemeToggle } from "../components/chat/ThemeToggle";
import { ContactImport } from "../components/contacts";
import { FeedbackSettings } from "../components/feedback";
import {
  AccountSettings,
  ApiTokensSection,
  ConnectedAppsSection,
  CatalogManager,
  LabelSyncManager,
  LanguageSwitcher,
  NotificationSettings,
  QuickRepliesManager,
  SlaPolicySettings,
} from "../components/settings";
import { Button, Input } from "../components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { WhatsAppConnectionPanel } from "../components/whatsapp";
import { WorkspaceAvatar } from "../components/workspace/WorkspaceAvatar";
import { useAuth } from "../contexts/auth-context";
import { useKeyboardShortcutsContext } from "../contexts/KeyboardShortcutsContext";
import { useWorkspace } from "../contexts/workspace-context";
import { productAnalytics } from "../lib/product-analytics";
import {
  useCompanyMembers,
  useDeleteCompany,
  useLeaveCompany,
  useTransferOwnership,
  useUpdateCompany,
} from "../hooks/useTeam";
import { cn } from "../lib/utils";
import {
  prepareWorkspaceLogo,
  validateWorkspaceLogo,
  WORKSPACE_LOGO_INPUT_BYTES,
  WORKSPACE_LOGO_SIZE,
} from "../lib/workspace-logo";
import { workspacePath } from "../lib/workspace-routes";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";

type SettingsSection =
  | "general"
  | "connections"
  | "sla"
  | "quick-replies"
  | "labels"
  | "catalogs"
  | "profile"
  | "notifications"
  | "data"
  | "appearance"
  | "privacy"
  | "api-tokens"
  | "feedback";

interface SectionDefinition {
  id: SettingsSection;
  /** i18n key; `label` is the English fallback. */
  labelKey: string;
  label: string;
  /** Stable grouping identifier - translated for display via groupLabel(). */
  group: string;
  icon: ComponentType<{ className?: string }>;
  visible: boolean;
}

const SECTION_GROUP_LABELS: Record<string, string> = {
  Workspace: "settings.groups.workspace",
  "Inbox tools": "settings.groups.inboxTools",
  Personal: "settings.groups.personal",
  Data: "settings.groups.data",
  Help: "settings.groups.help",
};

function groupLabel(t: TFunction, group: string): string {
  const key = SECTION_GROUP_LABELS[group];
  return key ? t(key, group) : group;
}

export function SettingsPage() {
  const { t } = useTranslation();

  const { section } = useParams<{ section?: SettingsSection }>();
  const navigate = useNavigate();
  const { activeWorkspace, can } = useWorkspace();
  if (!activeWorkspace) return null;

  const sections: SectionDefinition[] = [
    {
      id: "general",
      labelKey: "settings.sections.general",
      label: "General",
      group: "Workspace",
      icon: Building2,
      visible: true,
    },
    {
      id: "connections",
      labelKey: "settings.sections.connections",
      label: "Connections",
      group: "Workspace",
      icon: Plug,
      visible: can("can_manage_connections"),
    },
    {
      id: "sla",
      labelKey: "settings.sections.sla",
      label: "Response SLA",
      group: "Workspace",
      icon: Clock,
      visible: true,
    },
    {
      id: "quick-replies",
      labelKey: "settings.sections.quickReplies",
      label: "Quick replies",
      group: "Inbox tools",
      icon: MessageSquareText,
      visible: true,
    },
    {
      id: "labels",
      labelKey: "settings.sections.labels",
      label: "WhatsApp labels",
      group: "Inbox tools",
      icon: Tag,
      visible: can("can_manage_connections"),
    },
    {
      id: "catalogs",
      labelKey: "settings.sections.catalogs",
      label: "Product catalogs",
      group: "Inbox tools",
      icon: Package,
      visible: can("can_manage_connections"),
    },
    {
      id: "profile",
      labelKey: "settings.sections.profile",
      label: "Profile & security",
      group: "Personal",
      icon: UserRound,
      visible: true,
    },
    {
      id: "notifications",
      labelKey: "settings.sections.notifications",
      label: "Notifications",
      group: "Personal",
      icon: Bell,
      visible: true,
    },
    {
      id: "appearance",
      labelKey: "settings.sections.appearance",
      label: "Appearance & language",
      group: "Personal",
      icon: Globe2,
      visible: true,
    },
    {
      id: "privacy",
      labelKey: "settings.sections.privacy",
      label: "Privacy & analytics",
      group: "Personal",
      icon: ShieldCheck,
      // Analytics is an optional, deployer-enabled integration; render no
      // settings control at all when it is not configured.
      visible: productAnalytics.isConfigured(),
    },
    {
      id: "api-tokens",
      labelKey: "settings.sections.apiTokens",
      label: "AI agents (MCP)",
      group: "Personal",
      icon: KeyRound,
      visible: true,
    },
    {
      id: "data",
      labelKey: "settings.sections.data",
      label: "Data tools",
      group: "Data",
      icon: Database,
      visible: can("can_assign_contacts") || can("can_export"),
    },
    {
      id: "feedback",
      labelKey: "settings.sections.feedback",
      label: "Send feedback",
      group: "Help",
      icon: MessageSquareHeart,
      // Always reachable: the floating feedback tab can be dismissed for good,
      // so this is the durable way back to the form.
      visible: true,
    },
  ];
  const visibleSections = sections.filter((item) => item.visible);
  const current = visibleSections.find((item) => item.id === section);

  if (!section) {
    return (
      <Navigate
        to={workspacePath(activeWorkspace.id, "settings", "general")}
        replace
      />
    );
  }

  if (!current) {
    return (
      <Navigate
        to={workspacePath(activeWorkspace.id, "settings", "general")}
        replace
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full bg-[#f5f7f4] dark:bg-dark-primary">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-[#dce3de] bg-[#edf1ed] px-4 py-6 dark:border-dark-border dark:bg-dark-secondary md:block">
        <p className="px-2 text-xs font-bold uppercase tracking-[0.18em] text-[#0b7a55] dark:text-emerald-400">
          {t("settings.title", "Settings")}
        </p>
        <h1 className="mt-2 truncate px-2 text-xl font-semibold tracking-tight">
          {activeWorkspace.name}
        </h1>
        <nav
          className="mt-7 space-y-5"
          aria-label={t("settings.sectionsNav", "Settings sections")}
        >
          {[...new Set(visibleSections.map((item) => item.group))].map(
            (group) => (
              <div key={group}>
                <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#829089] dark:text-[#91a8a0]">
                  {groupLabel(t, group)}
                </p>
                <div className="space-y-0.5">
                  {visibleSections
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <SettingsLink
                        key={item.id}
                        item={item}
                        workspaceId={activeWorkspace.id}
                      />
                    ))}
                </div>
              </div>
            ),
          )}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
          <div className="mb-6 md:hidden">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0b7a55]">
              {t("settings.title", "Settings")}
            </p>
            <select
              value={current.id}
              onChange={(event) => {
                navigate(
                  workspacePath(
                    activeWorkspace.id,
                    "settings",
                    event.target.value,
                  ),
                );
              }}
              className="mt-3 h-11 w-full rounded-xl border border-[#dce3de] bg-white px-3 font-medium dark:border-dark-border dark:bg-dark-elevated"
              aria-label={t("settings.sectionSelect", "Settings section")}
            >
              {visibleSections.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.labelKey, item.label)}
                </option>
              ))}
            </select>
          </div>
          <header className="mb-7 border-b border-[#dce3de] pb-5 dark:border-dark-border">
            <p className="text-xs font-semibold text-[#0b7a55]">
              {groupLabel(t, current.group)}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.025em]">
              {t(current.labelKey, current.label)}
            </h2>
          </header>
          <SettingsSectionContent
            section={current.id}
            workspaceId={activeWorkspace.id}
          />
        </div>
      </main>
    </div>
  );
}

function SettingsLink({
  item,
  workspaceId,
}: {
  item: SectionDefinition;
  workspaceId: string;
}) {
  const { t } = useTranslation();

  const Icon = item.icon;
  return (
    <NavLink
      to={workspacePath(workspaceId, "settings", item.id)}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-white text-[#075c41] shadow-sm dark:bg-emerald-400/10 dark:text-emerald-300 dark:shadow-none dark:ring-1 dark:ring-inset dark:ring-emerald-400/20"
            : "text-[#65736d] hover:bg-white/60 hover:text-[#10211b] dark:text-[#9fb0aa] dark:hover:bg-white/[0.07] dark:hover:text-white",
        )
      }
    >
      <Icon className="h-4 w-4" /> {t(item.labelKey, item.label)}
    </NavLink>
  );
}

function SettingsSectionContent({
  section,
  workspaceId,
}: {
  section: SettingsSection;
  workspaceId: string;
}) {
  const { t } = useTranslation();

  switch (section) {
    case "general":
      return <GeneralSettings key={workspaceId} />;
    case "profile":
      return <AccountSettings />;
    case "connections":
      return (
        <Panel
          title={t("settings.connections.title", "WhatsApp connections")}
          description={t(
            "settings.connections.description",
            "Link and manage the WhatsApp devices that power this workspace inbox.",
          )}
        >
          <WhatsAppConnectionPanel multiConnection hideHeader />
        </Panel>
      );
    case "sla":
      return <SlaPolicySettings />;
    case "quick-replies":
      return (
        <Panel
          title={t("settings.quickRepliesPanel.title", "Saved responses")}
          description={t(
            "settings.quickRepliesPanel.description",
            "Create reusable message templates and insert them from the composer with a shortcut.",
          )}
        >
          <QuickRepliesManager />
        </Panel>
      );
    case "labels":
      return (
        <Panel
          title={t("settings.labels.title", "Label mapping")}
          description={t(
            "settings.labels.description",
            "Map WhatsApp Business labels to workspace tags for consistent contact organization.",
          )}
        >
          <LabelSyncManager />
        </Panel>
      );
    case "catalogs":
      return (
        <Panel
          title={t("settings.catalogsPanel.title", "Catalog library")}
          description={t(
            "settings.catalogsPanel.description",
            "Sync WhatsApp Business catalogs and review the products available to your team.",
          )}
        >
          <CatalogManager />
        </Panel>
      );
    case "api-tokens":
      return (
        <Panel
          title={t("settings.apiTokensPanel.title", "AI agents (MCP)")}
          description={t(
            "settings.apiTokensPanel.description",
            "Connect AI agents to this workspace through the MCP endpoint with personal, revocable tokens.",
          )}
        >
          <div className="space-y-8">
            <ConnectedAppsSection key={`apps-${workspaceId}`} />
            <ApiTokensSection key={workspaceId} />
          </div>
        </Panel>
      );
    case "notifications":
      return <NotificationSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "privacy":
      return (
        <Panel
          title={t("settings.privacyPanel.title", "Product analytics")}
          description={t(
            "settings.privacyPanel.description",
            "Control whether this browser shares anonymous usage analytics with this deployment's Google Analytics property.",
          )}
        >
          <AnalyticsPreferences />
        </Panel>
      );
    case "data":
      return <DataSettings />;
    case "feedback":
      return (
        <Panel
          title={t("settings.feedbackPanel.title", "Send feedback")}
          description={t(
            "settings.feedbackPanel.description",
            "Tell us what's working and what we can improve. Feedback reaches the team directly, and this form stays here even if you dismissed the floating feedback tab.",
          )}
        >
          <FeedbackSettings />
        </Panel>
      );
  }
}

function GeneralSettings() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();
  const [name, setName] = useState(activeWorkspace?.name ?? "");
  const [description, setDescription] = useState(
    activeWorkspace?.description ?? "",
  );
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const updateCompany = useUpdateCompany(activeWorkspace?.id ?? "");
  const deleteCompany = useDeleteCompany();
  const transferOwnership = useTransferOwnership();
  const leaveCompany = useLeaveCompany();
  const members = useCompanyMembers(
    activeWorkspace?.role === "owner" ? activeWorkspace.id : null,
    { limit: 100 },
  );

  if (!activeWorkspace) return null;
  const canEditIdentity =
    activeWorkspace.role === "owner" || activeWorkspace.role === "admin";
  const nextName = name.trim();
  const nextDescription = description.trim();
  const currentDescription = activeWorkspace.description ?? "";
  const identityChanged =
    nextName !== activeWorkspace.name ||
    nextDescription !== currentDescription ||
    logoDataUrl !== null ||
    logoRemoved;
  const logoPreview =
    logoDataUrl ?? (logoRemoved ? null : activeWorkspace.logoUrl);
  const identityBusy = updateCompany.isPending || isProcessingLogo;

  const handleLogo = async (file?: File) => {
    if (!file) return;
    const validationError = validateWorkspaceLogo(file);
    if (validationError) {
      setLogoError(validationError);
      return;
    }

    setLogoError(null);
    setIsProcessingLogo(true);
    try {
      setLogoDataUrl(await prepareWorkspaceLogo(file));
      setLogoRemoved(false);
    } catch (error) {
      setLogoError(
        error instanceof Error
          ? error.message
          : t("settings.logoProcessFailed", "Could not process this logo"),
      );
    } finally {
      setIsProcessingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const removeLogo = () => {
    setLogoDataUrl(null);
    setLogoRemoved(Boolean(activeWorkspace.logoUrl));
    setLogoError(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const save = async () => {
    if (!nextName || !identityChanged) return;
    try {
      await updateCompany.mutateAsync({
        ...(nextName !== activeWorkspace.name ? { name: nextName } : {}),
        ...(nextDescription !== currentDescription
          ? { description: nextDescription }
          : {}),
        ...(logoDataUrl
          ? { logoDataUrl }
          : logoRemoved
            ? { logoDataUrl: null }
            : {}),
      });
      await refreshWorkspaces();
      setName(nextName);
      setDescription(nextDescription);
      setLogoDataUrl(null);
      setLogoRemoved(false);
      toast.success(
        t("settings.identityUpdated", "Workspace identity updated"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(
              "settings.identityUpdateFailed",
              "Could not update workspace identity",
            ),
      );
    }
  };

  const navigateAfterExit = async () => {
    const available = (await refreshWorkspaces()).filter(
      (workspace) => workspace.status === "active",
    );
    if (available.length === 1) navigate(workspacePath(available[0].id));
    else navigate(available.length ? "/workspaces" : "/company-setup");
  };

  const deleteWorkspace = async () => {
    try {
      await deleteCompany.mutateAsync(activeWorkspace.id);
      toast.success(t("settings.workspaceDeleted", "Workspace deleted"));
      await navigateAfterExit();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.workspaceDeleteFailed", "Could not delete workspace"),
      );
    }
  };

  const leaveWorkspace = async () => {
    try {
      await leaveCompany.mutateAsync(activeWorkspace.id);
      toast.success(`You left ${activeWorkspace.name}`);
      await navigateAfterExit();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.workspaceLeaveFailed", "Could not leave workspace"),
      );
    }
  };

  const transferWorkspace = async () => {
    if (!transferTarget) return;
    try {
      await transferOwnership.mutateAsync({
        companyId: activeWorkspace.id,
        userId: transferTarget,
      });
      await refreshWorkspaces();
      setTransferOpen(false);
      toast.success(
        t("settings.ownershipTransferred", "Workspace ownership transferred"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(
              "settings.ownershipTransferFailed",
              "Could not transfer ownership",
            ),
      );
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        title={t("settings.identity.title", "Workspace identity")}
        description={t(
          "settings.identity.description",
          "Keep the name, description, and logo recognizable everywhere your team switches workspace.",
        )}
      >
        <div className="space-y-6">
          <div className="flex flex-col gap-4 rounded-2xl border border-[#dce3de] bg-[#f8faf8] p-4 dark:border-dark-border dark:bg-dark-tertiary/35 sm:flex-row sm:items-center">
            <WorkspaceAvatar
              workspace={{
                name: nextName || activeWorkspace.name,
                logoUrl: logoPreview,
              }}
              className="h-20 w-20 rounded-2xl text-xl shadow-sm"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {t("settings.workspaceLogo", "Workspace logo")}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
                {t("settings.logoHint", {
                  defaultValue:
                    "PNG, JPEG, WebP, GIF, or AVIF up to {{mb}} MB. Images are cropped to {{size}} × {{size}}.",
                  mb: WORKSPACE_LOGO_INPUT_BYTES / 1024 / 1024,
                  size: WORKSPACE_LOGO_SIZE,
                })}
              </p>
              {logoDataUrl && (
                <p className="mt-1.5 text-xs font-semibold text-[#0b7a55] dark:text-emerald-300">
                  {t("settings.logoReady", "New logo ready to save")}
                </p>
              )}
              {logoRemoved && (
                <p className="mt-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {t(
                    "settings.logoWillBeRemoved",
                    "Logo will be removed when you save",
                  )}
                </p>
              )}
            </div>
            {canEditIdentity && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.gif,.avif,image/png,image/jpeg,image/webp,image/gif,image/avif"
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => void handleLogo(event.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={identityBusy}
                  className="gap-2"
                >
                  {isProcessingLogo ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : logoPreview ? (
                    <Upload className="h-4 w-4" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  {logoPreview
                    ? t("settings.replace", "Replace")
                    : t("settings.upload", "Upload")}
                </Button>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={removeLogo}
                    disabled={identityBusy}
                    className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-950/30"
                  >
                    <X className="h-4 w-4" /> {t("settings.remove", "Remove")}
                  </Button>
                )}
              </div>
            )}
          </div>

          {logoError && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400"
            >
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              {logoError}
            </p>
          )}

          <label className="block text-sm font-medium">
            {t("settings.workspaceName", "Workspace name")}
            <Input
              className="mt-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canEditIdentity || identityBusy}
              maxLength={100}
            />
          </label>

          <label className="block text-sm font-medium">
            <span className="flex items-center justify-between gap-4">
              {t("settings.description", "Description")}{" "}
              <span>{description.length}/280</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={!canEditIdentity || identityBusy}
              maxLength={280}
              rows={3}
              placeholder={t(
                "settings.descriptionPlaceholder",
                "What does this team handle?",
              )}
              className="mt-2 w-full resize-none rounded-xl border border-[#dce3de] bg-white px-3.5 py-3 text-sm leading-5 outline-none transition-[border-color,box-shadow] placeholder:text-[#9aa7a1] focus:border-[#0b7a55] focus:ring-[3px] focus:ring-[#25d366]/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-border dark:bg-dark-tertiary dark:focus:border-emerald-400"
            />
          </label>

          {canEditIdentity && (
            <div className="flex justify-end border-t border-[#e6ebe7] pt-5 dark:border-dark-border">
              <Button
                type="button"
                onClick={() => void save()}
                disabled={identityBusy || !nextName || !identityChanged}
                className="gap-2 bg-[#0b7a55] text-white hover:bg-[#096747]"
              >
                {updateCompany.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {updateCompany.isPending
                  ? t("common.saving", "Saving…")
                  : t("settings.saveChanges", "Save changes")}
              </Button>
            </div>
          )}
        </div>
      </Panel>
      <Panel
        title={t("settings.membership.title", "Membership")}
        description={t(
          "settings.membership.description",
          "Your access is scoped to this workspace.",
        )}
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact
            label={t("settings.roleFact", "Role")}
            value={activeWorkspace.role}
            capitalize
          />
          <Fact
            label={t("settings.statusFact", "Status")}
            value={activeWorkspace.status}
            capitalize
          />
          <Fact
            label={t("settings.createdFact", "Created")}
            value={formatWorkspaceDate(t, activeWorkspace.createdAt)}
          />
        </dl>
      </Panel>
      {activeWorkspace.role === "owner" ? (
        <Panel
          title={t("settings.dangerZone.title", "Ownership and danger zone")}
          description={t(
            "settings.dangerZone.description",
            "Transfer ownership before leaving, or remove this workspace from active use.",
          )}
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(true)}>
              {t("settings.transferOwnership", "Transfer ownership")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />{" "}
              {t("settings.deleteWorkspace", "Delete workspace")}
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel
          title={t("settings.leaveWorkspace.title", "Leave workspace")}
          description={t(
            "settings.leaveWorkspace.description",
            "Your membership and workspace access will be removed.",
          )}
        >
          <Button variant="destructive" onClick={() => setLeaveOpen(true)}>
            {t("settings.leaveWorkspace.action", "Leave workspace")}
          </Button>
        </Panel>
      )}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="mx-4 w-[calc(100vw-2rem)] rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle>
              {t("settings.transferOwnership", "Transfer ownership")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.transferOwnershipDescription",
                "The selected member becomes owner and your role changes to Administrator.",
              )}
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm font-medium">
            {t("settings.newOwner", "New owner")}
            <select
              value={transferTarget}
              onChange={(event) => setTransferTarget(event.target.value)}
              className="mt-2 h-10 w-full rounded-lg border border-[#dce3de] bg-white px-3 dark:border-dark-border dark:bg-dark-tertiary"
            >
              <option value="">
                {t("settings.selectMember", "Select a member")}
              </option>
              {members.data?.data
                ?.filter((member) => member.userId !== user?.id)
                .map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name || member.email} · {member.role}
                  </option>
                ))}
            </select>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              disabled={!transferTarget || transferOwnership.isPending}
              onClick={() => void transferWorkspace()}
              className="bg-[#0b7a55] text-white hover:bg-[#096747]"
            >
              {transferOwnership.isPending
                ? t("settings.transferring", "Transferring…")
                : t("settings.transferOwnership", "Transfer ownership")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="mx-4 w-[calc(100vw-2rem)] rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle>
              {t("settings.leaveWorkspaceConfirm", {
                defaultValue: "Leave {{name}}?",
                name: activeWorkspace.name,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.leaveWorkspaceWarning",
                "You will immediately lose access to its conversations and settings.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={leaveCompany.isPending}
              onClick={() => void leaveWorkspace()}
            >
              {leaveCompany.isPending
                ? t("settings.leaving", "Leaving…")
                : t("settings.leaveWorkspace.action", "Leave workspace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="mx-4 w-[calc(100vw-2rem)] rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle>
              {t("settings.deleteWorkspaceConfirm", {
                defaultValue: "Delete {{name}}?",
                name: activeWorkspace.name,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.deleteWorkspaceWarning",
                "This action cannot be undone. Conversations, settings, and team access will be removed.",
              )}
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm font-medium">
            <Trans
              i18nKey="settings.deleteWorkspaceTypeToConfirm"
              values={{ name: activeWorkspace.name }}
              defaults="Type <strong>{{name}}</strong> to confirm"
              components={{ strong: <strong /> }}
            />
            <Input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="mt-2"
              autoComplete="off"
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleteConfirmation !== activeWorkspace.name ||
                deleteCompany.isPending
              }
              onClick={() => void deleteWorkspace()}
            >
              {deleteCompany.isPending
                ? t("common.deleting", "Deleting…")
                : t("settings.deleteWorkspace", "Delete workspace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppearanceSettings() {
  const { t } = useTranslation();

  const { openHelpModal } = useKeyboardShortcutsContext();
  return (
    <div className="space-y-5">
      <Panel
        title={t("settings.themePanel.title", "Theme")}
        description={t(
          "settings.themePanel.description",
          "Cycle between light, dark, and your system preference.",
        )}
      >
        <ThemeToggle className="rounded-xl border border-[#dce3de] dark:border-dark-border" />
      </Panel>
      <Panel
        title={t("settings.languagePanel.title", "Language")}
        description={t(
          "settings.languagePanel.description",
          "Choose the language used by the application interface.",
        )}
      >
        <LanguageSwitcher showLabel={false} />
      </Panel>
      <Panel
        title={t("settings.shortcuts.title", "Keyboard shortcuts")}
        description={t(
          "settings.shortcuts.description",
          "Review the keys available for faster navigation.",
        )}
      >
        <Button variant="outline" onClick={openHelpModal} className="gap-2">
          <Keyboard className="h-4 w-4" /> View shortcuts
        </Button>
      </Panel>
    </div>
  );
}

function DataSettings() {
  const { t } = useTranslation();

  const { can, activeWorkspace } = useWorkspace();
  const [showImport, setShowImport] = useState(false);
  return (
    <>
      <div className="space-y-5">
        {can("can_assign_contacts") && (
          <Panel
            title={t("settings.contactImportPanel.title", "Contact import")}
            description={t(
              "settings.contactImportPanel.description",
              "Add contacts from a reviewed CSV file.",
            )}
          >
            <Button variant="outline" onClick={() => setShowImport(true)}>
              {t("settings.importContactsAction", "Import contacts")}
            </Button>
          </Panel>
        )}
        {can("can_export") && (
          <Panel
            title={t("settings.exports.title", "Exports")}
            description={t(
              "settings.exports.description",
              "Workspace exports are available from the relevant Dashboard and Audit views.",
            )}
          >
            <p className="text-sm text-[#65736d] dark:text-dark-text-secondary">
              {t("settings.exportsScope", {
                defaultValue: "Exports contain data from {{name}} only.",
                name: activeWorkspace?.name,
              })}
            </p>
          </Panel>
        )}
      </div>
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="mx-4 max-h-[92dvh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto rounded-2xl p-0 sm:w-full">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {t("settings.importContactsAction", "Import contacts")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.importContactsDescription",
                "Review and import contacts into the current workspace.",
              )}
            </DialogDescription>
          </DialogHeader>
          <ContactImport
            onClose={() => setShowImport(false)}
            onImportComplete={() => setShowImport(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6">
      {title && <h3 className="font-semibold">{title}</h3>}
      {description && (
        <p className="mb-5 mt-1 text-sm leading-6 text-[#65736d] dark:text-dark-text-secondary">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

function Fact({
  label,
  value,
  capitalize = false,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-[#829089]">{label}</dt>
      <dd
        className={cn("mt-1 text-sm font-semibold", capitalize && "capitalize")}
      >
        {value}
      </dd>
    </div>
  );
}

function formatWorkspaceDate(t: TFunction, value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("settings.notAvailable", "Not available")
    : date.toLocaleDateString();
}
