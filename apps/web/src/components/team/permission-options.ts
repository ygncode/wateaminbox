import type { MemberPermissions } from "@wateaminbox/shared";

export interface PermissionOption {
  key: keyof MemberPermissions;
  label: string;
  description: string;
}

export interface PermissionGroup {
  label: string;
  options: PermissionOption[];
}

export const permissionGroups: PermissionGroup[] = [
  {
    label: "Chat and messaging",
    options: [
      {
        key: "can_view_all_chats",
        label: "View all chats and groups",
        description: "Otherwise only assigned conversations are visible.",
      },
      {
        key: "can_send_messages",
        label: "Send messages",
        description: "Reply to visible WhatsApp conversations.",
      },
      {
        key: "can_send_bulk_messages",
        label: "Send broadcasts",
        description: "Schedule bulk broadcast messages to many contacts.",
      },
    ],
  },
  {
    label: "Contact management",
    options: [
      {
        key: "can_assign_contacts",
        label: "Assign contacts",
        description: "Assign and reassign conversations.",
      },
    ],
  },
  {
    label: "Team management",
    options: [
      {
        key: "can_manage_team",
        label: "Manage team",
        description: "View members and perform hierarchy-allowed actions.",
      },
      {
        key: "can_invite",
        label: "Invite members",
        description: "Create, resend, and cancel invitations.",
      },
    ],
  },
  {
    label: "Workspace administration",
    options: [
      {
        key: "can_manage_connections",
        label: "Manage connections",
        description: "Manage WhatsApp connections.",
      },
      {
        key: "can_view_dashboard",
        label: "View dashboard",
        description: "Access workspace analytics.",
      },
      {
        key: "can_view_audit",
        label: "View audit log",
        description: "Access activity and security history.",
      },
    ],
  },
  {
    label: "Data management",
    options: [
      {
        key: "can_export",
        label: "Export data",
        description: "Export workspace records.",
      },
      {
        key: "can_delete",
        label: "Delete data",
        description: "Perform destructive data actions.",
      },
    ],
  },
];

export const permissionOptions = permissionGroups.flatMap(
  (group) => group.options,
);
