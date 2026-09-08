import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const root = join(import.meta.dir, "../../../..");
const protectedRoots = [
  "apps/api/src/channel-spine/contracts",
  "apps/api/src/channel-spine/domain",
  "apps/api/src/channel-spine/inbox",
  "apps/api/src/channel-spine/application",
  "packages/shared/src/channel-spine",
];
const providerImport =
  /(?:from\s*|import\s*\()\s*["'][^"']*(?:\/providers?\/|\/services\/whatsapp(?:\/|["'])|\/routes\/whatsapp(?:\/|["'])|\/lib\/nats(?:\/|["']))/g;
function violations(source: string): string[] {
  return [...source.matchAll(providerImport)].map((match) => match[0]);
}
function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? files(path)
      : /\.[cm]?[jt]sx?$/.test(path)
        ? [path]
        : [];
  });
}
describe("channel spine provider import boundary", () => {
  test("keeps normalized domain and inbox packages independent of providers", () => {
    const found = protectedRoots.flatMap((directory) =>
      files(join(root, directory)).flatMap((path) =>
        violations(readFileSync(path, "utf8")).map(
          (statement) => `${relative(root, path)}: ${statement}`,
        ),
      ),
    );
    expect(found).toEqual([]);
  });
  test("recognizes provider imports", () => {
    expect(
      violations(
        'import x from "../../providers/x.js"; import y from "../../services/whatsapp/session.js"; import("../../lib/nats/index.js")',
      ),
    ).toHaveLength(3);
  });
});
