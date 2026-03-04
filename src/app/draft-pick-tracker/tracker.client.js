// src/app/draft-pick-tracker/tracker.client.js
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";

import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import PushAlerts from "./PushAlerts.client.jsx";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function msToClock(ms) {
  const s = Math.max(0, Math.floor(safeNum(ms) / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hh > 0) return `${hh}:${pad(mm)}:${pad(ss)}`;
  return `${mm}:${pad(ss)}`;
}

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

function formatTimerHoursLabel(timerSec) {
  const t = safeNum(timerSec);
  if (t <= 0) return "";
  const hrs = t / 3600;
  const txt = Number.isInteger(hrs) ? String(hrs) : hrs.toFixed(1).replace(/\.0$/, "");
  return `${txt} HR Timer`;
}

function Pill({ children, tone = "blue", size = "md" }) {
  const tones = {
    blue: "bg-blue-500/20 text-blue-200 border-blue-400/30",
    green: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
    yellow: "bg-yellow-500/20 text-yellow-200 border-yellow-400/30",
    orange: "bg-orange-500/20 text-orange-200 border-orange-400/30",
    red: "bg-red-500/20 text-red-200 border-red-400/30",
    cyan: "bg-cyan-500/20 text-cyan-200 border-cyan-400/30",
    purple: "bg-purple-500/20 text-purple-200 border-purple-400/30",
    gray: "bg-white/5 text-gray-200 border-white/10",
  };

  const sizes = {
    xs: "px-1.5 py-0.5 text-[10px]",
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full border leading-none font-medium",
        sizes[size] || sizes.md,
        tones[tone] || tones.gray
      )}
    >
      {children}
    </span>
  );
}

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={classNames(
        "group inline-flex items-center gap-2 rounded-xl border px-3 py-2 transition",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-white/5",
        checked
          ? "bg-white/10 border-white/20 text-white"
          : "bg-black/20 border-white/10 text-gray-200"
      )}
      aria-pressed={checked}
      aria-label={label}
      title={label}
    >
      <span
        className={classNames(
          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border transition",
          checked ? "bg-emerald-500/20 border-emerald-400/30" : "bg-white/5 border-white/10"
        )}
      >
        <span
          className={classNames(
            "absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full transition",
            checked
              ? "left-[18px] bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.35)]"
              : "left-[2px] bg-gray-200/80"
          )}
        />
      </span>
      <span className="text-xs font-semibold tracking-wide">{label}</span>
    </button>
  );
}

function getOnClockHeatMsForUI({ isPaused, liveClockLeft, timerSec }) {
  if (isPaused) return Math.max(0, safeNum(timerSec) * 1000);
  return Math.max(0, safeNum(liveClockLeft));
}

function onClockHeatStyles(liveClockLeftMs, timerSec) {
  const leftMs = Math.max(0, safeNum(liveClockLeftMs));
  const tSec = Math.max(0, safeNum(timerSec));
  const totalMs = tSec > 0 ? tSec * 1000 : 0;

  if (!totalMs) {
    return {
      ring: "",
      wash: "",
      badgeTone: "gray",
      tier: "none",
      shake: "",
    };
  }

  const leftSec = Math.ceil(leftMs / 1000);

  const yellowCapSec = Math.max(Math.round(tSec * 0.60), 10 * 60);
  const orangeCapSec = Math.max(Math.round(tSec * 0.35), 5 * 60);
  const redCapSec = Math.max(Math.round(tSec * 0.15), 2 * 60);

  let tier = "green";
  if (leftSec <= redCapSec) tier = "red";
  else if (leftSec <= orangeCapSec) tier = "orange";
  else if (leftSec <= yellowCapSec) tier = "yellow";

  const pulse =
    tier === "green"
      ? "animate-[pulse_1.25s_ease-in-out_infinite]"
      : tier === "yellow"
      ? "animate-[pulse_1.05s_ease-in-out_infinite]"
      : tier === "orange"
      ? "animate-[pulse_0.9s_ease-in-out_infinite]"
      : "animate-[pulse_0.75s_ease-in-out_infinite]";

  const shakeOnly =
    tier === "orange" || tier === "red"
      ? "animate-[dpt_shake_0.9s_ease-in-out_infinite]"
      : "";

  const shake = `${pulse} ${shakeOnly}`.trim();

  const ring =
    tier === "green"
      ? "ring-2 ring-emerald-400/35 border-emerald-400/20 shadow-[0_0_0_1px_rgba(52,211,153,0.18),0_0_26px_rgba(52,211,153,0.14)]"
      : tier === "yellow"
      ? "ring-2 ring-yellow-300/30 border-yellow-300/20 shadow-[0_0_0_1px_rgba(253,224,71,0.14),0_0_24px_rgba(253,224,71,0.10)]"
      : tier === "orange"
      ? "ring-2 ring-orange-300/30 border-orange-300/20 shadow-[0_0_0_1px_rgba(251,146,60,0.14),0_0_26px_rgba(251,146,60,0.12)]"
      : "ring-2 ring-red-400/35 border-red-400/20 shadow-[0_0_0_1px_rgba(248,113,113,0.18),0_0_32px_rgba(248,113,113,0.16)]";

  const wash =
    tier === "green"
      ? "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-emerald-500/18 before:via-transparent before:to-transparent before:pointer-events-none"
      : tier === "yellow"
      ? "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-yellow-400/16 before:via-transparent before:to-transparent before:pointer-events-none"
      : tier === "orange"
      ? "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-orange-400/16 before:via-transparent before:to-transparent before:pointer-events-none"
      : "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-red-500/18 before:via-transparent before:to-transparent before:pointer-events-none";

  const badgeTone =
    tier === "green" ? "green" : tier === "yellow" ? "yellow" : tier === "orange" ? "orange" : "red";

  return {
    ring: `${ring} ${pulse}`,
    wash,
    badgeTone,
    tier,
    shake,
  };
}

