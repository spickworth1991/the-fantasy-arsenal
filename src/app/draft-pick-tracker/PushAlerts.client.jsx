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

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function PushAlerts({ username, draftIds }) {
  const [status, setStatus] = useState("idle"); // idle | working | enabled | error
  const [endpoint, setEndpoint] = useState("");

  useEffect(() => {
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
        body: JSON.stringify({ username, draftIds, subscription: sub }),
      });

      if (!res.ok) throw new Error(await res.text());
      setStatus("enabled");
    } catch (e) {
      setStatus("error");
      console.error(e);
      alert(e?.message || String(e));
    }
  }

  async function hardReset() {
    // This is the “revive my dead Chrome profile” button.
    try {
      setStatus("working");
      if (!("serviceWorker" in navigator)) throw new Error("Service workers not supported.");

      // 1) Grab current subscription (if any) so we can delete it server-side.
      let sub = null;
      try {
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.getSubscription();
      } catch {
        // if SW is busted, we'll still proceed
      }

      // 2) Delete endpoint from DB first (prevents stale rows)
      if (sub?.endpoint) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
      }

      // 3) Unsubscribe client push
      if (sub) {
        try {
          await sub.unsubscribe();
        } catch {}
      }

      // 4) Unregister ALL service workers for this origin
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(regs.map((r) => r.unregister()));
      } catch {}

      // 5) Clear caches for this origin (sometimes old SW script/cached assets get stuck)
      try {
        if (window.caches?.keys) {
          const keys = await caches.keys();
          await Promise.allSettled(keys.map((k) => caches.delete(k)));
        }
      } catch {}

      // 6) Best-effort clear storage (won’t always be allowed)
      try {
        if (navigator.storage?.estimate) {
          // just touch it; some browsers require a user gesture before clear
          await navigator.storage.estimate();
        }
        if (navigator.storage?.persisted) {
          await navigator.storage.persisted();
        }
      } catch {}

      setEndpoint("");
      setStatus("idle");

      alert("Hard reset complete. Page will reload. Then click Enable Alerts.");
      location.reload();
    } catch (e) {
      setStatus("error");
      console.error(e);
      alert(e?.message || String(e));
    }
  }

  return (
    <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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
        {status === "working" ? "Working…" : "Enable Alerts"}
      </button>

      <button
        onClick={hardReset}
        disabled={status === "working"}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(255,90,90,0.18)",
          color: "white",
          cursor: "pointer",
        }}
        title="Use this if your Chrome profile stopped receiving pushes entirely."
      >
        Hard Reset Alerts
      </button>

      {endpoint ? (
        <div style={{ width: "100%", marginTop: 10, fontSize: 12, opacity: 0.9 }}>
          <div style={{ marginBottom: 6 }}>
            <b>Current subscription endpoint:</b>
          </div>
          <div style={{ wordBreak: "break-all", opacity: 0.85 }}>{endpoint}</div>
        </div>
      ) : null}
    </div>
  );
}
