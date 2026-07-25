import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import {
  InvitationDeliveryError,
  InvitationEmailMismatchError,
} from "../../lib/errors.js";
import {
  acceptInvitation,
  inviteMember,
  resendInvitation,
} from "./invitations.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const deliveredEmail = async () => ({
  success: true,
  messageId: "test-message",
});
const failedEmail = async () => ({ success: false, error: "provider down" });

describe("company invitations", () => {
  integrationTest(
    "preserves roles, enforces recipients, and rolls back delivery failures",
    async () => {
      const ownerId = crypto.randomUUID();
      const recipientId = crypto.randomUUID();
      const otherUserId = crypto.randomUUID();
      const failedRecipientId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const schemaName = `test_${companyId.replaceAll("-", "_")}`;
      const recipientEmail = `admin-${recipientId}@example.com`;
      const failedEmailAddress = `failed-${failedRecipientId}@example.com`;

      try {
        await db
          .insertInto("users")
          .values([
            {
              id: ownerId,
              email: `owner-${ownerId}@example.com`,
              password_hash: "test",
            },
            {
              id: recipientId,
              email: recipientEmail,
              password_hash: "test",
            },
            {
              id: otherUserId,
              email: `other-${otherUserId}@example.com`,
              password_hash: "test",
            },
            {
              id: failedRecipientId,
              email: failedEmailAddress,
              password_hash: "test",
            },
          ])
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Invitation test",
            schema_name: schemaName,
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_stats")
          .values({ company_id: companyId, active_users: 1 })
          .execute();
        await db
          .insertInto("company_members")
          .values({
            company_id: companyId,
            user_id: ownerId,
            role: "owner",
          })
          .execute();

        const invitation = await inviteMember(
          companyId,
          { email: recipientEmail.toUpperCase(), role: "admin" },
          ownerId,
          deliveredEmail,
        );
        expect(invitation.email).toBe(recipientEmail);
        expect(invitation.role).toBe("admin");

        await expect(
          acceptInvitation(invitation.token, otherUserId),
        ).rejects.toBeInstanceOf(InvitationEmailMismatchError);
        expect(
          (
            await db
              .selectFrom("invitations")
              .select("accepted_at")
              .where("id", "=", invitation.id)
              .executeTakeFirstOrThrow()
          ).accepted_at,
        ).toBeNull();

        const accepted = await acceptInvitation(invitation.token, recipientId);
        expect(accepted.member.role).toBe("admin");

        await expect(
          inviteMember(
            companyId,
            { email: failedEmailAddress, role: "member" },
            ownerId,
            failedEmail,
          ),
        ).rejects.toBeInstanceOf(InvitationDeliveryError);
        expect(
          await db
            .selectFrom("invitations")
            .select("id")
            .where("email", "=", failedEmailAddress)
            .executeTakeFirst(),
        ).toBeUndefined();

        const pending = await inviteMember(
          companyId,
          { email: failedEmailAddress, role: "member" },
          ownerId,
          deliveredEmail,
        );
        await expect(
          resendInvitation(companyId, pending.id, ownerId, failedEmail),
        ).rejects.toBeInstanceOf(InvitationDeliveryError);
        const restored = await db
          .selectFrom("invitations")
          .select(["token", "role"])
          .where("id", "=", pending.id)
          .executeTakeFirstOrThrow();
        expect(restored.token).toBe(pending.token);
        expect(restored.role).toBe("member");
      } finally {
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db
          .deleteFrom("users")
          .where("id", "in", [
            ownerId,
            recipientId,
            otherUserId,
            failedRecipientId,
          ])
          .execute();
      }
    },
    30_000,
  );
});
