import { Mail, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InvitationsList } from "./InvitationsList";
import { InviteFormModal } from "./InviteFormModal";
import { MembersList } from "./MembersList";
import type { TeamManagementProps } from "./types";

/**
 * Team Management component for managing members and invitations
 */
export function TeamManagement({
  companyId,
  currentUserId,
  currentUserRole,
}: TeamManagementProps) {
  const [activeTab, setActiveTab] = useState<"members" | "invitations">(
    "members",
  );
  const [showInviteForm, setShowInviteForm] = useState(false);

  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-dark-border px-6 py-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
          Team
        </h2>
        {isAdmin && (
          <Button
            onClick={() => setShowInviteForm(true)}
            className="bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-dark-border">
        <button
          onClick={() => setActiveTab("members")}
          className={cn(
            "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors",
            activeTab === "members"
              ? "border-b-2 border-whatsapp-teal-green text-whatsapp-teal-green"
              : "text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary",
          )}
        >
          <Users className="h-4 w-4" />
          Members
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab("invitations")}
            className={cn(
              "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors",
              activeTab === "invitations"
                ? "border-b-2 border-whatsapp-teal-green text-whatsapp-teal-green"
                : "text-gray-500 dark:text-dark-text-secondary hover:text-gray-700 dark:hover:text-dark-text-primary",
            )}
          >
            <Mail className="h-4 w-4" />
            Pending Invitations
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "members" ? (
          <MembersList
            companyId={companyId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
        ) : (
          <InvitationsList companyId={companyId} />
        )}
      </div>

      {/* Invite Form Modal */}
      {showInviteForm && (
        <InviteFormModal
          companyId={companyId}
          onClose={() => setShowInviteForm(false)}
        />
      )}
    </div>
  );
}

export default TeamManagement;
