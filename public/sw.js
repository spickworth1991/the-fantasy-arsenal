/* public/sw.js
   Push-only service worker (stable).
   - Supports push + notification click + actions
*/

const CACHE = "tfa-static-v2";

const STATIC_ASSETS = [
  "/site.webmanifest",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/favicon.ico",
];

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)));
      } catch {}
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {}

  // handle wrapped payloads: { data: "{...}" }
  if (payload && typeof payload.data === "string") {
    try { payload = JSON.parse(payload.data); } catch {}
  }

  const title = payload.title || "Draft Update";
  const body = payload.body || "New draft activity.";
  const url = payload.url || "/draft-pick-tracker";

  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  if (!data.url) data.url = url;

  const opts = {
    body,
    icon: payload.icon || "/android-chrome-192x192.png",
    badge: payload.badge || "/android-chrome-192x192.png",
    tag: payload.tag || undefined,       // enables stacking/replace behavior depending on tag uniqueness
    renotify: !!payload.renotify,
    data,
    actions: Array.isArray(payload.actions) ? payload.actions : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const action = event.action || "";
  const data = event.notification?.data || {};

  let target = data.url || "/draft-pick-tracker";

  if (action === "open_league" && data.leagueUrl) target = data.leagueUrl;
  if (action === "open_tracker") target = data.url || "/draft-pick-tracker";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // If it's an external Sleeper URL, just open a new tab/window
      const isExternal = /^https?:\/\//i.test(target);

      if (!isExternal) {
        const existing = allClients.find((c) => c.url.includes(target));
        if (existing) return existing.focus();
      }

      return clients.openWindow(target);
    })()
  );
});
