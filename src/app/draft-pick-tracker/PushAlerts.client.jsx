"use client";

import { useMemo, useState } from "react";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushAlerts({ username, selectedDraftIds = [] }) {
  const [status, setStatus] = useState("idle"); // idle | enabled | denied | error | loading
  const [msg, setMsg] = useState("");

  const vapidKey = useMemo(() => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, []);

  async function enable() {
    try {
      setStatus("loading");
      setMsg("");

      if (!("serviceWorker" in navigator)) {
        setStatus("error");
        setMsg("Service Worker not supported in this browser.");
        return;
      }

      // iOS requirement: must be installed to Home Screen for push eligibility
      // (We’ll show a helpful message if subscription fails.)
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("denied");
        setMsg("Notifications are blocked. Enable them in browser settings.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      if (!("PushManager" in window)) {
        setStatus("error");
        setMsg("Push not supported on this device/browser.");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username || null,
          draftIds: selectedDraftIds,
          subscription: sub,
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        setStatus("error");
        setMsg(t || "Failed to save subscription.");
        return;
      }

      setStatus("enabled");
      setMsg("Draft alerts enabled.");
    } catch (e) {
      setStatus("error");
      setMsg(
        "Couldn’t enable push. On iPhone/iPad, make sure you added the site to Home Screen first (iOS 16.4+)."
      );
    }
  }

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
            Get “on deck” and pick notifications — even when the app is closed.
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

      {msg ? (
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
          {msg}
        </div>
      ) : null}
    </div>
  );
}
