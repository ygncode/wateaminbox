import { describe, expect, test } from "bun:test";

const readSource = async (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("global notification architecture", () => {
  test("mounts one provider and keeps notifications in the workspace shell", async () => {
    const [main, layout, chatPage, sidebar] = await Promise.all([
      readSource("../../main.tsx"),
      readSource("../layout/ProtectedAppLayout.tsx"),
      readSource("../../pages/ChatPage.tsx"),
      readSource("../chat/ChatSidebar.tsx"),
    ]);
    expect(main.match(/<NotificationProvider>/g)?.length).toBe(1);
    expect(layout.match(/<NotificationCenter/g)?.length).toBe(2);
    expect(layout.match(/<NotificationCenter className=/g)?.length).toBe(2);
    expect(chatPage).not.toContain("<NotificationCenter");
    expect(sidebar).not.toContain("notificationAction");
  });

  test("shows workspace sync progress from every protected page", async () => {
    const [layout, chatPage] = await Promise.all([
      readSource("../layout/ProtectedAppLayout.tsx"),
      readSource("../../pages/ChatPage.tsx"),
    ]);
    expect(layout.match(/<SyncingOverlay \/>/g)?.length).toBe(1);
    expect(chatPage).not.toContain("<SyncingOverlay");
  });

  test("persists a collapsible desktop workspace rail", async () => {
    const layout = await readSource("../layout/ProtectedAppLayout.tsx");
    expect(layout).toContain('"wateaminbox:sidebar-collapsed"');
    expect(layout).toContain("collapsed={sidebarCollapsed}");
    expect(layout).toContain("Expand sidebar");
    expect(layout).toContain("Collapse sidebar");
  });

  test("the bell and panel share one notification controller", async () => {
    const center = await readSource("./NotificationCenter.tsx");
    expect(center.match(/useNotificationCenter\(/g)?.length).toBe(1);
  });

  test("registers canonical and compatibility notification routes", async () => {
    const app = await readSource("../../App.tsx");
    expect(app).toContain('path="notifications"');
    expect(app).toContain('"/notifications"');
    expect(app).toContain("<NotificationsPage />");
  });
});
