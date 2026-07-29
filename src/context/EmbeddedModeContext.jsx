"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const EmbeddedModeContext = createContext({ embedded:false, parentOrigin:"", theme:"dark", openFullscreen:()=>{} });

export function EmbeddedModeProvider({ children }) {
  const [state, setState] = useState({ embedded:false, parentOrigin:"", theme:"dark" });

  useEffect(() => {
    const path = String(window.location.pathname || "");
    const query = new URLSearchParams(window.location.search);
    const framed = window.parent !== window;
    const embedded = framed || path === "/tools/app" || path.startsWith("/tools/app/") || query.get("embedded") === "1";
    let parentOrigin = "";
    try { parentOrigin = document.referrer ? new URL(document.referrer).origin : ""; } catch {}
    setState((current) => ({ ...current, embedded, parentOrigin }));
    document.documentElement.dataset.arsenalEmbedded = embedded ? "true" : "false";

    if (!embedded || !framed) return undefined;
    const send = (type, payload = {}) => window.parent.postMessage({ source:"the-fantasy-arsenal", type, ...payload }, parentOrigin || "*");
    const receive = (event) => {
      if (parentOrigin && event.origin !== parentOrigin) return;
      const message = event.data;
      if (!message || message.source !== "ballsville") return;
      if (message.type === "BALLSVILLE_CONTEXT") {
        setState((current) => ({ ...current, theme:message.theme || current.theme, parentOrigin:event.origin }));
        document.documentElement.dataset.ballsvilleTheme = message.theme || "dark";
      }
      if (message.type === "BALLSVILLE_NAVIGATE" && typeof message.href === "string" && message.href.startsWith("/")) {
        window.location.assign(message.href);
      }
    };
    window.addEventListener("message", receive);
    send("ARSENAL_READY", { path:window.location.pathname, version:1 });
    const resize = new ResizeObserver(() => send("ARSENAL_SIZE", { height:Math.ceil(document.documentElement.scrollHeight) }));
    resize.observe(document.body);
    return () => { window.removeEventListener("message", receive); resize.disconnect(); };
  }, []);

  const value = useMemo(() => ({
    ...state,
    openFullscreen:() => {
      const cleanPath = window.location.pathname.replace(/^\/tools\/app/, "") || "/";
      window.open(`https://thefantasyarsenal.com${cleanPath}${window.location.search}`, "_blank", "noopener,noreferrer");
    },
  }), [state]);
  return <EmbeddedModeContext.Provider value={value}>{children}</EmbeddedModeContext.Provider>;
}

export const useEmbeddedMode = () => useContext(EmbeddedModeContext);
