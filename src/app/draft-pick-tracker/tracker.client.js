"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";

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

function timerHoursLabel(timerSec) {
  const t = safeNum(timerSec);
  if (t <= 0) return null;
  const hrs = Math.max(1, Math.round(t / 3600));
  return `${hrs} HR Timer`;
}

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

function formatTimerHoursLabel(timerSec) {
  const t = safeNum(timerSec);
  if (t <= 0) return "";
  const hrs = t / 3600;

  // simple + clean: integers show as "2", otherwise "1.5"
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
  // If paused, treat it like a full clock so it stays "green"
  if (isPaused) return Math.max(0, safeNum(timerSec) * 1000);
  return Math.max(0, safeNum(liveClockLeft));
}

/**
 * ON-CLOCK heat (TIME-BASED thresholds, not %):
 * Tiers use remaining seconds only.
 * NOTE: only use when a real timer exists.
 */
function onClockHeatStyles(liveClockLeftMs) {
  const left = Math.max(0, safeNum(liveClockLeftMs));
  const leftSec = Math.ceil(left / 1000);

  // green: > 75s, yellow: 75-46, orange: 45-21, red: <= 20
  let tier = "green";
  if (leftSec <= 20) tier = "red";
  else if (leftSec <= 45) tier = "orange";
  else if (leftSec <= 75) tier = "yellow";

  const pulse =
    tier === "green"
      ? "animate-[pulse_1.25s_ease-in-out_infinite]"
      : tier === "yellow"
      ? "animate-[pulse_1.05s_ease-in-out_infinite]"
      : tier === "orange"
      ? "animate-[pulse_0.9s_ease-in-out_infinite]"
      : "animate-[pulse_0.75s_ease-in-out_infinite]";

  const shake = "animate-[dpt_shake_0.9s_ease-in-out_infinite]";

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
    tier === "green"
      ? "green"
      : tier === "yellow"
      ? "yellow"
      : tier === "orange"
      ? "orange"
      : "red";

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

// ---------------- Main ----------------

export default function DraftPickTrackerClient() {
  const { username, leagues, year, players } = useSleeper();

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
  const [showRecent, setShowRecent] = useState({});

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------------- Helpers ----------------

  const buildRosterNameMap = (users = [], rosters = []) => {
    const ownerToName = new Map();
    (users || []).forEach((u) => {
      const nm = u?.display_name || u?.metadata?.team_name || u?.user_id;
      if (u?.user_id) ownerToName.set(String(u.user_id), nm);
    });
    const rosterToName = new Map();
    (rosters || []).forEach((r) => {
      const nm =
        ownerToName.get(String(r?.owner_id)) || r?.owner_id || `Roster ${r?.roster_id}`;
      rosterToName.set(String(r?.roster_id), nm);
    });
    return rosterToName;
  };

  function getUserRosterIdForLeague(users, rosters) {
    const uname = String(username || "").toLowerCase().trim();
    if (!uname) return null;

    const u =
      (users || []).find((x) => String(x?.username || "").toLowerCase() === uname) ||
      (users || []).find((x) => String(x?.display_name || "").toLowerCase() === uname);

    if (!u?.user_id) return null;
    const r = (rosters || []).find((x) => String(x?.owner_id) === String(u.user_id));
    return r?.roster_id ? String(r.roster_id) : null;
  }

  function playerLabel(pid) {
    const p = players?.[String(pid)];
    const name =
      String(p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`).trim() ||
      `#${pid}`;
    const pos = String(p?.position || "").trim();
    return pos ? `${name} (${pos})` : name;
  }

  function buildTradedPickOwnerMap(tradedPicks = [], seasonStr = "") {
    const bestByKey = new Map();

    const scoreRow = (tp) => {
      const created = safeNum(tp?.created);
      const updated = safeNum(tp?.updated);
      if (updated > 0) return updated;
      if (created > 0) return created;
      const tx = tp?.transaction_id;
      if (typeof tx === "number" && Number.isFinite(tx)) return tx;
      if (typeof tx === "string") {
        const n = Number(tx);
        if (Number.isFinite(n)) return n;
        let h = tx.length;
        for (let i = 0; i < tx.length; i++) h = (h * 31 + tx.charCodeAt(i)) >>> 0;
        return h;
      }
      return 0;
    };

    (tradedPicks || []).forEach((tp, idx) => {
      const season = String(tp?.season ?? "");
      const round = safeNum(tp?.round);
      const orig = String(tp?.roster_id ?? "");
      const owner = String(tp?.owner_id ?? "");

      if (!season || !round || !orig || !owner) return;
      if (seasonStr && season !== seasonStr) return;

      const key = `${season}|${round}|${orig}`;

      const prev = bestByKey.get(key);
      const next = { owner, score: scoreRow(tp), idx };

      if (!prev || next.score > prev.score || (next.score === prev.score && next.idx > prev.idx)) {
        bestByKey.set(key, next);
      }
    });

    const m = new Map();
    for (const [key, val] of bestByKey.entries()) m.set(key, val.owner);
    return m;
  }

  function getSnakeSlotForPick({ pickNo, teams, reversalRound }) {
    if (!pickNo || !teams) return null;

    const idx0 = pickNo - 1;
    const round = Math.floor(idx0 / teams) + 1;
    const pickInRound0 = idx0 % teams;

    const rr = safeNum(reversalRound);
    let forward = true;

    if (round > 1) {
      for (let r = 2; r <= round; r++) {
        if (rr > 0 && r === rr) {
          // 3RR: skip flip on reversal round
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

  async function fetchDraftBundle(league) {
    const leagueId = league?.league_id;
    const draftId = league?.draft_id;
    if (!draftId) return null;

    const isBestBall = Number(league?.settings?.best_ball || 0) === 1;

// Best Ball leagues don't need traded_picks (and it is extra load).
const tradedPromise = isBestBall
  ? Promise.resolve(null)
  : fetch(`https://api.sleeper.app/v1/draft/${draftId}/traded_picks`);

const [draftRes, picksRes, usersRes, rostersRes, tradedRes] = await Promise.all([
  fetch(`https://api.sleeper.app/v1/draft/${draftId}`),
  fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`),
  fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
  fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
  tradedPromise,
]);

    if (!draftRes.ok) throw new Error(`Draft fetch failed: ${league?.name || leagueId}`);
    const draft = await draftRes.json();
    const picks = picksRes.ok ? await picksRes.json() : [];
    const users = usersRes.ok ? await usersRes.json() : [];
    const rosters = rostersRes.ok ? await rostersRes.json() : [];
    const traded_picks = tradedRes && tradedRes.ok ? await tradedRes.json() : [];

    return {
      league,
      draft,
      picks: Array.isArray(picks) ? picks : [],
      users,
      rosters,
      traded_picks: Array.isArray(traded_picks) ? traded_picks : [],
    };
  }

  function calcPickInfo({ league, draft, picks, users, rosters, traded_picks }, nowMs) {
    const rosterName = buildRosterNameMap(users, rosters);
    const reversalRound = safeNum(draft?.settings?.reversal_round);
    const draftStatus = String(draft?.status || "").toLowerCase();
    const rounds = safeNum(draft?.settings?.rounds);
    const timerSec = safeNum(draft?.settings?.pick_timer);

    const currentPick = (picks?.length || 0) + 1;

    const totalSlots =
      safeNum(draft?.settings?.teams) ||
      safeNum(draft?.settings?.slots) ||
      safeNum(draft?.settings?.num_teams) ||
      safeNum(rosters?.length) ||
      0;

    const teams = totalSlots > 0 ? totalSlots : 0;

    const rosterBySlot = new Map();
    const slotToRoster = draft?.slot_to_roster_id || {};
    Object.keys(slotToRoster || {}).forEach((slot) => {
      const rosterId = slotToRoster[slot];
      const s = safeNum(slot);
      if (s && rosterId != null) rosterBySlot.set(s, String(rosterId));
    });

    if (rosterBySlot.size === 0) {
      const draftOrder = draft?.draft_order || {};
      const ownerToRoster = new Map();
      (rosters || []).forEach((r) => {
        if (r?.owner_id != null && r?.roster_id != null) {
          ownerToRoster.set(String(r.owner_id), String(r.roster_id));
        }
      });

      Object.entries(draftOrder).forEach(([userId, slot]) => {
        const s = safeNum(slot);
        const rid = ownerToRoster.get(String(userId));
        if (s && rid) rosterBySlot.set(s, rid);
      });
    }

    const seasonStr = String(draft?.season || league?.season || year || "");
    const tradedOwnerMap = buildTradedPickOwnerMap(traded_picks, seasonStr);

    const currentOwnerName = teams
      ? getPickOwnerName({
          pickNo: currentPick,
          teams,
          rosterBySlot,
          tradedOwnerMap,
          seasonStr,
          reversalRound,
          rosterNameMap: rosterName,
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

    const myRosterId = getUserRosterIdForLeague(users, rosters);

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
      myNextPickOverall != null ? Math.max(0, myNextPickOverall - currentPick) : null;

    const onDeck = picksUntilMyPick === 1;

    const onClockIsMe = !!(
      myRosterId &&
      nextRosterId &&
      String(nextRosterId) === String(myRosterId)
    );

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

    // Clock left (only if timer exists)
    const lastPickTs = safeNum(draft?.last_picked);
    const clockEndsAt =
      lastPickTs > 0 && timerSec > 0 ? lastPickTs + timerSec * 1000 : 0;
    const clockLeftMs = clockEndsAt > 0 ? Math.max(0, clockEndsAt - nowMs) : 0;

    // ✅ ETA only if timer exists
    const perPickMs = timerSec > 0 ? timerSec * 1000 : 0;

    let etaMs = null;
    if (timerSec > 0 && picksUntilMyPick != null) {
      if (clockLeftMs > 0 && picksUntilMyPick > 0) {
        etaMs = clockLeftMs + Math.max(0, picksUntilMyPick - 1) * perPickMs;
      } else {
        etaMs = picksUntilMyPick * perPickMs;
      }
    }

    const recent = (Array.isArray(picks) ? picks : [])
      .slice(-10)
      .reverse()
      .map((p) => ({
        player_id: p?.player_id,
        label: p?.player_id ? playerLabel(p.player_id) : "—",
        pick_no: safeNum(p?.pick_no) || null,
      }));

    return {
      leagueId: league?.league_id,
      leagueName: league?.name || "Unnamed League",
      season: league?.season || year,
      draftId: draft?.draft_id || league?.draft_id,
      draftStatus,
      currentPick,
      currentOwnerName: currentOwnerName || "—",
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
    };
  }

  // ---------------- Refresh ----------------

  async function refresh() {
    setErr("");
    setLoading(true);
    try {
      const eligible = (leagues || []).filter((lg) => !!lg?.draft_id);
      const nextBundles = [];

      for (const lg of eligible) {
        try {
          const b = await fetchDraftBundle(lg);
          if (b) nextBundles.push(b);
        } catch (e) {
          console.warn("Draft bundle failed:", lg?.name, e);
        }
      }

      const nowMs = Date.now();
      const draftRows = [];
      nextBundles.forEach((b) => draftRows.push(calcPickInfo(b, nowMs)));

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

  const anyDrafting = useMemo(
    () => (rows || []).some((r) => String(r?.draftStatus) === "drafting"),
    [rows]
  );

  // ---------------- Auto-refresh ----------------
  useEffect(() => {
    if (!username) return;
    if (!autoRefresh) return;
    if (!anyDrafting) return;

    const t = setInterval(() => refresh(), 20000);
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
      .filter((r) => r.draftStatus === "drafting")
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

  // ---------------- Filters + sorting (bucket priority) ----------------

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
      r = r.filter((x) => String(x.leagueName || "").toLowerCase().includes(q));
    }

    // Priority buckets:
  // 0: drafting + onClock
  // 1: drafting + onDeck
  // 2: drafting (other)
  // 3: paused
  // 4: everything else
  const bucket = (x) => {
    const st = String(x?.draftStatus || "").toLowerCase();
    const isDrafting = st === "drafting";
    const isPaused = st === "paused";

    // ✅ ALWAYS top if you are on the clock (even if paused)
    if (x.onClockIsMe) return 0;

    // then preserve existing priority rules
    if (isDrafting && x.onDeck) return 1;
    if (isDrafting) return 2;
    if (isPaused) return 3;
    return 4;
  };


  const dir = sortDir === "asc" ? 1 : -1;

  const getLiveClockLeft = (x) => {
    const st = String(x?.draftStatus || "").toLowerCase();
    const hasTimer = safeNum(x.timerSec) > 0;
    if (!hasTimer) return Number.POSITIVE_INFINITY;

    // ✅ paused: do NOT tick down
    if (st === "paused") return Math.max(0, safeNum(x.clockLeftMs));

    const elapsed = Math.max(0, safeNum(now) - safeNum(x.computedAt));
    return Math.max(0, safeNum(x.clockLeftMs) - elapsed);
  };

  const getLiveEtaToShownPick = (x) => {
    const st = String(x?.draftStatus || "").toLowerCase();
    const hasTimer = safeNum(x.timerSec) > 0;
    if (!hasTimer) return Number.POSITIVE_INFINITY;

    // ✅ paused: do NOT tick down (keep last computed ETA)
    if (st === "paused") {
      const v = safeNum(x.etaMs);
      return v > 0 ? v : Number.POSITIVE_INFINITY;
    }

    const elapsed = Math.max(0, safeNum(now) - safeNum(x.computedAt));
    const isDrafting = st === "drafting";
    const liveClockLeft = getLiveClockLeft(x);

    const shownPickNo = x.onClockIsMe ? x.myNextPickAfterThis : x.myNextPickOverall;
    const perPickMs = safeNum(x.timerSec) * 1000;

    if (shownPickNo != null && x.currentPick != null) {
      if (isDrafting && x.onClockIsMe) {
        const gap = Math.max(0, safeNum(shownPickNo) - safeNum(x.currentPick) - 1);
        return liveClockLeft + gap * perPickMs;
      }
      return Math.max(0, safeNum(x.etaMs) - elapsed);
    }

    return Number.POSITIVE_INFINITY;
  };


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

  // ---------------- UI ----------------

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
            Multi-league draft dashboard: on-deck alerts, accurate on-clock timers, traded-pick ownership, and recent picks.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="px-5 py-2.5 rounded-2xl bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-700 disabled:opacity-60 text-white font-semibold shadow-[0_18px_40px_rgba(37,99,235,0.25)] border border-white/10"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
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
          {filteredDraftRows.map((r) => {
            const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
            const status = String(r?.draftStatus || "").toLowerCase();
            const isDrafting = status === "drafting";
            const isPaused = status === "paused";
            const hasTimer = safeNum(r.timerSec) > 0;

            // paused: do NOT tick down (use stored clockLeftMs)
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

            const etaClock = isPaused ? "paused" : hasTimer && liveEtaToShownPick != null ? msToClock(liveEtaToShownPick) : "—";

            const statusTone =
              r.draftStatus === "drafting"
                ? "green"
                : r.draftStatus === "paused"
                ? "yellow"
                : r.draftStatus === "complete"
                ? "gray"
                : "yellow";

            const clockHeat =
              r.onClockIsMe && hasTimer
                ? onClockHeatStyles(
                    getOnClockHeatMsForUI({
                      isPaused,
                      liveClockLeft,
                      timerSec: r.timerSec,
                    })
                  )
                : null;

            const deckTint = isDrafting && !r.onClockIsMe && r.onDeck ? onDeckTintStyles() : null;

            const shellRing = (clockHeat && clockHeat.ring) || (deckTint && deckTint.ring) || "";
            const shellWash = (clockHeat && clockHeat.wash) || (deckTint && deckTint.wash) || "";

            const timerLabel = formatTimerHoursLabel(r.timerSec);

            return (
              <div
                key={r.leagueId}
                className={classNames(
                  "relative bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden",
                  shellWash,
                  shellRing
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
                          <span
                          className={classNames(
                            "inline-flex",
                            hasTimer && !isPaused ? clockHeat?.shake : ""
                          )}
                        >
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
                      </div>

                      <div className="text-xs text-gray-400 mt-1">
                        {r.teams ? `${r.teams} teams` : "—"}
                        {r.rounds ? ` · ${r.rounds} rounds` : ""}
                        {timerLabel ? ` · ${timerLabel}` : ""}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {r.onClockIsMe && (
                        <span
                          className={classNames(
                            "inline-flex",
                            hasTimer && !isPaused ? clockHeat?.shake : ""
                          )}
                        >
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
                      <div className="text-white text-lg font-semibold truncate mt-0.5">{r.currentOwnerName || "—"}</div>

                      <div className="mt-1 flex items-center justify-between gap-3">
                        <div className="text-xs text-gray-400">
                          {r.currentPick ? `Pick #${nf0.format(r.currentPick)}` : "Pick —"}
                        </div>
                        {isDrafting && !isPaused ? (
                          <div className="text-xl text-white font-extrabold tabular-nums tracking-wide">
                            {clockText}
                          </div>
                        ) : r.draftStatus === "paused" ? (
                          <div className="text-xs text-yellow-200/80">paused</div>
                        ) : (
                          <div className="text-xs text-gray-500">—</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">
                        {r.onClockIsMe ? "Your Next Pick (after this)" : "Your Next Pick"}
                      </div>

                      <div className="text-white text-lg font-semibold mt-0.5">
                        {shownPickNo ? `#${nf0.format(shownPickNo)}` : "—"}
                      </div>

                      <div className="mt-1 flex items-center justify-between gap-3">
                        <div className="text-xs text-gray-400">ETA</div>
                        <div className="text-xl text-white font-extrabold tabular-nums tracking-wide">{etaClock}</div>
                      </div>
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
                        {(r.recent || []).length === 0 ? "None" : showRecent[r.leagueId] ? "Hide" : "Show"}
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
                              <span className="text-xs text-gray-400 flex-shrink-0">#{p.pick_no}</span>
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

          {/* MOBILE */}
          <div className="sm:hidden">
            <div className="w-full">
              <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-black/20 text-xs text-gray-300 border-b border-white/10">
                <div className="col-span-5">League</div>
                <div className="col-span-5">Current</div>
                <div className="col-span-2 text-right">Your Next</div>
              </div>

              <div className="divide-y divide-white/10">
                {filteredDraftRows.map((r) => {
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

                  return (
                    <div
                      key={r.leagueId}
                      className={classNames(
                        "relative grid grid-cols-12 gap-2 px-4 py-2.5 text-sm border-l-4",
                        r.onClockIsMe && "bg-emerald-500/10 border-emerald-400/60",
                        isDrafting && !r.onClockIsMe && r.onDeck && "bg-amber-500/10 border-amber-400/60",
                        !(isDrafting && (r.onClockIsMe || r.onDeck)) && "border-transparent"
                      )}
                    >
                      <div className="col-span-5 min-w-0">
                        <div className="text-white truncate">{r.leagueName}</div>
                        <div className="text-[10px] text-gray-400 truncate">{r.draftStatus || "—"}</div>
                      </div>

                      <div className="col-span-5 min-w-0">
                        <div className="text-gray-100 truncate">{r.currentOwnerName || "—"}</div>
                        <div className="text-[11px] text-gray-400 tabular-nums flex items-center gap-2">
                          <span>{r.currentPick ? `#${nf0.format(r.currentPick)}` : "—"}</span>
                          {isDrafting && !isPaused ? (
                            <span className="text-base font-extrabold text-white">{clockText}</span>
                          ) : r.draftStatus === "paused" ? (
                            <span className="text-yellow-200/80">paused</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex gap-1">
                          {r.onClockIsMe ? (
                            <Pill tone="green" size="xs">
                              ON CLOCK
                            </Pill>
                          ) : null}
                        </div>
                      </div>

                      <div className="col-span-2 text-right">
                        <div className="text-white">{shownPickNo ? `#${nf0.format(shownPickNo)}` : "—"}</div>
                        <div className="text-[11px] text-gray-300 mt-0.5 tabular-nums font-extrabold">{etaClock}</div>
                        <div className="mt-1 flex justify-end gap-1">
                          {isDrafting && !r.onClockIsMe && r.onDeck ? (
                            <Pill tone="yellow" size="xs">
                              ON DECK
                            </Pill>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredDraftRows.length === 0 && (
                  <div className="px-5 py-10 text-center text-gray-300">
                    No leagues found. Try adjusting filters or hit Refresh.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DESKTOP */}
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
                </tr>
              </thead>

              <tbody>
                {filteredDraftRows.map((r) => {
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

                  return (
                    <tr
                      key={r.leagueId}
                      className={classNames(
                        "border-t border-white/5 hover:bg-white/5",
                        r.onClockIsMe && "bg-emerald-500/5",
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
                        <Pill tone={statusTone} size="sm">
                          {r.draftStatus || "—"}
                        </Pill>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-gray-100">{r.currentOwnerName || "—"}</span>
                            {r.onClockIsMe ? (
                              <Pill tone="green" size="xs">
                                ON CLOCK
                              </Pill>
                            ) : null}
                          </div>

                          <span className="text-xs text-gray-400 tabular-nums flex items-center gap-2">
                            <span>{r.currentPick ? `#${nf0.format(r.currentPick)}` : "—"}</span>
                            {isDrafting && !isPaused ? (
                              <span className="text-lg font-extrabold text-white tabular-nums tracking-wide">
                                {clockText}
                              </span>
                            ) : r.draftStatus === "paused" ? (
                              <span className="text-yellow-200/80">paused</span>
                            ) : null}
                          </span>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        {shownPickNo ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Pill tone="purple" size="sm">
                              #{nf0.format(shownPickNo)}
                            </Pill>
                            {isDrafting && !r.onClockIsMe && r.onDeck ? (
                              <Pill tone="yellow" size="xs">
                                ON DECK
                              </Pill>
                            ) : null}
                          </div>
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
                          <span className="text-xs text-gray-400">
                            {hasTimer ? "timer-based" : "no timer"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredDraftRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-300">
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
    </div>
  );
}
