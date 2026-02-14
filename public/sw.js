/* public/sw.js */
/* Minimal PWA SW:
   - push notifications
   - basic “app shell” caching (safe + simple)
*/

const CACHE = "tfa-shell-v1";
const SHELL = ["/", "/tools", "/draft-pick-tracker", "/site.webmanifest"];

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});


self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Basic cache: only GET same-origin, avoid /api
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // ✅ Only cache static assets; do NOT cache HTML documents
  const accept = req.headers.get("accept") || "";
  if (accept.includes("text/html")) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});


// ✅ Push handler (W3C Push API)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}

  const title = data.title || "Draft Update";
  const body = data.body || "New draft activity.";
  const url = data.url || "/draft-pick-tracker";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/android-chrome-192x192.png",
      badge: "/android-chrome-192x192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/draft-pick-tracker";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })()
  );
});
