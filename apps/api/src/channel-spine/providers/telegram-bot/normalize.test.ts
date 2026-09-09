import { describe, expect, test } from "bun:test";
import { normalizeTelegramUpdate } from "./normalize";

const context = {
  companyId: "11111111-1111-4111-8111-111111111111",
  channelAccountId: "22222222-2222-4222-8222-222222222222",
  receivedAt: "2026-09-08T12:00:01.000Z",
};

describe("Telegram Bot update normalization", () => {
  test("normalizes a group topic message and only retains required media data", () => {
    const events = normalizeTelegramUpdate(
      {
        update_id: 101,
        message: {
          message_id: 51,
          message_thread_id: 7,
          date: 1_788_868_800,
          chat: { id: -100123, type: "supergroup", title: "Support" },
          from: {
            id: 42,
            is_bot: false,
            first_name: "Ada",
            username: "ada_private",
            language_code: "en",
          },
          caption: "screenshot",
          photo: [
            { file_id: "small", file_unique_id: "same", file_size: 5 },
            {
              file_id: "fetchable-file-id",
              file_unique_id: "same",
              file_size: 500,
              width: 1000,
              height: 1000,
            },
          ],
          reply_to_message: { message_id: 49, text: "private quoted body" },
          media_group_id: "album-1",
          entities: [{ type: "mention", offset: 0, length: 3 }],
        },
      },
      context,
    );
    expect(events.map(({ kind }) => kind)).toEqual([
      "endpoint.upsert",
      "conversation.upsert",
      "message.upsert",
    ]);
    expect(events[0]).toMatchObject({
      eventId: "telegram:101:endpoint.upsert",
      payload: {
        endpoint: {
          externalId: "42",
          identityScope: "telegram-user",
          endpointKind: "person",
          displayName: "Ada",
          addressDisplay: "@ada_private",
          normalizedAddress: "ada_private",
        },
        verificationState: "provider_verified",
      },
    });
    expect(events[1]).toMatchObject({
      eventId: "telegram:101:conversation.upsert",
      payload: {
        conversation: {
          externalThreadId: "-100123:thread:7",
          clientThreadKey: "telegram:-100123:thread:7",
          kind: "thread",
          subject: "Support",
        },
      },
    });
    const messageEvent = events[2];
    expect(messageEvent).toMatchObject({
      eventId: "telegram:101:message.upsert",
      providerOccurredAt: "2026-09-08T12:00:00.000Z",
      payload: {
        conversation: {
          externalThreadId: "-100123:thread:7",
          clientThreadKey: "telegram:-100123:thread:7",
          kind: "thread",
          subject: "Support",
        },
        externalIdentityScope: "telegram-thread:-100123:thread:7",
        sender: {
          externalId: "42",
          identityScope: "telegram-user",
          endpointKind: "person",
          displayName: "Ada",
        },
        normalizedType: "image",
        textContent: "screenshot",
        replyToExternalMessageId: "49",
        attachments: [
          {
            ordinal: 0,
            kind: "image",
            providerAttachmentId: "fetchable-file-id",
            byteSize: 500,
            status: "pending",
          },
        ],
        providerMetadata: { mediaGroupId: "album-1" },
      },
    });
    const serialized = JSON.stringify(events);
    // The username is retained on purpose: it is the only handle the Bot API
    // discloses, and the inbox needs something a teammate can identify a
    // Telegram contact by. Everything else below stays minimized.
    expect(serialized).toContain("@ada_private");
    expect(serialized).not.toContain("private quoted body");
    expect(serialized).not.toContain("file_unique_id");
    expect(serialized).not.toContain("entities");
  });

  test("normalizes a non-topic group conversation", () => {
    const events = normalizeTelegramUpdate(
      {
        update_id: 106,
        message: {
          message_id: 53,
          date: 1_788_868_800,
          chat: { id: -99, type: "group", title: "Operators" },
          from: { id: 42, first_name: "Ada" },
          text: "hello team",
        },
      },
      context,
    );

    expect(events.map(({ kind }) => kind)).toEqual([
      "endpoint.upsert",
      "conversation.upsert",
      "message.upsert",
    ]);
    expect(events[1]).toMatchObject({
      payload: {
        conversation: {
          externalThreadId: "-99",
          clientThreadKey: "telegram:-99",
          kind: "group",
          subject: "Operators",
        },
      },
    });
  });

  test("normalizes edited messages with the edit timestamp", () => {
    const events = normalizeTelegramUpdate(
      {
        update_id: 102,
        edited_message: {
          message_id: 52,
          date: 1_788_868_700,
          edit_date: 1_788_868_800,
          chat: { id: 42, type: "private" },
          from: { id: 42, first_name: "Ada" },
          text: "corrected",
        },
      },
      context,
    );

    expect(events.map(({ kind }) => kind)).toEqual([
      "endpoint.upsert",
      "conversation.upsert",
      "message.edit",
    ]);
    const editEvent = events[2];
    expect(editEvent).toMatchObject({
      kind: "message.edit",
      providerOccurredAt: "2026-09-08T12:00:00.000Z",
      payload: {
        conversation: { externalThreadId: "42", kind: "direct" },
        externalMessageId: "52",
        textContent: "corrected",
      },
    });
    expect("sender" in editEvent.payload).toBe(false);
  });

  test("emits reaction additions and removals from one update", () => {
    const events = normalizeTelegramUpdate(
      {
        update_id: 103,
        message_reaction: {
          chat: { id: -100123, type: "supergroup", title: "Support" },
          message_id: 51,
          message_thread_id: 7,
          user: { id: 42, first_name: "Ada" },
          date: 1_788_868_800,
          old_reaction: [
            { type: "emoji", emoji: "👍" },
            { type: "custom_emoji", custom_emoji_id: "custom-1" },
          ],
          new_reaction: [
            { type: "emoji", emoji: "🔥" },
            { type: "custom_emoji", custom_emoji_id: "custom-1" },
          ],
        },
      },
      context,
    );

    expect(events.map(({ kind }) => kind)).toEqual([
      "endpoint.upsert",
      "conversation.upsert",
      "reaction.delete",
      "reaction.upsert",
    ]);
    expect(events.slice(2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reaction.delete",
          payload: expect.objectContaining({
            messageExternalId: "51",
            messageIdentityScope: "telegram-thread:-100123:thread:7",
            emoji: "👍",
            reactor: expect.objectContaining({ externalId: "42" }),
          }),
        }),
        expect.objectContaining({
          kind: "reaction.upsert",
          payload: expect.objectContaining({ emoji: "🔥" }),
        }),
      ]),
    );
  });

  test("ignores authenticated update kinds outside the adapter contract", () => {
    expect(
      normalizeTelegramUpdate(
        { update_id: 104, callback_query: { id: "callback" } },
        context,
      ),
    ).toEqual([]);
  });

  test("rejects malformed supported updates", () => {
    expect(() =>
      normalizeTelegramUpdate(
        {
          update_id: 105,
          message: { message_id: 1, date: 1_788_868_800, chat: {} },
        },
        context,
      ),
    ).toThrow("Invalid Telegram chat");

    expect(() =>
      normalizeTelegramUpdate(
        {
          update_id: 106,
          message: {
            message_id: 1,
            date: 1_788_868_800,
            chat: { id: 42, type: "private" },
            from: { id: 42, first_name: 123 },
            text: 123,
          },
        },
        context,
      ),
    ).toThrow("Invalid Telegram text");
  });
});
