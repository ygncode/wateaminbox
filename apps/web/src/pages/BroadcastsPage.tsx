import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BroadcastJobDetail } from "../components/broadcasts/BroadcastJobDetail";
import { BroadcastJobList } from "../components/broadcasts/BroadcastJobList";
import { BroadcastsHeader } from "../components/broadcasts/BroadcastsHeader";
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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary">
      <BroadcastsHeader
        workspaceName={activeWorkspace.name}
        showingDetail={Boolean(jobId)}
        onBack={() => navigate(basePath)}
        onCreate={() => setWizardOpen(true)}
      />

      {/* Bounded like Team and Audit: the shell never scrolls, the table does. */}
      <main className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
        {jobId ? (
          <BroadcastJobDetail jobId={jobId} />
        ) : (
          <BroadcastJobList
            onCreateBroadcast={() => setWizardOpen(true)}
            getJobHref={(id) => `${basePath}/${id}`}
          />
        )}
      </main>

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
