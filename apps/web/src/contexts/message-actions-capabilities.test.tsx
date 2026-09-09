import { describe, expect, test } from "bun:test";
import type { Message, ResolvedCapabilities } from "@wateaminbox/shared";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MessageActionsProvider,
  useMessageActions,
} from "./message-actions-context";

const CAPABILITIES: ResolvedCapabilities = {
  typing: true,
  readReceipts: false,
  reactions: false,
  messageEditing: false,
  messageDeletion: false,
  templates: false,
  groups: false,
  multipleRecipients: false,
  outboundInitiation: true,
  scheduledMessages: false,
  messageTypes: [{ type: "text", enabled: true }],
  actions: {
    reply: true,
    quote: false,
    forward: false,
    retry: true,
    starLocally: true,
    deleteLocally: false,
    deleteForEveryone: false,
    groupMentions: false,
    remoteHistory: false,
  },
  attachment: { enabled: false },
  constraints: {},
  unavailableReasons: {},
  version: "test:v1",
};

const noop = (_message: Message) => {};
const noopReact = (_message: Message, _emoji: string) => {};

function OfferedActions() {
  const actions = useMessageActions();
  return (
    <pre>
      {(["onReply", "onForward", "onDelete", "onStar", "onReact"] as const)
        .filter((name) => actions[name] !== undefined)
        .join(",")}
    </pre>
  );
}

function offered(capabilities?: ResolvedCapabilities | null): string[] {
  const html = renderToStaticMarkup(
    <MessageActionsProvider
      onReply={noop}
      onForward={noop}
      onDelete={noop}
      onStar={noop}
      onReact={noopReact}
      capabilities={capabilities}
    >
      <OfferedActions />
    </MessageActionsProvider>,
  );
  const body = html.replace(/<\/?pre>/g, "");
  return body === "" ? [] : body.split(",");
}

describe("MessageActionsProvider capabilities", () => {
  test("offers only the actions the adapter reports", () => {
    expect(offered(CAPABILITIES).sort()).toEqual(["onReply", "onStar"]);
  });

  test("keeps every handler for legacy threads with no resolved contract", () => {
    expect(offered(null).sort()).toEqual(
      ["onDelete", "onForward", "onReact", "onReply", "onStar"].sort(),
    );
  });

  test("offers deletion when either local or for-everyone deletion is supported", () => {
    expect(
      offered({
        ...CAPABILITIES,
        messageDeletion: true,
        actions: { ...CAPABILITIES.actions, deleteLocally: true },
      }),
    ).toContain("onDelete");
    // The account-level switch outranks the per-action flags.
    expect(
      offered({
        ...CAPABILITIES,
        messageDeletion: false,
        actions: {
          ...CAPABILITIES.actions,
          deleteLocally: true,
          deleteForEveryone: true,
        },
      }),
    ).not.toContain("onDelete");
  });
});
