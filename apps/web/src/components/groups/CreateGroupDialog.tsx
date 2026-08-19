import { GROUP_NAME_MAX_LENGTH } from "@wateaminbox/shared";
import { Loader2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateGroup } from "@/hooks/useGroups";
import { useWhatsAppConnections } from "@/hooks/useWhatsAppConnections";
import { getConnectionLabel } from "../chat/ConnectionIdentity";
import {
  ParticipantPicker,
  type PickableParticipant,
} from "./ParticipantPicker";
import { useTranslation } from "react-i18next";

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create a WhatsApp group.
 *
 * The account is chosen explicitly rather than inferred: a group belongs to one
 * WhatsApp number, and in a multi-number workspace guessing would silently
 * create it under the wrong identity.
 */
export function CreateGroupDialog({
  open,
  onOpenChange,
}: CreateGroupDialogProps) {
  const { t } = useTranslation();

  const { connections } = useWhatsAppConnections();
  const createGroup = useCreateGroup();

  const connectedAccounts = useMemo(
    () => connections.filter((connection) => connection.status === "connected"),
    [connections],
  );

  const [connectionId, setConnectionId] = useState<string>("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Map<string, PickableParticipant>>(
    new Map(),
  );

  // Preselect the only usable account, and drop a selection that stops being
  // usable (the phone went offline while the dialog was open).
  useEffect(() => {
    if (!open) return;
    if (connectionId && connectedAccounts.some((c) => c.id === connectionId)) {
      return;
    }
    setConnectionId(
      connectedAccounts.length === 1 ? connectedAccounts[0].id : "",
    );
  }, [open, connectionId, connectedAccounts]);

  // Members are addressed per account, so switching accounts invalidates them.
  useEffect(() => {
    setSelected(new Map());
  }, [connectionId]);

  useEffect(() => {
    if (open) return;
    setName("");
    setSelected(new Map());
  }, [open]);

  const toggleParticipant = (participant: PickableParticipant) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(participant.jid)) {
        next.delete(participant.jid);
      } else {
        next.set(participant.jid, participant);
      }
      return next;
    });
  };

  const trimmedName = name.trim();
  const canSubmit =
    Boolean(connectionId) &&
    trimmedName.length > 0 &&
    trimmedName.length <= GROUP_NAME_MAX_LENGTH &&
    selected.size > 0 &&
    !createGroup.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await createGroup.mutateAsync({
        connectionId,
        name: trimmedName,
        participantJids: [...selected.keys()],
      });
    } catch {
      // The hook already toasted the reason. Keep the dialog open so the
      // selection survives and the request can be corrected and retried.
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("groups.newGroup", "New group")}</DialogTitle>
          <DialogDescription>
            {t(
              "groups.newGroupHint",
              "The group is created on WhatsApp and appears here once WhatsApp confirms it.",
            )}
          </DialogDescription>
        </DialogHeader>

        {connectedAccounts.length === 0 ? (
          <div className="flex gap-3 rounded-lg bg-gray-50 p-3 dark:bg-dark-elevated">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
            <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
              {t(
                "groups.noAccountConnected",
                "No WhatsApp account is connected. Connect one before creating a group.",
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-group-connection">
                {t("connections.whatsappAccount", "WhatsApp account")}
              </Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger id="create-group-connection">
                  <SelectValue
                    placeholder={t(
                      "groups.chooseAccount",
                      "Choose the account that will own the group",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {connectedAccounts.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {getConnectionLabel(connection)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-group-name">
                {t("groups.groupNameLabel", "Group name")}
              </Label>
              <Input
                id="create-group-name"
                value={name}
                maxLength={GROUP_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder={t(
                  "groups.namePlaceholder",
                  "e.g. Support escalations",
                )}
              />
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                {trimmedName.length}/{GROUP_NAME_MAX_LENGTH} characters ·
                WhatsApp rejects longer names.
              </p>
            </div>

            <div className="space-y-1.5">
              {/* Points at the picker's own search input rather than wrapping
                  nothing, and labels the option list for assistive tech. */}
              <Label
                id="create-group-members-label"
                htmlFor="create-group-members"
              >
                Members
              </Label>
              <ParticipantPicker
                connectionId={connectionId || null}
                selected={selected}
                onToggle={toggleParticipant}
                searchInputId="create-group-members"
                labelledBy="create-group-members-label"
              />
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                {t(
                  "groups.ownerJoinsHint",
                  "This account joins the group automatically. WhatsApp may refuse individual members whose privacy settings block group invites.",
                )}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createGroup.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-2"
          >
            {createGroup.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
