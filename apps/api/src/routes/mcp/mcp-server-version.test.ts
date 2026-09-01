import { describe, expect, test } from "bun:test";
import { MCP_SERVER_VERSION } from "./index.js";
import { readTools } from "./tools/read.js";
import { writeTools } from "./tools/write.js";

/**
 * Clients cache the tool list.
 *
 * ChatGPT kept answering "WATeamInbox does not currently expose a
 * list_connections tool" after that tool shipped, through a disconnect, a
 * reconnect and a fresh OAuth grant - the tool cache is not tied to the
 * authorization. The advertised server version had been "1.0.0" throughout,
 * while the tool surface had grown by three tools, so nothing signalled that
 * the cached list was out of date.
 *
 * This test pairs the version with the tool surface. Adding or removing a tool
 * fails it, and the fix is to bump MCP_SERVER_VERSION and update the list
 * below - which is the point: the version cannot silently stop tracking the
 * tools it describes.
 */
const TOOLS_AT_THIS_VERSION = [
  "add_contact_note",
  "assign_contact",
  "create_broadcast",
  "create_tag",
  "get_broadcast_status",
  "get_contact",
  "get_conversation_messages",
  "list_broadcasts",
  "list_connections",
  "list_contact_notes",
  "list_contacts",
  "list_conversations",
  "list_members",
  "list_tags",
  "search",
  "send_message",
  "start_conversation",
  "tag_contact",
  "unassign_contact",
  "untag_contact",
  "update_contact",
  "update_conversation_state",
] as const;

describe("advertised MCP server version", () => {
  test("tracks the tool surface it describes", () => {
    const actual = [...readTools, ...writeTools]
      .map((tool) => tool.name)
      .sort();

    expect(actual).toEqual([...TOOLS_AT_THIS_VERSION].sort());
  });

  test("is a plain semver string clients can compare", () => {
    expect(MCP_SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("has moved past the version that shipped a stale tool list", () => {
    // 1.0.0 was advertised while three tools were added under it. Any value
    // above it is fine; that specific one is not.
    expect(MCP_SERVER_VERSION).not.toBe("1.0.0");
  });
});
