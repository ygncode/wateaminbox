import { Loader2 } from "lucide-react";
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
import { type GroupDetail, useAddParticipants } from "@/hooks/useGroups";
import {
  ParticipantPicker,
  type PickableParticipant,
} from "./ParticipantPicker";

interface AddParticipantsDialogProps {
  group: GroupDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Add members to an existing group.
 *
 * The picker is scoped to the group's own WhatsApp account, and existing
 * members are shown as already-in rather than hidden, so it is obvious why a
 * contact cannot be selected.
 */
export function AddParticipantsDialog({
  group,
  open,
  onOpenChange,
}: AddParticipantsDialogProps) {
  const addParticipants = useAddParticipants();
  const [selected, setSelected] = useState<Map<string, PickableParticipant>>(
    new Map(),
  );

  useEffect(() => {
    if (!open) setSelected(new Map());
  }, [open]);

  const alreadyMembers = useMemo(
    () =>
      new Map(
        group.participants.map((participant) => [
          participant.jid,
          "Already in this group",
        ]),
      ),
    [group.participants],
  );

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    try {
      await addParticipants.mutateAsync({
        groupId: group.id,
        participantJids: [...selected.keys()],
      });
    } catch {
      // The hook already toasted the reason; keep the selection for a retry.
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
          <DialogDescription>
            Members are added by WhatsApp. The list updates here once WhatsApp
            confirms the change.
          </DialogDescription>
        </DialogHeader>

        <ParticipantPicker
          searchInputId="add-participants-search"
          connectionId={group.connection?.id ?? null}
          selected={selected}
          onToggle={(participant) =>
            setSelected((current) => {
              const next = new Map(current);
              if (next.has(participant.jid)) next.delete(participant.jid);
              else next.set(participant.jid, participant);
              return next;
            })
          }
          disabledJids={alreadyMembers}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={addParticipants.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selected.size === 0 || addParticipants.isPending}
            className="gap-2"
          >
            {addParticipants.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Add {selected.size > 0 ? selected.size : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
