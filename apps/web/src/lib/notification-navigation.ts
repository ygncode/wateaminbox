export function getSafeNotificationPath(value: unknown): string | null {
  if (typeof value !== "string" || !/^\/(?!\/)/.test(value)) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  return value;
}

export function navigateToNotificationTarget(
  value: unknown,
  navigate: (path: string) => void,
): boolean {
  const path = getSafeNotificationPath(value);
  if (!path) return false;
  navigate(path);
  return true;
}
