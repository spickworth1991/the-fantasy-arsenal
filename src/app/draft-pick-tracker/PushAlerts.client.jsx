"use client";

import React, { useEffect, useMemo, useState } from "react";

function urlBase64ToUint8Array(base64String) {
  // From WebPush docs: convert VAPID key
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushAlerts({ username, draftIds, selectedDraftIds }) {
  const [status, setStatus] = useState("idle"); // idle | enabled | denied | error | loading
  const [msg, setMsg] = useState("");

  const chosenDraftIds = useMemo(() => {
    const raw = Array.isArray(selectedDraftIds) && selectedDraftIds.length ? selectedDraftIds : draftIds;
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }, [draftIds, selectedDraftIds]);

  const vapidKey = useMemo(() => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, []);
  const hasNotification = typeof globalThis !== "undefined" && "Notification" in globalThis;

  // Reflect existing permission/subscription in the UI, but do NOT POST on page-load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!hasNotification) return;
        if (globalThis.Notification.permission !== "granted") return;
        if (!("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled && sub) setStatus("enabled");
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasNotification]);

  async function saveSubscription(subscription, { includeUsername = false } = {}) {

  const endpoint = subscription?.endpoint;
    if (!endpoint) return;

    const payload = {
      subscription,
      // Only send username explicitly when enabling alerts; otherwise we can omit to avoid unintended discover.
      username: includeUsername ? username : undefined,
      draftIds: chosenDraftIds,
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
  }

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
      const reg = await navigator.serviceWorker.ready;
      // Reuse existing subscription if present.
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      await saveSubscription(sub, { includeUsername: true });
      setStatus("enabled");
      setMsg("Alerts enabled for this device.");
    } catch (e) {
      console.error(e);
      setStatus("error");
      setMsg(e?.message || "Failed to enable alerts");
    }
  }

  // Keep server in sync when draft selection changes (prevents draft_ids_json = [])
  // Only after the user has enabled alerts.
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        if (cancelled) return;
        if (!hasNotification) return;
        if (globalThis.Notification.permission !== "granted") return;
        if (status !== "enabled") return;

        if (!("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenDraftIds.join("|"), status]);

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Pick Alerts</div>
          <div className="text-xs text-white/70">
            Get notified when it’s your pick.
          </div>
        </div>

        {status === "enabled" ? (
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200">
            Enabled
          </span>
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

      <div className="mt-2 text-[11px] text-white/50">
        Alerts are tied to this browser/device. If you clear site data, you’ll need to re-enable.
      </div>
    </div>
  );
}