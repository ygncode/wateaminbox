import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { BrandMark } from "../components/brand/BrandMark";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { useCreateCompany } from "../hooks/useTeam";
import { getWorkspaceBillingUrl } from "../lib/billing-url";
import {
  type CompanySetupFormData,
  companySetupSchema,
} from "../lib/schemas/auth";
import {
  prepareWorkspaceLogo,
  validateWorkspaceLogo,
  WORKSPACE_LOGO_INPUT_BYTES,
  WORKSPACE_LOGO_SIZE,
} from "../lib/workspace-logo";
import { workspacePath } from "../lib/workspace-routes";

function workspaceMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "WA";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function CompanySetupPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const { logout } = useAuth();
  const { refreshWorkspaces, switchWorkspace } = useWorkspace();
  const createCompany = useCreateCompany();
  const logoInputRef = React.useRef<HTMLInputElement>(null);
  const [logoDataUrl, setLogoDataUrl] = React.useState<string | null>(null);
  const [logoError, setLogoError] = React.useState<string | null>(null);
  const [isProcessingLogo, setIsProcessingLogo] = React.useState(false);
  const [isDraggingLogo, setIsDraggingLogo] = React.useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CompanySetupFormData>({
    resolver: zodResolver(companySetupSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const workspaceName = watch("name");
  const description = watch("description") ?? "";
  const previewName = workspaceName.trim() || t("setup.defaultWorkspaceName");
  const previewDescription =
    description.trim() || t("setup.defaultDescription");

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
    setLogoError(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const onSubmit = (data: CompanySetupFormData) => {
    const trimmedDescription = data.description?.trim();
    createCompany.mutate(
      {
        name: data.name.trim(),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        ...(logoDataUrl ? { logoDataUrl } : {}),
      },
      {
        onSuccess: async (created) => {
          await refreshWorkspaces();
          await switchWorkspace(created.id);
          const billingUrl = getWorkspaceBillingUrl(created.id, {
            onboarding: true,
          });
          // Private Cloud deployments use the configured billing destination to
          // present the post-setup start choice. OSS remains unaware of plans,
          // prices, trial policy, and payment providers.
          if (billingUrl) {
            window.location.assign(billingUrl);
            return;
          }
          navigate(workspacePath(created.id), { replace: true });
        },
      },
    );
  };

  const isBusy = createCompany.isPending || isProcessingLogo;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas px-3 py-3 text-fg sm:px-6 sm:py-6">
      <section className="relative mx-auto grid min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-line/80 bg-surface shadow-lg sm:min-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1.06fr)_minmax(22rem,0.94fr)]">
        <div className="flex min-w-0 flex-col p-6 sm:p-9 lg:p-12">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BrandMark className="h-10 w-10 shrink-0 rounded-[0.9rem] object-contain shadow-sm" />
              <div className="leading-none">
                <p className="text-[1.05rem] font-bold tracking-[-0.03em] text-fg">
                  WATeamInbox
                </p>
                <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-fg-subtle">
                  {t("setup.whatsappForTeams", "WhatsApp for teams")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label={t("nav.signOut", "Sign out")}
              className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-fg-muted transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {t("nav.signOut", "Sign out")}
              </span>
            </button>
          </div>

          <div className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col justify-center py-10 lg:py-12">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">
              {t("setup.oneLastStep", "One last step")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg text-balance sm:text-4xl">
              {t("setup.title", "Give your workspace an identity")}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-fg-muted">
              {t(
                "setup.subtitle",
                "Help teammates recognize the right inbox at a glance. You can start with just a name, or add more context now.",
              )}
            </p>

            {createCompany.error && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm leading-5 text-danger"
              >
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  {createCompany.error instanceof Error
                    ? createCompany.error.message
                    : t("setup.createFailed", "Failed to create workspace")}
                </span>
              </div>
            )}

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="mt-8 space-y-6 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-line-strong [&_input]:bg-raised [&_input]:px-3.5"
              aria-busy={isBusy}
              noValidate
            >
              <fieldset disabled={isBusy}>
                <legend className="mb-2 text-sm font-semibold text-fg-muted">
                  {t("settings.workspaceLogo")}{" "}
                  <span className="font-normal text-fg-subtle">
                    {t("setup.optional")}
                  </span>
                </legend>

                <div
                  className={`relative rounded-2xl border border-dashed p-3 transition-colors ${
                    logoError
                      ? "border-danger bg-danger-soft/40"
                      : isDraggingLogo
                        ? "border-accent bg-accent-soft"
                        : "border-line-strong bg-subtle/70 hover:border-accent hover:bg-muted"
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsDraggingLogo(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(event.relatedTarget as Node)
                    )
                      setIsDraggingLogo(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDraggingLogo(false);
                    void handleLogo(event.dataTransfer.files[0]);
                  }}
                >
                  <input
                    ref={logoInputRef}
                    id="workspace-logo"
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.gif,.avif,image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) =>
                      void handleLogo(event.target.files?.[0])
                    }
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="flex w-full cursor-pointer items-center gap-4 rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-accent-soft text-accent shadow-sm">
                      {isProcessingLogo ? (
                        <LoaderCircle
                          aria-label={t(
                            "setup.processingLogo",
                            "Processing logo",
                          )}
                          className="h-6 w-6 animate-spin"
                        />
                      ) : logoDataUrl ? (
                        <img
                          src={logoDataUrl}
                          alt={t(
                            "setup.logoPreviewAlt",
                            "Workspace logo preview",
                          )}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImagePlus aria-hidden="true" className="h-6 w-6" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                        <Upload aria-hidden="true" className="h-4 w-4" />
                        {logoDataUrl
                          ? t(
                              "setup.chooseDifferentLogo",
                              "Choose a different logo",
                            )
                          : t("setup.uploadLogo", "Upload logo")}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-fg-subtle">
                        {t("setup.logoHint", {
                          defaultValue:
                            "PNG, JPEG, WebP, GIF, or AVIF · max {{mb}} MB · automatically cropped to {{size}} × {{size}}",
                          mb: WORKSPACE_LOGO_INPUT_BYTES / 1024 / 1024,
                          size: WORKSPACE_LOGO_SIZE,
                        })}
                      </span>
                      {logoDataUrl && !isProcessingLogo && (
                        <span className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-accent">
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                          {t("setup.logoReady", "Logo ready")}
                        </span>
                      )}
                    </span>
                  </button>
                  {logoDataUrl && !isProcessingLogo && (
                    <button
                      type="button"
                      onClick={removeLogo}
                      className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                      aria-label={t(
                        "setup.removeLogo",
                        "Remove workspace logo",
                      )}
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {logoError && (
                  <p
                    role="alert"
                    className="mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-4 text-danger"
                  >
                    <CircleAlert
                      aria-hidden="true"
                      className="mt-px h-3.5 w-3.5 shrink-0"
                    />
                    {logoError}
                  </p>
                )}
              </fieldset>

              <FormField
                label={t("settings.workspaceName", "Workspace name")}
                id="companyName"
                type="text"
                placeholder={t("setup.namePlaceholder", "Northwind Support")}
                registration={register("name")}
                error={errors.name}
                autoComplete="organization"
                autoFocus
                disabled={isBusy}
              />

              <div className="group">
                <div className="mb-1.5 flex items-center justify-between gap-4">
                  <label
                    htmlFor="companyDescription"
                    className={`text-sm font-semibold transition-colors group-focus-within:text-accent  ${
                      errors.description ? "text-danger" : "text-fg-muted"
                    }`}
                  >
                    {t("settings.description", "Description")}{" "}
                    <span className="font-normal text-fg-subtle">
                      {t("setup.optional", "(optional)")}
                    </span>
                  </label>
                  <span className="text-[0.68rem] tabular-nums text-fg-subtle">
                    {description.length}/280
                  </span>
                </div>
                <textarea
                  id="companyDescription"
                  rows={3}
                  maxLength={280}
                  placeholder={t(
                    "settings.descriptionPlaceholder",
                    "What does this team handle?",
                  )}
                  disabled={isBusy}
                  aria-invalid={errors.description ? "true" : "false"}
                  aria-describedby={
                    errors.description ? "companyDescription-error" : undefined
                  }
                  className="w-full resize-none rounded-xl border border-line-strong bg-raised px-3.5 py-3 text-sm leading-5 text-fg shadow-sm transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-fg-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-ring/20 aria-invalid:border-danger aria-invalid:bg-danger-soft/35 aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-60"
                  {...register("description")}
                />
                {errors.description && (
                  <p
                    id="companyDescription-error"
                    role="alert"
                    className="mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-4 text-danger"
                  >
                    <CircleAlert
                      aria-hidden="true"
                      className="mt-px h-3.5 w-3.5 shrink-0"
                    />
                    {errors.description.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                className="h-12 w-full rounded-xl bg-primary text-on-primary shadow-lg hover:bg-accent-soft"
                disabled={isBusy}
              >
                {createCompany.isPending ? (
                  <>
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                    {t("setup.creatingWorkspace", "Creating workspace…")}
                  </>
                ) : isProcessingLogo ? (
                  <>
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                    {t("setup.preparingLogo", "Preparing logo…")}
                  </>
                ) : (
                  <>
                    {t("setup.createWorkspace", "Create workspace")}
                    <ArrowRight
                      aria-hidden="true"
                      className="rtl:-scale-x-100"
                    />
                  </>
                )}
              </Button>
            </form>
          </div>

          <p className="text-xs leading-5 text-fg-subtle">
            {t(
              "setup.visibilityNote",
              "Workspace details are visible only to invited team members.",
            )}
          </p>
        </div>

        <aside className="relative hidden overflow-hidden bg-nav p-10 text-nav-fg lg:flex lg:flex-col lg:justify-between xl:p-12">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            aria-hidden="true"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, rgba(255,255,255,0.5) 1px, transparent 1.5px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div
            className="pointer-events-none absolute -end-32 -top-24 h-80 w-80 rounded-full border-[72px] border-nav-line"
            aria-hidden="true"
          />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-nav-line bg-nav-hover px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-nav-fg">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-accent-soft"
              />
              {t("setup.livePreview", "Live workspace preview")}
            </div>
            <h2 className="mt-7 max-w-sm text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-balance">
              {t(
                "setup.previewHeadline",
                "Make the right inbox instantly recognizable.",
              )}
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-nav-fg/80">
              {t(
                "setup.previewBody",
                "Your name, description, and logo help teammates switch contexts without losing focus.",
              )}
            </p>
          </div>

          <div className="relative my-10 rounded-[1.5rem] border border-white/15 bg-white/[0.09] p-5 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-accent-soft text-lg font-bold tracking-wide text-accent shadow-lg">
                {logoDataUrl ? (
                  <img
                    src={logoDataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  workspaceMonogram(previewName)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold tracking-[-0.02em]">
                  {previewName}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-nav-fg-muted">
                  {previewDescription}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-nav-line bg-nav-hover p-3">
                <UsersRound
                  aria-hidden="true"
                  className="h-4 w-4 text-nav-badge"
                />
                <p className="mt-3 text-xs font-semibold">
                  {t("setup.inviteYourTeam", "Invite your team")}
                </p>
                <p className="mt-1 text-[0.68rem] text-nav-fg-muted">
                  {t("setup.addMembersAfter", "Add members after setup")}
                </p>
              </div>
              <div className="rounded-xl border border-nav-line bg-nav-hover p-3">
                <Building2
                  aria-hidden="true"
                  className="h-4 w-4 text-nav-badge"
                />
                <p className="mt-3 text-xs font-semibold">
                  {t("setup.privateWorkspace", "Private workspace")}
                </p>
                <p className="mt-1 text-[0.68rem] text-nav-fg-muted">
                  {t("setup.separateData", "Separate data and access")}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-nav-active px-3 py-2.5 text-xs text-nav-badge">
              <Check aria-hidden="true" className="h-4 w-4" />
              {t(
                "setup.readyForConnection",
                "Ready for your first WhatsApp connection",
              )}
            </div>
          </div>

          <div className="relative flex items-center gap-3 border-t border-nav-line pt-6 text-xs text-nav-fg-muted">
            <LockKeyhole aria-hidden="true" className="h-4 w-4" />
            {t("setup.ownerNote", "You’ll be the owner of this workspace.")}
          </div>
        </aside>
      </section>
    </main>
  );
}
