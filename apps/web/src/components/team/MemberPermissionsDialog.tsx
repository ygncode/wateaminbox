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
            <DialogTitle>Access for {member.name || member.email}</DialogTitle>
            <DialogDescription>
              Role hierarchy remains enforced by the server even when custom
              capabilities are granted.
            </DialogDescription>
          </DialogHeader>

          <div
            className="grid grid-cols-2 gap-2 rounded-xl bg-[#edf1ed] p-1 dark:bg-dark-tertiary"
            role="radiogroup"
            aria-label="Permission mode"
          >
            <ModeButton
              active={mode === "defaults"}
              onClick={() => setMode("defaults")}
              title="Use role defaults"
              description={`Follow the ${member.role} preset`}
            />
            <ModeButton
              active={mode === "custom"}
              onClick={() => setMode("custom")}
              title="Customize access"
              description="Override individual capabilities"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {error.message}
            </div>
          )}

          {mode === "defaults" ? (
            <div className="rounded-xl border border-[#dce3de] p-5 text-sm dark:border-dark-border">
              <p className="font-medium">Role defaults will be restored.</p>
              <p className="mt-1 text-[#65736d] dark:text-dark-text-secondary">
                Any custom overrides for this member will be removed.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {permissionGroups.map((group) => (
                <fieldset
                  key={group.label}
                  className="overflow-hidden rounded-xl border border-[#dce3de] dark:border-dark-border"
                >
                  <legend className="ml-3 px-1 text-xs font-bold uppercase tracking-[0.12em] text-[#65736d] dark:text-dark-text-secondary">
                    {group.label}
                  </legend>
                  <div className="divide-y divide-[#e6ebe7] dark:divide-dark-border">
                    {group.options.map((option) => (
                      <label
                        key={option.key}
                        className="flex cursor-pointer items-start gap-3 p-3.5 hover:bg-[#f8faf8] dark:hover:bg-dark-tertiary/50"
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
                          className="mt-1 h-4 w-4 rounded border-gray-300 accent-[#0b7a55]"
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            {option.label}
                          </span>
                          <span className="block text-xs leading-5 text-[#65736d] dark:text-dark-text-secondary">
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                void (mode === "defaults" ? onReset() : onSave(permissions))
              }
              disabled={isSaving}
              className="bg-[#0b7a55] text-white hover:bg-[#096747]"
            >
              {isSaving
                ? "Saving…"
                : mode === "defaults"
                  ? "Reset to defaults"
                  : "Save access"}
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
        "rounded-lg px-3 py-2 text-left transition-colors",
        active
          ? "bg-white shadow-sm dark:bg-dark-elevated"
          : "text-[#65736d] dark:text-dark-text-secondary",
      )}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="hidden text-[10px] sm:block">{description}</span>
    </button>
  );
}
