import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BroadcastJobDetail } from "../components/broadcasts/BroadcastJobDetail";
import { BroadcastJobList } from "../components/broadcasts/BroadcastJobList";
import { CreateBroadcastWizard } from "../components/broadcasts/CreateBroadcastWizard";
import { useWorkspace } from "../contexts/workspace-context";

/**
 * Broadcasts (bulk WhatsApp messaging): list of broadcast jobs, per-job
 * detail with recipient outcomes, and a wizard to schedule a new broadcast.
 */
export function BroadcastsPage() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceId, jobId } = useParams<{
    workspaceId: string;
    jobId?: string;
  }>();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);

  if (!activeWorkspace) return null;

  const basePath = `/w/${workspaceId}/broadcasts`;

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-dark-primary">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          {jobId ? (
            <BroadcastJobDetail
              jobId={jobId}
              onBack={() => navigate(basePath)}
            />
          ) : (
            <BroadcastJobList
              onCreateBroadcast={() => setWizardOpen(true)}
              onOpenJob={(id) => navigate(`${basePath}/${id}`)}
            />
          )}
        </div>
      </div>

      {/* Mounted per open so wizard state and idempotency key reset. */}
      {wizardOpen && (
        <CreateBroadcastWizard
          open
          onOpenChange={(open) => {
            if (!open) setWizardOpen(false);
          }}
          onCreated={(job) => {
            setWizardOpen(false);
            navigate(`${basePath}/${job.id}`);
          }}
        />
      )}
    </div>
  );
}
