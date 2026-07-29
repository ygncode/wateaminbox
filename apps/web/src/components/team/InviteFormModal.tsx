import { zodResolver } from "@hookform/resolvers/zod";
import {
  type MemberPermissions,
  ROLE_PERMISSION_PRESETS,
} from "@wateaminbox/shared";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Mail,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { useInviteMember } from "@/hooks/useTeam";
import {
  type InviteTeamMemberFormData,
  inviteTeamMemberSchema,
} from "@/lib/schemas/team";
import { cn } from "@/lib/utils";
import { permissionGroups, permissionOptions } from "./permission-options";
import type { InviteFormModalProps } from "./types";

type AccessMode = "defaults" | "custom";
type InviteStep = "details" | "review";

function permissionOverrides(
  role: "admin" | "member",
  permissions: MemberPermissions,
): Partial<MemberPermissions> {
  const defaults = ROLE_PERMISSION_PRESETS[role];
  const overrides: Partial<MemberPermissions> = {};
  for (const key of Object.keys(defaults) as Array<keyof MemberPermissions>) {
    if (permissions[key] !== defaults[key]) {
      overrides[key] = permissions[key];
    }
  }
  return overrides;
}

/** Two-step invitation flow with owner-only access customization. */
export function InviteFormModal({
  companyId,
  currentUserRole,
  onClose,
}: InviteFormModalProps) {
  const inviteMember = useInviteMember();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [step, setStep] = useState<InviteStep>("details");
  const [accessMode, setAccessMode] = useState<AccessMode>("defaults");
  const [permissions, setPermissions] = useState<MemberPermissions>({
    ...ROLE_PERMISSION_PRESETS.member,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<InviteTeamMemberFormData>({
    resolver: zodResolver(inviteTeamMemberSchema),
    defaultValues: {
      email: "",
      role: "member",
    },
    mode: "onChange",
  });

  const email = watch("email");
  const role = watch("role");
  const canCustomizeAccess = currentUserRole === "owner";
  const canInviteAdmin = currentUserRole !== "member";
  const effectivePermissions =
    accessMode === "custom" ? permissions : ROLE_PERMISSION_PRESETS[role];
  const enabledPermissions = permissionOptions.filter(
    (option) => effectivePermissions[option.key],
  );
  const overrideCount =
    accessMode === "custom"
      ? Object.keys(permissionOverrides(role, permissions)).length
      : 0;
  const hasCustomOverrides = accessMode === "custom" && overrideCount > 0;

  const selectRole = (nextRole: "admin" | "member") => {
    setValue("role", nextRole, { shouldValidate: true });
    setAccessMode("defaults");
    setPermissions({ ...ROLE_PERMISSION_PRESETS[nextRole] });
  };

  const onSubmit = async (data: InviteTeamMemberFormData) => {
    setSubmitError(null);
    try {
      await inviteMember.mutateAsync({
        companyId,
        email: data.email,
        role: data.role,
        permissions: hasCustomOverrides
          ? permissionOverrides(data.role, permissions)
          : undefined,
      });
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Could not send invitation",
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="mx-4 max-h-[92dvh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl border-[#dce3de] p-0 [&>button]:right-4 [&>button]:top-4 [&>button]:grid [&>button]:h-8 [&>button]:w-8 [&>button]:place-items-center [&>button]:rounded-full [&>button]:border [&>button]:border-[#d7e0da] [&>button]:bg-white [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:transition-colors hover:[&>button]:bg-[#edf3ef] sm:w-full dark:border-dark-border dark:[&>button]:border-dark-border dark:[&>button]:bg-dark-elevated dark:hover:[&>button]:bg-dark-tertiary">
        <div className="border-b border-[#e6ebe7] bg-[#f8faf8] py-4 pl-5 pr-16 dark:border-dark-border dark:bg-dark-tertiary/40 sm:pl-6 sm:pr-20">
          <div
            className="mb-4"
            aria-label="Step progress"
            aria-valuemin={1}
            aria-valuemax={2}
            aria-valuenow={step === "details" ? 1 : 2}
            role="progressbar"
          >
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                <span className="text-[#075c41] dark:text-emerald-300">
                  Details
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9ca9a2]" />
                <span
                  className={
                    step === "review"
                      ? "text-[#075c41] dark:text-emerald-300"
                      : "text-[#89968f] dark:text-dark-text-secondary"
                  }
                >
                  Review
                </span>
              </div>
              <span className="shrink-0 rounded-full border border-[#d7e0da] bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#65736d] shadow-sm dark:border-dark-border dark:bg-dark-elevated dark:text-dark-text-secondary">
                Step {step === "details" ? "1" : "2"} of 2
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#dce3de] dark:bg-dark-border">
              <div
                className={cn(
                  "h-full rounded-full bg-[#0b7a55] transition-[width] duration-300 ease-out dark:bg-emerald-500",
                  step === "details" ? "w-1/2" : "w-full",
                )}
              />
            </div>
          </div>
          <DialogHeader>
            <DialogTitle>
              {step === "details" ? "Invite team member" : "Review invitation"}
            </DialogTitle>
            <DialogDescription>
              {step === "details"
                ? "Choose their workspace role and starting access."
                : "Confirm exactly what access will be granted on acceptance."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {step === "details" ? (
            <div className="space-y-5 px-5 py-5 sm:px-6">
              <FormField
                id="email"
                label="Email address"
                type="email"
                inputMode="email"
                placeholder="colleague@company.com"
                autoComplete="email"
                registration={register("email")}
                error={errors.email}
              />

              <section>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <p
                      id="role-label"
                      className="text-sm font-semibold text-gray-800 dark:text-dark-text-primary"
                    >
                      Workspace role
                    </p>
                    <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
                      Role controls hierarchy as well as default access.
                    </p>
                  </div>
                </div>
                <div
                  className={cn(
                    "grid gap-2",
                    canInviteAdmin ? "grid-cols-2" : "grid-cols-1",
                  )}
                  role="radiogroup"
                  aria-labelledby="role-label"
                >
                  <RoleButton
                    selected={role === "member"}
                    onClick={() => selectRole("member")}
                    icon={Shield}
                    title="Member"
                    description="Handles assigned conversations"
                  />
                  {canInviteAdmin && (
                    <RoleButton
                      selected={role === "admin"}
                      onClick={() => selectRole("admin")}
                      icon={ShieldCheck}
                      title="Admin"
                      description="Broad workspace access"
                    />
                  )}
                </div>
                {errors.role && (
                  <p
                    className="mt-1 text-xs text-red-500 dark:text-red-400"
                    role="alert"
                  >
                    {errors.role.message}
                  </p>
                )}
              </section>

              <section className="overflow-hidden rounded-xl border border-[#dce3de] dark:border-dark-border">
                <div className="flex items-start gap-3 bg-[#f8faf8] px-4 py-3 dark:bg-dark-tertiary/40">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/50 dark:text-emerald-300">
                    <SlidersHorizontal className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Starting access</p>
                    <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
                      Applied when the invitation is accepted.
                    </p>
                  </div>
                </div>

                {canCustomizeAccess ? (
                  <>
                    <div
                      className="grid grid-cols-2 gap-1 border-y border-[#e6ebe7] bg-white p-1.5 dark:border-dark-border dark:bg-dark-elevated"
                      role="radiogroup"
                      aria-label="Invitation access mode"
                    >
                      <AccessModeButton
                        selected={accessMode === "defaults"}
                        onClick={() => {
                          setAccessMode("defaults");
                          setPermissions({ ...ROLE_PERMISSION_PRESETS[role] });
                        }}
                        title="Role defaults"
                        description={`Use the ${role} preset`}
                      />
                      <AccessModeButton
                        selected={accessMode === "custom"}
                        onClick={() => {
                          setAccessMode("custom");
                          setPermissions({ ...ROLE_PERMISSION_PRESETS[role] });
                        }}
                        title="Custom access"
                        description="Override capabilities"
                      />
                    </div>

                    {accessMode === "custom" && (
                      <div className="space-y-4 p-4">
                        {permissionGroups.map((group) => (
                          <fieldset key={group.label}>
                            <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#65736d] dark:text-dark-text-secondary">
                              {group.label}
                            </legend>
                            <div className="grid gap-1 sm:grid-cols-2">
                              {group.options.map((option) => (
                                <label
                                  key={option.key}
                                  className={cn(
                                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                                    permissions[option.key]
                                      ? "border-[#a9d4c1] bg-[#f0f8f4] dark:border-emerald-800 dark:bg-emerald-950/20"
                                      : "border-[#e6ebe7] hover:bg-[#f8faf8] dark:border-dark-border dark:hover:bg-dark-tertiary/50",
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    checked={permissions[option.key]}
                                    onChange={(event) =>
                                      setPermissions((current) => ({
                                        ...current,
                                        [option.key]: event.target.checked,
                                      }))
                                    }
                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#0b7a55]"
                                  />
                                  <span className="min-w-0">
                                    <span className="block text-xs font-semibold">
                                      {option.label}
                                    </span>
                                    <span className="block text-[11px] leading-4 text-[#65736d] dark:text-dark-text-secondary">
                                      {option.description}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="px-4 py-3 text-sm">
                    <p className="font-medium capitalize">
                      {role} role defaults
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
                      Only the workspace owner can customize invitation access.
                      Your role can invite this person with the selected preset.
                    </p>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-4 px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-[#dce3de] bg-[#f8faf8] p-4 dark:border-dark-border dark:bg-dark-tertiary/40">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/50 dark:text-emerald-300">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {role}
                      </Badge>
                      <Badge
                        variant={hasCustomOverrides ? "default" : "outline"}
                      >
                        {hasCustomOverrides
                          ? `${overrideCount} custom ${overrideCount === 1 ? "override" : "overrides"}`
                          : "Role defaults"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <section className="overflow-hidden rounded-xl border border-[#dce3de] dark:border-dark-border">
                <div className="flex items-center justify-between gap-3 border-b border-[#e6ebe7] px-4 py-3 dark:border-dark-border">
                  <div>
                    <p className="text-sm font-semibold">Effective access</p>
                    <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
                      {enabledPermissions.length} of {permissionOptions.length}{" "}
                      capabilities enabled
                    </p>
                  </div>
                  {!effectivePermissions.can_view_all_chats && (
                    <Badge variant="outline">Assigned chats only</Badge>
                  )}
                </div>
                <div className="grid gap-x-5 gap-y-2 p-4 sm:grid-cols-2">
                  {enabledPermissions.map((option) => (
                    <div
                      key={option.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/50 dark:text-emerald-300">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      <span>{option.label}</span>
                    </div>
                  ))}
                </div>
              </section>

              <p className="rounded-lg bg-[#fff8e7] px-3 py-2.5 text-xs leading-5 text-[#735c20] dark:bg-amber-950/20 dark:text-amber-200">
                Team hierarchy remains enforced even when a custom capability is
                enabled.
              </p>
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              className="mx-5 mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300 sm:mx-6"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex gap-2 border-t border-[#e6ebe7] bg-white px-5 py-4 dark:border-dark-border dark:bg-dark-elevated sm:px-6">
            {step === "review" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSubmitError(null);
                  setStep("details");
                }}
                className="gap-1.5"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            )}
            {step === "details" ? (
              <Button
                type="button"
                disabled={!isValid}
                onClick={handleSubmit(() => setStep("review"))}
                className="ml-auto gap-1.5 bg-[#0b7a55] text-white hover:bg-[#096747]"
              >
                Review invitation
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={inviteMember.isPending}
                className="ml-auto bg-[#0b7a55] text-white hover:bg-[#096747]"
              >
                {inviteMember.isPending ? "Sending…" : "Send invitation"}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleButton({
  selected,
  onClick,
  icon: Icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: typeof Shield;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
        selected
          ? "border-[#81bea4] bg-[#f0f8f4] text-[#075c41] dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200"
          : "border-[#dce3de] hover:border-[#b9c8bf] hover:bg-[#f8faf8] dark:border-dark-border dark:hover:bg-dark-tertiary/50",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-[#65736d] dark:text-dark-text-secondary">
          {description}
        </span>
      </span>
    </button>
  );
}

function AccessModeButton({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-2 text-left transition-colors",
        selected
          ? "bg-[#10211b] text-white shadow-sm dark:bg-white dark:text-[#10211b]"
          : "text-[#65736d] hover:bg-[#f4f7f5] dark:text-dark-text-secondary dark:hover:bg-dark-tertiary",
      )}
    >
      <span className="block text-xs font-semibold">{title}</span>
      <span
        className={cn(
          "block text-[10px]",
          selected
            ? "text-white/70 dark:text-[#10211b]/60"
            : "text-[#829089] dark:text-dark-text-tertiary",
        )}
      >
        {description}
      </span>
    </button>
  );
}
