import { describe, expect, test } from "bun:test";
import type { ResolvedCapabilities } from "@wateaminbox/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelComposerGate } from "./ChannelComposerGate";
import {
  LEGACY_COMPOSER_FEATURES,
  resolveComposerFeatures,
  useComposerFeatures,
} from "./composer-capabilities";

const CAPABILITIES: ResolvedCapabilities = {
  typing: true,
  readReceipts: false,
  reactions: true,
  messageEditing: false,
  messageDeletion: true,
  templates: false,
  groups: true,
  multipleRecipients: false,
  outboundInitiation: false,
  scheduledMessages: false,
  messageTypes: [
    { type: "text", enabled: true, maxTextLength: 4096 },
    {
      type: "image",
      enabled: true,
      attachment: { maxCount: 1 },
    },
    {
      type: "document",
      enabled: false,
      attachment: { maxCount: 1 },
    },
  ],
  actions: {
    reply: true,
    quote: true,
    forward: true,
    retry: true,
    starLocally: true,
    deleteLocally: true,
    deleteForEveryone: false,
    groupMentions: false,
    remoteHistory: false,
  },
  attachment: {
    enabled: true,
    acceptedContentTypes: ["image/jpeg", "image/png"],
  },
  constraints: {},
  unavailableReasons: {},
  version: "test:v1",
};

describe("resolveComposerFeatures", () => {
  test("derives controls from enabled descriptors rather than the channel name", () => {
    expect(resolveComposerFeatures(CAPABILITIES)).toEqual({
      canComposeText: true,
      canAttach: true,
      canSchedule: false,
      canSendTyping: true,
      canMentionGroups: false,
      maxTextLength: 4096,
      attachmentTypes: ["image"],
      acceptedContentTypes: ["image/jpeg", "image/png"],
    });
  });

  test("fails attachment support closed when the account-level switch is off", () => {
    expect(
      resolveComposerFeatures({
        ...CAPABILITIES,
        attachment: { enabled: false },
      }).canAttach,
    ).toBe(false);
  });

  test("does not treat template-required text as free-form text", () => {
    expect(
      resolveComposerFeatures({
        ...CAPABILITIES,
        messageTypes: [{ type: "text", enabled: true, templateRequired: true }],
      }).canComposeText,
    ).toBe(false);
  });
});

describe("ChannelComposerGate", () => {
  test("renders children only when text composition is supported", () => {
    const html = renderToStaticMarkup(
      <ChannelComposerGate capabilities={CAPABILITIES}>
        <textarea aria-label="Composer" />
      </ChannelComposerGate>,
    );
    expect(html).toContain("Composer");
    expect(html).not.toContain("Messaging is not available");
  });

  test("fails closed while capabilities are absent", () => {
    const html = renderToStaticMarkup(
      <ChannelComposerGate capabilities={null}>
        <textarea aria-label="Composer" />
      </ChannelComposerGate>,
    );
    expect(html).toContain("Messaging is not available");
    expect(html).not.toContain("textarea");
  });
});

function FeatureProbe() {
  const features = useComposerFeatures();
  return <pre>{JSON.stringify(features)}</pre>;
}

/** `renderToStaticMarkup` escapes the JSON quotes; undo that before parsing. */
function readProbe(html: string): unknown {
  return JSON.parse(html.replace(/<\/?pre>/g, "").replace(/&quot;/g, '"'));
}

describe("ComposerFeaturesContext", () => {
  test("hands the resolved descriptor to every control inside the gate", () => {
    const html = renderToStaticMarkup(
      <ChannelComposerGate capabilities={CAPABILITIES}>
        <FeatureProbe />
      </ChannelComposerGate>,
    );
    expect(readProbe(html)).toEqual(resolveComposerFeatures(CAPABILITIES));
  });

  test("leaves the legacy linked-device composer unrestricted outside the gate", () => {
    const html = renderToStaticMarkup(<FeatureProbe />);
    expect(readProbe(html)).toEqual(LEGACY_COMPOSER_FEATURES);
  });
});
