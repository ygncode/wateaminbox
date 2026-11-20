import { UserRound, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

const identityPalettes = [
  "bg-id-1-soft text-id-1",
  "bg-id-6-soft text-id-6",
  "bg-id-2-soft text-id-2",
  "bg-id-4-soft text-id-4",
  "bg-id-3-soft text-id-3",
  "bg-id-7-soft text-id-7",
  "bg-id-5-soft text-id-5",
] as const;

export function isUnnamedIdentity(displayName: string | null | undefined) {
  const value = displayName?.trim();
  if (!value) return true;
  const normalized = value.toLocaleLowerCase();
  if (
    normalized === "unknown" ||
    normalized === "unknown contact" ||
    normalized === "unknown participant"
  ) {
    return true;
  }
  if (value.includes("@")) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return true;

  const digits = value.replace(/\D/g, "");
  return (
    /^[+\d][\d\s().-]*$/.test(value) &&
    digits.length >= 7 &&
    digits.length <= 15
  );
}

export function getIdentityPaletteIndex(identity: string): number {
  let hash = 0;
  for (const character of identity) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % identityPalettes.length;
}

function getInitials(displayName: string): string {
  return (
    displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export type IdentityAvatarKind = "user" | "group";
export type IdentityAvatarRenderKind = "user-icon" | "group-icon" | "initials";

export function getIdentityAvatarRenderKind(
  displayName: string | null | undefined,
  kind: IdentityAvatarKind = "user",
): IdentityAvatarRenderKind {
  if (kind === "group") return "group-icon";
  return isUnnamedIdentity(displayName) ? "user-icon" : "initials";
}

interface IdentityAvatarFallbackProps {
  displayName: string;
  identity?: string | null;
  kind?: IdentityAvatarKind;
  className?: string;
  iconClassName?: string;
}

/** A deterministic WhatsApp-style fallback for contacts without an image. */
export function IdentityAvatarFallback({
  displayName,
  identity,
  kind = "user",
  className,
  iconClassName,
}: IdentityAvatarFallbackProps) {
  const renderKind = getIdentityAvatarRenderKind(displayName, kind);
  const palette =
    identityPalettes[
      getIdentityPaletteIndex(
        identity?.trim() || displayName.trim() || "unknown",
      )
    ];

  return (
    <span
      className={cn(
        "flex h-full w-full items-center justify-center font-semibold",
        palette,
        className,
      )}
      data-avatar-kind={renderKind}
      aria-hidden="true"
    >
      {renderKind === "group-icon" ? (
        <UsersRound
          className={cn("h-[57%] w-[57%]", iconClassName)}
          strokeWidth={2}
        />
      ) : renderKind === "user-icon" ? (
        <UserRound
          className={cn("h-[55%] w-[55%]", iconClassName)}
          strokeWidth={2}
        />
      ) : (
        getInitials(displayName)
      )}
    </span>
  );
}
