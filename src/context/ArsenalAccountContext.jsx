"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSleeper } from "./SleeperContext";

const TOKEN_KEY = "tfa:account-token";
const META_KEY = "tfa:sync-meta";
const PREFER_REMOTE_KEY = "tfa:sync-prefer-remote";
const RECORD_REFRESH_KEY = "tfa:leaderboard-record-refresh";
const UI_PREFERENCES_KEY = "tfa:ui-preferences";
const SYNC_EXACT = new Set([
  "format", "qbType", "sourceKey", "projectionScoring", "year",
  "tfa:account-preferences", "tfa:intelligence-actions",
  "tfa:account-platform",
  UI_PREFERENCES_KEY,
  "draft-helper-watchlist", "leagueHubWatchlist",
]);
const SYNC_PREFIXES = [
  "tfa:tips:",
  "tfa:league-hub:",
  "commissioner-", "orphan-recruiting:", "lineup-saves:", "lineup-controls:",
  "draft-helper-queue:", "playoff-scenarios:",
  "tfa:trade-workspaces:", "tfa:trade-block:", "tfa:trade-swipes:",
  "ps:guard:", "ps:ballsville:",
];
const ArsenalAccountContext = createContext(null);

export const STOCK_AVATARS = [
  { key:"blitz", label:"Blitz", src:"/icons/football-icon.webp", gradient:"from-cyan-400/30 to-blue-600/20" },
  { key:"architect", label:"Architect", src:"/icons/draft-command-center-icon.webp", gradient:"from-violet-400/30 to-fuchsia-600/20" },
  { key:"closer", label:"Closer", src:"/icons/trade-icon.png", gradient:"from-emerald-400/30 to-cyan-600/20" },
  { key:"scout", label:"Scout", src:"/icons/manager-intelligence-icon.webp", gradient:"from-amber-400/30 to-orange-600/20" },
  { key:"commissioner", label:"Commissioner", src:"/icons/commissioner-dashboard-icon.webp", gradient:"from-rose-400/30 to-violet-600/20" },
  { key:"analyst", label:"Analyst", src:"/icons/stock-icon.png", gradient:"from-sky-400/30 to-indigo-600/20" },
];

export function accountAvatar(account) {
  if (account?.avatarType === "upload" && account?.avatarValue) return account.avatarValue;
  return STOCK_AVATARS.find((avatar) => avatar.key === account?.avatarValue)?.src || STOCK_AVATARS[0].src;
}

