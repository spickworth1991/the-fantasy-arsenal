"use client";

import { useEffect, useMemo, useState } from "react";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

export default function PushAlerts({ username, selectedDraftIds = [] }) {
  const [status, setStatus] = useState("idle"); // idle | enabled | denied | error | loading
  const [msg, setMsg] = useState("");

  const vapidKey = useMemo(() => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, []);
  const hasNotification = typeof globalThis !== "undefined" && "Notification" in globalThis;

  async function saveSubscription(sub) {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username || null,
        draftIds: Array.isArray(selectedDraftIds) ? selectedDraftIds : [],
        subscription: sub,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `Subscribe API failed (${res.status})`);
    }
  }

  async function enable() {
    try {
      setStatus("loading");
      setMsg("");

      if (!vapidKey) {
        throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY (not available in this build).");
      }

      if (!hasNotification) {
        throw new Error(
          "Notifications are not available in this browser/context. On iPhone/iPad, add the site to Home Screen (iOS 16.4+) and enable notifications for the app."
        );
      }

      if (!("serviceWorker" in navigator)) {
        throw new Error("Service Worker not supported in this browser.");
      }

      const perm = await withTimeout(
        globalThis.Notification.requestPermission(),
        15000,
        "Notification permission"
      );
      if (perm !== "granted") {
        setStatus("denied");
        setMsg("Notifications are blocked. Enable them in browser settings.");
        return;
      }

      // Wait for SW ready, but don't hang forever
      const reg = await withTimeout(navigator.serviceWorker.ready, 15000, "Service worker");

      if (!reg?.pushManager) {
        throw new Error("PushManager not available (push not supported on this device/browser).");
      }

      // Prefer existing subscription (prevents InvalidState issues)
      let sub = await withTimeout(reg.pushManager.getSubscription(), 8000, "Get subscription");

      if (!sub) {
        sub = await withTimeout(
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          }),
          15000,
          "Push subscribe"
        );
      }

      // Save to server (D1)
      await withTimeout(saveSubscription(sub), 15000, "Save subscription");

      setStatus("enabled");
      setMsg(
        selectedDraftIds?.length
          ? `Draft alerts enabled for ${selectedDraftIds.length} draft(s).`
          : "Draft alerts enabled. Pick a league/draft to receive alerts."
      );
    } catch (e) {
      setStatus("error");
      setMsg(
        e?.message ||
          "Couldn’t enable push. On iPhone/iPad, add the site to Home Screen first (iOS 16.4+)."
      );
    }
  }

  // Keep server in sync when draft selection changes (prevents draft_ids_json = [])
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        if (!hasNotification) return;
        if (globalThis.Notification.permission !== "granted") return;
        if (!("serviceWorker" in navigator)) return;

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;

        await saveSubscription(sub);

        if (!cancelled && status === "enabled") {
          setMsg(
            selectedDraftIds?.length
              ? `Alerts updated: tracking ${selectedDraftIds.length} draft(s).`
              : "Alerts updated. Pick a league/draft to receive alerts."
          );
        }
      } catch {
        // ignore
      }
    }

    if (status === "enabled" || (hasNotification && globalThis.Notification.permission === "granted")) sync();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftIds.join("|")]);

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 16,
        padding: 14,
        background: "rgba(10,16,34,0.55)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>Draft Pick Tracker Alerts</div>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            Get “on the clock” alerts — even when the app is closed.
          </div>
        </div>

        <button
          onClick={enable}
          disabled={status === "loading"}
          style={{
            borderRadius: 999,
            padding: "10px 14px",
            border: "1px solid rgba(122,212,242,0.35)",
            background: "rgba(122,212,242,0.14)",
            color: "white",
            fontWeight: 700,
            cursor: status === "loading" ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {status === "enabled" ? "Enabled" : status === "loading" ? "Enabling…" : "Enable Alerts"}
        </button>
      </div>

      {msg ? <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>{msg}</div> : null}
    </div>
  );
}
