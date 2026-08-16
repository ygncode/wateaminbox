import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
  type GroupMemberAddMode,
} from "@wateaminbox/shared";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type GroupDetail,
  type UpdateGroupSettingsVariables,
  useUpdateGroupSettings,
} from "@/hooks/useGroups";

interface GroupSettingsSectionProps {
  group: GroupDetail;
}

/**
 * The group's WhatsApp name, description and permissions.
 *
 * The form is seeded from WhatsApp's last confirmed state and only sends the
 * fields the user actually changed - WhatsApp applies each setting as its own
 * request, so sending unchanged ones would be extra round trips that could each
 * fail on their own.
 */
export function GroupSettingsSection({ group }: GroupSettingsSectionProps) {
  const updateSettings = useUpdateGroupSettings();
  const confirmed = group.settings;

  // Seeded from the WhatsApp subject, never from `group.name` - that field is
  // alias-first, so seeding from it would offer the workspace-private alias for
  // editing and push it to every member on save.
  const [name, setName] = useState(group.whatsappName ?? "");
  const [description, setDescription] = useState(group.description ?? "");

  // Re-seed whenever WhatsApp confirms new values, so an edit that landed on
  // the phone is not silently overwritten by a stale form.
  useEffect(() => {
    setName(group.whatsappName ?? "");
    setDescription(group.description ?? "");
  }, [group.whatsappName, group.description]);

  const disabled = !group.canAdminister || updateSettings.isPending;
  const trimmedName = name.trim();
  const profileChanged =
    trimmedName !== (group.whatsappName ?? "").trim() ||
    description !== (group.description ?? "");
  const canSaveProfile =
    profileChanged &&
    trimmedName.length > 0 &&
    trimmedName.length <= GROUP_NAME_MAX_LENGTH &&
    !disabled;

  const submit = (changes: Omit<UpdateGroupSettingsVariables, "groupId">) =>
    updateSettings.mutate({ groupId: group.id, ...changes });

  return (
    <RightPanelSection title="Group settings">
      {!group.isMember ? (
        <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
          This WhatsApp account has left the group, so its settings can no
          longer be changed from here.
        </p>
      ) : !group.isAdmin ? (
        <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
          Only group admins can change these settings. This WhatsApp account is
          a member, not an admin.
        </p>
      ) : group.connection?.status !== "connected" ? (
        <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
          The WhatsApp account for this group is offline. Reconnect it to change
          group settings.
        </p>
      ) : null}

      {/* A permission switch reflects WhatsApp's confirmed state, so it stays
          where it is until WhatsApp answers. Saying so is what separates
          "waiting" from "the control is broken". */}
      {updateSettings.isPending && (
        <p
          className="mb-3 flex items-center gap-2 text-xs text-gray-500 dark:text-dark-text-tertiary"
          role="status"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Waiting for WhatsApp to apply the change…
        </p>
      )}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="group-name">Group name</Label>
          <Input
            id="group-name"
            value={name}
            maxLength={GROUP_NAME_MAX_LENGTH}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
            {trimmedName.length}/{GROUP_NAME_MAX_LENGTH} characters. This is the
            name every member sees on WhatsApp.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="group-description">Description</Label>
          <Textarea
            id="group-description"
            rows={3}
            value={description}
            maxLength={GROUP_DESCRIPTION_MAX_LENGTH}
            disabled={disabled}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <Button
          size="sm"
          className="gap-2"
          disabled={!canSaveProfile}
          onClick={() =>
            submit({
              ...(trimmedName !== (group.whatsappName ?? "").trim()
                ? { name: trimmedName }
                : {}),
              ...(description !== (group.description ?? "")
                ? { description }
                : {}),
            })
          }
        >
          {updateSettings.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Save name and description
        </Button>

        <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-dark-border">
          <PermissionToggle
            id="group-announce"
            label="Only admins can send messages"
            description="Turns the group into an announcement group."
            checked={confirmed.isAnnounce}
            disabled={disabled}
            onChange={(isAnnounce) => submit({ isAnnounce })}
          />
          <PermissionToggle
            id="group-locked"
            label="Only admins can edit group info"
            description="Locks the group's name, icon and description."
            checked={confirmed.isLocked}
            disabled={disabled}
            onChange={(isLocked) => submit({ isLocked })}
          />
          <PermissionToggle
            id="group-approval"
            label="Approve new members"
            description="People who use the invite link wait for an admin."
            checked={confirmed.isJoinApprovalRequired}
            disabled={disabled}
            onChange={(isJoinApprovalRequired) =>
              submit({ isJoinApprovalRequired })
            }
          />
          <PermissionToggle
            id="group-member-add"
            label="Only admins can add members"
            description="Otherwise any member can add someone."
            checked={confirmed.memberAddMode === "admin_add"}
            disabled={disabled}
            onChange={(adminOnly) =>
              submit({
                memberAddMode: (adminOnly
                  ? "admin_add"
                  : "all_member_add") satisfies GroupMemberAddMode,
              })
            }
          />
        </div>
      </div>
    </RightPanelSection>
  );
}

interface PermissionToggleProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * A permission switch that reflects WhatsApp's confirmed state.
 *
 * `checked` is driven entirely by the group's synced settings, never by local
 * state, so a change WhatsApp refuses snaps back instead of appearing to stick.
 */
function PermissionToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: PermissionToggleProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-dark-text-tertiary">
          {description}
        </p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-whatsapp-teal-green disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
