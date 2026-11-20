import type { CompanyMember, MemberPermissions } from "@wateaminbox/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { permissionGroups } from "./permission-options";
import { useTranslation } from "react-i18next";

type AccessMode = "defaults" | "custom";

interface MemberPermissionsDialogProps {
  member: CompanyMember | null;
  isSaving: boolean;
  error?: Error | null;
  onClose: () => void;
  onSave: (permissions: MemberPermissions) => Promise<void>;
  onReset: () => Promise<void>;
}

export function MemberPermissionsDialog({
  member,
  isSaving,
  error,
  onClose,
  onSave,
  onReset,
}: MemberPermissionsDialogProps) {
  const { t } = useTranslation();

  const [permissions, setPermissions] = useState<MemberPermissions | null>(
    null,
  );
  const [mode, setMode] = useState<AccessMode>("defaults");

  useEffect(() => {
    setPermissions(member?.effectivePermissions ?? null);
    setMode(
      member?.permissions && Object.keys(member.permissions).length
        ? "custom"
        : "defaults",
    );
  }, [member]);

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      {member && permissions && (
        <DialogContent className="mx-4 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle>
              {t("team.accessFor", {
                defaultValue: "Access for {{name}}",
                name: member.name || member.email,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "team.hierarchyEnforcedServer",
                "Role hierarchy remains enforced by the server even when custom capabilities are granted.",
              )}
            </DialogDescription>
          </DialogHeader>

          <div
            className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1"
            role="radiogroup"
            aria-label={t("team.permissionMode", "Permission mode")}
          >
            <ModeButton
              active={mode === "defaults"}
              onClick={() => setMode("defaults")}
              title={t("team.useRoleDefaults", "Use role defaults")}
              description={t("team.followPreset", { role: member.role })}
            />
            <ModeButton
              active={mode === "custom"}
              onClick={() => setMode("custom")}
              title={t("team.customizeAccess", "Customize access")}
              description={t(
                "team.overrideCapabilities",
                "Override individual capabilities",
              )}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-danger-soft p-3 text-sm text-danger"
            >
              {error.message}
            </div>
          )}

          {mode === "defaults" ? (
            <div className="rounded-xl border border-line p-5 text-sm">
              <p className="font-medium">
                {t(
                  "team.roleDefaultsRestored",
                  "Role defaults will be restored.",
                )}
              </p>
              <p className="mt-1 text-fg-muted">
                {t(
                  "team.customOverridesRemoved",
                  "Any custom overrides for this member will be removed.",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {permissionGroups.map((group) => (
                <fieldset
                  key={group.label}
                  className="overflow-hidden rounded-xl border border-line"
                >
                  <legend className="ms-3 px-1 text-xs font-bold uppercase tracking-[0.12em] text-fg-muted">
                    {group.label}
                  </legend>
                  <div className="divide-y divide-line">
                    {group.options.map((option) => (
                      <label
                        key={option.key}
                        className="flex cursor-pointer items-start gap-3 p-3.5 hover:bg-subtle"
                      >
                        <input
                          type="checkbox"
                          checked={permissions[option.key]}
                          onChange={(event) =>
                            setPermissions((current) =>
                              current
                                ? {
                                    ...current,
                                    [option.key]: event.target.checked,
                                  }
                                : current,
                            )
                          }
                          className="mt-1 h-4 w-4 rounded border-line-strong accent-primary"
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            {option.label}
                          </span>
                          <span className="block text-xs leading-5 text-fg-muted">
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() =>
                void (mode === "defaults" ? onReset() : onSave(permissions))
              }
              disabled={isSaving}
              className="bg-primary text-on-primary hover:bg-primary-hover"
            >
              {isSaving
                ? "Saving…"
                : mode === "defaults"
                  ? t("team.resetToDefaults", "Reset to defaults")
                  : t("team.saveAccess", "Save access")}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-2 text-start transition-colors",
        active ? "bg-surface shadow-sm" : "text-fg-muted",
      )}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="hidden text-[10px] sm:block">{description}</span>
    </button>
  );
}
