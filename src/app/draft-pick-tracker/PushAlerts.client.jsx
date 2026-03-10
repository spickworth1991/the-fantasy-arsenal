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

  try {
    const direct = await navigator.serviceWorker.getRegistration("/");
    if (direct?.pushManager) return direct;
  } catch {
    // ignore
  }

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    const match = (regs || []).find((reg) => reg?.scope && reg.scope.includes(location.origin));
    if (match?.pushManager) return match;
  } catch {
    // ignore
  }

  try {
    const ready = await navigator.serviceWorker.ready;
    if (ready?.pushManager) return ready;
  } catch {
    // ignore
  }

  return null;
}

async function getCurrentSubscription(options = {}) {
  const { retries = 0, delayMs = 350 } = options || {};
  if (!("serviceWorker" in navigator)) return null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const reg = await getPushRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub?.endpoint) return sub;
    } catch {
      // ignore
    }

    if (attempt < retries) await sleep(delayMs);
  }

  return null;
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

function clearCachedEndpoint() {
  try {
    localStorage.removeItem(PUSH_ENDPOINT_CACHE_KEY);
    localStorage.removeItem(PUSH_STATUS_CACHE_KEY);
  } catch {
    // ignore
  }
}

export default function PushAlerts({ username, draftIds, selectedDraftIds, activeOnClockCount = 0 }) {
  const [status, setStatus] = useState("idle");
  const [msg, setMsg] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const chosenDraftIds = useMemo(() => {
    const raw = Array.isArray(selectedDraftIds) && selectedDraftIds.length ? selectedDraftIds : draftIds;
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }, [draftIds, selectedDraftIds]);

  const vapidKey = useMemo(() => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, []);
  const hasNotification = typeof globalThis !== "undefined" && "Notification" in globalThis;

  async function fetchSettingsForSubscription(subscriptionOrEndpoint) {
    const endpoint =
      typeof subscriptionOrEndpoint === "string"
        ? subscriptionOrEndpoint
        : subscriptionOrEndpoint?.endpoint;
    if (!endpoint) return DEFAULT_SETTINGS;

    const res = await fetch(`/api/push/settings?endpoint=${encodeURIComponent(endpoint)}`, {
      cache: "no-store",
    });
    if (!res.ok) return DEFAULT_SETTINGS;

    const json = await res.json().catch(() => ({}));
    const next = {
      ...DEFAULT_SETTINGS,
      ...(json?.settings && typeof json.settings === "object" ? json.settings : {}),
    };
    setSettings(next);
    return next;
  }

  async function saveSubscription(subscription, { includeUsername = false, settingsOverride } = {}) {
    const endpoint = subscription?.endpoint;
    if (!endpoint) return;

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

    cacheEndpoint(endpoint);
    try {
      localStorage.setItem(PUSH_STATUS_CACHE_KEY, "enabled");
    } catch {
      // ignore
    }
  }

  async function persistSettings(nextSettings) {
    const sub = await getCurrentSubscription();
    if (!sub?.endpoint) throw new Error("No active subscription found");

    const res = await fetch("/api/push/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        settings: nextSettings,
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || "Failed to save settings");
    }

    await saveSubscription(sub, { includeUsername: true, settingsOverride: nextSettings });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!hasNotification) return;
        if (globalThis.Notification.permission === "denied") {
          if (!cancelled) {
            clearCachedEndpoint();
            setStatus("denied");
          }
          return;
        }
        if (globalThis.Notification.permission !== "granted") return;

        const cachedEndpoint = readCachedEndpoint();
        if (!cancelled && cachedEndpoint) {
          setStatus("enabled");
          fetchSettingsForSubscription(cachedEndpoint).catch(() => {});
        }

        const sub = await getCurrentSubscription({ retries: 5, delayMs: 500 });
        if (!cancelled && sub?.endpoint) {
          cacheEndpoint(sub.endpoint);
          try {
            localStorage.setItem(PUSH_STATUS_CACHE_KEY, "enabled");
          } catch {
            // ignore
          }
          setStatus("enabled");
          await fetchSettingsForSubscription(sub);
        } else if (!cancelled && !cachedEndpoint) {
          setStatus("idle");
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasNotification]);

  async function enable() {
    try {
      setMsg("");
      setStatus("loading");

      if (!hasNotification) throw new Error("Notifications not supported");
      if (!vapidKey) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");

      const perm = await globalThis.Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "error");
        setMsg("Notifications permission not granted.");
        return;
      }

      if (!("serviceWorker" in navigator)) throw new Error("No service worker");
      const reg = await getPushRegistration();
      if (!reg?.pushManager) throw new Error("Push registration unavailable");

      const existing = await getCurrentSubscription({ retries: 4, delayMs: 500 });
      const sub =
        existing ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      await saveSubscription(sub, { includeUsername: true, settingsOverride: settings });
      await fetchSettingsForSubscription(sub);
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
      const sub = await getCurrentSubscription();
      if (sub?.endpoint) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        try {
          await sub.unsubscribe();
        } catch {
          // ignore
        }
      }
      clearCachedEndpoint();
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
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setSaving(true);
    setMsg("");
    try {
      await persistSettings(next);
      setMsg("Notification settings saved.");
    } catch (e) {
      console.error(e);
      setSettings(settings);
      setMsg(e?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        if (cancelled) return;
        if (!hasNotification) return;
        if (globalThis.Notification.permission !== "granted") return;
        if (status !== "enabled") return;

        const sub = await getCurrentSubscription({ retries: 2, delayMs: 400 });
        if (!sub) return;

        await saveSubscription(sub, { includeUsername: true });
      } catch {
        // ignore
      }
    }

    if (status === "enabled") sync();

    return () => {
      cancelled = true;
    };
  }, [chosenDraftIds.join("|"), status, hasNotification]);

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
              Badge count follows your exact live on-clock leagues{typeof activeOnClockCount === "number" ? ` (${activeOnClockCount} right now)` : ""}.
            </div>
          ) : null}
        </div>

        {status === "enabled" ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200">
              Enabled
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

      {status === "enabled" && settingsOpen ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/60">
            This device
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>On-clock alerts</span>
              <input type="checkbox" checked={!!settings.onClock} onChange={() => handleToggle("onClock")} disabled={saving} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>Progress alerts</span>
              <input type="checkbox" checked={!!settings.progress} onChange={() => handleToggle("progress")} disabled={saving} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>Paused / resumed</span>
              <input type="checkbox" checked={!!settings.paused} onChange={() => handleToggle("paused")} disabled={saving} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <span>App icon badges</span>
              <input type="checkbox" checked={!!settings.badges} onChange={() => handleToggle("badges")} disabled={saving} />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-[11px] text-white/50">
              Badge updates happen from push, so the count can change without opening the app.
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
