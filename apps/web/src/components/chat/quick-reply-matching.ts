import type { QuickReply } from "@/lib/api/types";

const SHORTCUT_CHARACTER = /[a-zA-Z0-9_-]/;

export interface ActiveQuickReplyToken {
  start: number;
  end: number;
  query: string;
}

export interface QuickReplyInsertion {
  message: string;
  cursor: number;
}

/**
 * Finds a /shortcut token at the caret. Tokens only activate at the beginning
 * of a message or after whitespace, which avoids triggering inside URLs.
 */
export function getActiveQuickReplyToken(
  message: string,
  cursor: number,
): ActiveQuickReplyToken | null {
  const safeCursor = Math.max(0, Math.min(cursor, message.length));
  const beforeCursor = message.slice(0, safeCursor);
  const match = beforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);

  if (!match) return null;

  const slashOffset = match[0].lastIndexOf("/");
  const start = safeCursor - match[0].length + slashOffset;
  let end = safeCursor;

  while (end < message.length && SHORTCUT_CHARACTER.test(message[end])) {
    end += 1;
  }

  return {
    start,
    end,
    query: message.slice(start + 1, end).toLowerCase(),
  };
}

export function filterQuickReplies(
  quickReplies: QuickReply[],
  query: string,
  limit = 6,
): QuickReply[] {
  const normalizedQuery = query.trim().toLowerCase();

  return quickReplies
    .map((quickReply, index) => {
      const shortcut = quickReply.shortcut.toLowerCase();
      const title = quickReply.title.toLowerCase();
      const content = quickReply.content.toLowerCase();
      let score = 0;

      if (normalizedQuery) {
        if (shortcut === normalizedQuery) score = 0;
        else if (shortcut.startsWith(normalizedQuery)) score = 1;
        else if (title.startsWith(normalizedQuery)) score = 2;
        else if (shortcut.includes(normalizedQuery)) score = 3;
        else if (title.includes(normalizedQuery)) score = 4;
        else if (content.includes(normalizedQuery)) score = 5;
        else return null;
      }

      return { quickReply, score, index };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        quickReply: QuickReply;
        score: number;
        index: number;
      } => candidate !== null,
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.quickReply.shortcut.localeCompare(right.quickReply.shortcut) ||
        left.index - right.index,
    )
    .slice(0, limit)
    .map(({ quickReply }) => quickReply);
}

export function insertQuickReply(
  message: string,
  token: ActiveQuickReplyToken,
  quickReply: QuickReply,
): QuickReplyInsertion {
  const nextMessage =
    message.slice(0, token.start) +
    quickReply.content +
    message.slice(token.end);

  return {
    message: nextMessage,
    cursor: token.start + quickReply.content.length,
  };
}
