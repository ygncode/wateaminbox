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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

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
        error instanceof Error
          ? error.message
          : t("team.inviteFailed", "Could not send invitation"),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="mx-4 max-h-[92dvh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl border-line p-0 [&>button]:end-4 [&>button]:top-4 [&>button]:grid [&>button]:h-8 [&>button]:w-8 [&>button]:place-items-center [&>button]:rounded-full [&>button]:border [&>button]:border-line [&>button]:bg-surface [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:transition-colors hover:[&>button]:bg-muted sm:w-full">
        <div className="border-b border-line bg-subtle py-4 ps-5 pe-16 sm:ps-6 sm:pe-20">
          <div
            className="mb-4"
            aria-label={t("team.stepProgress", "Step progress")}
            aria-valuemin={1}
            aria-valuemax={2}
            aria-valuenow={step === "details" ? 1 : 2}
            role="progressbar"
          >
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                <span className="text-accent">{t("team.stepDetails")}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle rtl:-scale-x-100" />
                <span
                  className={
                    step === "review" ? "text-accent" : "text-fg-muted"
                  }
                >
                  {t("team.stepReview")}
                </span>
              </div>
              <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted shadow-sm">
                {t("team.stepOf", {
                  current: step === "details" ? 1 : 2,
                  total: 2,
                })}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted-strong">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width] duration-300 ease-out",
                  step === "details" ? "w-1/2" : "w-full",
                )}
              />
            </div>
          </div>
          <DialogHeader>
            <DialogTitle>
              {step === "details"
                ? t("team.inviteTeamMember", "Invite team member")
                : t("team.reviewInvitation", "Review invitation")}
            </DialogTitle>
            <DialogDescription>
              {step === "details"
                ? t(
                    "team.inviteStepDetailsHint",
                    "Choose their workspace role and starting access.",
                  )
                : t(
                    "team.inviteStepReviewHint",
                    "Confirm exactly what access will be granted on acceptance.",
                  )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {step === "details" ? (
            <div className="space-y-5 px-5 py-5 sm:px-6">
              <FormField
                id="email"
                label={t("team.emailAddress", "Email address")}
                type="email"
                inputMode="email"
                placeholder={t("team.emailPlaceholder")}
                autoComplete="email"
                registration={register("email")}
                error={errors.email}
              />

              <section>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <p
                      id="role-label"
                      className="text-sm font-semibold text-fg"
                    >
                      {t("team.workspaceRole", "Workspace role")}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {t(
                        "team.workspaceRoleHint",
                        "Role controls hierarchy as well as default access.",
                      )}
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
                    title={t("team.roleMember", "Member")}
                    description={t(
                      "team.roleMemberDescription",
                      "Handles assigned conversations",
                    )}
                  />
                  {canInviteAdmin && (
                    <RoleButton
                      selected={role === "admin"}
                      onClick={() => selectRole("admin")}
                      icon={ShieldCheck}
                      title={t("team.roleAdmin", "Admin")}
                      description={t(
                        "team.roleAdminDescription",
                        "Broad workspace access",
                      )}
                    />
                  )}
                </div>
                {errors.role && (
                  <p className="mt-1 text-xs text-danger" role="alert">
                    {errors.role.message}
                  </p>
                )}
              </section>

              <section className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-start gap-3 bg-subtle px-4 py-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <SlidersHorizontal className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {t("team.startingAccess", "Starting access")}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {t(
                        "team.startingAccessHint",
                        "Applied when the invitation is accepted.",
                      )}
                    </p>
                  </div>
                </div>

                {canCustomizeAccess ? (
                  <>
                    <div
                      className="grid grid-cols-2 gap-1 border-y border-line bg-surface p-1.5"
                      role="radiogroup"
                      aria-label={t(
                        "team.invitationAccessMode",
                        "Invitation access mode",
                      )}
                    >
                      <AccessModeButton
                        selected={accessMode === "defaults"}
                        onClick={() => {
                          setAccessMode("defaults");
                          setPermissions({ ...ROLE_PERMISSION_PRESETS[role] });
                        }}
                        title={t("team.roleDefaults", "Role defaults")}
                        description={t("team.useRolePreset", {
                          defaultValue: "Use the {{role}} preset",
                          role,
                        })}
                      />
                      <AccessModeButton
                        selected={accessMode === "custom"}
                        onClick={() => {
                          setAccessMode("custom");
                          setPermissions({ ...ROLE_PERMISSION_PRESETS[role] });
                        }}
                        title={t("team.customAccess", "Custom access")}
                        description={t(
                          "team.overrideCapabilitiesShort",
                          "Override capabilities",
                        )}
                      />
                    </div>

                    {accessMode === "custom" && (
                      <div className="space-y-4 p-4">
                        {permissionGroups.map((group) => (
                          <fieldset key={group.label}>
                            <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">
                              {group.label}
                            </legend>
                            <div className="grid gap-1 sm:grid-cols-2">
                              {group.options.map((option) => (
                                <label
                                  key={option.key}
                                  className={cn(
                                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                                    permissions[option.key]
                                      ? "border-accent/30 bg-subtle"
                                      : "border-line hover:bg-muted",
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
                                    className="mt-0.5 h-4 w-4 rounded border-line-strong accent-primary"
                                  />
                                  <span className="min-w-0">
                                    <span className="block text-xs font-semibold">
                                      {option.label}
                                    </span>
                                    <span className="block text-[11px] leading-4 text-fg-muted">
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
                      {t("team.roleDefaultsFor", {
                        defaultValue: "{{role}} role defaults",
                        role,
                      })}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-fg-muted">
                      {t(
                        "team.ownerOnlyCustomAccess",
                        "Only the workspace owner can customize invitation access. Your role can invite this person with the selected preset.",
                      )}
                    </p>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-4 px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-line bg-subtle p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
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
                          ? t("team.customOverrideCount", {
                              defaultValue: "{{count}} custom override",
                              count: overrideCount,
                            })
                          : t("team.roleDefaults", "Role defaults")}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <section className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {t("team.effectiveAccess", "Effective access")}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {t("team.capabilitiesEnabled", {
                        defaultValue:
                          "{{enabled}} of {{total}} capabilities enabled",
                        enabled: enabledPermissions.length,
                        total: permissionOptions.length,
                      })}
                    </p>
                  </div>
                  {!effectivePermissions.can_view_all_chats && (
                    <Badge variant="outline">
                      {t("team.assignedChatsOnly", "Assigned chats only")}
                    </Badge>
                  )}
                </div>
                <div className="grid gap-x-5 gap-y-2 p-4 sm:grid-cols-2">
                  {enabledPermissions.map((option) => (
                    <div
                      key={option.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      <span>{option.label}</span>
                    </div>
                  ))}
                </div>
              </section>

              <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning">
                {t(
                  "team.hierarchyEnforcedNote",
                  "Team hierarchy remains enforced even when a custom capability is enabled.",
                )}
              </p>
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              className="mx-5 mb-4 flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger sm:mx-6"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex gap-2 border-t border-line bg-surface px-5 py-4 sm:px-6">
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
                <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
                {t("common.back")}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
            )}
            {step === "details" ? (
              <Button
                type="button"
                disabled={!isValid}
                onClick={handleSubmit(() => setStep("review"))}
                className="ms-auto gap-1.5 bg-primary text-on-primary hover:bg-primary-hover"
              >
                {t("team.reviewInvitation", "Review invitation")}
                <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={inviteMember.isPending}
                className="ms-auto bg-primary text-on-primary hover:bg-primary-hover"
              >
                {inviteMember.isPending
                  ? t("team.sending", "Sending…")
                  : t("team.sendInvitation", "Send invitation")}
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
        "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-start transition-colors",
        selected
          ? "border-accent bg-subtle text-accent"
          : "border-line hover:border-line-strong hover:bg-muted",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-fg-muted">{description}</span>
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
        "rounded-lg px-3 py-2 text-start transition-colors",
        selected
          ? "bg-primary text-on-primary shadow-sm"
          : "text-fg-muted hover:bg-muted",
      )}
    >
      <span className="block text-xs font-semibold">{title}</span>
      <span
        className={cn(
          "block text-[10px]",
          selected ? "text-on-primary/70" : "text-fg-muted",
        )}
      >
        {description}
      </span>
    </button>
  );
}
