import { describe, expect, mock, test } from "bun:test";
import { AuthError } from "../lib/errors.js";

/**
 * Regression coverage for the email-change TOCTOU in `updateProfile`/`register`.
 *
 * The uniqueness pre-check runs OUTSIDE the transaction, so two concurrent
 * requests for the same email can both pass it before either commit. The
 * `users_email_key` unique constraint is then the only backstop, rejecting the
 * losing transaction with a raw Postgres `unique_violation` (SQLSTATE 23505).
 * Before the fix the catch block re-threw that raw driver error, which the route
 * layer (`handleAuthError`) turned into HTTP 500 — the friendly `EMAIL_EXISTS`
 * 409 the pre-check raises was unreachable under contention.
 *
 * These tests inject a synthetic 23505 from the in-transaction UPDATE/INSERT
 * — deterministically, with no database — and assert the loser now gets the
 * same friendly `EMAIL_EXISTS` 409, while unrelated errors still propagate
 * unwrapped (so the fix does not over-mask). The full path is exercised: real
 * `updateProfile`/`register` read the mocked `db`/`password` live bindings.
 */

type SelectResult = Record<string, unknown> | undefined;

interface FakeDbState {
  selects: SelectResult[];
  txnError: unknown;
  updateResult: SelectResult;
  insertResult: SelectResult;
}

const state: FakeDbState = {
  selects: [],
  txnError: undefined,
  updateResult: undefined,
  insertResult: undefined,
};

function chain() {
  return {
    selectAll() {
      return this;
    },
    select() {
      return this;
    },
    set() {
      return this;
    },
    values() {
      return this;
    },
    where() {
      return this;
    },
    returning() {
      return this;
    },
    returningAll() {
      return this;
    },
    forUpdate() {
      return this;
    },
  };
}

const finish = () =>
  state.txnError ? Promise.reject(state.txnError) : Promise.resolve(undefined);

function makeTrx() {
  const base = chain();
  return {
    updateTable: () => ({
      ...base,
      executeTakeFirstOrThrow: finish,
      execute: finish,
    }),
    insertInto: () => ({
      ...base,
      executeTakeFirstOrThrow: finish,
      execute: finish,
    }),
    deleteFrom: () => ({ ...base, execute: finish }),
    selectFrom: () => ({
      ...base,
      executeTakeFirst: () => Promise.resolve(state.selects.shift()),
    }),
  };
}

const fakeDb = {
  selectFrom: () => ({
    ...chain(),
    executeTakeFirst: () => Promise.resolve(state.selects.shift()),
  }),
  transaction: () => ({
    execute: (cb: (trx: ReturnType<typeof makeTrx>) => Promise<unknown>) =>
      cb(makeTrx()),
  }),
};

function resetState(selects: SelectResult[], txnError: unknown = undefined) {
  state.selects = selects.slice();
  state.txnError = txnError;
  state.updateResult = undefined;
  state.insertResult = undefined;
}

const actualDbModule = await import("@wateaminbox/database");
mock.module("@wateaminbox/database", () => ({ ...actualDbModule, db: fakeDb }));

const actualPassword = await import("../lib/password.js");
mock.module("../lib/password.js", () => ({
  ...actualPassword,
  verifyPassword: async () => true,
  hashPassword: async () => "mocked-hash",
}));

const { updateProfile, register } = await import("./auth.service.js");

// A real `node-postgres` unique_violation, shaped exactly as Kysely's
// PostgresDialect re-throws it: the driver's .code/.constraint reach the catch
// intact (the client has no error transformer — see packages/database client).
function pg23505(constraint = "users_email_key") {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    { name: "error", code: "23505", constraint },
  );
}

const USER_ID = crypto.randomUUID();
const currentRow: Record<string, unknown> = {
  id: USER_ID,
  email: "current@example.com",
  password_hash: "hashed",
  avatar_key: null,
  email_verified_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
};

async function catchUpdateProfile() {
  resetState([currentRow, undefined], pg23505());
  let thrown: unknown;
  try {
    await updateProfile(USER_ID, {
      email: "new@example.com",
      currentPassword: "pw",
    });
  } catch (error) {
    thrown = error;
  }
  return thrown;
}

