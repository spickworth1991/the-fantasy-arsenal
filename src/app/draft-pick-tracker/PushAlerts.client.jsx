"use client";

import React, { useEffect, useMemo, useState } from "react";

const PUSH_ENDPOINT_CACHE_KEY = "tfa_push_endpoint_cache";
const PUSH_STATUS_CACHE_KEY = "tfa_push_status_cache";

const DEFAULT_SETTINGS = {
  onClock: true,
  progress: true,
  paused: true,
  badges: true,
};

function isMobileBrowser() {
  if (typeof window === "undefined") return false;
  const ua = String(window.navigator?.userAgent || "").toLowerCase();
  return /iphone|ipad|ipod|android|mobile/.test(ua);
}

function isIOSBrowser() {
  if (typeof window === "undefined") return false;
  const ua = String(window.navigator?.userAgent || "").toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return !!(window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPushRegistration() {
  if (!("serviceWorker" in navigator)) return null;

  const seen = new Set();
  const out = [];
  const push = (reg) => {
    if (!reg?.pushManager) return;
    const key = String(reg.scope || "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(reg);
  };

  try {
    const ready = await navigator.serviceWorker.ready;
    push(ready);
  } catch {
    // ignore
  }

  try {
    const direct = await navigator.serviceWorker.getRegistration("/");
    push(direct);
  } catch {
    // ignore
  }

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs || []) push(reg);
  } catch {
    // ignore
  }

  return out[0] || null;
}

async function getRegistrationWithSubscription(options = {}) {
  const { retries = 0, delayMs = 350 } = options || {};
  if (!("serviceWorker" in navigator)) return { registration: null, subscription: null };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const checked = [];
    const seen = new Set();
    const remember = (reg) => {
      if (!reg?.pushManager) return;
      const key = String(reg.scope || "");
      if (seen.has(key)) return;
      seen.add(key);
      checked.push(reg);
    };

    try {
      const ready = await navigator.serviceWorker.ready;
      remember(ready);
    } catch {
      // ignore
    }

    try {
      const direct = await navigator.serviceWorker.getRegistration("/");
      remember(direct);
    } catch {
      // ignore
    }

    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs || []) remember(reg);
    } catch {
      // ignore
    }

    for (const reg of checked) {
      try {
        const sub = await reg.pushManager.getSubscription();
        if (sub?.endpoint) return { registration: reg, subscription: sub };
      } catch {
        // ignore
      }
    }

    if (attempt < retries) await sleep(delayMs);
  }

  return { registration: null, subscription: null };
}

async function getCurrentSubscription(options = {}) {
  const { retries = 0, delayMs = 350 } = options || {};
  if (!("serviceWorker" in navigator)) return null;

  const { subscription } = await getRegistrationWithSubscription({ retries, delayMs });
  return subscription?.endpoint ? subscription : null;
}

function readCachedEndpoint() {
  try {
    return localStorage.getItem(PUSH_ENDPOINT_CACHE_KEY) || "";
  } catch {
    return "";
  }
}

function cacheEndpoint(endpoint) {
  try {
    if (endpoint) localStorage.setItem(PUSH_ENDPOINT_CACHE_KEY, endpoint);
  } catch {
    // ignore
  }
}

function readCachedStatus() {
  try {
    return localStorage.getItem(PUSH_STATUS_CACHE_KEY) || "";
  } catch {
    return "";
  }
}

function clearCachedEndpoint() {
  try {
    localStorage.removeItem(PUSH_ENDPOINT_CACHE_KEY);
    localStorage.removeItem(PUSH_STATUS_CACHE_KEY);
  } catch {
    // ignore
  }
}

function hasAnyVisibleAlerts(s) {
  return !!(s?.onClock || s?.progress || s?.paused);
}

async function syncAppBadgeCount(count, badgesEnabled) {
  try {
    const safeCount = Math.max(0, Number(count || 0));

    if (!badgesEnabled) {
      if (typeof navigator !== "undefined" && typeof navigator.clearAppBadge === "function") {
        await navigator.clearAppBadge();
        return;
      }
      return;
    }

    if (safeCount > 0) {
      if (typeof navigator !== "undefined" && typeof navigator.setAppBadge === "function") {
        await navigator.setAppBadge(safeCount);
        return;
      }
    } else {
      if (typeof navigator !== "undefined" && typeof navigator.clearAppBadge === "function") {
        await navigator.clearAppBadge();
        return;
      }
    }
  } catch {
    // ignore
  }
}

