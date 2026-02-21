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

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
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
      // clean older caches
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
      await self.clients.claim();
    })()
  );
});

// Push handler
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};

      // Prefer JSON payloads
      try {
        if (event.data) payload = await event.data.json();
      } catch {
        // Fallback to text payloads
        try {
          const t = event.data ? await event.data.text() : "";
          payload = t ? { body: t } : {};
        } catch {
          payload = {};
        }
      }

      // ✅ handle wrapped payloads: { data: "{...}" }
      if (payload && typeof payload.data === "string") {
        try {
          payload = JSON.parse(payload.data);
        } catch {}
      }

      // Some senders wrap under { notification: {...} }
      if (
        payload &&
        typeof payload === "object" &&
        payload.notification &&
        typeof payload.notification === "object"
      ) {
        payload = payload.notification;
      }

      const title = payload.title || "Draft Update";
      const body = payload.body || "New draft activity.";
      const url = payload.url || payload?.data?.url || "/draft-pick-tracker";

      // Allow server-controlled presentation (tag/renotify/icon/etc)
      const icon = payload.icon || "/android-chrome-192x192.png";
      const badge = payload.badge || "/android-chrome-192x192.png";
      const image = payload.image || undefined;

      await self.registration.showNotification(title, {
        body,
        icon,
        badge,
        image,
        tag: payload.tag,
        renotify: !!payload.renotify,
        requireInteraction: !!payload.requireInteraction,
        actions: Array.isArray(payload.actions) ? payload.actions : undefined,
        data: {
          ...(payload.data && typeof payload.data === "object" ? payload.data : {}),
          url,
        },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const action = event.action;
  const url =
    action === "open_league"
      ? data.leagueUrl || data.draftUrl || data.url
      : action === "open_tracker"
      ? data.url || "/draft-pick-tracker"
      : data.url || "/draft-pick-tracker";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => c.url && c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })()
  );
});