import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Re-export shared identity formatters for backward compatibility.
export {
  extractPhoneFromJid as extractPhoneFromJID,
  formatPhoneLikeText,
  formatPhoneNumber,
} from "@wateaminbox/shared";
