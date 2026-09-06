import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const sourceRoot = resolve(import.meta.dir, "../..");

// Architectural guardrail: every single-choice dropdown shares the same theme.
// Searchable/multi-select popovers and action menus have different semantics.
test("single-choice dropdowns use the shared Select without appearance overrides", () => {
  const violations: string[] = [];
  for (const file of readdirSync(sourceRoot, { recursive: true })) {
    if (typeof file !== "string" || !file.endsWith(".tsx")) continue;
    if (file === "components/ui/select.tsx" || file.includes(".test."))
      continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(resolve(sourceRoot, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "@radix-ui/react-select"
      ) {
        violations.push(`${file}: import Select from @/components/ui/select`);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (tag === "select" || tag === "option") {
          violations.push(`${file}: replace native ${tag} with shared Select`);
        }
        if (tag === "SelectTrigger") {
          for (const prop of node.attributes.properties) {
            if (!ts.isJsxAttribute(prop)) continue;
            const name = prop.name.getText(source);
            if (name === "style")
              violations.push(`${file}: no inline Select styles`);
            if (name !== "className") continue;
            if (!prop.initializer || !ts.isStringLiteral(prop.initializer)) {
              violations.push(
                `${file}: use static layout classes on SelectTrigger`,
              );
              continue;
            }
            for (const token of prop.initializer.text
              .split(/\s+/)
              .filter(Boolean)) {
              if (
                !/^(?:(?:sm|md|lg|xl|2xl):)?(?:w-|min-w-|max-w-|h-|m[trblxy]?-|flex-|hidden$|text-xs$)/.test(
                  token,
                )
              ) {
                violations.push(
                  `${file}: move Select appearance '${token}' into ui/select.tsx`,
                );
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
