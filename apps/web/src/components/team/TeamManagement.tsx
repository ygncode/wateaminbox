import { Mail, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCompanyMembers, usePendingInvitations } from "@/hooks/useTeam";
import { cn } from "@/lib/utils";
import { InvitationsList } from "./InvitationsList";
import { InviteFormModal } from "./InviteFormModal";
import { MembersList } from "./MembersList";
import type { TeamManagementProps } from "./types";
import { useTranslation } from "react-i18next";

/** Team interface driven by effective capabilities and server hierarchy rules. */
export function TeamManagement({
  companyId,
  currentUserId,
  currentUserRole,
  canManageTeam,
  canInvite,
}: TeamManagementProps) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<"members" | "invitations">(
    canManageTeam ? "members" : "invitations",
  );
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "owner" | "admin" | "member"
  >("all");
  const members = useCompanyMembers(canManageTeam ? companyId : null);
  const invitations = usePendingInvitations(canInvite ? companyId : null);

  return (
    <div className="flex h-full flex-col bg-[#f5f7f4] dark:bg-dark-primary">
      <header className="border-b border-[#dce3de] bg-white px-4 py-4 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[#0b7a55]">
              {t("team.workspace", "Workspace")}
            </p>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
              {t("team.title", "Team")}
            </h1>
            <p className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
              {t("team.memberInvitationCounts", {
                defaultValue:
                  "{{members}} members · {{invitations}} pending invitations",
                members: members.data?.pagination.total ?? 0,
                invitations: invitations.data?.pagination.total ?? 0,
              })}
            </p>
          </div>
          {canInvite && (
            <Button
              onClick={() => setShowInviteForm(true)}
              className="bg-[#0b7a55] text-white hover:bg-[#096747]"
            >
              <UserPlus className="mr-2 h-4 w-4" /> Invite member
            </Button>
          )}
        </div>
      </header>

      <div className="flex border-b border-[#dce3de] bg-white dark:border-dark-border dark:bg-dark-secondary">
        {canManageTeam && (
          <Tab
            active={activeTab === "members"}
            onClick={() => setActiveTab("members")}
            icon={Users}
            label={t("team.membersLabel", "Members")}
            count={members.data?.pagination.total}
          />
        )}
        {canInvite && (
          <Tab
            active={activeTab === "invitations"}
            onClick={() => setActiveTab("invitations")}
            icon={Mail}
            label={t("team.invitations", "Invitations")}
            count={invitations.data?.pagination.total}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
        {activeTab === "members" && canManageTeam ? (
          <MembersList
            companyId={companyId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            search={memberSearch}
            roleFilter={roleFilter}
            onSearchChange={setMemberSearch}
            onRoleFilterChange={setRoleFilter}
          />
        ) : (
          <InvitationsList companyId={companyId} />
        )}
      </div>

      {showInviteForm && canInvite && (
        <InviteFormModal
          companyId={companyId}
          currentUserRole={currentUserRole}
          onClose={() => setShowInviteForm(false)}
        />
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Users;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors",
        active
          ? "border-[#0b7a55] text-[#0b7a55]"
          : "border-transparent text-[#65736d] hover:text-[#10211b] dark:text-dark-text-secondary dark:hover:text-white",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
      {count !== undefined && (
        <span className="rounded-full bg-[#edf1ed] px-1.5 py-0.5 text-[10px] dark:bg-dark-tertiary">
          {count}
        </span>
      )}
    </button>
  );
}

export default TeamManagement;
