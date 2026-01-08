import { db } from "@whatsapp-web/database";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("UserService");

/**
 * Helper function to get user display names by their IDs
 * Returns a map of userId -> display name (name field, or email prefix as fallback)
 * Falls back to userId if user not found or email is malformed
 *
 * @param userIds - Array of user UUIDs to look up
 * @returns Map of userId to display name
 */
export async function getUserNames(
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  // Validate and filter valid UUIDs
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validIds = Array.from(new Set(userIds)).filter((id) =>
    uuidRegex.test(id),
  );

  if (validIds.length === 0) {
    return new Map();
  }

  try {
    const users = await db
      .selectFrom("users")
      .select(["id", "name", "email"])
      .where("id", "in", validIds)
      .execute();

    const userMap = new Map<string, string>();
    for (const user of users) {
      // Use name if available, otherwise use email prefix as display name
      let displayName: string;
      if (user.name) {
        displayName = user.name;
      } else {
        // Fallback to email prefix (before @)
        const atIndex = user.email.indexOf("@");
        displayName =
          atIndex > 0 ? user.email.substring(0, atIndex) : user.email;
      }
      userMap.set(user.id, displayName);
    }

    return userMap;
  } catch (error) {
    logger.error({ err: formatError(error) }, "Error fetching user names");
    // Return empty map on error - callers will fall back to UUID
    return new Map();
  }
}
