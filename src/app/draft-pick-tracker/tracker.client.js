"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function safeNum(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function msToHuman(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
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

function Pill({ children, tone = "blue" }) {
  const tones = {
    blue: "bg-blue-500/20 text-blue-200 border-blue-400/30",
    green: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
    yellow: "bg-yellow-500/20 text-yellow-200 border-yellow-400/30",
    red: "bg-red-500/20 text-red-200 border-red-400/30",
    cyan: "bg-cyan-500/20 text-cyan-200 border-cyan-400/30",
    purple: "bg-purple-500/20 text-purple-200 border-purple-400/30",
    gray: "bg-white/5 text-gray-200 border-white/10",
  };
  return (
    <span
      className={classNames(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs border",
        tones[tone] || tones.gray
      )}
    >
      {children}
    </span>
  );
}

function getHeatTier(etaMs) {
  const ms = safeNum(etaMs);

  // If ETA is missing/invalid/zero, do NOT heat up.
  // (This is what’s causing the “1h48m but red” bug.)
  if (!Number.isFinite(ms) || ms <= 0) return "cool";

  const m = Math.floor(ms / 60000);

  if (m <= 10) return "hot";
  if (m <= 30) return "warm";
  return "cool";
}

function heatStyles(tier, isDrafting, flashHot) {
  // only “heat up” visuals during active drafting
  if (!isDrafting) return { ring: "", wash: "", badge: null };

  if (tier === "hot") {
    const ringBase =
      "ring-2 ring-red-400/40 border-red-400/20 shadow-[0_0_0_1px_rgba(248,113,113,0.22),0_0_30px_rgba(248,113,113,0.18)]";
    const washBase =
      "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-red-500/15 before:via-transparent before:to-transparent before:pointer-events-none";

    return {
      ring: flashHot ? `${ringBase} animate-[pulse_1.2s_ease-in-out_infinite]` : ringBase,
      wash: flashHot ? `${washBase} before:animate-[pulse_1.2s_ease-in-out_infinite]` : washBase,
      badge: flashHot ? <Pill tone="red">🔥 SOON</Pill> : null, // badge ONLY at <=10m
    };
  }

  if (tier === "warm") {
    return {
      ring: "ring-1 ring-orange-300/25 border-orange-300/15 shadow-[0_0_0_1px_rgba(251,146,60,0.14),0_0_18px_rgba(251,146,60,0.10)]",
      wash: "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-orange-400/10 before:via-transparent before:to-transparent before:pointer-events-none",
      badge: null, // no badge at 10–30 unless you want one
    };
  }

  return { ring: "", wash: "", badge: null };
}

