import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Holds the API's shutdown budget and its container stop grace together.
 *
 * Both files are read as text rather than imported: importing the entrypoint
 * would register signal handlers on the test process and pull in every service
 * module's import-time side effects.
 */
const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const entrypoint = readFileSync(
  join(repoRoot, "apps/api/src/index.ts"),
  "utf8",
);
const compose = readFileSync(join(repoRoot, "compose.production.yml"), "utf8");

function shutdownDeadlineSeconds(source: string): number {
  const literal = source.match(/SHUTDOWN_DEADLINE_MS\s*=\s*([\d_]+)/)?.[1];
  if (!literal) throw new Error("SHUTDOWN_DEADLINE_MS not found in index.ts");
  return Number(literal.replaceAll("_", "")) / 1000;
}

/**
 * Reads stop_grace_period out of one service block. A scan rather than a YAML
 * parse: the assertion is narrow and the API has no YAML dependency.
 */
function stopGracePeriodSeconds(
  yaml: string,
  service: string,
): number | undefined {
  const lines = yaml.split("\n");
  const start = lines.indexOf(`  ${service}:`);
  if (start === -1) throw new Error(`service ${service} not found`);

  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) break; // next service block
    const match = line.match(/^\s*stop_grace_period:\s*(\d+)s\s*$/);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

describe("api shutdown budget", () => {
  test("the container waits longer than the shutdown budget", () => {
    const deadline = shutdownDeadlineSeconds(entrypoint);
    const grace = stopGracePeriodSeconds(compose, "api");

    expect(deadline).toBeGreaterThan(0);
    expect(grace).toBeDefined();
    // Docker's 10s default would SIGKILL mid-shutdown.
    expect(grace ?? 0).toBeGreaterThan(deadline);
  });

  test("the grace period leaves headroom to exit after the budget", () => {
    const deadline = shutdownDeadlineSeconds(entrypoint);
    const grace = stopGracePeriodSeconds(compose, "api") ?? 0;

    // The sequence can use its whole budget and still needs time to log and
    // exit; a one-second margin would make SIGKILL a routine outcome.
    expect(grace - deadline).toBeGreaterThanOrEqual(5);
  });

});
