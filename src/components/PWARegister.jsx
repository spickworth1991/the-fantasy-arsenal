"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Don’t spam console; just register quietly.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
