import {
  Check,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "../brand/BrandMark";

type AuthPageShellProps = {
  children: ReactNode;
  variant: "login" | "register" | "recovery";
};

const registerHighlights = [
  "Shared ownership, clear handoffs",
  "Private notes stay with your team",
  "Conversation history in one place",
];

export function AuthPageShell({ children, variant }: AuthPageShellProps) {
  const isRegister = variant === "register";
  const isRecovery = variant === "recovery";

  return (
    <main className="relative h-dvh overflow-hidden bg-[#edf4f0] px-3 py-3 text-slate-950 sm:px-6 sm:py-6 dark:bg-dark-primary dark:text-dark-text-primary">
      <div
        className="pointer-events-none absolute -left-28 -top-28 h-80 w-80 rounded-full bg-[#25d366]/12 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-36 -right-24 h-96 w-96 rounded-full bg-[#075e54]/14 blur-3xl"
        aria-hidden="true"
      />

      <section className="relative mx-auto grid h-full min-h-0 w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/80 bg-white shadow-[0_24px_80px_rgba(15,55,43,0.14)] lg:grid-cols-[minmax(0,1.08fr)_minmax(23rem,0.92fr)] dark:border-dark-border dark:bg-dark-elevated dark:shadow-none">
        <div className="scrollbar-hide flex min-h-0 min-w-0 flex-col overflow-y-auto p-6 sm:p-9 lg:p-12">
          <div className="mb-10 flex items-center gap-3 sm:mb-12">
            <BrandMark className="h-10 w-10 shrink-0 rounded-[0.9rem] object-contain shadow-sm shadow-[#075e54]/20" />
            <div className="leading-none">
              <p className="text-[1.05rem] font-bold tracking-[-0.03em] text-slate-900 dark:text-dark-text-primary">
                WATeamInbox
              </p>
              <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-dark-text-tertiary">
                WhatsApp for teams
              </p>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col justify-center">
            {children}
          </div>

          <p className="mt-10 text-xs leading-5 text-slate-400 dark:text-dark-text-tertiary">
            Secure team messaging, designed for focused customer conversations.
          </p>
        </div>

        <aside className="scrollbar-hide relative hidden min-h-0 overflow-y-auto bg-[#073f3a] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
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
              {isRecovery ? (
                <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-[#8fffb5] shadow-[0_0_0_3px_rgba(143,255,181,0.12)]"
                />
              )}
              {isRegister
                ? "A calmer shared inbox"
                : isRecovery
                  ? "Account recovery"
                  : "Your team is waiting"}
            </div>
            <h2 className="mt-7 max-w-sm text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-balance">
              {isRegister
                ? "One conversation. The whole team in sync."
                : isRecovery
                  ? "A secure way back to your workspace."
                  : "Pick up every conversation right where you left it."}
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-emerald-50/72">
              {isRegister
                ? "Turn customer messages into clear, accountable teamwork—without losing the human touch."
                : isRecovery
                  ? "Reset instructions are sent privately, links are time-limited, and your account details remain protected."
                  : "Assignments, notes, and customer context stay together, so your team can respond with confidence."}
            </p>
          </div>

          <div className="relative mt-10">
            {isRecovery ? <RecoveryPreview /> : <ConversationPreview />}
          </div>

          <div className="relative mt-9 flex items-center gap-3 border-t border-white/10 pt-6 text-xs text-emerald-50/65">
            <LockKeyhole aria-hidden="true" className="h-4 w-4" />
            Your workspace data stays private to your team.
          </div>
        </aside>
      </section>
    </main>
  );
}

function ConversationPreview() {
  return (
    <div>
      <div className="rounded-2xl border border-white/15 bg-white/[0.09] p-4 shadow-2xl shadow-black/10 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[#d9fdd3] text-sm font-bold text-[#075e54]">
            SM
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Sara Mitchell</p>
            <p className="mt-0.5 text-xs text-emerald-50/55">
              Online now · Acme &amp; Co.
            </p>
          </div>
          <span className="h-2 w-2 rounded-full bg-[#25d366]" />
        </div>

        <div className="mt-5 rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm leading-5 text-slate-700 shadow-sm">
          Thanks! Could you send the updated quote before 3pm?
          <p className="mt-1 text-right text-[0.65rem] text-slate-400">10:42</p>
        </div>

        <div className="ml-9 mt-3 rounded-2xl rounded-br-md bg-[#d9fdd3] px-4 py-3 text-sm leading-5 text-[#16483f] shadow-sm">
          Absolutely—Maya is preparing it now. We’ll send it shortly.
          <p className="mt-1 flex items-center justify-end gap-1 text-[0.65rem] text-[#537d73]">
            10:43 <Check aria-hidden="true" className="h-3 w-3" />
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-emerald-50/75">
            <UsersRound aria-hidden="true" className="h-3.5 w-3.5" />
            Assigned to Maya
          </div>
          <span className="rounded-full bg-[#25d366]/18 px-2 py-1 text-[0.65rem] font-semibold text-[#8fffb5]">
            In progress
          </span>
        </div>
      </div>

      <ul className="mt-5 grid gap-2">
        {registerHighlights.map((item) => (
          <li
            key={item}
            className="flex items-center gap-2.5 text-xs text-emerald-50/70"
          >
            <CheckCircle2
              aria-hidden="true"
              className="h-4 w-4 text-[#52df83]"
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecoveryPreview() {
  const steps = [
    {
      number: "01",
      title: "Request received",
      detail: "Enter the email linked to your workspace.",
    },
    {
      number: "02",
      title: "Secure link sent",
      detail: "Follow the time-limited link in your inbox.",
    },
    {
      number: "03",
      title: "Choose a new password",
      detail: "Return to your team with a fresh sign-in.",
    },
  ];

  return (
    <ol className="rounded-2xl border border-white/15 bg-white/[0.09] p-5 shadow-2xl shadow-black/10 backdrop-blur">
      {steps.map((step, index) => (
        <li key={step.number} className="relative flex gap-4 pb-6 last:pb-0">
          {index < steps.length - 1 && (
            <span
              className="absolute left-[1.05rem] top-9 h-[calc(100%-1.75rem)] w-px bg-white/15"
              aria-hidden="true"
            />
          )}
          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#52df83]/35 bg-[#25d366]/15 text-[0.65rem] font-bold tracking-wider text-[#8fffb5]">
            {step.number}
          </span>
          <div className="pt-0.5">
            <p className="text-sm font-semibold">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-emerald-50/60">
              {step.detail}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
