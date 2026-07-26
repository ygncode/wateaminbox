import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Shield, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import type { InviteFormModalProps } from "./types";

/**
 * Invite form modal
 */
export function InviteFormModal({ companyId, onClose }: InviteFormModalProps) {
  const inviteMember = useInviteMember();
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const role = watch("role");

  const onSubmit = async (data: InviteTeamMemberFormData) => {
    setSubmitError(null);
    try {
      await inviteMember.mutateAsync({
        companyId,
        email: data.email,
        role: data.role,
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
      <DialogContent className="mx-4 w-[calc(100vw-2rem)] max-w-md rounded-2xl sm:w-full">
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>
            Send a time-limited invitation to the current workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            id="email"
            label="Email address"
            type="email"
            inputMode="email"
            placeholder="colleague@company.com…"
            autoComplete="email"
            registration={register("email")}
            error={errors.email}
          />

          <div>
            <label
              id="role-label"
              className="block text-sm font-medium text-gray-700 dark:text-dark-text-secondary mb-1"
            >
              Role
            </label>
            <div
              className="flex gap-2"
              role="radiogroup"
              aria-labelledby="role-label"
            >
              <button
                type="button"
                role="radio"
                aria-checked={role === "member"}
                onClick={() =>
                  setValue("role", "member", { shouldValidate: true })
                }
                className={cn(
                  "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  role === "member"
                    ? "border-whatsapp-teal-green bg-whatsapp-light-green text-whatsapp-dark-green"
                    : "border-gray-300 dark:border-dark-border text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary",
                )}
              >
                <Shield className="mx-auto mb-1 h-5 w-5" aria-hidden="true" />
                Member
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={role === "admin"}
                onClick={() =>
                  setValue("role", "admin", { shouldValidate: true })
                }
                className={cn(
                  "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  role === "admin"
                    ? "border-whatsapp-teal-green bg-whatsapp-light-green text-whatsapp-dark-green"
                    : "border-gray-300 dark:border-dark-border text-gray-700 dark:text-dark-text-primary hover:bg-gray-50 dark:hover:bg-dark-tertiary",
                )}
              >
                <ShieldCheck
                  className="mx-auto mb-1 h-5 w-5"
                  aria-hidden="true"
                />
                Admin
              </button>
            </div>
            {errors.role && (
              <p
                className="mt-1 text-xs text-red-500 dark:text-red-400"
                role="alert"
              >
                {errors.role.message}
              </p>
            )}
          </div>

          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={inviteMember.isPending || !isValid}
              className="flex-1 bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {inviteMember.isPending ? "Sending…" : "Send Invitation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
