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
        // A default size, because this element has none of its own: the image
        // inside is h-full/w-full, so a caller that forgets to pass dimensions
        // gets the logo at its natural size and a torn layout. tailwind-merge
        // lets every caller's own size win, so this only catches omissions.
        "grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#dcefe7] text-xs font-bold text-[#075c41]",
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
