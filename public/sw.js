/* public/sw.js
   Push-only service worker (stable).
   - Never fails install
   - Supports push + notification click
*/

const CACHE = "tfa-static-v2";

// Optional: cache only safe static assets (not HTML routes)
const STATIC_ASSETS = [
  "/site.webmanifest",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/favicon.ico",
];

// Flip to false once push is proven end-to-end.
const DEBUG_PUSH = true;

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (DEBUG_PUSH) console.log("[SW] install");
      // Never let install fail because an asset 404s
      try {
        const cache = await caches.open(CACHE);
        await Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)));
      } catch {
        // ignore
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (DEBUG_PUSH) console.log("[SW] activate");
      // clean older caches
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

// Push handler
self.addEventListener("push", (event) => {
  if (DEBUG_PUSH) console.log("[SW] push event fired");

  let payload = {};
  let raw = "";

  try {
    raw = event.data ? event.data.text() : "";
    if (DEBUG_PUSH) console.log("[SW] push raw:", raw);
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    if (DEBUG_PUSH) console.log("[SW] push parse failed:", e);
    payload = {};
  }

  // ✅ handle wrapped payloads: { data: "{...}" }
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
        if (DEBUG_PUSH) console.log("[SW] showNotification ok", { title, url });
      } catch (e) {
        if (DEBUG_PUSH) console.log("[SW] showNotification FAILED", e);
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  if (DEBUG_PUSH) console.log("[SW] notificationclick");
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
