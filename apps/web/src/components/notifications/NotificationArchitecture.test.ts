import { describe, expect, test } from "bun:test";

const readSource = async (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("global notification architecture", () => {
  test("mounts one provider and docks the chat notification center", async () => {
    const [main, layout, chatPage, sidebar] = await Promise.all([
      readSource("../../main.tsx"),
      readSource("../layout/ProtectedAppLayout.tsx"),
      readSource("../../pages/ChatPage.tsx"),
      readSource("../chat/ChatSidebar.tsx"),
    ]);
    expect(main.match(/<NotificationProvider>/g)?.length).toBe(1);
    expect(layout).toContain("!isChatRoute");
    expect(chatPage.match(/<NotificationCenter/g)?.length).toBe(1);
    expect(chatPage).toContain("panelContainer={notificationPanelHost}");
    expect(sidebar).toContain("{notificationAction}");
  });

  test("the bell and panel share one notification controller", async () => {
    const center = await readSource("./NotificationCenter.tsx");
    expect(center.match(/useNotificationCenter\(/g)?.length).toBe(1);
  });

  test("registers the protected notifications route", async () => {
    const app = await readSource("../../App.tsx");
    expect(app).toContain('path="/notifications"');
    expect(app).toContain("<NotificationsPage />");
  });
});
