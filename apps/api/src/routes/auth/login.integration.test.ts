import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const PASSWORD = "Login-bounds-test-password-123!";
const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  // user_sessions.user_id ON DELETE CASCADE removes sessions automatically.
  await db.deleteFrom("users").where("id", "in", createdUserIds).execute();
});

async function countSessions(userId: string): Promise<number> {
  const row = await db
    .selectFrom("user_sessions")
    .where("user_id", "=", userId)
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

async function latestSession(userId: string) {
  return db
    .selectFrom("user_sessions")
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .select(["device_name", "device_type", "id"])
    .executeTakeFirst();
}

async function login(userId: string, body: Record<string, unknown>) {
  const email = `bounds-${userId}@example.com`;
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, ...body }),
  });
  return response;
}

describe("POST /api/auth/login deviceInfo bounds", () => {
  integrationTest(
    "rejects an overlong deviceName with a 400 validation error, not a 500, and creates no session",
    async () => {
      const userId = crypto.randomUUID();
      createdUserIds.push(userId);
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `bounds-${userId}@example.com`,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();

      const sessionsBefore = await countSessions(userId);
      expect(sessionsBefore).toBe(0);

      const response = await login(userId, {
        deviceInfo: { deviceName: "x".repeat(256) },
      });

      // Previously this returned 500 from a Postgres varchar(255) overflow thrown
      // inside the forUpdate transaction. The zod .max(255) bound must turn it
      // into a 400 validation error before the transaction is ever entered.
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        success: boolean;
        error: {
          name: string;
          issues: Array<{ message: string; path: (string | number)[] }>;
        };
      };
      // Not the generic 500 envelope: a structured Zod validation error.
      expect(body.success).toBe(false);
      expect(body.error.name).toBe("ZodError");
      expect(
        body.error.issues.some(
          (i) =>
            i.message === "Device name must be at most 255 characters" &&
            JSON.stringify(i.path) ===
              JSON.stringify(["deviceInfo", "deviceName"]),
        ),
      ).toBe(true);

      // Validation rejects in the zValidator middleware before the route
      // handler calls login(), so no session row is inserted.
      expect(await countSessions(userId)).toBe(0);
    },
  );

  integrationTest(
    "rejects an overlong deviceType with a 400 validation error, not a 500, and creates no session",
    async () => {
      const userId = crypto.randomUUID();
      createdUserIds.push(userId);
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `bounds-${userId}@example.com`,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();

      expect(await countSessions(userId)).toBe(0);

      const response = await login(userId, {
        deviceInfo: { deviceType: "y".repeat(51) },
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        success: boolean;
        error: {
          name: string;
          issues: Array<{ message: string; path: (string | number)[] }>;
        };
      };
      expect(body.success).toBe(false);
      expect(body.error.name).toBe("ZodError");
      expect(
        body.error.issues.some(
          (i) =>
            i.message === "Device type must be at most 50 characters" &&
            JSON.stringify(i.path) ===
              JSON.stringify(["deviceInfo", "deviceType"]),
        ),
      ).toBe(true);

      expect(await countSessions(userId)).toBe(0);
    },
  );

  integrationTest(
    "accepts deviceName/deviceType at the column limit (255/50) and persists the full values",
    async () => {
      const userId = crypto.randomUUID();
      createdUserIds.push(userId);
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `bounds-${userId}@example.com`,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();

      const longName = "n".repeat(255);
      const longType = "t".repeat(50);

      const response = await login(userId, {
        deviceInfo: { deviceName: longName, deviceType: longType },
      });

      expect(response.status).toBe(200);

      // Persisted row carries the full at-boundary strings (bound == column width).
      const session = await latestSession(userId);
      expect(session?.device_name).toBe(longName);
      expect(session?.device_type).toBe(longType);

      // Active-sessions screen shows them verbatim.
      const loginBody = (await response.json()) as {
        tokens: { accessToken: string };
      };
      const sessionsResponse = await app.request("/api/auth/sessions", {
        headers: { authorization: `Bearer ${loginBody.tokens.accessToken}` },
      });
      expect(sessionsResponse.status).toBe(200);
      const sessionsBody = (await sessionsResponse.json()) as {
        data: {
          sessions: Array<{
            deviceName: string | null;
            deviceType: string | null;
          }>;
        };
      };
      expect(
        sessionsBody.data.sessions.find((s) => s.deviceName === longName),
      ).toMatchObject({ deviceName: longName, deviceType: longType });
    },
  );

  integrationTest(
    "accepts empty device strings and persists them as empty, not null",
    async () => {
      const userId = crypto.randomUUID();
      createdUserIds.push(userId);
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `bounds-${userId}@example.com`,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();

      const response = await login(userId, {
        deviceInfo: { deviceName: "", deviceType: "" },
      });

      expect(response.status).toBe(200);
      const session = await latestSession(userId);
      expect(session?.device_name).toBe("");
      expect(session?.device_type).toBe("");
    },
  );

  integrationTest(
    "accepts an omitted deviceInfo and persists null device fields",
    async () => {
      const userId = crypto.randomUUID();
      createdUserIds.push(userId);
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `bounds-${userId}@example.com`,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();

      const response = await login(userId, {});

      expect(response.status).toBe(200);
      const session = await latestSession(userId);
      expect(session?.device_name).toBeNull();
      expect(session?.device_type).toBeNull();
    },
  );

  integrationTest(
    "persisted typical device info is shown verbatim on the active-sessions screen",
    async () => {
      const userId = crypto.randomUUID();
      createdUserIds.push(userId);
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `bounds-${userId}@example.com`,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();

      const response = await login(userId, {
        deviceInfo: { deviceName: "Macintosh", deviceType: "web" },
      });

      expect(response.status).toBe(200);
      const loginBody = (await response.json()) as {
        tokens: { accessToken: string };
      };
      const sessionsResponse = await app.request("/api/auth/sessions", {
        headers: { authorization: `Bearer ${loginBody.tokens.accessToken}` },
      });
      expect(sessionsResponse.status).toBe(200);
      const sessionsBody = (await sessionsResponse.json()) as {
        data: {
          sessions: Array<{
            deviceName: string | null;
            deviceType: string | null;
          }>;
        };
      };
      expect(
        sessionsBody.data.sessions.find((s) => s.deviceName === "Macintosh"),
      ).toMatchObject({ deviceName: "Macintosh", deviceType: "web" });
    },
  );
});
