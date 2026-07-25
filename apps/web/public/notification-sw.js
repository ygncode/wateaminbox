const isSafePath = (value) =>
  typeof value === "string" &&
  /^\/(?!\/)/.test(value) &&
  !/[\u0000-\u001f\u007f\\]/.test(value);

const parsePayload = (value) => {
  if (!value || typeof value !== "object" || value.version !== 1) return null;
  if (value.type !== "message" && value.type !== "notification") return null;
  if (
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.tag !== "string" ||
    !isSafePath(value.actionUrl)
  )
    return null;
  return {
    title: value.title.slice(0, 200),
    body: value.body.slice(0, 500),
    tag: value.tag.slice(0, 200),
    actionUrl: value.actionUrl,
    icon: isSafePath(value.icon) ? value.icon : "/apple-touch-icon.png",
    badge: isSafePath(value.badge) ? value.badge : "/favicon-32x32.png",
  };
};

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = parsePayload(event.data?.json());
      } catch {
        return;
      }
      if (!payload) return;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (
        windows.some(
          (client) => client.focused || client.visibilityState === "visible",
        )
      ) {
        return;
      }
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        icon: payload.icon,
        badge: payload.badge,
        data: { actionUrl: payload.actionUrl },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const actionUrl = isSafePath(event.notification.data?.actionUrl)
    ? event.notification.data.actionUrl
    : "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.focus();
        await existing.navigate(actionUrl);
        return;
      }
      await self.clients.openWindow(actionUrl);
    })(),
  );
});