function onDeckTintStyles() {
  return {
    ring: "ring-1 ring-amber-300/25 border-amber-300/15 shadow-[0_0_0_1px_rgba(251,191,36,0.14),0_0_18px_rgba(251,191,36,0.10)]",
    wash:
      "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-amber-400/10 before:via-transparent before:to-transparent before:pointer-events-none",
  };
}

export default function DraftPickTrackerClient() {
  const { username, leagues, year } = useSleeper();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [search, setSearch] = useState("");
  const [onlyDrafting, setOnlyDrafting] = useState(true);
  const [includePaused, setIncludePaused] = useState(true);

  const [view, setView] = useState("cards"); // cards | table
  const [onlyOnDeckOrClock, setOnlyOnDeckOrClock] = useState(false);
  const [maxPicksAway, setMaxPicksAway] = useState(30); // 999 = off
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [sortMode, setSortMode] = useState("time"); // "time" | "pick"
  const [sortDir, setSortDir] = useState("asc");

  const [rows, setRows] = useState([]);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [now, setNow] = useState(0);

  // Local "auto-pick" flags (set via service-worker push -> postMessage).
  const [autoByDraftId, setAutoByDraftId] = useState({});

  // Toast for copy
  const [toast, setToast] = useState("");

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // push -> client auto flags
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (ev) => {
      const data = ev?.data;
      if (!data || data.type !== "push-event") return;
      if (data.stage !== "auto" || !data.draftId) return;
      const draftId = String(data.draftId);
      const ts = Number(data.ts || Date.now());
      setAutoByDraftId((prev) => ({ ...prev, [draftId]: ts }));
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  // Auto flags expire after 15 minutes.
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - 15 * 60 * 1000;
      setAutoByDraftId((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [k, v] of Object.entries(next)) {
          if (Number(v || 0) < cutoff) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  // ---------------- Refresh (registry-only) ----------------
  async function refresh() {
    setErr("");
    setLoading(true);

    const jsonParseSafe = (s, fallback) => {
      try {
        return JSON.parse(s);
      } catch {
        return fallback;
      }
    };

    const safeLower = (s) => String(s || "").trim().toLowerCase();

    const getSnakeSlotForPick = ({ pickNo, teams, reversalRound }) => {
      if (!pickNo || !teams) return null;
      const idx0 = pickNo - 1;
      const round = Math.floor(idx0 / teams) + 1;
      const pickInRound0 = idx0 % teams;

      const rr = safeNum(reversalRound);
      let forward = true;
      if (round > 1) {
        for (let r = 2; r <= round; r++) {
          if (rr > 0 && r === rr) {
            // 3RR: skip flip
          } else {
            forward = !forward;
          }
        }
      }

      const slot = forward ? pickInRound0 + 1 : teams - pickInRound0;
      return { round, slot };
    };

    const resolveRosterForPick = ({
      pickNo,
      teams,
      reversalRound,
      slotToRoster,
      tradedPickOwner,
      seasonStr,
    }) => {
      const rs = getSnakeSlotForPick({ pickNo, teams, reversalRound });
      if (!rs) return null;
      const { round, slot } = rs;
      const origRosterId = slotToRoster?.[String(slot)] ?? slotToRoster?.[slot] ?? null;
      if (!origRosterId) return null;
      const key = `${seasonStr}|${round}|${String(origRosterId)}`;
      const traded = tradedPickOwner?.[key];
      return traded ? String(traded) : String(origRosterId);
    };

    const getOwnerName = (rosterId, rosterNames) => {
      const rid = rosterId == null ? "" : String(rosterId);
      return rosterNames?.[rid] || (rid ? `Roster ${rid}` : "—");
    };

    try {
      const eligible = (leagues || []).filter((lg) => !!lg?.draft_id);
      if (!eligible.length) {
        setRows([]);
        return;
      }

      const ids = eligible.map((l) => String(l.draft_id)).filter(Boolean);

      const res = await fetch(
        `/api/draft-pick-tracker/registry?ids=${encodeURIComponent(ids.join(","))}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Registry fetch failed");

      const json = await res.json();
      const registryDrafts = json?.drafts || {};

      const nowMs = Date.now();
      const uname = safeLower(username);

      const draftRows = [];

      for (const lg of eligible) {
        const reg = registryDrafts[String(lg.draft_id)];
        if (!reg) continue;

        const draft =
          reg?.draft ?? (reg?.draft_json ? jsonParseSafe(reg.draft_json, null) : null);

        const draftStatus = String(draft?.status || reg?.status || "").toLowerCase();

        const slotToRoster =
          reg?.slotToRoster ??
          (reg?.slot_to_roster_json ? jsonParseSafe(reg.slot_to_roster_json, {}) : {}) ??
          {};

        const rosterNames =
          reg?.rosterNames ??
          (reg?.roster_names_json ? jsonParseSafe(reg.roster_names_json, {}) : {}) ??
          {};

        const rosterByUsername =
          reg?.rosterByUsername ??
          (reg?.roster_by_username_json ? jsonParseSafe(reg.roster_by_username_json, {}) : {}) ??
          {};

        const tradedPickOwner =
          reg?.tradedPickOwners ??
          (reg?.traded_pick_owner_json ? jsonParseSafe(reg.traded_pick_owner_json, {}) : {}) ??
          {};

        const teams = safeNum(reg?.teams || draft?.settings?.teams || 0);
        const rounds = safeNum(reg?.rounds || draft?.settings?.rounds || 0);
        const timerSec = safeNum(
          reg?.timer_sec ||
            reg?.timerSec ||
            draft?.settings?.pick_timer ||
            draft?.settings?.pick_timer_seconds ||
            0
        );
        const reversalRound = safeNum(reg?.reversal_round || draft?.settings?.reversal_round || 0);

        const pickCount = safeNum((reg?.pickCount ?? reg?.pick_count) ?? 0);
        const currentPick = pickCount + 1;

        const seasonStr = String(draft?.season || lg?.season || year || "");
        const myRosterId = rosterByUsername?.[uname] ? String(rosterByUsername[uname]) : null;

        const currentRosterId = teams
          ? resolveRosterForPick({
              pickNo: currentPick,
              teams,
              reversalRound,
              slotToRoster,
              tradedPickOwner,
              seasonStr,
            })
          : null;
        const nextRosterId = teams
          ? resolveRosterForPick({
              pickNo: currentPick + 1,
              teams,
              reversalRound,
              slotToRoster,
              tradedPickOwner,
              seasonStr,
            })
          : null;

        const currentOwnerName = currentRosterId ? getOwnerName(currentRosterId, rosterNames) : "—";
        const nextOwnerName = nextRosterId ? getOwnerName(nextRosterId, rosterNames) : "—";

        const onClockIsMe = !!(
          myRosterId &&
          currentRosterId &&
          String(myRosterId) === String(currentRosterId)
        );
        const onDeck = !!(myRosterId && nextRosterId && String(myRosterId) === String(nextRosterId));

        let myNextPickOverall = null;
        if (myRosterId && teams > 0) {
          const maxPk = rounds > 0 ? rounds * teams : currentPick + 500;
          for (let pk = currentPick; pk <= maxPk; pk++) {
            const rid = resolveRosterForPick({
              pickNo: pk,
              teams,
              reversalRound,
              slotToRoster,
              tradedPickOwner,
              seasonStr,
            });
            if (rid && String(rid) === String(myRosterId)) {
              myNextPickOverall = pk;
              break;
            }
          }
        }

        let myNextPickAfterThis = null;
        if (myRosterId && teams > 0) {
          const startPk = onClockIsMe ? currentPick + 1 : currentPick;
          const maxPk = rounds > 0 ? rounds * teams : startPk + 500;
          for (let pk = startPk; pk <= maxPk; pk++) {
            const rid = resolveRosterForPick({
              pickNo: pk,
              teams,
              reversalRound,
              slotToRoster,
              tradedPickOwner,
              seasonStr,
            });
            if (rid && String(rid) === String(myRosterId)) {
              myNextPickAfterThis = pk;
              break;
            }
          }
        }

        const picksUntilMyPick =
          myNextPickOverall != null ? Math.max(0, myNextPickOverall - currentPick) : null;

        const lastPickedMs = safeNum(draft?.last_picked || reg?.last_picked || 0);
        const totalMs = timerSec > 0 ? timerSec * 1000 : 0;
        const clockEndsAt =
          draftStatus === "drafting" && lastPickedMs > 0 && totalMs > 0 ? lastPickedMs + totalMs : 0;
        const clockLeftMs = clockEndsAt > 0 ? Math.max(0, clockEndsAt - nowMs) : 0;

        const perPickMs = totalMs > 0 ? totalMs : 90 * 1000;
        let etaMs = 0;
        if (picksUntilMyPick != null) {
          if (clockLeftMs > 0 && picksUntilMyPick > 0) {
            etaMs = clockLeftMs + Math.max(0, picksUntilMyPick - 1) * perPickMs;
          } else {
            etaMs = picksUntilMyPick * perPickMs;
          }
        }

        draftRows.push({
          leagueId: reg?.leagueId || reg?.league_id || lg?.league_id || null,
          leagueName: reg?.leagueName || reg?.league_name || lg?.name || "Unnamed League",
          season: seasonStr,
          draftId: String(lg?.draft_id || reg?.draft_id || ""),
          draftStatus,
          currentPick,
          currentOwnerName,
          nextOwnerName,
          clockLeftMs,
          onClockIsMe,
          onDeck,
          myNextPickOverall,
          myNextPickAfterThis,
          picksUntilMyPick,
          etaMs,
          timerSec: timerSec || null,
          teams: teams || null,
          rounds: rounds || null,
          reversalRound: reversalRound || 0,
          recent: [],
          computedAt: nowMs,
        });
      }

      setRows(draftRows);
    } catch (e) {
      console.error(e);
      setErr("Failed to load drafts from registry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!username) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const anyDrafting = useMemo(() => {
    const ACTIVE = new Set(["drafting", "paused"]);
    return (rows || []).some((r) => ACTIVE.has(String(r?.draftStatus || "").toLowerCase()));
  }, [rows]);

  useEffect(() => {
    if (!username) return;
    if (!autoRefresh) return;
    if (!anyDrafting) return;
    const t = setInterval(() => refresh(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, autoRefresh, anyDrafting]);

  // ---------------- Alerts: sound + title flash ----------------
  const alertEnabledRef = useRef(true);
  const lastAlertKeyRef = useRef("");
  const originalTitleRef = useRef(typeof document !== "undefined" ? document.title : "");
  const flashTimerRef = useRef(null);

  function beep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.06;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 180);
    } catch {}
  }

  function flashTitle(msg) {
    if (typeof document === "undefined") return;
    const base = originalTitleRef.current || document.title || "Draft Pick Tracker";
    let on = false;

    if (flashTimerRef.current) clearInterval(flashTimerRef.current);
    flashTimerRef.current = setInterval(() => {
      document.title = on ? `${msg} — ${base}` : base;
      on = !on;
    }, 900);

    setTimeout(() => {
      if (flashTimerRef.current) clearInterval(flashTimerRef.current);
      document.title = base;
    }, 12000);
  }

  useEffect(() => {
    if (!alertEnabledRef.current) return;
    if (!Array.isArray(rows) || rows.length === 0) return;

    const hot = rows
      .filter((r) => String(r.draftStatus || "") === "drafting")
      .filter((r) => r.onDeck || r.onClockIsMe);

    if (hot.length === 0) return;

    const best = hot.find((r) => r.onClockIsMe) || hot.find((r) => r.onDeck) || null;
    if (!best) return;

    const key = `${best.leagueId}|${best.currentPick}|${best.myNextPickOverall}|${
      best.onClockIsMe ? "clock" : "deck"
    }`;
    if (lastAlertKeyRef.current === key) return;

    lastAlertKeyRef.current = key;
    beep();
    flashTitle(best.onClockIsMe ? "ON CLOCK" : "ON DECK");
  }, [rows]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearInterval(flashTimerRef.current);
      if (typeof document !== "undefined" && originalTitleRef.current) {
        document.title = originalTitleRef.current;
      }
    };
  }, []);

  // ---------------- Live-time helpers ----------------
  const getAgeMs = (row) => {
    const computedAt = safeNum(row?.computedAt);
    return computedAt > 0 && now > 0 ? Math.max(0, now - computedAt) : 0;
  };

  const getLiveClockLeft = (row) => {
    const base = safeNum(row?.clockLeftMs);
    return Math.max(0, base - getAgeMs(row));
  };

  const getLiveEtaToShownPick = (row) => {
    const v = row?.etaMs;
    if (v == null) return Number.MAX_SAFE_INTEGER;
    const base = safeNum(v);
    return Math.max(0, base - getAgeMs(row));
  };

  // Bucket priority for sorting: On Clock (me) → On Deck → Drafting → Paused → Other
  const bucket = (row) => {
    if (row?.onClockIsMe) return 0;
    if (row?.onDeck) return 1;
    const st = String(row?.draftStatus || "").toLowerCase();
    if (st === "drafting") return 2;
    if (st === "paused") return 3;
    return 4;
  };

  // ---------------- Filters + sorting (bucket priority) ----------------
  const filteredDraftRows = useMemo(() => {
    const q = String(search || "").toLowerCase().trim();
    let r = rows || [];

    if (q) {
      r = r.filter((x) => String(x?.leagueName || "").toLowerCase().includes(q));
    }

    if (onlyDrafting) {
      r = r.filter((x) => {
        const st = String(x.draftStatus || "").toLowerCase();
        if (st === "drafting") return true;
        if (includePaused && st === "paused") return true;
        return false;
      });
    }

    if (onlyOnDeckOrClock) {
      r = r.filter((x) => x.onDeck || x.onClockIsMe);
    }

    if (maxPicksAway < 999) {
      r = r.filter((x) => {
        if (x?.onClockIsMe) return true;
        const upIn = x?.picksUntilMyPick;
        if (upIn == null) return false;
        return safeNum(upIn) <= safeNum(maxPicksAway);
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;

    r = [...r].sort((a, b) => {
      const ba = bucket(a);
      const bb = bucket(b);
      if (ba !== bb) return ba - bb;

      if (ba === 0 && bb === 0) {
        const acl = getLiveClockLeft(a);
        const bcl = getLiveClockLeft(b);
        if (acl !== bcl) return (acl - bcl) * dir;
        return String(a.leagueName || "").localeCompare(String(b.leagueName || "")) * dir;
      }

      const at = getLiveEtaToShownPick(a);
      const bt = getLiveEtaToShownPick(b);

      if (sortMode === "pick") {
        const av = safeNum(a.picksUntilMyPick);
        const bv = safeNum(b.picksUntilMyPick);
        if (av !== bv) return (av - bv) * dir;
        if (at !== bt) return (at - bt) * dir;
        return String(a.leagueName || "").localeCompare(String(b.leagueName || "")) * dir;
      }

      if (at !== bt) return (at - bt) * dir;

      const av = safeNum(a.picksUntilMyPick);
      const bv = safeNum(b.picksUntilMyPick);
      if (av !== bv) return (av - bv) * dir;

      return String(a.leagueName || "").localeCompare(String(b.leagueName || "")) * dir;
    });

    return r;
  }, [
    rows,
    now,
    search,
    onlyDrafting,
    includePaused,
    onlyOnDeckOrClock,
    maxPicksAway,
    sortMode,
    sortDir,
  ]);

  const totalLeagues = filteredDraftRows.length;

  const copyInviteLink = async (draftId) => {
    const url = `https://sleeper.com/draft/nfl/${String(draftId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast("Copied draft link");
    } catch {
      try {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setToast("Copied draft link");
      } catch {
        setToast("Copy failed");
      }
    }
    setTimeout(() => setToast(""), 1800);
  };

  return (
    <div className="min-h-screen">
      <BackgroundParticles />
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-24">
        {/* Toast */}
        {toast ? (
          <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-2xl border border-white/10 bg-black/70 px-4 py-2 text-sm text-white shadow-xl backdrop-blur">
            {toast}
          </div>
        ) : null}

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold text-white">Draft Pick Tracker</h2>
              <Pill tone="purple">LIVE</Pill>
              {anyDrafting ? <Pill tone="green">Drafts in progress</Pill> : <Pill tone="gray">No active drafts</Pill>}
            </div>
            <p className="text-gray-300 mt-1">
              Multi-league draft dashboard: on-deck alerts, accurate on-clock timers, traded-pick ownership, and recent picks.
            </p>
          </div>

          <div className="flex flex-col gap-2 items-start sm:items-end">
            <div className="flex gap-2">
              <button
                onClick={refresh}
                disabled={loading}
                className="px-5 py-2.5 rounded-2xl bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-700 disabled:opacity-60 text-white font-semibold shadow-[0_18px_40px_rgba(37,99,235,0.25)] border border-white/10"
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {/* keep your push UI */}
            <PushAlerts
              username={username}
              draftIds={(leagues || []).filter((l) => l?.draft_id).map((l) => String(l.draft_id))}
              selectedDraftIds={(leagues || []).filter((l) => l?.draft_id).map((l) => String(l.draft_id))}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="mt-6 rounded-3xl border border-white/10 bg-gradient-to-b from-gray-900/80 to-black/40 shadow-[0_20px_70px_rgba(0,0,0,0.45)] overflow-hidden">
          <div className="px-5 py-4 bg-black/20 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone="cyan">{totalLeagues} leagues</Pill>
              {includePaused && onlyDrafting && <Pill tone="yellow">Paused included</Pill>}
              {onlyOnDeckOrClock && <Pill tone="purple">Hot only</Pill>}
              {maxPicksAway >= 999 ? null : <Pill tone="blue">≤ {maxPicksAway} picks</Pill>}
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-2xl border border-white/10 bg-black/20 p-1">
                <button
                  onClick={() => setView("cards")}
                  className={classNames(
                    "px-4 py-2 rounded-xl text-sm font-semibold transition",
                    view === "cards" ? "bg-white/10 text-white" : "text-gray-200 hover:bg-white/5"
                  )}
                >
                  Cards
                </button>
                <button
                  onClick={() => setView("table")}
                  className={classNames(
                    "px-4 py-2 rounded-xl text-sm font-semibold transition",
                    view === "table" ? "bg-white/10 text-white" : "text-gray-200 hover:bg-white/5"
                  )}
                >
                  Table
                </button>
              </div>

              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={classNames(
                  "px-4 py-2 rounded-2xl text-sm font-semibold border border-white/10 bg-black/20 text-gray-200 hover:bg-white/5",
                  filtersOpen && "bg-white/10 border-white/20 text-white"
                )}
                aria-expanded={filtersOpen}
              >
                {filtersOpen ? "Close" : "Filters"}
              </button>
            </div>
          </div>

          {filtersOpen && (
            <div className="border-t border-white/10 p-5">
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className="xl:col-span-4">
                  <div className="text-xs text-gray-300 mb-2">Search</div>
                  <div className="relative">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search league…"
                      className="w-full px-4 py-3 rounded-2xl bg-black/30 border border-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-300/30 shadow-inner"
                    />
                    <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/5" />
                  </div>
                </div>

                <div className="xl:col-span-5">
                  <div className="text-xs text-gray-300 mb-2">Filters</div>
                  <div className="flex flex-wrap gap-2">
                    <Toggle checked={onlyDrafting} onChange={setOnlyDrafting} label="Drafting only" />
                    <Toggle
                      checked={includePaused}
                      onChange={setIncludePaused}
                      label="Include paused"
                      disabled={!onlyDrafting}
                    />
                    <Toggle checked={onlyOnDeckOrClock} onChange={setOnlyOnDeckOrClock} label="On deck / on clock" />
                    <Toggle checked={autoRefresh} onChange={setAutoRefresh} label="Auto-refresh" />
                  </div>
                </div>

                <div className="xl:col-span-3">
                  <div className="text-xs text-gray-300 mb-2">Sort & Window</div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-300">Next pick within</div>
                      <button
                        type="button"
                        onClick={() => setMaxPicksAway(999)}
                        className={classNames(
                          "px-3 py-1.5 rounded-xl text-xs font-semibold border transition",
                          maxPicksAway >= 999
                            ? "bg-white/10 border-white/20 text-white"
                            : "bg-black/30 border-white/10 text-gray-200 hover:text-white hover:bg-white/5"
                        )}
                        title="Turn off 'within N picks' filter"
                      >
                        {maxPicksAway >= 999 ? "Any" : `≤ ${maxPicksAway}`}
                      </button>
                    </div>

                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={Math.min(maxPicksAway, 30)}
                      onChange={(e) => setMaxPicksAway(Number(e.target.value))}
                      className="mt-2 w-full accent-cyan-300"
                      disabled={maxPicksAway >= 999}
                    />

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSortMode("time")}
                        className={classNames(
                          "flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition",
                          sortMode === "time"
                            ? "bg-white/10 border-white/20 text-white"
                            : "bg-black/30 border-white/10 text-gray-200 hover:bg-white/5"
                        )}
                      >
                        Time
                      </button>
                      <button
                        type="button"
                        onClick={() => setSortMode("pick")}
                        className={classNames(
                          "flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition",
                          sortMode === "pick"
                            ? "bg-white/10 border-white/20 text-white"
                            : "bg-black/30 border-white/10 text-gray-200 hover:bg-white/5"
                        )}
                      >
                        Pick
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                      className="mt-2 w-full px-3 py-2 rounded-xl text-xs font-semibold border border-white/10 bg-black/30 text-gray-200 hover:bg-white/5"
                    >
                      {sortDir === "asc" ? "▲ Asc" : "▼ Desc"}
                    </button>

                    <div className="mt-2 text-[11px] text-gray-400">
                      ON CLOCK rows always sort by <span className="text-gray-200">time left</span> (when timer exists).
                    </div>
                  </div>
                </div>
              </div>

              {err && <p className="text-red-300 mt-4">{err}</p>}
            </div>
          )}
        </div>

        {/* Card view */}
        {view === "cards" && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {filteredDraftRows.map((r, idx) => {
              const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
              const status = String(r?.draftStatus || "").toLowerCase();
              const isDrafting = status === "drafting";
              const isPaused = status === "paused";
              const hasTimer = safeNum(r.timerSec) > 0;

              const liveClockLeft = hasTimer
                ? isPaused
                  ? Math.max(0, safeNum(r.clockLeftMs))
                  : Math.max(0, safeNum(r.clockLeftMs) - elapsed)
                : 0;

              const clockText = isPaused ? "paused" : hasTimer ? msToClock(liveClockLeft) : "—";

              const shownPickNo = r.onClockIsMe ? r.myNextPickAfterThis : r.myNextPickOverall;

              const perPickMs = hasTimer ? safeNum(r.timerSec) * 1000 : 0;
              let liveEtaToShownPick = null;

              if (hasTimer && r.etaMs != null && shownPickNo != null && r.currentPick != null) {
                if (isDrafting && r.onClockIsMe) {
                  const gap = Math.max(0, safeNum(shownPickNo) - safeNum(r.currentPick) - 1);
                  liveEtaToShownPick = liveClockLeft + gap * perPickMs;
                } else {
                  liveEtaToShownPick = Math.max(0, safeNum(r.etaMs) - elapsed);
                }
              }

              const etaClock =
                isPaused ? "paused" : hasTimer && liveEtaToShownPick != null ? msToClock(liveEtaToShownPick) : "—";

              const statusTone =
                r.draftStatus === "drafting"
                  ? "green"
                  : r.draftStatus === "paused"
                  ? "yellow"
                  : r.draftStatus === "complete"
                  ? "gray"
                  : "yellow";

              const draftId = r?.draftId;

              const autoActive = (() => {
                const ts = autoByDraftId?.[String(draftId)];
                if (!ts) return false;
                return Date.now() - Number(ts) < 15 * 60 * 1000;
              })();

              const autoHeat = autoActive
                ? {
                    ring: "ring-red-400/70",
                    wash: "bg-red-500/10",
                    shake: "animate-pulse",
                  }
                : null;

              const deckTint = isDrafting && !r.onClockIsMe && r.onDeck ? onDeckTintStyles() : null;

              const clockHeat =
                r.onClockIsMe && hasTimer
                  ? onClockHeatStyles(
                      getOnClockHeatMsForUI({
                        isPaused,
                        liveClockLeft,
                        timerSec: r.timerSec,
                      }),
                      r.timerSec
                    )
                  : null;

              const shellRing =
                (autoHeat && autoHeat.ring) || (clockHeat && clockHeat.ring) || (deckTint && deckTint.ring) || "";
              const shellWash =
                (autoHeat && autoHeat.wash) || (clockHeat && clockHeat.wash) || (deckTint && deckTint.wash) || "";

              const timerLabel = formatTimerHoursLabel(r.timerSec);

              return (
                <div
                  key={r.__rowKey || r.draftId || r.leagueId || `row:${idx}`}
                  className={classNames(
                    "relative bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden",
                    shellWash,
                    shellRing,
                    (autoHeat && autoHeat.shake) || (clockHeat && clockHeat.shake) || ""
                  )}
                >
                  <style jsx>{`
                    @keyframes dpt_shake {
                      0%,
                      100% {
                        transform: translate3d(0, 0, 0) rotate(0deg);
                      }
                      25% {
                        transform: translate3d(0.6px, -0.4px, 0) rotate(-0.15deg);
                      }
                      50% {
                        transform: translate3d(-0.6px, 0.4px, 0) rotate(0.15deg);
                      }
                      75% {
                        transform: translate3d(0.4px, 0.6px, 0) rotate(-0.1deg);
                      }
                    }
                    .animate-[dpt_shake_0.9s_ease-in-out_infinite] {
                      animation: dpt_shake 0.9s ease-in-out infinite;
                    }
                  `}</style>

                  <div className="p-4 border-b border-white/10 bg-black/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-white font-semibold truncate">{r.leagueName}</div>
                          <Pill tone={statusTone} size="sm">
                            {r.draftStatus || "—"}
                          </Pill>

                          {r.onClockIsMe && (
                            <span className={classNames("inline-flex", hasTimer && !isPaused ? clockHeat?.shake : "")}>
                              <Pill tone={(hasTimer ? clockHeat?.badgeTone : "green") || "green"} size="sm">
                                ON CLOCK
                              </Pill>
                            </span>
                          )}

                          {isDrafting && !r.onClockIsMe && r.onDeck && (
                            <Pill tone="yellow" size="sm">
                              ON DECK
                            </Pill>
                          )}

                          {autoActive ? (
                            <Pill tone="red" size="sm">
                              🚨 AUTO
                            </Pill>
                          ) : null}
                        </div>

                        <div className="text-xs text-gray-400 mt-1">
                          {r.teams ? `${r.teams} teams` : "—"}
                          {r.rounds ? ` · ${r.rounds} rounds` : ""}
                          {timerLabel ? ` · ${timerLabel}` : ""}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        {r.onClockIsMe && (
                          <span className={classNames("inline-flex", hasTimer && !isPaused ? clockHeat?.shake : "")}>
                            <Pill tone={(hasTimer ? clockHeat?.badgeTone : "green") || "green"} size="lg">
                              <span className="tabular-nums font-extrabold tracking-wide">{clockText}</span>
                            </Pill>
                          </span>
                        )}

                        {!r.onClockIsMe && r.picksUntilMyPick != null && r.myNextPickOverall != null && (
                          <Pill tone={r.picksUntilMyPick <= 1 ? "yellow" : "cyan"} size="xs">
                            Up in {r.picksUntilMyPick}
                          </Pill>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                        <div className="text-xs text-gray-400">Current Pick</div>
                        <div className="text-white text-lg font-semibold truncate mt-0.5">
                          {r.currentOwnerName || "—"}
                        </div>

                        <div className="mt-1 flex items-center justify-between gap-3">
                          <div className="text-xs text-gray-400">
                            {r.currentPick ? `Pick #${nf0.format(r.currentPick)}` : "Pick —"}
                          </div>
                          {isDrafting && !isPaused ? (
                            <div className="text-xl text-white font-extrabold tabular-nums tracking-wide">{clockText}</div>
                          ) : r.draftStatus === "paused" ? (
                            <div className="text-xs text-yellow-200/80">paused</div>
                          ) : (
                            <div className="text-xs text-gray-500">—</div>
                          )}
                        </div>
                      </div>

                      <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                        <div className="text-xs text-gray-400">{r.onClockIsMe ? "Your Next Pick (after this)" : "Your Next Pick"}</div>
                        <div className="text-white text-lg font-semibold mt-0.5">
                          {shownPickNo ? `#${nf0.format(shownPickNo)}` : "—"}
                        </div>

                        <div className="mt-1 flex items-center justify-between gap-3">
                          <div className="text-xs text-gray-400">ETA</div>
                          <div className="text-xl text-white font-extrabold tabular-nums tracking-wide">{etaClock}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <a
                        href={`https://sleeper.com/draft/nfl/${String(r.draftId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2 rounded-2xl bg-cyan-500/90 text-black font-semibold hover:bg-cyan-400 border border-white/10"
                      >
                        Open Draft
                      </a>

                      <button
                        type="button"
                        onClick={() => copyInviteLink(r.draftId)}
                        className="px-4 py-2 rounded-2xl bg-white/10 text-white font-semibold hover:bg-white/15 border border-white/10"
                        title="Copy Sleeper draft link"
                      >
                        Copy Invite Link
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredDraftRows.length === 0 && (
              <div className="col-span-full bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl p-10 text-center text-gray-300">
                No leagues found. Try adjusting filters or hit Refresh.
              </div>
            )}
          </div>
        )}

        {/* Table view */}
        {view === "table" && (
          <div className="mt-6 bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-black/20">
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Pill tone="cyan">{totalLeagues} leagues</Pill>
                <Pill tone="blue">Sort: {sortMode}</Pill>
                {includePaused && onlyDrafting && <Pill tone="yellow">Showing paused</Pill>}
              </div>
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-black/20 text-gray-200">
                  <tr>
                    <th className="px-5 py-3 text-left">League</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-left">Current</th>
                    <th className="px-5 py-3 text-left">Your Next</th>
                    <th className="px-5 py-3 text-left">Up In</th>
                    <th className="px-5 py-3 text-left">ETA</th>
                    <th className="px-5 py-3 text-left">Links</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredDraftRows.map((r, idx) => {
                    const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
                    const status = String(r?.draftStatus || "").toLowerCase();
                    const isDrafting = status === "drafting";
                    const isPaused = status === "paused";
                    const hasTimer = safeNum(r.timerSec) > 0;

                    const liveClockLeft = hasTimer
                      ? isPaused
                        ? Math.max(0, safeNum(r.clockLeftMs))
                        : Math.max(0, safeNum(r.clockLeftMs) - elapsed)
                      : 0;

                    const clockText = isPaused ? "paused" : hasTimer ? msToClock(liveClockLeft) : "—";

                    const shownPickNo = r.onClockIsMe ? r.myNextPickAfterThis : r.myNextPickOverall;

                    const perPickMs = hasTimer ? safeNum(r.timerSec) * 1000 : 0;
                    let liveEta = null;
                    if (hasTimer && r.etaMs != null && shownPickNo != null && r.currentPick != null) {
                      if (isDrafting && r.onClockIsMe) {
                        const gap = Math.max(0, safeNum(shownPickNo) - safeNum(r.currentPick) - 1);
                        liveEta = liveClockLeft + gap * perPickMs;
                      } else {
                        liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);
                      }
                    }

                    const etaClock = isPaused ? "paused" : hasTimer && liveEta != null ? msToClock(liveEta) : "—";

                    const statusTone =
                      r.draftStatus === "drafting"
                        ? "green"
                        : r.draftStatus === "paused"
                        ? "yellow"
                        : r.draftStatus === "complete"
                        ? "gray"
                        : "yellow";

                    const timerLabel = formatTimerHoursLabel(r.timerSec);

                    const autoActive = (() => {
                      const ts = autoByDraftId?.[String(r.draftId)];
                      if (!ts) return false;
                      return Date.now() - Number(ts) < 15 * 60 * 1000;
                    })();

                    return (
                      <tr
                        key={r.__rowKey || r.draftId || r.leagueId || `row:${idx}`}
                        className={classNames(
                          "border-t border-white/5 hover:bg-white/5",
                          isDrafting && !r.onClockIsMe && r.onDeck && "bg-amber-500/5"
                        )}
                      >
                        <td className="px-5 py-4">
                          <div>
                            <div className="text-white font-semibold">{r.leagueName}</div>
                            <div className="text-xs text-gray-400">
                              {r.teams ? `${r.teams} teams` : "—"}
                              {r.rounds ? ` · ${r.rounds} rounds` : ""}
                              {timerLabel ? ` · ${timerLabel}` : ""}
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Pill tone={statusTone} size="sm">
                              {r.draftStatus || "—"}
                            </Pill>
                            {autoActive ? (
                              <Pill tone="red" size="sm">
                                🚨 AUTO
                              </Pill>
                            ) : null}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-gray-100">{r.currentOwnerName || "—"}</span>
                              {r.onClockIsMe ? (
                                <Pill tone={hasTimer ? onClockHeatStyles(getOnClockHeatMsForUI({ isPaused, liveClockLeft, timerSec: r.timerSec }), r.timerSec)?.badgeTone : "green"} size="xs">
                                  ON CLOCK
                                </Pill>
                              ) : null}
                              {isDrafting && !r.onClockIsMe && r.onDeck ? (
                                <Pill tone="yellow" size="xs">
                                  ON DECK
                                </Pill>
                              ) : null}
                            </div>

                            <span className="text-xs text-gray-400 tabular-nums flex items-center gap-2">
                              <span>{r.currentPick ? `#${nf0.format(r.currentPick)}` : "—"}</span>
                              {isDrafting && !isPaused ? (
                                <span className="text-lg font-extrabold text-white tabular-nums tracking-wide">{clockText}</span>
                              ) : r.draftStatus === "paused" ? (
                                <span className="text-yellow-200/80">paused</span>
                              ) : null}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          {shownPickNo ? (
                            <Pill tone="purple" size="sm">
                              #{nf0.format(shownPickNo)}
                            </Pill>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          {r.picksUntilMyPick != null ? (
                            <Pill tone={r.picksUntilMyPick <= 1 ? "yellow" : "cyan"} size="sm">
                              {r.picksUntilMyPick}
                            </Pill>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex flex-col">
                            <span className="text-lg text-white font-extrabold tabular-nums tracking-wide">{etaClock}</span>
                            <span className="text-xs text-gray-400">{hasTimer ? "timer-based" : "no timer"}</span>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={`https://sleeper.com/draft/nfl/${String(r.draftId)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-xl bg-cyan-500/90 px-3 py-1.5 text-xs font-semibold text-black hover:bg-cyan-400 border border-white/10"
                            >
                              Open
                            </a>
                            <button
                              type="button"
                              onClick={() => copyInviteLink(r.draftId)}
                              className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 border border-white/10"
                            >
                              Copy
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredDraftRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-gray-300">
                        No leagues found. Try adjusting filters or hit Refresh.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-4 border-t border-white/10 text-xs text-gray-400">
              Tip: Current pick owner and your next pick both account for traded pick ownership.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}