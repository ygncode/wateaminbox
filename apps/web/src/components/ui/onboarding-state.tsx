import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { BrandMark } from "../brand/BrandMark";
import { Button } from "./button";
import { useTranslation } from "react-i18next";

function OnboardingFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <main className="relative min-h-dvh overflow-hidden bg-muted px-3 py-3 text-fg sm:px-6 sm:py-6">
      <section className="relative mx-auto grid min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-line bg-surface shadow-lg sm:min-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1.08fr)_minmax(23rem,0.92fr)]">
        <div className="flex min-w-0 flex-col p-6 sm:p-9 lg:p-12">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10 shrink-0 rounded-[0.9rem] object-contain shadow-sm" />
            <div className="leading-none">
              <p className="text-[1.05rem] font-bold tracking-[-0.03em] text-fg">
                WATeamInbox
              </p>
              <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-fg-muted">
                {t("setup.whatsappForTeams", "WhatsApp for teams")}
              </p>
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-[30rem] flex-1 items-center py-12">
            {children}
          </div>
          <p className="text-xs leading-5 text-fg-subtle">
            {t(
              "onboarding.tagline",
              "Secure team messaging, designed for focused customer conversations.",
            )}
          </p>
        </div>

        <aside className="relative hidden overflow-hidden bg-nav text-nav-fg lg:block">
          <div
            className="absolute inset-0 opacity-[0.16]"
            aria-hidden="true"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, rgba(255,255,255,0.5) 1px, transparent 1.5px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div
            className="absolute -end-32 -top-24 h-80 w-80 rounded-full border-[72px] border-nav-fg/10"
            aria-hidden="true"
          />
          <div className="absolute inset-x-12 bottom-12 rounded-2xl border border-nav-fg/10 bg-nav-hover p-5">
            <div className="h-2 w-24 rounded-full bg-nav-active" />
            <div className="mt-4 h-2 w-full rounded-full bg-nav-hover" />
            <div className="mt-2 h-2 w-4/5 rounded-full bg-nav-hover" />
          </div>
        </aside>
      </section>
    </main>
  );
}

export function OnboardingLoadingScreen({ message }: { message?: string }) {
  const { t } = useTranslation();

  return (
    <OnboardingFrame>
      <div className="w-full" role="status" aria-live="polite">
        <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          <span className="absolute inset-0 animate-ping rounded-2xl bg-accent/10" />
          <RefreshCw aria-hidden="true" className="h-6 w-6 animate-spin" />
        </div>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.16em] text-accent">
          {t("onboarding.justAMoment", "Just a moment")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg text-balance sm:text-4xl">
          {message ??
            t("onboarding.preparingWorkspace", "Preparing your workspace…")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-fg-muted">
          {t(
            "onboarding.restoringSession",
            "We’re restoring your session and checking workspace access.",
          )}
        </p>
        <div
          className="mt-8 h-1.5 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <div className="h-full w-2/5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      </div>
    </OnboardingFrame>
  );
}

export function OnboardingErrorScreen({
  message,
  onRetry,
  onSignOut,
  eyebrow,
  title,
  hint,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
  /** Override the default "Workspace unavailable" framing. */
  eyebrow?: string;
  title?: string;
  hint?: string;
}) {
  const { t } = useTranslation();

  return (
    <OnboardingFrame>
      <div className="w-full">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-warning-soft text-warning">
          <AlertTriangle aria-hidden="true" className="h-6 w-6" />
        </span>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.16em] text-warning">
          {eyebrow ??
            t("onboarding.workspaceUnavailable", "Workspace unavailable")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg text-balance sm:text-4xl">
          {title ??
            t("onboarding.couldNotLoad", "We couldn’t load your workspace")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-fg-muted">
          {hint ??
            t(
              "onboarding.couldNotLoadHint",
              "Your current page has been preserved. Try loading workspace access again, or sign out and return later.",
            )}
        </p>
        <div
          role="alert"
          className="mt-6 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          {message}
        </div>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            onClick={onRetry}
            className="h-12 flex-1 rounded-xl bg-primary text-on-primary hover:bg-primary-hover"
          >
            {t("onboarding.tryAgain", "Try again")}
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={onSignOut}
            className="h-12 flex-1 rounded-xl"
          >
            {t("nav.signOut", "Sign out")}
            <ArrowRight aria-hidden="true" className="rtl:-scale-x-100" />
          </Button>
        </div>
      </div>
    </OnboardingFrame>
  );
}
