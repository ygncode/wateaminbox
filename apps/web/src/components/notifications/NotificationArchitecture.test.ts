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

  test("presents the panel as a sheet with modal semantics", async () => {
    const center = await readSource("./NotificationCenter.tsx");
    expect(center).toContain("NOTIFICATION_SHEET_CLASS");
    expect(center).toContain("NOTIFICATION_SCRIM_CLASS");
    expect(center).toContain('role="dialog"');
    expect(center).toContain("aria-modal=");
    expect(center).toContain("aria-labelledby={titleId}");
    // the old floating-card geometry must not come back
    expect(center).not.toContain("top-16");
    expect(center).not.toContain("md:right-5");
  });

  test("ships the sheet entrance animations the classes rely on", async () => {
    const css = await readSource("../../index.css");
    expect(css).toContain(".animate-sheet-in-right");
    expect(css).toContain(".animate-scrim-in");
    expect(css).toContain("@keyframes sheet-slide-in-right");
  });

  test("the Activity Inbox asks for read and unread notifications by default", async () => {
    const page = await readSource("../../pages/NotificationsPage.tsx");
    // The unread view has to be an opt-in, and "all" must send no filter at
    // all rather than an explicit `unreadOnly: false`.
    expect(page).toContain("parseNotificationFilter");
    expect(page).toContain(
      'unreadOnly: filter === "unread" ? true : undefined',
    );
    expect(page).not.toMatch(/unreadOnly:\s*false/);
    expect(page).not.toMatch(/useState\([^)]*unreadOnly/);
  });

  test("the Activity Inbox keeps a working unread filter in the URL", async () => {
    const page = await readSource("../../pages/NotificationsPage.tsx");
    expect(page).toContain("useSearchParams");
    expect(page).toContain('params.set("filter", next)');
    expect(page).toContain('params.delete("filter")');
    // Switching filters must not strand the reader on a page that no longer
    // exists in the filtered result.
    expect(page).toContain("resetPage: true");
  });

  test("the sheet and the page render notifications through one component", async () => {
    const [center, page] = await Promise.all([
      readSource("./NotificationCenter.tsx"),
      readSource("../../pages/NotificationsPage.tsx"),
    ]);
    for (const source of [center, page]) {
      expect(source).toContain("NotificationGroups");
      expect(source).toContain("NotificationListSkeleton");
      expect(source).toContain("NotificationEmptyState");
      expect(source).toContain("NotificationErrorState");
    }
    expect(center).toContain('density="compact"');
    // The row markup itself must live in one place only.
    expect(center).not.toContain("function NotificationItem");
    expect(page).not.toContain("function NotificationItem");
  });

  test("the sheet reports load failures instead of claiming an empty inbox", async () => {
    const center = await readSource("./NotificationCenter.tsx");
    expect(center).toContain("error ?");
    expect(center).toContain("onRetry={refresh}");
  });

  test("the full inbox stays reachable from an empty or failed sheet", async () => {
    const center = await readSource("./NotificationCenter.tsx");
    expect(center).toContain("View all notifications");
    // The footer used to be rendered only when the sheet had rows, which hid
    // the one route to the read notifications the sheet does not show.
    expect(center).not.toContain("{notifications.length > 0 && (");
  });

  test("registers canonical and compatibility notification routes", async () => {
    const app = await readSource("../../App.tsx");
    expect(app).toContain('path="notifications"');
    expect(app).toContain('"/notifications"');
    expect(app).toContain("<NotificationsPage />");
  });
});
