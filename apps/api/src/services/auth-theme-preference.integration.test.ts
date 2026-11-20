import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { hashPassword } from "../lib/password.js";
import {
  getUserById,
  toAuthUserResponse,
  updateProfile,
} from "./auth.service.js";

/**
 * The interface theme a user picks is stored on their account so it follows
 * them to every browser and device. Runs only under `RUN_DB_INTEGRATION=1`
 * with a migrated Postgres on `DATABASE_URL`.
 */

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  await db.deleteFrom("users").where("id", "in", createdUserIds).execute();
});

async function createUser(): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insertInto("users")
    .values({
      id,
      email: `theme-${id}@example.com`,
      password_hash: await hashPassword("Theme-test-password-1!"),
      email_verified_at: new Date(),
    })
    .execute();
  createdUserIds.push(id);
  return id;
}

describe("interface theme preference (real database)", () => {
  integrationTest("starts unset for a new account", async () => {
    const userId = await createUser();
    const user = await getUserById(userId);
    expect(user?.themePreference).toBeNull();
    expect((await toAuthUserResponse(user!)).themePreference).toBeNull();
  });

  integrationTest("saves, returns, and clears the chosen theme", async () => {
    const userId = await createUser();

    const saved = await updateProfile(userId, { themePreference: "whatsapp" });
    expect(saved.user.themePreference).toBe("whatsapp");
    expect(saved.emailVerificationRequired).toBe(false);
    expect((await getUserById(userId))?.themePreference).toBe("whatsapp");

    const changed = await updateProfile(userId, { themePreference: "dark" });
    expect((await toAuthUserResponse(changed.user)).themePreference).toBe(
      "dark",
    );

    await updateProfile(userId, { themePreference: null });
    expect((await getUserById(userId))?.themePreference).toBeNull();
  });

  integrationTest("keeps theme and language independent", async () => {
    const userId = await createUser();
    await updateProfile(userId, {
      themePreference: "light",
      preferredLanguage: "de",
    });
    const renamed = await updateProfile(userId, { preferredLanguage: "fr" });
    expect(renamed.user.themePreference).toBe("light");
    const themed = await updateProfile(userId, { themePreference: "whatsapp" });
    expect(themed.user.preferredLanguage).toBe("fr");
  });
});
