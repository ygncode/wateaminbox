import type { CompanyMember, MemberPermissions } from "@wateaminbox/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

const permissionOptions: Array<{
  key: keyof MemberPermissions;
  label: string;
  description: string;
}> = [
  {
    key: "can_view_all_chats",
    label: "View all chats and groups",
    description:
      "Otherwise only conversations assigned to this member are visible.",
  },
  {
    key: "can_send_messages",
    label: "Send messages",
    description: "Reply to visible WhatsApp conversations.",
  },
  {
    key: "can_assign_contacts",
    label: "Assign contacts",
    description: "Assign and reassign conversations to team members.",
  },
  {
    key: "can_manage_connections",
    label: "Manage connections",
    description: "Add, reconnect, rename, and remove WhatsApp connections.",
  },
  {
    key: "can_view_dashboard",
    label: "View dashboard",
    description: "Access workspace analytics and metrics.",
  },
  {
    key: "can_manage_team",
    label: "Manage team",
    description: "View members and change roles or permissions.",
  },
  {
    key: "can_invite",
    label: "Invite members",
    description: "Create, resend, and cancel invitations.",
  },
  {
    key: "can_view_audit",
    label: "View audit log",
    description: "Access workspace activity and security history.",
  },
  {
    key: "can_export",
    label: "Export data",
    description: "Export conversations and workspace records.",
  },
  {
    key: "can_delete",
    label: "Delete data",
    description: "Perform destructive workspace actions.",
  },
];

interface MemberPermissionsDialogProps {
  member: CompanyMember | null;
  isSaving: boolean;
  error?: Error | null;
  onClose: () => void;
  onSave: (permissions: MemberPermissions) => Promise<void>;
}

export function MemberPermissionsDialog({
  member,
  isSaving,
  error,
  onClose,
  onSave,
}: MemberPermissionsDialogProps) {
  const [permissions, setPermissions] = useState<MemberPermissions | null>(
    null,
  );

  useEffect(() => {
    setPermissions(member?.effectivePermissions ?? null);
  }, [member]);

  if (!member || !permissions) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-permissions-title"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-dark-elevated"
      >
        <h2
          id="member-permissions-title"
          className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary"
        >
          Permissions for {member.email}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-text-secondary">
          These settings override the {member.role} role defaults.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            {error.message}
          </div>
        )}

        <div className="mt-5 divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-dark-border dark:border-dark-border">
          {permissionOptions.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer items-start gap-3 p-4"
            >
              <input
                type="checkbox"
                checked={permissions[option.key]}
                onChange={(event) =>
                  setPermissions((current) =>
                    current
                      ? { ...current, [option.key]: event.target.checked }
                      : current,
                  )
                }
                className="mt-1 h-4 w-4 rounded border-gray-300 text-whatsapp-teal-green focus:ring-whatsapp-teal-green"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                  {option.label}
                </span>
                <span className="block text-xs text-gray-500 dark:text-dark-text-secondary">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
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
            onClick={() => void onSave(permissions)}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save permissions"}
          </Button>
        </div>
      </div>
    </div>
  );
}
