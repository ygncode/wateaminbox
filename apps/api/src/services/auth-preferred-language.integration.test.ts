import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { hashPassword } from "../lib/password.js";
import { getUserById, toAuthUserResponse, updateProfile } from "./auth.service.js";

/**
 * The interface language a user picks is stored on their account so it
 * follows them to every browser and device. Runs only under
 * `RUN_DB_INTEGRATION=1` with a migrated Postgres on `DATABASE_URL`.
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
      email: `lang-${id}@example.com`,
      password_hash: await hashPassword("Language-test-password-1!"),
      email_verified_at: new Date(),
    })
    .execute();
  createdUserIds.push(id);
  return id;
}

describe("preferred interface language (real database)", () => {
  integrationTest("starts unset for a new account", async () => {
    const userId = await createUser();
    const user = await getUserById(userId);
    expect(user?.preferredLanguage).toBeNull();
    expect((await toAuthUserResponse(user!)).preferredLanguage).toBeNull();
  });

  integrationTest("saves, returns, and clears the chosen language", async () => {
    const userId = await createUser();

    const saved = await updateProfile(userId, { preferredLanguage: "zh-CN" });
    expect(saved.user.preferredLanguage).toBe("zh-CN");
    expect(saved.emailVerificationRequired).toBe(false);
    expect((await getUserById(userId))?.preferredLanguage).toBe("zh-CN");

    const changed = await updateProfile(userId, { preferredLanguage: "ar" });
    expect((await toAuthUserResponse(changed.user)).preferredLanguage).toBe("ar");

    await updateProfile(userId, { preferredLanguage: null });
    expect((await getUserById(userId))?.preferredLanguage).toBeNull();
  });

  integrationTest("keeps the language when other profile fields change", async () => {
    const userId = await createUser();
    await updateProfile(userId, { preferredLanguage: "de" });
    const renamed = await updateProfile(userId, { name: "Renamed User" });
    expect(renamed.user.preferredLanguage).toBe("de");
  });
});
