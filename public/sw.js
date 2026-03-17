/* public/sw.js */
const CACHE = "tfa-static-v3";
const PUSH_CONTEXT_CACHE = "tfa-push-context-v1";
const PUSH_CONTEXT_URL = "/__tfa_push_context__";

const STATIC_ASSETS = [
  "/site.webmanifest",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/favicon.ico",
];

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function readPushContext() {
  try {
    const cache = await caches.open(PUSH_CONTEXT_CACHE);
    const res = await cache.match(PUSH_CONTEXT_URL);
    if (!res) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function writePushContext(context) {
  try {
    const cache = await caches.open(PUSH_CONTEXT_CACHE);
    await cache.put(
      PUSH_CONTEXT_URL,
      new Response(JSON.stringify(context || {}), {
        headers: { "content-type": "application/json" },
      })
    );
  } catch {
    // ignore
  }
}

async function clearPushContext() {
  try {
    const cache = await caches.open(PUSH_CONTEXT_CACHE);
    await cache.delete(PUSH_CONTEXT_URL);
  } catch {
    // ignore
  }
}

async function setAppBadgeCount(count) {
  const n = Number(count || 0);
  try {
    if (n > 0) {
      if (typeof self.navigator?.setAppBadge === "function") {
        await self.navigator.setAppBadge(n);
        return true;
      }
      if (typeof self.registration?.setAppBadge === "function") {
        await self.registration.setAppBadge(n);
        return true;
      }
    } else {
      if (typeof self.navigator?.clearAppBadge === "function") {
        await self.navigator.clearAppBadge();
        return true;
      }
      if (typeof self.registration?.clearAppBadge === "function") {
        await self.registration.clearAppBadge();
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

async function postPushMessage(payload, appBadgeCount) {
  const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientsList) {
    try {
      client.postMessage({
        type: "push-event",
        stage: payload?.data?.stage || payload?.stage || null,
        draftId: payload?.data?.draftId || payload?.draftId || null,
        ts: Date.now(),
        appBadgeCount,
      });
    } catch {
      // ignore
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "TFA_PUSH_CONTEXT_SAVE") {
    event.waitUntil(writePushContext(event.data?.context || {}));
    return;
  }

  if (event.data?.type === "TFA_PUSH_CONTEXT_CLEAR") {
    event.waitUntil(clearPushContext());
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
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
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) =>
          k !== CACHE && k !== PUSH_CONTEXT_CACHE ? caches.delete(k) : null
        )
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};
      try {
        if (event.data) payload = await event.data.json();
      } catch {
        try {
          const t = event.data ? await event.data.text() : "";
          payload = t ? { body: t } : {};
        } catch {
          payload = {};
        }
      }

      if (payload && typeof payload.data === "string") {
        try {
          payload = JSON.parse(payload.data);
        } catch {}
      }

      if (
        payload &&
        typeof payload === "object" &&
        payload.notification &&
        typeof payload.notification === "object"
      ) {
        payload = payload.notification;
      }

      const appBadgeCount = Number(payload.appBadgeCount || 0);
      const shouldClearAppBadge = !!payload.clearAppBadge || appBadgeCount <= 0;
      const isAppleWebPush = !!payload.isAppleWebPush;

      if (!!payload.silent) {
        if (payload.badgesEnabled !== false) {
          if (shouldClearAppBadge) await setAppBadgeCount(0);
          else if (Number.isFinite(appBadgeCount) && appBadgeCount > 0) await setAppBadgeCount(appBadgeCount);
        }
        await postPushMessage(payload, appBadgeCount);
        return;
      }

      const title = payload.title || "Draft Update";
      const body = payload.body || "New draft activity.";
      const url = payload.url || payload?.data?.url || "/draft-pick-tracker";
      const icon = payload.icon || "/android-chrome-192x192.png";
      const badge = payload.badge || "/android-chrome-192x192.png";
      const image = payload.image || undefined;
      const data = {
        ...(payload.data && typeof payload.data === "object" ? payload.data : {}),
        url,
      };

      if (isAppleWebPush) {
        let shown = false;
        try {
          await self.registration.showNotification(title, { body, icon, data });
          shown = true;
        } catch {
          try {
            await self.registration.showNotification(title, { body, data });
            shown = true;
          } catch {
            // ignore
          }
        }

        if (payload.badgesEnabled !== false) {
          if (shouldClearAppBadge) await setAppBadgeCount(0);
          else if (Number.isFinite(appBadgeCount) && appBadgeCount > 0) await setAppBadgeCount(appBadgeCount);
        }
        await postPushMessage(payload, appBadgeCount);
        return shown;
      }

      await self.registration.showNotification(title, {
        body,
        icon,
        badge,
        image,
        tag: payload.tag,
        renotify: !!payload.renotify,
        requireInteraction: !!payload.requireInteraction,
        actions: Array.isArray(payload.actions) ? payload.actions : undefined,
        data,
      });

      if (payload.badgesEnabled !== false) {
        if (shouldClearAppBadge) await setAppBadgeCount(0);
        else if (Number.isFinite(appBadgeCount) && appBadgeCount > 0) await setAppBadgeCount(appBadgeCount);
      }
      await postPushMessage(payload, appBadgeCount);
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const context = await readPushContext();
      const vapidPublicKey = String(context?.vapidPublicKey || "").trim();
      if (!vapidPublicKey) return;

      let nextSubscription = null;
      try {
        nextSubscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      } catch {
        return;
      }

      if (!nextSubscription?.endpoint) return;

      const payload = {
        subscription: nextSubscription,
        username: context?.username || undefined,
        draftIds: Array.isArray(context?.draftIds) ? context.draftIds : [],
        settings: context?.settings && typeof context.settings === "object" ? context.settings : undefined,
        clientId: context?.clientId || undefined,
        previousEndpoint:
          String(event?.oldSubscription?.endpoint || context?.endpoint || "").trim() || undefined,
      };

      try {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        await writePushContext({
          ...(context && typeof context === "object" ? context : {}),
          endpoint: nextSubscription.endpoint,
        });
      } catch {
        // ignore
      }
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