function SortHeader({ label, col, sortKey, sortDir, setSortKey, setSortDir }) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => {
        if (active) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else {
          setSortKey(col);
          setSortDir("asc");
        }
      }}
      className={classNames(
        "text-left w-full flex items-center gap-2",
        active ? "text-white" : "text-gray-300 hover:text-white"
      )}
    >
      <span>{label}</span>
      {active && (
        <span className="text-xs opacity-80">{sortDir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
  );
}

// ---------------- Main ----------------

export default function DraftPickTrackerClient() {
  const { username, leagues, year, players } = useSleeper();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [search, setSearch] = useState("");
  const [onlyDrafting, setOnlyDrafting] = useState(true);
  const [includePaused, setIncludePaused] = useState(false);

  const [view, setView] = useState("cards"); // cards | table
  const [onlyOnDeckOrClock, setOnlyOnDeckOrClock] = useState(false);
  const [maxPicksAway, setMaxPicksAway] = useState(30); // 999 = off
  const [autoRefresh, setAutoRefresh] = useState(true);

  // removed pace sorting; default to "picks until" then ETA
  const [sortKey, setSortKey] = useState("etaMs");
  const [sortDir, setSortDir] = useState("asc");

  const [rows, setRows] = useState([]); // computed draft rows
  const [bundles, setBundles] = useState([]); // cached bundles

  // per-league expand/collapse for recent picks
  const [expandedRecent, setExpandedRecent] = useState({}); // { [leagueId]: boolean }
  const [expandedSettings, setExpandedSettings] = useState({}); // { [leagueId]: boolean }
  const [showRecent, setShowRecent] = useState({}); // { [leagueId]: boolean }

  // ticker so clocks count down without refetching
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------------- Helpers ----------------

  function getUserRosterIdForLeague(rosterByUsernameObj) {
    const uname = String(username || "").toLowerCase().trim();
    if (!uname) return null;

    const m = rosterByUsernameObj || {};
    const rid = m?.[uname];
    return rid != null ? String(rid) : null;
  }

  function playerLabel(pid) {
    const p = players?.[String(pid)];
    const name =
      String(p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`)
        .trim() || `#${pid}`;
    const pos = String(p?.position || "").trim();
    return pos ? `${name} (${pos})` : name;
  }

  function getEtaDisplay(r, liveClockLeft, liveEta) {
    const isDrafting = String(r?.draftStatus || "").toLowerCase() === "drafting";

    // If you're on the clock and draft is active: show the clock countdown for THIS pick.
    if (isDrafting && r?.onClockIsMe && liveClockLeft > 0) {
      return {
        label: "ON CLOCK",
        primary: msToClock(liveClockLeft),
        secondary: "Time left for your pick",
        mode: "clock",
      };
    }

    // Otherwise: show ETA until your next pick (if you have one).
    if (r?.myNextPickOverall != null) {
      return {
        label: "ETA",
        primary: msToHuman(liveEta),
        secondary: `League timer: ${r?.timerSec ? msToClock(r.timerSec * 1000) : "—"}`,
        mode: "eta",
      };
    }

    return { label: "ETA", primary: "—", secondary: "", mode: "none" };
  }

  function buildTradedPickOwnerMap(tradedPicksObj = {}) {
    // already keyed as `${season}|${round}|${origRosterId}` => ownerRosterId
    return new Map(Object.entries(tradedPicksObj || {}));
  }

  function getSnakeSlotForPick({ pickNo, teams, reversalRound }) {
    if (!pickNo || !teams) return null;

    const idx0 = pickNo - 1;
    const round = Math.floor(idx0 / teams) + 1;
    const pickInRound0 = idx0 % teams;

    // Direction handling:
    // - Normal snake flips every round (1 forward, 2 reverse, 3 forward...)
    // - 3RR (third-round reversal) means round 3 stays the SAME direction as round 2.
    const rr = safeNum(reversalRound);
    let forward = true; // round 1

    if (round > 1) {
      for (let r = 2; r <= round; r++) {
        if (rr > 0 && r === rr) {
          // skip flip on reversal round (3RR behavior)
        } else {
          forward = !forward;
        }
      }
    }

    const slot = forward ? pickInRound0 + 1 : teams - pickInRound0;
    return { round, slot };
  }

  function resolveRosterForPick({
    pickNo,
    teams,
    rosterBySlot,
    tradedOwnerMap,
    seasonStr,
    reversalRound,
  }) {
    if (!pickNo || !teams) return null;

    const rs = getSnakeSlotForPick({ pickNo, teams, reversalRound });
    if (!rs) return null;

    const { round, slot } = rs;

    const origRosterId = rosterBySlot.get(slot) || null;
    if (!origRosterId) return null;

    const tradedOwner =
      tradedOwnerMap?.get(`${seasonStr}|${round}|${String(origRosterId)}`) || null;

    return tradedOwner || String(origRosterId);
  }

  function getPickOwnerName({
    pickNo,
    teams,
    rosterBySlot,
    tradedOwnerMap,
    seasonStr,
    reversalRound,
    rosterNameMap,
  }) {
    const rid = resolveRosterForPick({
      pickNo,
      teams,
      rosterBySlot,
      tradedOwnerMap,
      seasonStr,
      reversalRound,
    });
    if (!rid) return null;
    return rosterNameMap?.get(String(rid)) || `Roster ${rid}`;
  }

  function calcPickInfo(bundle, nowMs) {
    const league = bundle?.league;
    const draft = bundle?.draft;

    const pickCount = safeNum(bundle?.pickCount);
    const lastPickedMs = safeNum(bundle?.lastPicked || draft?.last_picked);
    const draftStatus = String(draft?.status || "").toLowerCase();

    const teamsFromReg = safeNum(bundle?.teams);
    const roundsFromReg = safeNum(bundle?.rounds);
    const timerSec = safeNum(bundle?.timerSec);
    const reversalRound = safeNum(bundle?.reversalRound);

    const scoringType =
      String(draft?.metadata?.scoring_type || league?.settings?.scoring_type || "")
        .trim() || null;

    const currentPick = pickCount + 1;

    const rosterNamesObj = bundle?.rosterNames || {};
    const rosterNameMap = new Map(Object.entries(rosterNamesObj || {}));

    // slot -> roster_id map
    const rosterBySlot = new Map();
    const slotToRosterObj = bundle?.slotToRoster || {};
    Object.keys(slotToRosterObj || {}).forEach((slot) => {
      const rosterId = slotToRosterObj[slot];
      const s = safeNum(slot);
      if (s && rosterId != null) rosterBySlot.set(s, String(rosterId));
    });

    const seasonStr = String(draft?.season || league?.season || year || "");
    const tradedOwnerMap = buildTradedPickOwnerMap(bundle?.tradedPickOwners || {});

    const teams = teamsFromReg || rosterBySlot.size || 0;
    const rounds = roundsFromReg || safeNum(draft?.settings?.rounds) || 0;

    const currentOwnerName = teams
      ? getPickOwnerName({
          pickNo: currentPick,
          teams,
          rosterBySlot,
          tradedOwnerMap,
          seasonStr,
          reversalRound,
          rosterNameMap,
        })
      : null;

    const nextOwnerName = teams
      ? getPickOwnerName({
          pickNo: currentPick + 1,
          teams,
          rosterBySlot,
          tradedOwnerMap,
          seasonStr,
          reversalRound,
          rosterNameMap,
        })
      : null;

    const nextRosterId = teams
      ? resolveRosterForPick({
          pickNo: currentPick,
          teams,
          rosterBySlot,
          tradedOwnerMap,
          seasonStr,
          reversalRound,
        })
      : null;

    const myRosterId = getUserRosterIdForLeague(bundle?.rosterByUsername || {});

    // Find my next pick overall (account for traded ownership)
    let myNextPickOverall = null;
    if (myRosterId && teams > 0) {
      const maxPk = rounds > 0 && teams > 0 ? rounds * teams : currentPick + 500;
      for (let pk = currentPick; pk <= maxPk; pk++) {
        const rosterIdAtPick = resolveRosterForPick({
          pickNo: pk,
          teams,
          rosterBySlot,
          tradedOwnerMap,
          seasonStr,
          reversalRound,
        });
        if (String(rosterIdAtPick || "") === String(myRosterId)) {
          myNextPickOverall = pk;
          break;
        }
      }
    }

    const picksUntilMyPick =
      myNextPickOverall != null
        ? Math.max(0, myNextPickOverall - currentPick)
        : null;

    const onDeck = picksUntilMyPick === 1;
    const onClockIsMe = !!(
      myRosterId &&
      nextRosterId &&
      String(nextRosterId) === String(myRosterId)
    );

    // If I'm currently on the clock, also find my *next* pick AFTER this one
    let myNextPickAfterThis = null;
    if (myRosterId && teams > 0) {
      const startPk = onClockIsMe ? currentPick + 1 : currentPick;
      const maxPk = rounds > 0 && teams > 0 ? rounds * teams : startPk + 500;

      for (let pk = startPk; pk <= maxPk; pk++) {
        const rosterIdAtPick = resolveRosterForPick({
          pickNo: pk,
          teams,
          rosterBySlot,
          tradedOwnerMap,
          seasonStr,
          reversalRound,
        });

        if (String(rosterIdAtPick || "") === String(myRosterId)) {
          myNextPickAfterThis = pk;
          break;
        }
      }
    }

    // Clock left
    const clockEndsAt =
      lastPickedMs > 0 && timerSec > 0 ? lastPickedMs + timerSec * 1000 : 0;
    const clockLeftMs = clockEndsAt > 0 ? Math.max(0, clockEndsAt - nowMs) : 0;

    // ETA uses ONLY timer (no pace)
    const perPickMs = timerSec > 0 ? timerSec * 1000 : 90 * 1000;

    let etaMs = 0;
    if (picksUntilMyPick != null) {
      if (clockLeftMs > 0 && picksUntilMyPick > 0) {
        etaMs = clockLeftMs + Math.max(0, picksUntilMyPick - 1) * perPickMs;
      } else {
        etaMs = picksUntilMyPick * perPickMs;
      }
    }

    // Recent picks (we don't keep pick lists in registry to avoid huge payloads)
    // Keep UI stable: show none (or you can re-add "recent" via a separate endpoint later).
    const recent = [];

    return {
      leagueId: league?.league_id,
      leagueName: league?.name || "Unnamed League",
      season: league?.season || year,
      draftId: draft?.draft_id || league?.draft_id,
      draftStatus,
      currentPick,
      currentOwnerName: currentOwnerName || "—",
      nextOwnerName: nextOwnerName || "—",
      clockLeftMs,
      onClockIsMe,
      onDeck,
      myNextPickOverall,
      myNextPickAfterThis,
      picksUntilMyPick,
      etaMs,
      timerSec,
      teams,
      rounds,
      recent,
      computedAt: nowMs,
      draftType: String(draft?.type || "").toLowerCase(),
      scoringType,
      startTimeMs: safeNum(draft?.start_time),
      createdMs: safeNum(draft?.created),
      lastPickedMs,
      reversalRound: reversalRound || 0,
    };
  }

  async function registerDraftsInRegistry(leagueList) {
    try {
      const items = (leagueList || [])
        .filter((lg) => !!lg?.draft_id)
        .map((lg) => ({
          draft_id: String(lg.draft_id),
          league_id: lg?.league_id != null ? String(lg.league_id) : null,
          league_name: lg?.name != null ? String(lg.name) : null,
          league_avatar: lg?.avatar
            ? `https://sleepercdn.com/avatars/thumbs/${lg.avatar}`
            : null,
        }));

      if (!items.length) return;

      await fetch("/api/draft-pick-tracker/registry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
    } catch {
      // ignore
    }
  }

  // ---------------- Refresh ----------------

  async function refresh() {
    setErr("");
    setLoading(true);
    try {
      const eligible = (leagues || []).filter((lg) => !!lg?.draft_id);
      const draftIds = eligible.map((l) => String(l.draft_id)).filter(Boolean);

      if (!draftIds.length) {
        setBundles([]);
        setRows([]);
        return;
      }

      // Pull shared draft state + context from the registry (D1) instead of polling Sleeper per user.
      // (This keeps the UI fast even when many people share the same leagues.)
      const res = await fetch(
        `/api/draft-pick-tracker/registry?draft_ids=${encodeURIComponent(
          draftIds.join(",")
        )}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("registry fetch failed");
      const data = await res.json();
      const registry = data?.rows || {};

      // Build "bundle" objects that match calcPickInfo() expectations.
      const nextBundles = [];
      for (const lg of eligible) {
        const draftId = String(lg?.draft_id || "");
        const reg = registry?.[draftId];
        if (!draftId || !reg?.draft) continue;

        nextBundles.push({
          league: lg,
          draft: reg.draft,
          pickCount: safeNum(reg.pickCount),
          lastPicked: safeNum(reg.lastPicked),
          teams: safeNum(reg.teams),
          rounds: safeNum(reg.rounds),
          timerSec: safeNum(reg.timerSec),
          reversalRound: safeNum(reg.reversalRound),
          slotToRoster: reg.slotToRoster || {},
          rosterNames: reg.rosterNames || {},
          rosterByUsername: reg.rosterByUsername || {},
          tradedPickOwners: reg.tradedPickOwners || {},
        });
      }

      const nowMs = Date.now(); // critical: prevents stale-now auto-refresh drift
      const draftRows = nextBundles.map((b) => calcPickInfo(b, nowMs));

      setBundles(nextBundles);
      setRows(draftRows);
    } catch (e) {
      console.error(e);
      setErr("Failed to load drafts. Try refresh.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!username) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // Ensure the shared registry knows about the drafts you can see (non-blocking).
  useEffect(() => {
    if (!username) return;
    if (!Array.isArray(leagues) || leagues.length === 0) return;
    registerDraftsInRegistry(leagues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, leagues]);

  // ---------------- Filters + sorting ----------------

  const filteredDraftRows = useMemo(() => {
    const q = String(search || "").toLowerCase().trim();
    let r = rows || [];

    if (onlyDrafting) {
      r = r.filter((x) => {
        const st = String(x.draftStatus || "").toLowerCase();
        if (st === "drafting") return true;
        if (includePaused && st === "paused") return true;
        return false;
      });
    }

    if (onlyOnDeckOrClock) {
      r = r.filter((x) => !!x.onDeck || !!x.onClockIsMe);
    }

    if (maxPicksAway < 999) {
      r = r.filter((x) => {
        const pu = safeNum(x.picksUntilMyPick);
        if (x.myNextPickOverall == null) return false;
        return pu <= maxPicksAway;
      });
    }

    if (q) {
      r = r.filter((x) => {
        return (
          String(x.leagueName || "").toLowerCase().includes(q) ||
          String(x.nextOwnerName || "").toLowerCase().includes(q) ||
          String(x.myNextPickOverall || "").includes(q)
        );
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      const av = a?.[sortKey];
      const bv = b?.[sortKey];
      if (typeof av === "string" || typeof bv === "string") {
        return String(av || "").localeCompare(String(bv || "")) * dir;
      }
      return (safeNum(av) - safeNum(bv)) * dir;
    });

    return r;
  }, [
    rows,
    search,
    onlyDrafting,
    includePaused,
    onlyOnDeckOrClock,
    maxPicksAway,
    sortKey,
    sortDir,
  ]);

  const anyDrafting = useMemo(
    () => (rows || []).some((r) => String(r?.draftStatus) === "drafting"),
    [rows]
  );

  // ---------------- Auto-refresh ----------------
  // active drafting only (paused doesn't keep polling)

  useEffect(() => {
    if (!username) return;
    if (!autoRefresh) return;
    if (!anyDrafting) return;

    const t = setInterval(() => {
      refresh();
    }, 20000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, autoRefresh, anyDrafting]);

  // ---------------- Alerts: sound + title flash ----------------

  const alertEnabledRef = useRef(true);
  const lastAlertKeyRef = useRef("");
  const originalTitleRef = useRef(
    typeof document !== "undefined" ? document.title : ""
  );
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
    const base =
      originalTitleRef.current || document.title || "Draft Pick Tracker";
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
      .filter((r) => r.draftStatus === "drafting")
      .filter((r) => r.onDeck || r.onClockIsMe);

    if (hot.length === 0) return;

    const best =
      hot.find((r) => r.onClockIsMe) || hot.find((r) => r.onDeck) || null;
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

  // ---------------- UI bits ----------------

  const totalLeagues = filteredDraftRows.length;

  return (
    <div className="mt-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold text-white">Draft Pick Tracker</h2>
            <Pill tone="purple">LIVE</Pill>
            {anyDrafting ? (
              <Pill tone="green">Drafts in progress</Pill>
            ) : (
              <Pill tone="gray">No active drafts</Pill>
            )}
          </div>
          <p className="text-gray-300 mt-1">
            Multi-league draft dashboard: on-deck alerts, accurate on-clock timers,
            traded-pick ownership, and expandable recent picks.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold shadow-lg"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-6 bg-gray-900/70 border border-white/10 rounded-2xl p-4 shadow-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search league / next up / your pick…"
              className="w-full sm:w-[360px] px-4 py-2 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />

            <div className="flex flex-wrap gap-2 items-center">
              <label className="inline-flex items-center gap-2 text-gray-200 select-none">
                <input
                  type="checkbox"
                  checked={onlyDrafting}
                  onChange={(e) => setOnlyDrafting(e.target.checked)}
                />
                Drafting only
              </label>

              <label className="inline-flex items-center gap-2 text-gray-200 select-none">
                <input
                  type="checkbox"
                  checked={includePaused}
                  onChange={(e) => setIncludePaused(e.target.checked)}
                  disabled={!onlyDrafting}
                />
                Include paused
              </label>

              <label className="inline-flex items-center gap-2 text-gray-200 select-none">
                <input
                  type="checkbox"
                  checked={onlyOnDeckOrClock}
                  onChange={(e) => setOnlyOnDeckOrClock(e.target.checked)}
                />
                On deck / on clock
              </label>

              <label className="inline-flex items-center gap-2 text-gray-200 select-none">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-refresh
              </label>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-300 whitespace-nowrap">
                Next pick within:
              </span>
              <input
                type="range"
                min={1}
                max={30}
                value={Math.min(maxPicksAway, 30)}
                onChange={(e) => setMaxPicksAway(Number(e.target.value))}
                className="w-[160px]"
              />
              <button
                type="button"
                onClick={() => setMaxPicksAway(999)}
                className={classNames(
                  "px-3 py-1.5 rounded-xl text-xs font-semibold border transition",
                  maxPicksAway >= 999
                    ? "bg-white/10 border-white/20 text-white"
                    : "bg-black/20 border-white/10 text-gray-300 hover:text-white"
                )}
                title="Turn off 'within N picks' filter"
              >
                {maxPicksAway >= 999 ? "Any" : `≤ ${maxPicksAway}`}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setView("cards")}
                className={classNames(
                  "px-4 py-2 rounded-xl border text-sm font-semibold transition",
                  view === "cards"
                    ? "bg-white/10 border-white/20 text-white"
                    : "bg-black/20 border-white/10 text-gray-200 hover:bg-white/5"
                )}
              >
                Cards
              </button>
              <button
                onClick={() => setView("table")}
                className={classNames(
                  "px-4 py-2 rounded-xl border text-sm font-semibold transition",
                  view === "table"
                    ? "bg-white/10 border-white/20 text-white"
                    : "bg-black/20 border-white/10 text-gray-200 hover:bg-white/5"
                )}
              >
                Table
              </button>
            </div>
          </div>
        </div>

        {err && <p className="text-red-300 mt-3">{err}</p>}
      </div>

      {/* Card view */}
      {view === "cards" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {filteredDraftRows.map((r) => {
            const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
            const liveClockLeft = Math.max(0, safeNum(r.clockLeftMs) - elapsed);
            const clockText = liveClockLeft > 0 ? msToClock(liveClockLeft) : null;

            const liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);
            const isDrafting = String(r.draftStatus || "").toLowerCase() === "drafting";
            const hasMyPick = r.myNextPickOverall != null;
            const heatTier = getHeatTier(hasMyPick ? liveEta : NaN);

            // Flash ONLY when ETA <= 10 minutes (and you actually have a next pick)
            const flashHot = isDrafting && hasMyPick && heatTier === "hot";

            const heat = heatStyles(heatTier, isDrafting && hasMyPick, flashHot);

            const statusTone =
              r.draftStatus === "drafting"
                ? "green"
                : r.draftStatus === "paused"
                ? "yellow"
                : r.draftStatus === "complete"
                ? "gray"
                : "yellow";

            const upIn = r.picksUntilMyPick != null ? r.picksUntilMyPick : null;

            const isExpanded = !!expandedRecent[r.leagueId];
            const recentToShow = isExpanded ? (r.recent || []) : (r.recent || []).slice(0, 3);

            return (
              <div
                key={r.leagueId}
                className={classNames(
                  "relative bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden",
                  heat.wash,
                  heat.ring,
                  (r.onClockIsMe || r.onDeck) &&
                    r.draftStatus === "drafting" &&
                    "ring-1 ring-emerald-400/30"
                )}
              >
                <div className="p-4 border-b border-white/10 bg-black/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-white font-semibold truncate">{r.leagueName}</div>
                        <Pill tone={statusTone}>{r.draftStatus || "—"}</Pill>
                        {heat.badge}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {r.teams ? `${r.teams} teams` : "—"}
                        {r.rounds ? ` · ${r.rounds} rounds` : ""}
                        {r.timerSec ? ` · ${r.timerSec}s timer` : ""}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {r.draftStatus === "drafting" && r.onClockIsMe && clockText && (
                        <Pill tone="green">ON CLOCK · {clockText}</Pill>
                      )}
                      {r.draftStatus === "drafting" && !r.onClockIsMe && r.onDeck && (
                        <Pill tone="yellow">ON DECK</Pill>
                      )}
                      {upIn != null && upIn >= 0 && (
                        upIn === 0 ? (
                          <Pill tone="green">YOUR PICK!</Pill>
                        ) : (
                          <Pill tone={upIn <= 1 ? "yellow" : "cyan"}>
                            Up in {upIn} pick{upIn === 1 ? "" : "s"}
                          </Pill>
                        )
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Current Pick */}
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">Current Pick</div>
                      <div className="text-white text-lg font-semibold">
                        {r.currentPick ? `#${nf0.format(r.currentPick)}` : "—"}
                      </div>
                      <div className="text-sm text-gray-200 truncate mt-0.5">
                        {r.currentOwnerName || "—"}
                      </div>

                      {r.draftStatus === "drafting" && clockText && (
                        <div className="text-xs text-gray-400 mt-1">{clockText} left</div>
                      )}
                      {r.draftStatus === "paused" && (
                        <div className="text-xs text-yellow-200/80 mt-1">Draft paused</div>
                      )}
                    </div>

                    {/* Who’s Next */}
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">Who’s Next?</div>
                      <div className="text-white text-lg font-semibold truncate">
                        {r.nextOwnerName || "—"}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {(() => {
                          const shown = r.onClockIsMe ? r.myNextPickAfterThis : r.myNextPickOverall;
                          return shown ? `Your next: #${nf0.format(shown)}` : "Your next: —";
                        })()}
                      </div>
                    </div>

                    {/* ETA / On-clock timer (live) */}
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      {(() => {
                        const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
                        const liveClockLeft = Math.max(0, safeNum(r.clockLeftMs) - elapsed);
                        const liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);

                        const d = getEtaDisplay(r, liveClockLeft, liveEta);

                        return (
                          <>
                            <div className="text-xs text-gray-400">{d.label}</div>
                            <div className="text-white text-lg font-semibold">{d.primary}</div>

                            {d.secondary ? (
                              <div className="text-xs text-gray-400 mt-1">{d.secondary}</div>
                            ) : null}

                            {d.mode === "clock" && r.myNextPickAfterThis ? (
                              <div className="text-xs text-gray-400 mt-1">
                                Next after this: #{nf0.format(r.myNextPickAfterThis)}
                              </div>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>

                    {/* League Settings (click-to-expand) */}
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSettings((prev) => ({
                            ...prev,
                            [r.leagueId]: !prev?.[r.leagueId],
                          }))
                        }
                        className="w-full text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-gray-400">League Settings</div>
                          <span className="text-xs text-gray-300">
                            {expandedSettings[r.leagueId] ? "▲" : "▼"}
                          </span>
                        </div>

                        <div className="text-white text-lg font-semibold mt-0.5">
                          {r.teams ? `${r.teams} teams` : "—"}
                          {r.rounds ? ` · ${r.rounds} rounds` : ""}
                        </div>

                        <div className="text-xs text-gray-400 mt-1">
                          Timer: {r.timerSec ? `${r.timerSec}s` : "—"}
                        </div>
                      </button>

                      {expandedSettings[r.leagueId] && (
                        <div className="mt-3 text-xs text-gray-300 space-y-1">
                          <div>Season: {r.season || "—"}</div>
                          <div>Draft type: {r.draftType || "—"}</div>
                          <div>Scoring: {r.scoringType || "—"}</div>
                          <div>3RR: {r.reversalRound ? `Yes (round ${r.reversalRound})` : "No"}</div>
                          <div>Draft ID: {r.draftId || "—"}</div>
                          <div>
                            Start time:{" "}
                            {r.startTimeMs ? new Date(r.startTimeMs).toLocaleString() : "—"}
                          </div>
                          <div>
                            Last pick:{" "}
                            {r.lastPickedMs ? new Date(r.lastPickedMs).toLocaleString() : "—"}
                          </div>
                          <div>
                            Current pick #: {r.currentPick ? nf0.format(r.currentPick) : "—"}
                          </div>
                          <div>
                            Your current/next pick #:{" "}
                            {r.myNextPickOverall ? nf0.format(r.myNextPickOverall) : "—"}
                            {r.onClockIsMe && r.myNextPickAfterThis
                              ? ` (next after this: ${nf0.format(r.myNextPickAfterThis)})`
                              : ""}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 bg-black/20 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-white font-semibold">Recent picks</div>

                      <button
                        type="button"
                        onClick={() =>
                          setShowRecent((prev) => ({
                            ...prev,
                            [r.leagueId]: !prev?.[r.leagueId],
                          }))
                        }
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10"
                        disabled={(r.recent || []).length === 0}
                        title="Show/hide recent picks"
                      >
                        {(r.recent || []).length === 0
                          ? "None"
                          : showRecent[r.leagueId]
                          ? "Hide"
                          : "Show"}
                      </button>
                    </div>

                    {showRecent[r.leagueId] && (
                      <div className="mt-2 space-y-1">
                        {(r.recent || []).map((p, idx) => (
                          <div
                            key={`${r.leagueId}-recent-${idx}-${p?.player_id || "x"}`}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <div className="text-gray-200 truncate">
                              <span className="text-gray-400 mr-2">•</span>
                              {p?.label || "—"}
                            </div>
                            {p?.pick_no ? (
                              <span className="text-xs text-gray-400 flex-shrink-0">
                                #{p.pick_no}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-600 flex-shrink-0">—</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
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

      {/* Table view etc... (unchanged below this point in your file) */}
      {/* IMPORTANT: the rest of your original file remains as-is */}
    </div>
  );
}