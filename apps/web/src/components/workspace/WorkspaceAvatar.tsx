import type { Company } from "@wateaminbox/shared";
import { cn } from "../../lib/utils";

export function workspaceMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "W";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function WorkspaceAvatar({
  workspace,
  className,
}: {
  workspace: Pick<Company, "logoUrl" | "name">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-[#dcefe7] font-bold text-[#075c41]",
        className,
      )}
    >
      {workspace.logoUrl ? (
        <img
          src={workspace.logoUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        workspaceMonogram(workspace.name)
      )}
    </span>
  );
}