async function catchUpdateProfileWith(error: unknown) {
  resetState([currentRow, undefined], error);
  let thrown: unknown;
  try {
    await updateProfile(USER_ID, {
      email: "new@example.com",
      currentPassword: "pw",
    });
  } catch (error) {
    thrown = error;
  }
  return thrown;
}

async function catchRegister(error: unknown) {
  resetState([undefined], error);
  let thrown: unknown;
  try {
    await register("new@example.com", "Password123", "Name");
  } catch (error) {
    thrown = error;
  }
  return thrown;
}

describe("updateProfile email-change TOCTOU", () => {
  test("a 23505 from the in-transaction UPDATE becomes EMAIL_EXISTS 409, not 500", async () => {
    const thrown = await catchUpdateProfile();

    // Before the fix this was a raw driver error (isAuthError: false, code: 23505).
    expect(thrown).toBeInstanceOf(AuthError);
    expect(thrown).toMatchObject({
      code: "EMAIL_EXISTS",
      statusCode: 409,
      message: "An account with this email already exists",
    });
  });

  test("the raw 23505 is no longer leaked to the route layer", async () => {
    const thrown = await catchUpdateProfile();

    expect((thrown as { code?: string }).code).toBe("EMAIL_EXISTS");
    expect((thrown as { code?: string }).code).not.toBe("23505");
  });

  test("a non-23505 driver error still propagates unwrapped", async () => {
    const thrown = await catchUpdateProfileWith(
      Object.assign(new Error("connection refused"), { code: "08006" }),
    );

    expect(thrown).not.toBeInstanceOf(AuthError);
    expect((thrown as { code?: string }).code).toBe("08006");
  });

  test("a 23505 on a different constraint is not masked as an email collision", async () => {
    const thrown = await catchUpdateProfileWith(
      pg23505("auth_tokens_token_hash_key"),
    );

    expect(thrown).not.toBeInstanceOf(AuthError);
    expect((thrown as { code?: string }).code).toBe("23505");
    expect((thrown as { constraint?: string }).constraint).toBe(
      "auth_tokens_token_hash_key",
    );
  });

  test("the uncontended pre-check still raises EMAIL_EXISTS on its own", async () => {
    // Real pre-check path: the email is already taken, so the transaction is
    // never reached. This pins the happy-path 409 the fix must preserve.
    resetState([currentRow, { id: "other-user" }]);
    let thrown: unknown;
    try {
      await updateProfile(USER_ID, {
        email: "new@example.com",
        currentPassword: "pw",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AuthError);
    expect(thrown).toMatchObject({ code: "EMAIL_EXISTS", statusCode: 409 });
  });
});

describe("register email-uniqueness TOCTOU", () => {
  test("a 23505 from the in-transaction INSERT becomes EMAIL_EXISTS 409", async () => {
    const thrown = await catchRegister(pg23505());

    expect(thrown).toBeInstanceOf(AuthError);
    expect(thrown).toMatchObject({
      code: "EMAIL_EXISTS",
      statusCode: 409,
      message: "An account with this email already exists",
    });
  });

  test("a non-23505 driver error still propagates unwrapped", async () => {
    const thrown = await catchRegister(
      Object.assign(new Error("connection refused"), { code: "08006" }),
    );

    expect(thrown).not.toBeInstanceOf(AuthError);
    expect((thrown as { code?: string }).code).toBe("08006");
  });

  test("a 23505 on a different constraint is not masked as an email collision", async () => {
    const thrown = await catchRegister(pg23505("auth_tokens_token_hash_key"));

    expect(thrown).not.toBeInstanceOf(AuthError);
    expect((thrown as { code?: string }).code).toBe("23505");
  });

  test("the uncontended pre-check still raises EMAIL_EXISTS on its own", async () => {
    resetState([{ id: "existing-user" }]);
    let thrown: unknown;
    try {
      await register("new@example.com", "Password123", "Name");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AuthError);
    expect(thrown).toMatchObject({ code: "EMAIL_EXISTS", statusCode: 409 });
  });
});
