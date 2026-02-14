"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    (async () => {
      try {
        console.log("[SW] registering /sw.js …");
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        console.log("[SW] registered:", reg);

        // Helpful visibility
        const regs = await navigator.serviceWorker.getRegistrations();
        console.log("[SW] registrations now:", regs);

        // controller attaches after reload; log state
        console.log("[SW] controller:", navigator.serviceWorker.controller);

        // Force claim if it’s waiting
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        // When installed, reload once so controller becomes non-null
        if (!navigator.serviceWorker.controller) {
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            console.log("[SW] controllerchange -> reloading once");
            window.location.reload();
          });
        }
      } catch (e) {
        console.error("[SW] register failed:", e);
      }
    })();
  }, []);

  return null;
}
