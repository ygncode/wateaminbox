import {
  AlertTriangle,
  ArrowRight,
  MessageCircleMore,
  RefreshCw,
} from "lucide-react";
import { Button } from "./button";

function OnboardingFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#edf4f0] px-3 py-3 text-slate-950 sm:px-6 sm:py-6 dark:bg-dark-primary dark:text-dark-text-primary">
      <div
        className="pointer-events-none absolute -left-28 -top-28 h-80 w-80 rounded-full bg-[#25d366]/12 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-36 -right-24 h-96 w-96 rounded-full bg-[#075e54]/14 blur-3xl"
        aria-hidden="true"
      />
      <section className="relative mx-auto grid min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,55,43,0.14)] sm:min-h-[calc(100dvh-3rem)] lg:grid-cols-[minmax(0,1.08fr)_minmax(23rem,0.92fr)] dark:border-dark-border dark:bg-dark-elevated dark:shadow-none">
        <div className="flex min-w-0 flex-col p-6 sm:p-9 lg:p-12">
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
          <div className="mx-auto flex w-full max-w-[30rem] flex-1 items-center py-12">
            {children}
          </div>
          <p className="text-xs leading-5 text-slate-400 dark:text-dark-text-tertiary">
            Secure team messaging, designed for focused customer conversations.
          </p>
        </div>

        <aside className="relative hidden overflow-hidden bg-[#073f3a] lg:block">
          <div
            className="absolute inset-0 opacity-[0.16]"
            aria-hidden="true"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, rgba(255,255,255,0.7) 1px, transparent 1.5px)",
              backgroundSize: "24px 24px",
            }}
          />
          <div
            className="absolute -right-32 -top-24 h-80 w-80 rounded-full border-[72px] border-[#25d366]/20"
            aria-hidden="true"
          />
          <div className="absolute inset-x-12 bottom-12 rounded-2xl border border-white/10 bg-white/[0.07] p-5">
            <div className="h-2 w-24 rounded-full bg-white/15" />
            <div className="mt-4 h-2 w-full rounded-full bg-white/10" />
            <div className="mt-2 h-2 w-4/5 rounded-full bg-white/10" />
          </div>
        </aside>
      </section>
    </main>
  );
}

export function OnboardingLoadingScreen({
  message = "Preparing your workspace…",
}: {
  message?: string;
}) {
  return (
    <OnboardingFrame>
      <div className="w-full" role="status" aria-live="polite">
        <div className="relative grid h-14 w-14 place-items-center rounded-2xl bg-[#e2f8e9] text-[#075e54] dark:bg-[#25d366]/15 dark:text-[#52df83]">
          <span className="absolute inset-0 animate-ping rounded-2xl bg-[#25d366]/10" />
          <RefreshCw aria-hidden="true" className="h-6 w-6 animate-spin" />
        </div>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
          Just a moment
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
          {message}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-dark-text-secondary">
          We’re restoring your session and checking workspace access.
        </p>
        <div
          className="mt-8 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-dark-tertiary"
          aria-hidden="true"
        >
          <div className="h-full w-2/5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-[#25d366]" />
        </div>
      </div>
    </OnboardingFrame>
  );
}

export function OnboardingErrorScreen({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <OnboardingFrame>
      <div className="w-full">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
          <AlertTriangle aria-hidden="true" className="h-6 w-6" />
        </span>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
          Workspace unavailable
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
          We couldn’t load your workspace
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-dark-text-secondary">
          Your current page has been preserved. Try loading workspace access
          again, or sign out and return later.
        </p>
        <div
          role="alert"
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-400/[0.07] dark:text-amber-200"
        >
          {message}
        </div>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            onClick={onRetry}
            className="h-12 flex-1 rounded-xl bg-[#075e54] text-white hover:bg-[#064b43]"
          >
            Try again
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={onSignOut}
            className="h-12 flex-1 rounded-xl"
          >
            Sign out
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </OnboardingFrame>
  );
}