const isSyncKey = (key) => key && (SYNC_EXACT.has(key) || SYNC_PREFIXES.some((prefix) => key.startsWith(prefix)));
const accountApiUrl = (url) => {
  if (typeof window === "undefined" || !String(url).startsWith("/api/arsenal/")) return url;
  return window.location.pathname === "/tools/app" || window.location.pathname.startsWith("/tools/app/")
    ? `/tools/app${url}`
    : url;
};
const request = async (url, options = {}, token = "") => {
  const response = await fetch(accountApiUrl(url), {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { Authorization:`Bearer ${token}` } : {}) },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `${options.method || "GET"} ${url} returned HTTP ${response.status}`);
  }
  return response.json();
};
const digest = async (value) => {
  const data = new TextEncoder().encode(String(value || ""));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export function ArsenalAccountProvider({ children }) {
  const pathname = usePathname();
  const { username:activeSleeperUsername, year:activeSleeperYear, loadPortfolio, storageReady:sleeperStorageReady } = useSleeper();
  const [token, setToken] = useState("");
  const [account, setAccount] = useState(null);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState({ status:"guest", message:"Guest mode · data stays on this device", at:null });
  const syncLock = useRef(false);
  const accountPortfolioLoad = useRef("");

  const authorized = useCallback((url, options) => request(url, options, token), [token]);

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY) || "";
    setToken(saved);
    if (!saved) { setReady(true); return; }
    request("/api/arsenal/account", {}, saved)
      .then((result) => { setAccount(result.account); setSyncState({ status:"ready", message:"Account connected", at:null }); })
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(""); setAccount(null); setSyncState({ status:"error", message:"Saved Arsenal key is no longer valid", at:null }); })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!sleeperStorageReady || !account?.sleeperUsername || activeSleeperUsername) return;
    const target = String(account.sleeperUsername);
    if (accountPortfolioLoad.current === target.toLowerCase()) return;
    accountPortfolioLoad.current = target.toLowerCase();
    loadPortfolio(target, activeSleeperYear || new Date().getFullYear()).catch(() => {
      accountPortfolioLoad.current = "";
    });
  }, [account?.sleeperUsername, activeSleeperUsername, activeSleeperYear, loadPortfolio, sleeperStorageReady]);

  const syncNow = useCallback(async ({ quiet = false } = {}) => {
    if (!token || syncLock.current) return null;
    syncLock.current = true;
    if (!quiet) setSyncing(true);
    try {
      const metaKey = `${META_KEY}:${account?.accountId || "unknown"}`;
      const meta = JSON.parse(localStorage.getItem(metaKey) || "{}");
      const preferRemote = localStorage.getItem(PREFER_REMOTE_KEY) === "1";
      const local = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!isSyncKey(key)) continue;
        const value = localStorage.getItem(key) || "";
        const hash = await digest(value);
        if (!meta[key] || meta[key].hash !== hash) meta[key] = { hash, updatedAt:preferRemote && !meta[key] ? 0 : Date.now() };
        local.push({ key, value, updatedAt:Number(meta[key].updatedAt || Date.now()) });
      }
      const remoteResult = await authorized("/api/arsenal/sync");
      let remoteApplied = false;
      for (const item of remoteResult.items || []) {
        const localMeta = meta[item.key];
        if (!localMeta || Number(item.updatedAt) > Number(localMeta.updatedAt || 0)) {
          localStorage.setItem(item.key, item.value);
          remoteApplied = true;
          meta[item.key] = { hash:await digest(item.value), updatedAt:Number(item.updatedAt) };
        }
      }
      localStorage.removeItem(PREFER_REMOTE_KEY);
      const refreshed = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (isSyncKey(key)) refreshed.push({ key, value:localStorage.getItem(key) || "", updatedAt:Number(meta[key]?.updatedAt || Date.now()) });
      }
      await authorized("/api/arsenal/sync", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ items:refreshed }) });
      localStorage.setItem(metaKey, JSON.stringify(meta));
      if (remoteApplied) window.dispatchEvent(new CustomEvent("tfa:cloud-sync-applied"));
      const at = new Date();
      setSyncState({ status:"synced", message:"Everything is synced", at });
      return { ok:true, at };
    } catch (error) {
      setSyncState({ status:"error", message:error?.message || "Sync failed", at:null });
      if (!quiet) throw error;
      return null;
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [account?.accountId, authorized, token]);

  useEffect(() => {
    if (!account?.accountId || !pathname) return undefined;
    const supported = "select,input[type='checkbox'],input[type='radio'],input[type='range'],button[aria-pressed]";
    const clean = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").replace(/\d+/g, "#").trim().slice(0, 140);
    const eligible = (element) => element instanceof HTMLElement
      && element.matches(supported)
      && !element.disabled
      && !element.closest("[data-no-account-persist]")
      && element.getAttribute("data-account-persist") !== "off";
    const identity = (element) => {
      const explicit = element.getAttribute("data-account-preference");
      if (explicit) return `${pathname}|explicit:${explicit}`;
      const named = element.id || element.getAttribute("name") || element.getAttribute("aria-label");
      if (named) return `${pathname}|${element.tagName.toLowerCase()}:${clean(named)}`;
      const label = element.closest("label")?.innerText || element.parentElement?.querySelector?.("label")?.innerText || "";
      if (clean(label)) return `${pathname}|${element.tagName.toLowerCase()}:${element.getAttribute("type") || ""}:label:${clean(label)}`;
      const controls = [...document.querySelectorAll(supported)].filter(eligible);
      const optionKey = element instanceof HTMLSelectElement
        ? [...element.options].slice(0, 8).map((option) => option.value).join(",")
        : "";
      return `${pathname}|${element.tagName.toLowerCase()}:${element.getAttribute("type") || ""}:options:${clean(optionKey)}:index:${controls.indexOf(element)}`;
    };
    const readStore = () => {
      try {
        const parsed = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || "{}");
        return parsed && typeof parsed === "object" ? { version:1, controls:{}, ...parsed, controls:{ ...(parsed.controls || {}) } } : { version:1, controls:{} };
      } catch {
        return { version:1, controls:{} };
      }
    };
    let syncTimer;
    const save = (element) => {
      if (!eligible(element)) return;
      const store = readStore();
      const key = identity(element);
      store.controls[key] = {
        type:element instanceof HTMLSelectElement ? "select" : element.matches("button[aria-pressed]") ? "pressed-button" : element.type,
        value:String(element.value ?? ""),
        checked:element.matches("button[aria-pressed]") ? element.getAttribute("aria-pressed") === "true" : "checked" in element ? !!element.checked : undefined,
        updatedAt:Date.now(),
      };
      localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(store));
      clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => syncNow({ quiet:true }), 900);
    };
    const setNative = (element, field, value) => {
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, field)?.set;
      if (setter) setter.call(element, value);
      else element[field] = value;
    };
    const restore = () => {
      const controls = readStore().controls;
      document.querySelectorAll(supported).forEach((element) => {
        if (!eligible(element)) return;
        const saved = controls[identity(element)];
        if (!saved) return;
        let changed = false;
        if ((element instanceof HTMLSelectElement || element.type === "range") && String(element.value) !== String(saved.value)) {
          setNative(element, "value", String(saved.value));
          changed = true;
        }
        if ((element.type === "checkbox" || element.type === "radio") && typeof saved.checked === "boolean" && element.checked !== saved.checked) {
          setNative(element, "checked", saved.checked);
          changed = true;
        }
        if (element.matches("button[aria-pressed]") && typeof saved.checked === "boolean") {
          const pressed = element.getAttribute("aria-pressed") === "true";
          const groupSize = element.parentElement?.querySelectorAll?.("button[aria-pressed]").length || 1;
          if (pressed !== saved.checked && (groupSize === 1 || saved.checked)) element.click();
        }
        if (changed) {
          element.dispatchEvent(new Event("input", { bubbles:true }));
          element.dispatchEvent(new Event("change", { bubbles:true }));
        }
      });
    };
    const onControl = (event) => save(event.target);
    const onClick = (event) => {
      if (!event.target?.matches?.("button[aria-pressed]")) return;
      window.setTimeout(() => save(event.target), 0);
    };
    const onCloud = () => window.setTimeout(restore, 0);
    window.addEventListener("change", onControl, true);
    window.addEventListener("input", onControl, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("tfa:cloud-sync-applied", onCloud);
    const observer = new MutationObserver(() => window.requestAnimationFrame(restore));
    observer.observe(document.body, { childList:true, subtree:true });
    const initial = window.setTimeout(restore, 0);
    return () => {
      clearTimeout(initial);
      clearTimeout(syncTimer);
      observer.disconnect();
      window.removeEventListener("change", onControl, true);
      window.removeEventListener("input", onControl, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("tfa:cloud-sync-applied", onCloud);
    };
  }, [account?.accountId, pathname, syncNow]);

  useEffect(() => {
    if (!token || !account) return undefined;
    syncNow({ quiet:true });
    const timer = window.setInterval(() => syncNow({ quiet:true }), 45000);
    const visibility = () => { if (document.visibilityState === "hidden") syncNow({ quiet:true }); };
    document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [account, syncNow, token]);

  const activateAccountPortfolio = async (nextAccount) => {
    const target = String(nextAccount?.sleeperUsername || "").trim();
    if (!target || target.toLowerCase() === String(activeSleeperUsername || "").toLowerCase()) return;
    await loadPortfolio(target, activeSleeperYear || new Date().getFullYear());
  };

  const createAccount = async (sleeperUsername, loginName, password, confirmPassword) => {
    const result = await request("/api/arsenal/register", {
      method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ sleeperUsername, loginName, password, confirmPassword }),
    });
    localStorage.setItem(TOKEN_KEY, result.token);
    setToken(result.token);
    setAccount(result.account);
    await activateAccountPortfolio(result.account).catch(() => {});
    setSyncState({ status:"ready", message:"Account created · save your recovery key", at:null });
    return result;
  };
  const loginAccount = async (loginName, password) => {
    const result = await request("/api/arsenal/login", {
      method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ loginName, password }),
    });
    localStorage.setItem(PREFER_REMOTE_KEY, "1");
    localStorage.setItem(TOKEN_KEY, result.token);
    setToken(result.token);
    setAccount(result.account);
    await activateAccountPortfolio(result.account).catch(() => {});
    setSyncState({ status:"ready", message:"Signed in · restoring your Arsenal workspace", at:null });
    return result;
  };
  const connectAccount = async (nextToken) => {
    const clean = String(nextToken || "").trim();
    const result = await request("/api/arsenal/account", {}, clean);
    localStorage.setItem(PREFER_REMOTE_KEY, "1");
    localStorage.setItem(TOKEN_KEY, clean);
    setToken(clean);
    setAccount(result.account);
    await activateAccountPortfolio(result.account).catch(() => {});
    setSyncState({ status:"ready", message:"Account connected", at:null });
    return result;
  };
  const updateProfile = async (patch) => {
    const result = await authorized("/api/arsenal/account", {
      method:"PATCH", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(patch),
    });
    setAccount(result.account);
    return result.account;
  };
  const uploadAvatar = async (file) => {
    const form = new FormData();
    form.append("avatar", file);
    const result = await authorized("/api/arsenal/avatar", { method:"POST", body:form });
    return updateProfile({ avatarType:"upload", avatarValue:result.avatarValue });
  };
  const refreshRecord = useCallback(async () => {
    const result = await authorized("/api/arsenal/leaderboard", { method:"POST" });
    setAccount(result.account);
    return result.account;
  }, [authorized]);
  const clearAccountData = async (mode, password="") => {
    const result=await authorized("/api/arsenal/data",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,password})});
    if(mode==="sync"){
      const keys=[];for(let index=0;index<localStorage.length;index+=1){const key=localStorage.key(index);if(isSyncKey(key))keys.push(key);}
      keys.forEach((key)=>localStorage.removeItem(key));
      localStorage.removeItem(`${META_KEY}:${account?.accountId||"unknown"}`);
    }else if(mode==="history"){
      localStorage.removeItem("tfa:intelligence-actions");
      try{const platform=JSON.parse(localStorage.getItem("tfa:account-platform")||"{}");platform.activity=[];localStorage.setItem("tfa:account-platform",JSON.stringify(platform));}catch{}
    }else if(mode==="avatar"){
      const refreshed=await authorized("/api/arsenal/account");
      setAccount(refreshed.account);
    }
    window.dispatchEvent(new CustomEvent("tfa:cloud-sync-applied"));
    return result;
  };
  useEffect(() => {
    if (!token || !account?.accountId) return;
    const key = `${RECORD_REFRESH_KEY}:${account.accountId}`;
    const lastAttempt = Number(localStorage.getItem(key) || 0);
    const currentSeason = new Date().getFullYear();
    const recordIsCurrent = Number(account.record?.season) === currentSeason;
    const recordIsFresh = Date.now() - Number(account.record?.updatedAt || 0) < 12 * 60 * 60 * 1000;
    if (recordIsCurrent && recordIsFresh && Date.now() - lastAttempt < 12 * 60 * 60 * 1000) return;
    localStorage.setItem(key, String(Date.now()));
    refreshRecord().catch(() => {});
  }, [account?.accountId, account?.record?.season, account?.record?.updatedAt, refreshRecord, token]);
  const disconnect = async () => {
    try {
      if (token) await authorized("/api/arsenal/sessions", { method:"DELETE", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ current:true }) });
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setAccount(null);
    setSyncState({ status:"guest", message:"Guest mode · data stays on this device", at:null });
  };

  const value = useMemo(() => ({
    ready, token, account, isConnected:!!account, syncing, syncState,
    createAccount, loginAccount, connectAccount, updateProfile, uploadAvatar, refreshRecord, clearAccountData, disconnect, syncNow, accountRequest:authorized,
  }), [account, ready, syncState, syncing, token, syncNow]);
  return <ArsenalAccountContext.Provider value={value}>{children}</ArsenalAccountContext.Provider>;
}

export function useArsenalAccount() {
  const value = useContext(ArsenalAccountContext);
  if (!value) throw new Error("useArsenalAccount must be used inside ArsenalAccountProvider");
  return value;
}
