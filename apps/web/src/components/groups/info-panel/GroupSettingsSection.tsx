import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { RightPanelSection } from "@/components/layout/right-panel";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@/components/ui";
import { useUpdateGroupSettings } from "@/hooks/useGroups";
import type { GroupSettingsSectionProps } from "./types";

/**
 * Group settings section for admins
 */
export function GroupSettingsSection({ group }: GroupSettingsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(group.name || "");
  const [description, setDescription] = useState(group.description || "");
  const updateSettings = useUpdateGroupSettings();

  useEffect(() => {
    setName(group.name || "");
    setDescription(group.description || "");
  }, [group.name, group.description]);

  const handleSave = async () => {
    await updateSettings.mutateAsync({
      groupId: group.id,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
    });
    setIsOpen(false);
  };

  const handleCancel = () => {
    setName(group.name || "");
    setDescription(group.description || "");
    setIsOpen(false);
  };

  return (
    <>
      <RightPanelSection title="Group Settings">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center gap-2"
        >
          <Settings className="h-4 w-4" />
          Edit Group Settings
        </Button>
        <p className="mt-1 text-xs text-gray-500 dark:text-dark-text-tertiary">
          Change group name and description on WhatsApp
        </p>
      </RightPanelSection>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group Settings</DialogTitle>
            <DialogDescription>
              Update the group name and description. These changes will be
              reflected on WhatsApp for all members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                Group Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter group name"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                Description
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter group description"
                rows={4}
                maxLength={512}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
