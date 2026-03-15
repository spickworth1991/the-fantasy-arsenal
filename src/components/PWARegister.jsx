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

    const getExistingRegistration = async () => {
      try {
        const direct = await navigator.serviceWorker.getRegistration("/");
        if (direct) return direct;
      } catch {
        // ignore
      }

      try {
        return await navigator.serviceWorker.ready;
      } catch {
        return null;
      }
    };

    const ensureRegistration = async () => {
      try {
        const existing = await getExistingRegistration();
        const reg =
          existing ||
          (await navigator.serviceWorker.register("/sw.js", {
            scope: "/",
            updateViaCache: "none",
          }));
        await activateWaitingWorker(reg);
        return reg;
      } catch (e) {
        console.error("[SW] register failed:", e);
        return null;
      }
    };

    const refreshRegistration = async () => {
      try {
        const reg = await ensureRegistration();
        await reg?.update?.().catch(() => {});
        await activateWaitingWorker(reg);
        return reg;
      } catch (e) {
        console.error("[SW] refresh failed:", e);
        return null;
      }
    };

    (async () => {
      const reg = await ensureRegistration();
      if (cancelled || !reg) return;
      await reg.update().catch(() => {});
      await activateWaitingWorker(reg);
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

    const ensurePresent = window.setInterval(() => {
      ensureRegistration().catch(() => {});
    }, 60 * 1000);

    const periodic = window.setInterval(() => {
      refreshRegistration().catch(() => {});
    }, 15 * 60 * 1000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(ensurePresent);
      window.clearInterval(periodic);
    };
  }, []);

  return null;
}
