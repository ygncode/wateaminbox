import { describe, expect, test } from "bun:test";
import { signConnectionAdmissionRequest } from "./connection-admission-signature.js";

describe("connection admission request signing", () => {
  test("matches the private control-plane contract", () => {
    expect(
      signConnectionAdmissionRequest(
        "test-secret",
        "1770000000",
        '{"companyId":"x"}',
      ),
    ).toBe(
      "9012ec6f75a2c6eda035dd28353c7e17df92e1878ac3f2013b0d05b828a7ea5c",
    );
  });
});
