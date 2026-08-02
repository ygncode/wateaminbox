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
  MessageCircleMore,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { useCreateCompany } from "../hooks/useTeam";
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
  const previewName = workspaceName.trim() || "Your workspace";
  const previewDescription =
    description.trim() ||
    "A shared place for your team to manage every customer conversation.";

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
        error instanceof Error ? error.message : "Could not process this logo",
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
          navigate(workspacePath(created.id), { replace: true });
        },
      },
    );
  };

  const isBusy = createCompany.isPending || isProcessingLogo;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#edf4f0] px-3 py-3 text-slate-950 sm:px-6 sm:py-6 dark:bg-dark-primary dark:text-dark-text-primary">
      <div
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#25d366]/12 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-[#075e54]/14 blur-3xl"
        aria-hidden="true"
      />

      <section className="relative mx-auto grid min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,55,43,0.14)] sm:min-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1.06fr)_minmax(22rem,0.94fr)] dark:border-dark-border dark:bg-dark-elevated dark:shadow-none">
        <div className="flex min-w-0 flex-col p-6 sm:p-9 lg:p-12">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-[0.9rem] bg-[#075e54] text-white shadow-sm shadow-[#075e54]/20">
                <MessageCircleMore
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={2.2}
                />
              </span>
              <div className="leading-none">
                <p className="text-[1.05rem] font-bold tracking-[-0.03em] text-slate-900 dark:text-dark-text-primary">
                  WATeamInbox
                </p>
                <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-dark-text-tertiary">
                  WhatsApp for teams
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Sign out"
              className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] dark:text-dark-text-secondary dark:hover:bg-dark-tertiary dark:hover:text-white"
            >
              <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>

          <div className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col justify-center py-10 lg:py-12">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
              One last step
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
              Give your workspace an identity
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
              Help teammates recognize the right inbox at a glance. You can
              start with just a name, or add more context now.
            </p>

            {createCompany.error && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
              >
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  {createCompany.error instanceof Error
                    ? createCompany.error.message
                    : "Failed to create workspace"}
                </span>
              </div>
            )}

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="mt-8 space-y-6 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-slate-300 [&_input]:bg-white [&_input]:px-3.5 dark:[&_input]:border-dark-border dark:[&_input]:bg-dark-tertiary"
              aria-busy={isBusy}
              noValidate
            >
              <fieldset disabled={isBusy}>
                <legend className="mb-2 text-sm font-semibold text-slate-700 dark:text-dark-text-secondary">
                  Workspace logo{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </legend>

                <div
                  className={`relative rounded-2xl border border-dashed p-3 transition-colors ${
                    logoError
                      ? "border-red-400 bg-red-50/40 dark:bg-red-950/10"
                      : isDraggingLogo
                        ? "border-[#0a7c43] bg-[#e7f7ed] dark:bg-[#25d366]/10"
                        : "border-slate-300 bg-slate-50/70 hover:border-[#76b69d] hover:bg-[#f0f8f3] dark:border-dark-border dark:bg-dark-tertiary/45 dark:hover:border-[#52df83]/50"
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
                    className="flex w-full cursor-pointer items-center gap-4 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:focus-visible:ring-[#52df83]"
                  >
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#dcefe7] text-[#075e54] shadow-sm dark:bg-[#25d366]/15 dark:text-[#52df83]">
                      {isProcessingLogo ? (
                        <LoaderCircle
                          aria-label="Processing logo"
                          className="h-6 w-6 animate-spin"
                        />
                      ) : logoDataUrl ? (
                        <img
                          src={logoDataUrl}
                          alt="Workspace logo preview"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImagePlus aria-hidden="true" className="h-6 w-6" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-dark-text-primary">
                        <Upload aria-hidden="true" className="h-4 w-4" />
                        {logoDataUrl
                          ? "Choose a different logo"
                          : "Upload logo"}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-dark-text-tertiary">
                        PNG, JPEG, WebP, GIF, or AVIF · max{" "}
                        {WORKSPACE_LOGO_INPUT_BYTES / 1024 / 1024} MB ·
                        automatically cropped to {WORKSPACE_LOGO_SIZE} ×{" "}
                        {WORKSPACE_LOGO_SIZE}
                      </span>
                      {logoDataUrl && !isProcessingLogo && (
                        <span className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#0a7c43] dark:text-[#52df83]">
                          <Check aria-hidden="true" className="h-3.5 w-3.5" />
                          Logo ready
                        </span>
                      )}
                    </span>
                  </button>
                  {logoDataUrl && !isProcessingLogo && (
                    <button
                      type="button"
                      onClick={removeLogo}
                      className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-dark-secondary"
                      aria-label="Remove workspace logo"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {logoError && (
                  <p
                    role="alert"
                    className="mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-4 text-red-600 dark:text-red-400"
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
                label="Workspace name"
                id="companyName"
                type="text"
                placeholder="Northwind Support"
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
                    className={`text-sm font-semibold transition-colors group-focus-within:text-[#075e54] dark:group-focus-within:text-[#52df83] ${
                      errors.description
                        ? "text-red-600 dark:text-red-400"
                        : "text-slate-700 dark:text-dark-text-secondary"
                    }`}
                  >
                    Description{" "}
                    <span className="font-normal text-slate-400">
                      (optional)
                    </span>
                  </label>
                  <span className="text-[0.68rem] tabular-nums text-slate-400">
                    {description.length}/280
                  </span>
                </div>
                <textarea
                  id="companyDescription"
                  rows={3}
                  maxLength={280}
                  placeholder="What does this team handle?"
                  disabled={isBusy}
                  aria-invalid={errors.description ? "true" : "false"}
                  aria-describedby={
                    errors.description ? "companyDescription-error" : undefined
                  }
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-5 text-slate-900 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-slate-400 hover:border-slate-400 focus:border-[#0a7c43] focus:outline-none focus:ring-[3px] focus:ring-[#25d366]/20 aria-invalid:border-red-500 aria-invalid:bg-red-50/35 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary dark:placeholder:text-dark-text-tertiary dark:hover:border-slate-500 dark:focus:border-[#52df83] dark:focus:ring-[#25d366]/15 dark:aria-invalid:border-red-500 dark:aria-invalid:bg-red-950/10"
                  {...register("description")}
                />
                {errors.description && (
                  <p
                    id="companyDescription-error"
                    role="alert"
                    className="mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-4 text-red-600 dark:text-red-400"
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
                className="h-12 w-full rounded-xl bg-[#075e54] text-white shadow-lg shadow-[#075e54]/15 hover:bg-[#064b43] dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90"
                disabled={isBusy}
              >
                {createCompany.isPending ? (
                  <>
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                    Creating workspace…
                  </>
                ) : isProcessingLogo ? (
                  <>
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                    Preparing logo…
                  </>
                ) : (
                  <>
                    Create workspace
                    <ArrowRight aria-hidden="true" />
                  </>
                )}
              </Button>
            </form>
          </div>

          <p className="text-xs leading-5 text-slate-400 dark:text-dark-text-tertiary">
            Workspace details are visible only to invited team members.
          </p>
        </div>

        <aside className="relative hidden overflow-hidden bg-[#073f3a] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.16]"
            aria-hidden="true"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, rgba(255,255,255,0.7) 1px, transparent 1.5px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div
            className="pointer-events-none absolute -right-32 -top-24 h-80 w-80 rounded-full border-[72px] border-[#25d366]/20"
            aria-hidden="true"
          />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-emerald-50">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-[#8fffb5]"
              />
              Live workspace preview
            </div>
            <h2 className="mt-7 max-w-sm text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-balance">
              Make the right inbox instantly recognizable.
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-emerald-50/72">
              Your name, description, and logo help teammates switch contexts
              without losing focus.
            </p>
          </div>

          <div className="relative my-10 rounded-[1.5rem] border border-white/15 bg-white/[0.09] p-5 shadow-2xl shadow-black/10 backdrop-blur">
            <div className="flex items-center gap-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#d9fdd3] text-lg font-bold tracking-wide text-[#075e54] shadow-lg shadow-black/10">
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
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-emerald-50/60">
                  {previewDescription}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                <UsersRound
                  aria-hidden="true"
                  className="h-4 w-4 text-[#8fffb5]"
                />
                <p className="mt-3 text-xs font-semibold">Invite your team</p>
                <p className="mt-1 text-[0.68rem] text-emerald-50/50">
                  Add members after setup
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                <Building2
                  aria-hidden="true"
                  className="h-4 w-4 text-[#8fffb5]"
                />
                <p className="mt-3 text-xs font-semibold">Private workspace</p>
                <p className="mt-1 text-[0.68rem] text-emerald-50/50">
                  Separate data and access
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-[#25d366]/14 px-3 py-2.5 text-xs text-[#a9fbc5]">
              <Check aria-hidden="true" className="h-4 w-4" />
              Ready for your first WhatsApp connection
            </div>
          </div>

          <div className="relative flex items-center gap-3 border-t border-white/10 pt-6 text-xs text-emerald-50/65">
            <LockKeyhole aria-hidden="true" className="h-4 w-4" />
            You’ll be the owner of this workspace.
          </div>
        </aside>
      </section>
    </main>
  );
}
