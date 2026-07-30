import { db } from "@wateaminbox/database";
import { getEmailDisplayName } from "@wateaminbox/shared";
import { getGravatarUrl } from "../lib/gravatar.js";
import { createLogger, formatError } from "../lib/logger.js";
import { getPresignedUrl } from "../lib/storage.js";

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
      const displayName = user.name || getEmailDisplayName(user.email);
      userMap.set(user.id, displayName);
    }

    return userMap;
  } catch (error) {
    logger.error({ err: formatError(error) }, "Error fetching user names");
    // Return empty map on error - callers will fall back to UUID
    return new Map();
  }
}

/**
 * Resolve profile pictures for message authors in one batch.
 * Custom avatars use a short-lived signed URL and fall back to Gravatar.
 */
export interface UserAvatarSources {
  avatarUrl: string;
  gravatarUrl: string;
}

export async function getUserAvatarSources(
  userIds: string[],
): Promise<Map<string, UserAvatarSources>> {
  if (userIds.length === 0) return new Map();

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validIds = Array.from(new Set(userIds)).filter((id) =>
    uuidRegex.test(id),
  );
  if (validIds.length === 0) return new Map();

  try {
    const users = await db
      .selectFrom("users")
      .select(["id", "email", "avatar_key"])
      .where("id", "in", validIds)
      .execute();

    const resolved = await Promise.all(
      users.map(async (user) => {
        const fallbackUrl = getGravatarUrl(user.email);
        if (!user.avatar_key) {
          return [
            user.id,
            { avatarUrl: fallbackUrl, gravatarUrl: fallbackUrl },
          ] as const;
        }
        try {
          return [
            user.id,
            {
              avatarUrl: await getPresignedUrl(user.avatar_key, 24 * 60 * 60),
              gravatarUrl: fallbackUrl,
            },
          ] as const;
        } catch {
          return [
            user.id,
            { avatarUrl: fallbackUrl, gravatarUrl: fallbackUrl },
          ] as const;
        }
      }),
    );

    return new Map(resolved);
  } catch (error) {
    logger.error({ err: formatError(error) }, "Error fetching user avatars");
    return new Map();
  }
}
