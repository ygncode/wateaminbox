import { describe, expect, test } from "bun:test";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  changePasswordSettingsSchema,
  companySetupSchema,
  forgotPasswordSchema,
  loginSchema,
  profileSettingsSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth";
import { addContactSchema } from "./contact";
import { quickReplySchema } from "./quick-reply";
import { postStatusSchema } from "./status";
import { inviteTeamMemberSchema } from "./team";

const options = { fields: {}, shouldUseNativeValidation: false };

describe("Zod 4 / React Hook Form resolver contracts", () => {
  test("login preserves field errors and never returns invalid values", async () => {
    const result = await zodResolver(loginSchema)(
      { email: "bad", password: "" },
      {},
      options,
    );
    expect(result.values).toEqual({});
    expect(result.errors.email?.message).toBe(
      "Please enter a valid email address",
    );
    expect(result.errors.password?.message).toBe("Password is required");
  });

  test("registration and password confirmation keep their field paths", async () => {
    const result = await zodResolver(registerSchema)(
      {
        name: "Ada",
        email: "ada@example.com",
        password: "Passw0rd!",
        confirmPassword: "different",
      },
      {},
      options,
    );
    expect(result.errors.confirmPassword?.message).toBe(
      "Passwords do not match",
    );
    const reset = await zodResolver(resetPasswordSchema)(
      { password: "Passw0rd!", confirmPassword: "different" },
      {},
      options,
    );
    expect(reset.errors.confirmPassword?.message).toBe(
      "Passwords do not match",
    );
    const change = await zodResolver(changePasswordSettingsSchema)(
      {
        currentPassword: "Passw0rd!",
        newPassword: "Passw0rd!",
        confirmPassword: "Passw0rd!",
      },
      {},
      options,
    );
    expect(change.errors.newPassword?.message).toBe(
      "New password must be different from your current password",
    );
  });

  test("profile and quick-reply transforms reach the submit handler unchanged", async () => {
    const profile = await zodResolver(profileSettingsSchema)(
      { name: " Ada ", email: " ada@example.com " },
      {},
      options,
    );
    expect(profile).toEqual({
      errors: {},
      values: { name: "Ada", email: "ada@example.com" },
    });
    const reply = await zodResolver(quickReplySchema)(
      { shortcut: " HELLO ", title: " Greeting ", content: " Welcome " },
      {},
      options,
    );
    expect(reply).toEqual({
      errors: {},
      values: { shortcut: "hello", title: "Greeting", content: "Welcome" },
    });
  });

  test("custom enum and cross-field errors retain user-facing messages", async () => {
    for (const input of [{}, { role: "owner" }, { role: 123 }]) {
      const result = inviteTeamMemberSchema.safeParse({
        email: "ada@example.com",
        ...input,
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues[0]?.message).toBe(
          "Please select a valid role",
        );
    }
    expect(
      (
        await zodResolver(inviteTeamMemberSchema)(
          { email: "ada@example.com", role: "member" },
          {},
          options,
        )
      ).errors,
    ).toEqual({});
    const status = await zodResolver(postStatusSchema)(
      { type: "text", content: " " },
      {},
      options,
    );
    expect(status.errors.content?.message).toBe(
      "Please enter some text for your status",
    );
    const invalidType = postStatusSchema.safeParse({ type: "unsupported" });
    if (invalidType.success) throw new Error("Expected invalid status type");
    expect(invalidType.error.issues[0]?.message).toBe(
      "Please select a status type",
    );
  });

  test("contact forms preserve v3 GUID acceptance", async () => {
    const value = {
      phoneNumber: "+15551234567",
      connectionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    };
    const result = await zodResolver(addContactSchema)(value, {}, options);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual(value);
  });

  test("remaining form resolvers preserve successful submissions", async () => {
    expect(
      await zodResolver(forgotPasswordSchema)(
        { email: "ada@example.com" },
        {},
        options,
      ),
    ).toEqual({ errors: {}, values: { email: "ada@example.com" } });
    expect(
      await zodResolver(companySetupSchema)({ name: "Workspace" }, {}, options),
    ).toEqual({ errors: {}, values: { name: "Workspace" } });
    const value = {
      name: "Ada",
      email: "ada@example.com",
      password: "Passw0rd!",
      confirmPassword: "Passw0rd!",
    };
    expect(await zodResolver(registerSchema)(value, {}, options)).toEqual({
      errors: {},
      values: value,
    });
  });

  test("criteriaMode all and nested array errors remain supported", async () => {
    const schema = z.object({
      items: z
        .array(
          z.object({
            name: z
              .string()
              .min(3, "Too short")
              .regex(/^[A-Z]+$/, "Uppercase required"),
          }),
        )
        .max(2, "Too many items"),
    });
    const resolver = zodResolver(schema);
    const invalid = await resolver(
      { items: [{ name: "a" }] },
      {},
      { ...options, criteriaMode: "all" },
    );
    expect(invalid.errors.items?.[0]?.name?.types).toEqual({
      too_small: "Too short",
      invalid_format: "Uppercase required",
    });
    const oversized = await resolver(
      { items: Array.from({ length: 10_000 }, () => ({ name: "a" })) },
      {},
      options,
    );
    expect(oversized.values).toEqual({});
    expect(oversized.errors.items?.message).toBe("Too many items");
    expect(Object.keys(oversized.errors.items ?? {}).sort()).toEqual([
      "message",
      "ref",
      "type",
    ]);
  });
});
