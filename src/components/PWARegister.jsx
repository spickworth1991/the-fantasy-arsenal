"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    let cancelled = false;

    const activateWaitingWorker = async (reg) => {
      try {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      } catch {
        // ignore
      }
    };

    const refreshRegistration = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await reg.update().catch(() => {});
        await activateWaitingWorker(reg);
        return reg;
      } catch (e) {
        console.error("[SW] register failed:", e);
        return null;
      }
    };

    (async () => {
      const reg = await refreshRegistration();
      if (cancelled || !reg) return;

      if (!navigator.serviceWorker.controller) {
        const onChange = () => {
          navigator.serviceWorker.removeEventListener("controllerchange", onChange);
          window.location.reload();
        };

        navigator.serviceWorker.addEventListener("controllerchange", onChange);
      }
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshRegistration().catch(() => {});
      }
    };

    const onFocus = () => {
      refreshRegistration().catch(() => {});
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    const periodic = window.setInterval(() => {
      refreshRegistration().catch(() => {});
    }, 15 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(periodic);
    };
  }, []);

  return null;
}
