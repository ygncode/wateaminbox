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

describe("Telegram sticker attachments", () => {
  const base = {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1_757_332_800,
      chat: { id: 42, type: "private" as const },
      from: { id: 42, is_bot: false, first_name: "Ada" },
    },
  };
  const normalizeSticker = (sticker: Record<string, unknown>) =>
    normalizeTelegramUpdate(
      {
        ...base,
        message: { ...base.message, sticker },
      },
      {
        companyId: "11111111-1111-4111-8111-111111111111",
        channelAccountId: "22222222-2222-4222-8222-222222222222",
        receivedAt: "2026-09-08T12:00:01.000Z",
      },
    ).find((event) => event.kind === "message.upsert")?.payload
      .attachments?.[0];

  test("a static sticker is typed as WebP, which Telegram never declares itself", () => {
    // The Sticker object is the only Telegram file with no `mime_type`, so
    // without this it stored as octet-stream and rendered as a broken image.
    expect(normalizeSticker({ file_id: "static-1" })).toMatchObject({
      kind: "sticker",
      providerAttachmentId: "static-1",
      contentType: "image/webp",
    });
  });

  test("a video sticker is typed as WebM so the client uses a video element", () => {
    expect(
      normalizeSticker({ file_id: "video-1", is_video: true }),
    ).toMatchObject({
      providerAttachmentId: "video-1",
      contentType: "video/webm",
    });
  });

  test("an animated sticker keeps its Lottie payload, marked as an opaque archive", () => {
    // A .tgs is gzipped Lottie JSON: not an image, and never to be labelled
    // as one, or the client would hand it to an <img> and draw nothing.
    expect(
      normalizeSticker({
        file_id: "animated-1",
        is_animated: true,
        thumbnail: { file_id: "thumb-1" },
      }),
    ).toMatchObject({
      providerAttachmentId: "animated-1",
      contentType: "application/gzip",
    });
  });
});

describe("Telegram service messages", () => {
  const serviceMessage = (extra: Record<string, unknown>) =>
    normalizeTelegramUpdate(
      {
        update_id: 9,
        message: {
          message_id: 30,
          date: 1_757_332_800,
          chat: { id: -100999, type: "group", title: "WATeamInboxTest" },
          from: { id: 42, is_bot: false, first_name: "Ivar" },
          ...extra,
        },
      },
      {
        companyId: "11111111-1111-4111-8111-111111111111",
        channelAccountId: "22222222-2222-4222-8222-222222222222",
        receivedAt: "2026-09-08T12:00:01.000Z",
      },
    ).find((event) => event.kind === "message.upsert")?.payload;

  test("a membership change is described instead of arriving blank", () => {
    // These carry no text at all, so the thread previously showed an empty
    // bubble attributed to whoever triggered the event.
    const payload = serviceMessage({
      new_chat_members: [{ id: 7, is_bot: true, first_name: "WATeamInbox" }],
    });
    expect(payload?.normalizedType).toBe("system");
    expect(payload?.textContent).toBe("WATeamInbox joined the group");
  });

  test("a rename and a departure read as events, not messages", () => {
    expect(serviceMessage({ new_chat_title: "Support" })?.textContent).toBe(
      'The group was renamed to "Support"',
    );
    expect(
      serviceMessage({
        left_chat_member: { id: 7, is_bot: false, first_name: "Ivar" },
      })?.textContent,
    ).toBe("Ivar left the group");
  });

  test("a real message keeps its own text", () => {
    expect(serviceMessage({ text: "hello" })?.textContent).toBe("hello");
  });
});
