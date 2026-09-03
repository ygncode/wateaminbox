import { describe, expect, test } from "bun:test";

const readSource = async (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("bottom sheet close lifecycle", () => {
  test("keeps hosted profile content mounted during its exit animation", async () => {
    const panel = await readSource("./right-panel.tsx");
    expect(panel).toContain(
      'if (!isOpen && surface === "docked") return null;',
    );
  });

  test("does not change a member sheet back into a side panel while closing", async () => {
    const state = await readSource("../../hooks/chat/useChatPageState.ts");
    const closeHandler = state.slice(
      state.indexOf("const handleCloseProfile"),
      state.indexOf("// Switching conversations"),
    );

    expect(closeHandler).toContain("setIsProfileOpen(false)");
    expect(closeHandler).not.toContain("setParticipantProfileId(null)");
  });

  test("retains shared-contact content until the sheet finishes sliding out", async () => {
    const sheet = await readSource("../chat/SharedContactSheet.tsx");
    expect(sheet).toContain(
      "const renderedContact = contact ?? lastContactRef.current",
    );
  });
});
