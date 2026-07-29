import { createHash } from "node:crypto";

export function getGravatarUrl(email: string): string {
  const hash = createHash("md5")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=256&d=mp`;
}