export default function PushAlerts({
  username,
  draftIds,
  selectedDraftIds,
  activeOnClockCount = 0,
}) {
  const [status, setStatus] = useState("idle");
  const [msg, setMsg] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [endpoint, setEndpoint] = useState("");
  const [hasBrowserSubscription, setHasBrowserSubscription] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  const chosenDraftIds = useMemo(() => {
    const raw =
      Array.isArray(selectedDraftIds) && selectedDraftIds.length
        ? selectedDraftIds
        : draftIds;
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }, [draftIds, selectedDraftIds]);

  const vapidKey = useMemo(() => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, []);
  const hasNotification =
    typeof globalThis !== "undefined" && "Notification" in globalThis;

  async function fetchSettingsForSubscription(subscriptionOrEndpoint) {
    const nextEndpoint =
      typeof subscriptionOrEndpoint === "string"
        ? subscriptionOrEndpoint
        : subscriptionOrEndpoint?.endpoint;

    if (!nextEndpoint) return DEFAULT_SETTINGS;

    const res = await fetch(
      `/api/push/settings?endpoint=${encodeURIComponent(nextEndpoint)}`,
      { cache: "no-store" }
    );

    if (!res.ok) return DEFAULT_SETTINGS;

    const json = await res.json().catch(() => ({}));
    const next = {
      ...DEFAULT_SETTINGS,
      ...(json?.settings && typeof json.settings === "object" ? json.settings : {}),
    };

    setSettings(next);
    setEndpoint(nextEndpoint);
    cacheEndpoint(nextEndpoint);
    return next;
  }

  async function resolveEndpoint(options = {}) {
    const { allowCached = true, retries = 4, delayMs = 450 } = options || {};

    const sub = await getCurrentSubscription({ retries, delayMs });
    if (sub?.endpoint) {
      setHasBrowserSubscription(true);
      setEndpoint(sub.endpoint);
      cacheEndpoint(sub.endpoint);
      return { endpoint: sub.endpoint, subscription: sub, source: "browser" };
    }

    if (allowCached) {
      const cached = readCachedEndpoint();
      if (cached) {
        setEndpoint(cached);
        return { endpoint: cached, subscription: null, source: "cache" };
      }
    }

    return { endpoint: "", subscription: null, source: "none" };
  }

  async function saveSubscription(
    subscription,
    { includeUsername = false, settingsOverride } = {}
  ) {
    const subEndpoint = subscription?.endpoint;
    if (!subEndpoint) return;

    const payload = {
      subscription,
      username: includeUsername ? username : undefined,
      draftIds: chosenDraftIds,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(settingsOverride || settings || {}),
      },
    };

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || "Subscribe failed");
    }

    setEndpoint(subEndpoint);
    setHasBrowserSubscription(true);
    cacheEndpoint(subEndpoint);

    try {
      localStorage.setItem(PUSH_STATUS_CACHE_KEY, "enabled");
    } catch {
      // ignore
    }
  }

  async function persistSettings(nextSettings) {
    if (nextSettings.badges && !hasAnyVisibleAlerts(nextSettings)) {
      throw new Error(
        "Badges alone may not update reliably on all devices. Turn on at least one notification type too. Recommended: On-clock alerts."
      );
    }

    const resolved = await resolveEndpoint({
      allowCached: true,
      retries: 5,
      delayMs: 500,
    });

    if (!resolved.endpoint) {
      throw new Error("No active subscription found");
    }

    const res = await fetch("/api/push/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: resolved.endpoint,
        settings: nextSettings,
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || "Failed to save settings");
    }

    setSettings(nextSettings);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!hasNotification) return;

        if (globalThis.Notification.permission === "denied") {
          if (!cancelled) {
            clearCachedEndpoint();
            setEndpoint("");
            setHasBrowserSubscription(false);
            setStatus("denied");
          }
          return;
        }

        const cachedEndpoint = readCachedEndpoint();
        const cachedStatus = readCachedStatus() === "enabled";

        if (!cancelled && cachedEndpoint) {
          setEndpoint(cachedEndpoint);
          if (cachedStatus) {
            setStatus("enabled");
            fetchSettingsForSubscription(cachedEndpoint).catch(() => {});
          } else {
            setStatus("idle");
          }
        }

        if (globalThis.Notification.permission !== "granted") {
          if (!cancelled && !cachedEndpoint) setStatus("idle");
          return;
        }

        const sub = await getCurrentSubscription({ retries: 6, delayMs: 500 });

        if (!cancelled && sub?.endpoint) {
          setHasBrowserSubscription(true);
          setEndpoint(sub.endpoint);
          cacheEndpoint(sub.endpoint);
          setStatus("enabled");
          try {
            localStorage.setItem(PUSH_STATUS_CACHE_KEY, "enabled");
          } catch {
            // ignore
          }
          const existingSettings = await fetchSettingsForSubscription(sub).catch(() => DEFAULT_SETTINGS);
          await saveSubscription(sub, {
            includeUsername: true,
            settingsOverride: existingSettings,
          }).catch(() => {});
        } else if (!cancelled) {
          setHasBrowserSubscription(false);
          if (cachedEndpoint && cachedStatus) {
            setStatus("enabled");
          } else {
            setStatus("idle");
          }
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasNotification]);

  useEffect(() => {
    let cancelled = false;

    async function syncSubscriptionMetadata() {
      try {
        if (cancelled) return;
        if (!hasNotification) return;
        if (globalThis.Notification.permission !== "granted") return;
        if (status !== "enabled") return;

        const sub = await getCurrentSubscription({ retries: 3, delayMs: 450 });
        if (!sub?.endpoint) return;

        await saveSubscription(sub, { includeUsername: true });
      } catch {
        // ignore
      }
    }

    if (status === "enabled" && readCachedStatus() === "enabled") {
      syncSubscriptionMetadata();
      const onControllerChange = () => {
        syncSubscriptionMetadata();
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          syncSubscriptionMetadata();
        }
      };
      const onFocus = () => {
        syncSubscriptionMetadata();
      };

      navigator.serviceWorker?.addEventListener?.("controllerchange", onControllerChange);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", onFocus);
      const t = setInterval(() => {
        syncSubscriptionMetadata();
      }, isIOSBrowser() ? 10 * 60 * 1000 : 30 * 60 * 1000);

      return () => {
        cancelled = true;
        navigator.serviceWorker?.removeEventListener?.("controllerchange", onControllerChange);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", onFocus);
        clearInterval(t);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [chosenDraftIds.join("|"), status, hasNotification, username]);

  useEffect(() => {
    let cancelled = false;

    async function syncBadgeFromUI() {
      try {
        if (cancelled) return;
        if (!hasNotification) return;
        if (globalThis.Notification.permission !== "granted") return;
        if (status !== "enabled") return;

        await syncAppBadgeCount(activeOnClockCount, !!settings.badges);
      } catch {
        // ignore
      }
    }

    syncBadgeFromUI();

    return () => {
      cancelled = true;
    };
  }, [activeOnClockCount, settings.badges, status, hasNotification]);

  async function enable() {
    try {
      setMsg("");
      setInstallHelpOpen(false);
      setStatus("loading");

      if (isMobileBrowser() && !isStandaloneDisplay()) {
        setStatus("idle");
        setInstallHelpOpen(true);
        setMsg(
          isIOSBrowser()
            ? "Install the app to your home screen first. iPhone notifications only work from the installed app."
            : "Install the app to your home screen first. Mobile notifications work best from the installed app."
        );
        return;
      }

      if (!hasNotification) throw new Error("Notifications not supported");
      if (!vapidKey) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");

      const perm = await globalThis.Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "error");
        setMsg("Notifications permission not granted.");
        return;
      }

      if (!("serviceWorker" in navigator)) {
        throw new Error("No service worker");
      }

      const { registration: subReg, subscription: existingSub } = await getRegistrationWithSubscription({
        retries: 2,
        delayMs: 300,
      });
      const reg = subReg || (await getPushRegistration());
      if (!reg?.pushManager) {
        throw new Error("Push registration unavailable");
      }

      const existing = existingSub || (await getCurrentSubscription({ retries: 5, delayMs: 500 }));

      const sub =
        existing ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      const normalizedSettings =
        settings.badges && !hasAnyVisibleAlerts(settings)
          ? { ...settings, onClock: true }
          : settings;

      await saveSubscription(sub, {
        includeUsername: true,
        settingsOverride: normalizedSettings,
      });

      setSettings(normalizedSettings);
      await fetchSettingsForSubscription(sub);
      await syncAppBadgeCount(activeOnClockCount, !!normalizedSettings.badges);

      setStatus("enabled");
      setMsg("Alerts enabled for this device.");
    } catch (e) {
      console.error(e);
      setStatus("error");
      setMsg(e?.message || "Failed to enable alerts");
    }
  }

  async function disableAlerts() {
    try {
      setSaving(true);
      setMsg("");

      const sub = await getCurrentSubscription({ retries: 3, delayMs: 400 });
      const cached = readCachedEndpoint();
      const endpointToRemove = sub?.endpoint || cached;

      if (endpointToRemove) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: endpointToRemove }),
        });
      }

      if (sub?.unsubscribe) {
        try {
          await sub.unsubscribe();
        } catch {
          // ignore
        }
      }

      await syncAppBadgeCount(0, false);

      clearCachedEndpoint();
      setEndpoint("");
      setHasBrowserSubscription(false);
      setStatus("idle");
      setSettingsOpen(false);
      setSettings(DEFAULT_SETTINGS);
      setMsg("Alerts disabled for this device.");
    } catch (e) {
      console.error(e);
      setMsg(e?.message || "Failed to disable alerts");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(key) {
    const prev = settings;
    const next = { ...settings, [key]: !settings[key] };

    if (next.badges && !hasAnyVisibleAlerts(next)) {
      setMsg(
        "Badges alone may not update reliably on all devices. Turn on at least one notification type too. Recommended: On-clock alerts."
      );
      return;
    }

    setSettings(next);
    setSaving(true);
    setMsg("");

    try {
      await persistSettings(next);

      if (!next.badges) {
        await syncAppBadgeCount(0, false);
      } else {
        await syncAppBadgeCount(activeOnClockCount, true);
      }

      setMsg("Notification settings saved.");
    } catch (e) {
      console.error(e);
      setSettings(prev);
      setMsg(e?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  const visibleAlertsEnabled = hasAnyVisibleAlerts(settings);

  return (
    <div className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Pick Alerts</div>
          <div className="text-xs text-white/70">
            Home-screen notifications for your active draft leagues.
          </div>

          {status === "enabled" ? (
            <div className="mt-1 text-[11px] text-white/50">
              Badge count follows your exact live on-clock leagues
              {typeof activeOnClockCount === "number"
                ? ` (${activeOnClockCount} right now)`
                : ""}
              .
            </div>
          ) : null}
        </div>

        {status === "enabled" ? (
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                visibleAlertsEnabled
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-yellow-500/20 text-yellow-200"
              }`}
            >
              {visibleAlertsEnabled ? "Enabled" : "Subscribed"}
            </span>

            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
            >
              Notification Settings
            </button>
          </div>
        ) : status === "denied" ? (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200">
            Blocked
          </span>
        ) : (
          <button
            type="button"
            onClick={enable}
            disabled={status === "loading"}
            className="rounded-lg bg-cyan-500/90 px-3 py-1.5 text-xs font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
          >
            {status === "loading" ? "Enabling..." : "Enable Alerts"}
          </button>
        )}
      </div>

            {msg ? <div className="mt-2 text-xs text-white/70">{msg}</div> : null}

      {installHelpOpen ? (
        <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-3 text-xs text-cyan-50">
          <div className="font-semibold text-cyan-100">Install the app first</div>
          {isIOSBrowser() ? (
            <div className="mt-2 space-y-1 text-cyan-50/90">
              <div>1. Tap the Share button in Safari.</div>
              <div>2. Tap <span className="font-semibold">Add to Home Screen</span>.</div>
              <div>3. Open the installed app from your home screen.</div>
              <div>4. Tap <span className="font-semibold">Enable Alerts</span> again inside the app.</div>
            </div>
          ) : (
            <div className="mt-2 space-y-1 text-cyan-50/90">
              <div>1. Open the browser menu.</div>
              <div>2. Tap <span className="font-semibold">Install app</span> or <span className="font-semibold">Add to Home screen</span>.</div>
              <div>3. Open the installed app from your home screen.</div>
              <div>4. Tap <span className="font-semibold">Enable Alerts</span> again inside the app.</div>
            </div>
          )}
        </div>
      ) : null}

      {status === "enabled" && settingsOpen ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
            This device
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>On-clock alerts</span>
              <input
                type="checkbox"
                checked={!!settings.onClock}
                onChange={() => handleToggle("onClock")}
                disabled={saving}
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>Progress alerts</span>
              <input
                type="checkbox"
                checked={!!settings.progress}
                onChange={() => handleToggle("progress")}
                disabled={saving}
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>Paused / resumed</span>
              <input
                type="checkbox"
                checked={!!settings.paused}
                onChange={() => handleToggle("paused")}
                disabled={saving}
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>App icon badges</span>
              <input
                type="checkbox"
                checked={!!settings.badges}
                onChange={() => handleToggle("badges")}
                disabled={saving}
              />
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60">
            Badges can update from push and from opening the tracker, but badges alone may not be reliable on every device.
            Recommended: leave <span className="font-semibold text-white">On-clock alerts</span> on.
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-[11px] text-white/50 break-all">
              Endpoint: {endpoint || (hasBrowserSubscription ? "browser subscription found" : "cached")}
            </div>

            <button
              type="button"
              onClick={disableAlerts}
              disabled={saving}
              className="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-50"
            >
              Disable Alerts
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 text-[11px] text-white/50">
        Alerts are tied to this browser/device. If you clear site data, you’ll need to re-enable.
      </div>
    </div>
  );
}
