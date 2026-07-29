"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "./SleeperContext";

const TOKEN_KEY = "tfa:account-token";
const META_KEY = "tfa:sync-meta";
const PREFER_REMOTE_KEY = "tfa:sync-prefer-remote";
const RECORD_REFRESH_KEY = "tfa:leaderboard-record-refresh";
const SYNC_EXACT = new Set([
  "format", "qbType", "sourceKey", "year",
  "tfa:account-preferences", "tfa:intelligence-actions",
  "tfa:account-platform",
  "draft-helper-watchlist", "leagueHubWatchlist",
]);
const SYNC_PREFIXES = [
  "commissioner-", "orphan-recruiting:", "lineup-saves:", "lineup-controls:",
  "draft-helper-queue:", "playoff-scenarios:",
  "tfa:trade-workspaces:", "tfa:trade-block:", "tfa:trade-swipes:",
  "ps:guard:",
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
