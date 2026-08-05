import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural guard on the channel split.
 *
 * `company:{companyId}` is subscribed by every workspace member, so an event
 * published there is readable by everyone. Only workspace/connection control
 * events may go there. Anything naming a contact's conversation has to be
 * fanned out to that conversation's authorized viewers instead.
 *
 * The type system already blocks the obvious mistake (a conversation event
 * passed to `broadcastToCompany` fails to compile). These tests pin the
 * classification itself, which the type system cannot judge.
 */

const SRC = new URL("..", import.meta.url).pathname;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.endsWith(".ts") && !entry.includes(".test.")) {
      acc.push(full);
    }
  }
  return acc;
}

const realtimeSource = readFileSync(join(SRC, "lib/realtime.ts"), "utf8");

function unionMembers(typeName: string): string[] {
  const start = realtimeSource.indexOf(`export type ${typeName} =`);
  expect(start).toBeGreaterThan(-1);
  const body = realtimeSource
    .slice(start, realtimeSource.indexOf(";", start))
    // Comments inside the union may quote event names or doc titles; only the
    // actual `| "member"` entries count.
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return [...body.matchAll(/\|\s*"([^"]+)"/g)].map((match) => match[1]);
}

const COMPANY_EVENTS = unionMembers("CompanyRealtimeEventType");
const CONVERSATION_EVENTS = unionMembers("ConversationRealtimeEventType");

describe("realtime channel classification", () => {
  test("no event is both company-wide and conversation-scoped", () => {
    const overlap = COMPANY_EVENTS.filter((event) =>
      CONVERSATION_EVENTS.includes(event),
    );
    expect(overlap).toEqual([]);
  });

  test("every conversation-scoped event is actually conversation-scoped", () => {
    // Each of these names a message, a conversation, or a contact, so it
    // reveals which conversations exist and when they are active.
    expect(CONVERSATION_EVENTS.sort()).toEqual(
      [
        "contact:profile_picture",
        "contact:updated",
        "conversation:read",
        "conversation:updated",
        "media:download_failed",
        "media:downloaded",
        "message:deleted",
        "message:failed",
        "message:new",
        "message:reaction",
        "message:status",
        "presence:offline",
        "presence:online",
        "scheduled_message:updated",
        "typing:start",
        "typing:stop",
      ].sort(),
    );
  });

  test("company-wide events describe the workspace or a connection only", () => {
    // If a new name lands here, decide deliberately: does it identify one
    // contact's conversation? Then it belongs in ConversationRealtimeEventType.
    expect(COMPANY_EVENTS.sort()).toEqual(
      [
        "bulk_job:updated",
        "catalogs:updated",
        "command:failed",
        "connected",
        "connection:status",
        "disconnected",
        "history:loaded",
        "labels:updated",
        "notification:toast",
        "qr",
        "status",
        "sync:complete",
        "sync:interrupted",
        "sync:progress",
        "sync:start",
      ].sort(),
    );
  });

  test("no company-wide event name mentions a message or conversation", () => {
    const suspicious = COMPANY_EVENTS.filter((event) =>
      /^(message|conversation|typing|presence|media|contact|scheduled_message):/.test(
        event,
      ),
    );
    expect(suspicious).toEqual([]);
  });
});

describe("no producer bypasses the visibility-scoped fan-out", () => {
  const files = sourceFiles(SRC).filter(
    (file) => !file.endsWith("lib/realtime.ts"),
  );

  test("nothing publishes a conversation event straight to the company channel", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("broadcastToCompany(")) continue;
      for (const event of CONVERSATION_EVENTS) {
        // A conversation event name appearing in the same file as a
        // company-channel publish is worth a human look.
        const call = new RegExp(
          `broadcastToCompany\\([^)]*?"${event.replace(":", ":")}"`,
          "s",
        );
        if (call.test(source)) offenders.push(`${file}: ${event}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the company-wide 'except one client' helper is gone", () => {
    // It existed only for typing and read receipts, both now scoped. Keeping
    // it would be an easy way to reintroduce a company-wide conversation event.
    expect(realtimeSource).not.toMatch(
      /export async function broadcastToCompanyExcept/,
    );
    const users = files.filter((file) =>
      readFileSync(file, "utf8").includes("broadcastToCompanyExcept"),
    );
    expect(users).toEqual([]);
  });
});
