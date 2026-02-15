// public/sw.js

const DEBUG = true;

self.addEventListener("install", (event) => {
  if (DEBUG) console.log("[SW] install");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  if (DEBUG) console.log("[SW] activate");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (DEBUG) console.log("[SW] push fired");
  let payload = {};
  let raw = "";

  try {
    raw = event.data ? event.data.text() : "";
    if (DEBUG) console.log("[SW] push raw:", raw);
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (DEBUG) console.log("[SW] push parse error:", e);
    payload = {};
  }

  // handle wrapped payloads: { data: "{...}" }
  if (payload && typeof payload.data === "string") {
    try {
      payload = JSON.parse(payload.data);
    } catch {}
  }

  const title = payload.title || "Draft Update";
  const body = payload.body || "New draft activity.";
  const url = payload.url || "/draft-pick-tracker";

  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(title, {
          body,
          icon: "/android-chrome-192x192.png",
          badge: "/android-chrome-192x192.png",
          data: { url },
        });
        if (DEBUG) console.log("[SW] showNotification OK");
      } catch (e) {
        if (DEBUG) console.log("[SW] showNotification FAILED:", e);
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  if (DEBUG) console.log("[SW] notificationclick");
  event.notification.close();
  const url = event.notification?.data?.url || "/draft-pick-tracker";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = allClients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })()
  );
});
