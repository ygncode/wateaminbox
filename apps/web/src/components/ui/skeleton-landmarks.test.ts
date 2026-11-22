import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/*
 * Loading skeletons are sized against the loaded UI (DESIGN.md → Loading
 * skeletons). Both sides mark the same boxes with `data-sk="<landmark>"`, and
 * scripts/measure-skeletons.mjs compares those boxes in a browser.
 *
 * This test keeps the markers honest without a browser: every landmark a
 * skeleton draws must also exist on a real component, and the pages that
 * have skeletons must keep their markers. A redesign that renames or drops a
 * real landmark therefore fails here and points at the skeleton to update.
 */

const srcRoot = resolve(import.meta.dir, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const SKELETON_FILE = /skeleton/i;
const MARKER =
  /data-sk(?:=|:\s*)["{]?\s*(?:compact\s*\?\s*)?"([a-z-]+)"(?:\s*:\s*"([a-z-]+)")?/g;

function markers(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(MARKER)) {
      for (const name of [match[1], match[2]].filter(Boolean) as string[]) {
        found.set(name, [...(found.get(name) ?? []), relative(srcRoot, file)]);
      }
    }
  }
  return found;
}

const files = sourceFiles(srcRoot);
// A file is a skeleton source when its name says so, or when the marker sits
// inside a function whose name ends in Skeleton (shared files such as
// ChatListItem keep real rows and their placeholders together).
const skeletonFiles = files.filter((file) => SKELETON_FILE.test(file));
const realFiles = files.filter((file) => !SKELETON_FILE.test(file));
const skeletonMarkers = markers(skeletonFiles);
const realMarkers = markers(realFiles);

test("every skeleton landmark exists on a real component", () => {
  const orphans = [...skeletonMarkers.keys()].filter(
    (name) => !realMarkers.has(name),
  );
  expect(orphans).toEqual([]);
});

test("the landmarks the skeleton audit measures are still marked", () => {
  const required = [
    "rail",
    "rail-nav",
    "rail-user",
    "frame",
    "ws-switcher",
    "ws-compact",
    "mobile-header",
    "mobile-nav",
    "list-tabs",
    "list-pane",
    "list-search",
    "list-filters",
    "list-row",
    "list-avatar",
    "thread-header",
    "composer",
    "settings-nav",
    "page-header",
    "card",
    "toolbar",
    "thead",
    "trow",
    "tfoot",
    "tabs",
    "stat",
    "chart",
    "nrow",
    "profile-head",
    "group-row",
  ];
  const missingReal = required.filter((name) => !realMarkers.has(name));
  const missingSkeleton = required.filter(
    (name) => !skeletonMarkers.has(name) && !realMarkers.get(name)?.length,
  );
  expect(missingReal).toEqual([]);
  expect(missingSkeleton).toEqual([]);
});
