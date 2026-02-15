"use client";

import { useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushAlerts({ username, draftIds }) {
  const [status, setStatus] = useState("idle");
  const [endpoint, setEndpoint] = useState("");

  useEffect(() => {
    // Try to display current endpoint (if already subscribed)
    (async () => {
      try {
        if (!("serviceWorker" in navigator)) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub?.endpoint) setEndpoint(sub.endpoint);
      } catch {
        // ignore
      }
    })();
  }, []);

  async function enable() {
    try {
      setStatus("working");

      if (!("serviceWorker" in navigator)) throw new Error("Service workers not supported.");
      if (!VAPID_PUBLIC_KEY) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY.");

      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications not granted.");

      const reg = await navigator.serviceWorker.ready;

      // Reuse existing subscription if present (prevents endpoint churn)
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      setEndpoint(sub.endpoint || "");

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          draftIds,
          subscription: sub,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      setStatus("enabled");
    } catch (e) {
      setStatus("error");
      console.error(e);
      alert(e?.message || String(e));
    }
  }

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpoint);
      alert("Endpoint copied.");
    } catch {
      alert("Could not copy. (Clipboard blocked?)");
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={enable}
        disabled={status === "working"}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(255,255,255,0.08)",
          color: "white",
          cursor: "pointer",
        }}
      >
        {status === "working" ? "Enabling…" : "Enable Alerts"}
      </button>

      {endpoint ? (
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
          <div style={{ marginBottom: 6 }}>
            <b>Current subscription endpoint:</b>
          </div>
          <div style={{ wordBreak: "break-all", opacity: 0.85 }}>{endpoint}</div>
          <button
            onClick={copyEndpoint}
            style={{
              marginTop: 8,
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              cursor: "pointer",
            }}
          >
            Copy endpoint
          </button>
        </div>
      ) : null}
    </div>
  );
}
