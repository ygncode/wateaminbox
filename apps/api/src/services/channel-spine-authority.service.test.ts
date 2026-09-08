import { describe, expect, test } from "bun:test";
import {
  getChannelSpineWorkspaceAuthority,
  isChannelProviderEnabled,
} from "./channel-spine-authority.service.js";
const companyId = "11111111-1111-4111-8111-111111111111";
type AuthorityDatabase = NonNullable<
  Parameters<typeof getChannelSpineWorkspaceAuthority>[1]
>;

function fake(load: () => unknown): AuthorityDatabase {
  const query = {
    select: () => query,
    where: () => query,
    executeTakeFirst: load,
  };
  return { selectFrom: () => query } as unknown as AuthorityDatabase;
}
function enabled() {
  return {
    dual_write_enabled: true,
    dual_write_revision: "api-r1",
    neutral_reads_enabled: true,
    neutral_read_revision: "api-r1",
    write_authority: "neutral",
    write_authority_revision: "api-r1",
    enabled_providers: ["telegram_bot"],
    provider_enable_revision: "api-r1",
    revision: "4",
  };
}
describe("channel spine workspace authority", () => {
  test("defaults a missing row to legacy/off", async () => {
    expect(
      await getChannelSpineWorkspaceAuthority(
        companyId,
        fake(() => undefined),
      ),
    ).toMatchObject({
      source: "absent",
      dualWriteEnabled: false,
      neutralReadsEnabled: false,
      writeAuthority: "legacy",
      enabledProviders: [],
    });
  });
  test("fails closed for unavailable and malformed state", async () => {
    const unavailable = await getChannelSpineWorkspaceAuthority(
      companyId,
      fake(() => {
        throw new Error("down");
      }),
    );
    const invalid = await getChannelSpineWorkspaceAuthority(
      companyId,
      fake(() => ({ ...enabled(), write_authority_revision: null })),
    );
    for (const value of [unavailable, invalid])
      expect(value).toMatchObject({
        dualWriteEnabled: false,
        neutralReadsEnabled: false,
        writeAuthority: "legacy",
        enabledProviders: [],
      });
    expect(unavailable.source).toBe("unavailable");
    expect(invalid.source).toBe("invalid");
  });
  test("does not retain stale authority between calls", async () => {
    let calls = 0;
    let row: unknown = enabled();
    const database = fake(() => {
      calls += 1;
      return row;
    });
    const first = await getChannelSpineWorkspaceAuthority(companyId, database);
    row = undefined;
    const second = await getChannelSpineWorkspaceAuthority(companyId, database);
    expect(calls).toBe(2);
    expect(first.writeAuthority).toBe("neutral");
    expect(isChannelProviderEnabled(first, "telegram_bot")).toBe(true);
    expect(second.writeAuthority).toBe("legacy");
  });
});
