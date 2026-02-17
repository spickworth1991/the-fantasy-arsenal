"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    (async () => {
      try {
        console.log("[SW] registering /sw.js …");

        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

        console.log("[SW] registered scope:", reg.scope);
        console.log("[SW] installing:", !!reg.installing, "waiting:", !!reg.waiting, "active:", !!reg.active);

        // If not controlled yet, reload once when controller is acquired
        if (!navigator.serviceWorker.controller) {
          console.log("[SW] controller is null (expected on first load). Waiting for controllerchange…");

          const onChange = () => {
            console.log("[SW] controllerchange fired -> reloading once");
            navigator.serviceWorker.removeEventListener("controllerchange", onChange);
            window.location.reload();
          };

          navigator.serviceWorker.addEventListener("controllerchange", onChange);
        } else {
          console.log("[SW] controller already present");
        }

        // Snapshot registrations AFTER register (async)
        setTimeout(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          console.log("[SW] registrations after 1s:", regs.map(r => r.scope));
          console.log("[SW] controller after 1s:", navigator.serviceWorker.controller);
        }, 1000);
      } catch (e) {
        console.error("[SW] register failed:", e);
      }
    })();
  }, []);

  return null;
}
