import { describe, expect, test } from "bun:test";
import { channelSpineDefaults } from "./channel-spine-provisioning.service.js";

/**
 * New workspaces inherit the deployment's defaults; existing ones never do.
 * The env module snapshots at import, so this asserts the parsing contract
 * that decides whether seeding happens at all.
 */
describe("channelSpineDefaults", () => {
  test("no configured providers means new workspaces start on legacy", () => {
    // The shipped default. A self-hosted deployment that configures nothing
    // must not silently begin enabling channels for its workspaces.
    expect(channelSpineDefaults()).toBeNull();
  });
});

describe("provider list parsing", () => {
  // Mirrors the parsing in channelSpineDefaults, which reads a snapshotted
  // env value; this pins the shape a deployment is expected to write.
  const parse = (value: string) =>
    value
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean);

  test("accepts a single provider", () => {
    expect(parse("telegram_bot")).toEqual(["telegram_bot"]);
  });

  test("tolerates spacing and trailing separators", () => {
    expect(parse(" telegram_bot , whatsapp_linked_device ,")).toEqual([
      "telegram_bot",
      "whatsapp_linked_device",
    ]);
  });

  test("an empty or whitespace value yields nothing to enable", () => {
    expect(parse("")).toEqual([]);
    expect(parse("  ,  ")).toEqual([]);
  });
});
