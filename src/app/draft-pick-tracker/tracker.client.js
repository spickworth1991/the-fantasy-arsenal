"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import LoadingScreen from "../../components/LoadingScreen";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DRAFT_FETCH_CONCURRENCY = 4;

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

function Pill({ children, tone = "blue", size = "md" }) {
  const tones = {
    blue: "bg-blue-500/20 text-blue-200 border-blue-400/30",
    green: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
    yellow: "bg-yellow-500/20 text-yellow-200 border-yellow-400/30",
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
  const yellowCapSec = Math.max(Math.round(tSec * 0.6), 10 * 60);
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

  const shakeOnly = tier === "orange" || tier === "red" ? "animate-[dpt_shake_0.9s_ease-in-out_infinite]" : "";
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

  const badgeTone = tier === "green" ? "green" : tier === "yellow" ? "yellow" : tier === "orange" ? "orange" : "red";

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
    wash: "before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-amber-400/10 before:via-transparent before:to-transparent before:pointer-events-none",
  };
}

function getDraftStatusKey(status) {
  return String(status || "").toLowerCase();
}

function getRowPriority(row) {
  const status = getDraftStatusKey(row?.draftStatus);
  if (row?.onClockIsMe && status === "drafting") return 0;
  if (row?.onClockIsMe && status === "paused") return 1;
  if (!row?.onClockIsMe && row?.onDeck && status !== "complete") return 2;
  return 3;
}

function getSearchBottomPriority(row, q) {
  return row?.myNextPickOverall == null ? 1 : 0;
}

function getRowAttentionState(row, liveClockLeft) {
  const status = getDraftStatusKey(row?.draftStatus);
  const isDrafting = status === "drafting";
  const isPaused = status === "paused";
  const isComplete = status === "complete";
  const hasTimer = safeNum(row?.timerSec) > 0 && !isComplete;
  const clockHeat =
    row?.onClockIsMe && hasTimer
      ? onClockHeatStyles(
          getOnClockHeatMsForUI({
            isPaused,
            liveClockLeft,
            timerSec: row?.timerSec,
          }),
          row?.timerSec
        )
      : null;
  const deckTint = !row?.onClockIsMe && row?.onDeck && !isComplete ? onDeckTintStyles() : null;

  const rowTone =
    clockHeat?.tier === "red"
      ? "bg-red-500/10"
      : clockHeat?.tier === "orange"
      ? "bg-orange-500/10"
      : clockHeat?.tier === "yellow"
      ? "bg-yellow-500/10"
      : clockHeat?.tier === "green"
      ? "bg-emerald-500/10"
      : deckTint
      ? "bg-amber-500/5"
      : "";

  const cardAccentClass = clockHeat
    ? classNames("relative", clockHeat.ring, clockHeat.wash)
    : deckTint
    ? classNames("relative", deckTint.ring, deckTint.wash)
    : "";

  return {
    isDrafting,
    isPaused,
    isComplete,
    hasTimer,
    clockHeat,
    deckTint,
    rowTone,
    cardAccentClass,
    showOnClockBadge: !!row?.onClockIsMe && (isDrafting || isPaused),
    showOnDeckBadge: !row?.onClockIsMe && !!row?.onDeck && !isComplete,
  };
}

function getDisplayClockText(attention, liveClockLeft) {
  if (attention?.isPaused) return "PAUSED";
  if (attention?.hasTimer && liveClockLeft > 0) return msToClock(liveClockLeft);
  return null;
}

function getDisplayEtaText(row, attention, liveEtaMs) {
  if (row?.myNextPickOverall == null) return null;
  if (attention?.isPaused) return "PAUSED";
  return msToHuman(Math.max(0, safeNum(liveEtaMs)));
}

function getEtaSortValue(row) {
  if (row?.myNextPickOverall == null) return Number.MAX_SAFE_INTEGER;
  if (getDraftStatusKey(row?.draftStatus) === "paused") return Number.MAX_SAFE_INTEGER - 1;
  return safeNum(row?.etaMs);
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
        <span className="text-xs opacity-80">
          {sortDir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

// ---------------- Main ----------------

export default function DraftPickTrackerClient() {
  const { username, leagues, year, players } = useSleeper();

  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [err, setErr] = useState("");

  const [search, setSearch] = useState("");
  const [onlyDrafting, setOnlyDrafting] = useState(true);
  const [includePaused, setIncludePaused] = useState(false);

  const [view, setView] = useState("cards"); // cards | table
  const [onlyOnDeckOrClock, setOnlyOnDeckOrClock] = useState(false);
  const [maxPicksAway, setMaxPicksAway] = useState(999); // 999 = off
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // removed pace sorting; default to "picks until" then ETA
  const [sortKey, setSortKey] = useState("etaMs");
  const [sortDir, setSortDir] = useState("asc");

  const [rows, setRows] = useState([]); // computed draft rows
  const [bundles, setBundles] = useState([]); // cached bundles
  const refreshInFlightRef = useRef(false);
  const eligibleDraftKey = useMemo(
    () => (leagues || []).filter((lg) => lg?.draft_id).map((lg) => String(lg.draft_id)).join(","),
    [leagues]
  );

  // per-league expand/collapse for recent picks
  const [expandedRecent, setExpandedRecent] = useState({}); // { [leagueId]: boolean }
  const [mobileDetailRow, setMobileDetailRow] = useState(null);

  // ticker so clocks count down without refetching
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
        ownerToName.get(String(r?.owner_id)) ||
        r?.owner_id ||
        `Roster ${r?.roster_id}`;
      rosterToName.set(String(r?.roster_id), nm);
    });
    return rosterToName;
  };

  function getUserRosterIdForLeague(users, rosters) {
    const uname = String(username || "").toLowerCase().trim();
    if (!uname) return null;

    const u =
      (users || []).find(
        (x) => String(x?.username || "").toLowerCase() === uname
      ) ||
      (users || []).find(
        (x) => String(x?.display_name || "").toLowerCase() === uname
      );

    if (!u?.user_id) return null;
    const r = (rosters || []).find(
      (x) => String(x?.owner_id) === String(u.user_id)
    );
    return r?.roster_id ? String(r.roster_id) : null;
  }

  function playerLabel(pid) {
    const p = players?.[String(pid)];
    const name =
      String(p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`)
        .trim() || `#${pid}`;
    const pos = String(p?.position || "").trim();
    return pos ? `${name} (${pos})` : name;
  }

  function buildTradedPickOwnerMap(tradedPicks = [], seasonStr = "") {
    // key: `${season}|${round}|${originalRosterId}` => currentOwnerRosterId
    const m = new Map();
    (tradedPicks || []).forEach((tp) => {
      const season = String(tp?.season ?? "");
      const round = safeNum(tp?.round);
      const orig = String(tp?.roster_id ?? "");
      const owner = String(tp?.owner_id ?? "");
      if (!season || !round || !orig || !owner) return;
      if (seasonStr && season !== seasonStr) return;
      m.set(`${season}|${round}|${orig}`, owner);
    });
    return m;
  }

  function resolveRosterForPick({
    pickNo,
    teams,
    rosterBySlot,
    tradedOwnerMap,
    seasonStr,
    draftType,
  }) {
    if (!pickNo || !teams) return null;
    const idx0 = pickNo - 1;
    const round = Math.floor(idx0 / teams) + 1;
    const pickInRound0 = idx0 % teams;

    const normalizedType = String(draftType || "snake").toLowerCase();
    let slot;

    if (normalizedType === "linear") {
      slot = pickInRound0 + 1;
    } else if (normalizedType === "snake") {
      const isReverse = round % 2 === 0;
      slot = isReverse ? teams - pickInRound0 : pickInRound0 + 1;
    } else {
      // Fallback to snake for unknown types
      const isReverse = round % 2 === 0;
      slot = isReverse ? teams - pickInRound0 : pickInRound0 + 1;
    }

    const origRosterId = rosterBySlot.get(slot) || null;
    if (!origRosterId) return null;

    const tradedOwner =
      tradedOwnerMap?.get(`${seasonStr}|${round}|${String(origRosterId)}`) ||
      null;

    return tradedOwner || String(origRosterId);
  }

  async function fetchDraftBundle(league) {
    const leagueId = league?.league_id;
    const draftId = league?.draft_id;
    if (!draftId) return null;

    const [draftRes, picksRes, usersRes, rostersRes, tradedRes] =
      await Promise.all([
        fetch(`https://api.sleeper.app/v1/draft/${draftId}`),
        fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
        // traded picks (for this draft)
        fetch(`https://api.sleeper.app/v1/draft/${draftId}/traded_picks`),
      ]);

    if (!draftRes.ok)
      throw new Error(`Draft fetch failed: ${league?.name || leagueId}`);
    const draft = await draftRes.json();
    const picks = picksRes.ok ? await picksRes.json() : [];
    const users = usersRes.ok ? await usersRes.json() : [];
    const rosters = rostersRes.ok ? await rostersRes.json() : [];
    const traded_picks = tradedRes.ok ? await tradedRes.json() : [];

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

    const draftStatus = String(draft?.status || "").toLowerCase();
    const rounds = safeNum(draft?.settings?.rounds);
    const slots = safeNum(draft?.settings?.teams);
    const timerSec = safeNum(draft?.settings?.pick_timer);
    const draftType = String(draft?.type || "snake").toLowerCase();

    const currentPick = (picks?.length || 0) + 1;

    const slotToRoster = draft?.slot_to_roster_id || {};
    const rosterBySlot = new Map();
    Object.keys(slotToRoster || {}).forEach((slot) => {
      const rosterId = slotToRoster[slot];
      const s = safeNum(slot);
      if (s && rosterId != null) rosterBySlot.set(s, String(rosterId));
    });

    const totalSlots = slots || safeNum(draft?.settings?.slots) || 0;
    const teams = totalSlots > 0 ? totalSlots : 0;

    const seasonStr = String(draft?.season || league?.season || year || "");
    const tradedOwnerMap = buildTradedPickOwnerMap(traded_picks, seasonStr);

    // who is currently on the clock (accounting for traded pick ownership)
    const nextRosterId = teams
      ? resolveRosterForPick({
          pickNo: currentPick,
          teams,
          rosterBySlot,
          tradedOwnerMap,
          seasonStr,
          draftType,
        })
      : null;

    const nextOwnerName = nextRosterId
      ? rosterName.get(String(nextRosterId)) || `Roster ${nextRosterId}`
      : "—";

    const myRosterId = getUserRosterIdForLeague(users, rosters);

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
          draftType,
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

    // Clock left (use nowMs passed in, NOT component state, to avoid stale closure bug)
    const lastPickTs = safeNum(draft?.last_picked); // Sleeper is ms epoch
    const clockEndsAt =
      lastPickTs > 0 && timerSec > 0 ? lastPickTs + timerSec * 1000 : 0;
    const clockLeftMs =
      clockEndsAt > 0 ? Math.max(0, clockEndsAt - nowMs) : 0;

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

    // Recent picks (last 10) — show pick_no + name
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
      nextOwnerName,
      clockLeftMs,
      onClockIsMe,
      onDeck,
      myNextPickOverall,
      picksUntilMyPick,
      etaMs,
      timerSec,
      teams,
      rounds,
      recent,
      computedAt: nowMs, // match baseline used in clock calc
    };
  }

  // ---------------- Refresh ----------------

  async function refresh() {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setErr("");
    setLoading(true);
    setScanProgress(0);
    try {
      const eligible = (leagues || []).filter((lg) => !!lg?.draft_id);
      const bundleResults = new Array(eligible.length);
      let cursor = 0;
      let completed = 0;
      const workers = Array.from(
        { length: Math.min(DRAFT_FETCH_CONCURRENCY, eligible.length) },
        async () => {
          while (true) {
            const index = cursor++;
            if (index >= eligible.length) break;
            const lg = eligible[index];
            try {
              bundleResults[index] = await fetchDraftBundle(lg);
            } catch (e) {
              console.warn("Draft bundle failed:", lg?.name, e);
            } finally {
              completed += 1;
              setScanProgress(Math.round((completed / Math.max(eligible.length, 1)) * 100));
            }
          }
        }
      );
      await Promise.all(workers);
      const nextBundles = bundleResults.filter(Boolean);

      const nowMs = Date.now(); // critical: prevents stale-now auto-refresh drift

      const draftRows = [];
      nextBundles.forEach((b) => {
        draftRows.push(calcPickInfo(b, nowMs));
      });

      setBundles(nextBundles);
      setRows(draftRows);
      setScanProgress(100);
    } catch (e) {
      console.error(e);
      setErr("Failed to load drafts. Try refresh.");
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!username || !eligibleDraftKey) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, eligibleDraftKey]);

  // ---------------- Filters + sorting ----------------

  const filteredDraftRows = useMemo(() => {
    const q = String(search || "").toLowerCase().trim();
    let r = rows || [];

    if (onlyDrafting) {
      r = r.filter((x) => {
        const st = String(x.draftStatus || "").toLowerCase();
        if (st === "drafting") return true;
        if (st === "paused" && x.onClockIsMe) return true;
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
      const searchBottomDelta = getSearchBottomPriority(a, q) - getSearchBottomPriority(b, q);
      if (searchBottomDelta !== 0) return searchBottomDelta;

      const rowPriorityDelta = getRowPriority(a) - getRowPriority(b);
      if (rowPriorityDelta !== 0) return rowPriorityDelta;

      if (sortKey === "etaMs") {
        const cmp = (getEtaSortValue(a) - getEtaSortValue(b)) * dir;
        if (cmp !== 0) return cmp;
      }

      const av = a?.[sortKey];
      const bv = b?.[sortKey];
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av || "").localeCompare(String(bv || "")) * dir;
        if (cmp !== 0) return cmp;
      } else {
        const cmp = (safeNum(av) - safeNum(bv)) * dir;
        if (cmp !== 0) return cmp;
      }
      return String(a?.leagueName || "").localeCompare(String(b?.leagueName || ""));
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

  const renderMobileDetailModal = () => {
    if (!mobileDetailRow) return null;

    const r = mobileDetailRow;
    const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
    const rawClockLeft = Math.max(0, safeNum(r.clockLeftMs) - elapsed);
    const attention = getRowAttentionState(r, rawClockLeft);
    const clockText = getDisplayClockText(attention, rawClockLeft) || "—";
    const etaHuman = getDisplayEtaText(r, attention, Math.max(0, safeNum(r.etaMs) - elapsed)) || "—";
    const statusTone =
      r.draftStatus === "drafting"
        ? "green"
        : r.draftStatus === "paused"
        ? "yellow"
        : r.draftStatus === "complete"
        ? "gray"
        : "yellow";

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:hidden">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-gray-950/95 p-4 text-white shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold leading-tight">{r.leagueName}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Pill tone={statusTone} size="xs">
                  {r.draftStatus || "—"}
                </Pill>
                {attention.showOnClockBadge ? <Pill tone="green" size="xs">ON CLOCK</Pill> : null}
                {attention.showOnDeckBadge ? (
                  <Pill tone="yellow" size="xs">ON DECK</Pill>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileDetailRow(null)}
              className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-gray-400">Current Pick</div>
              <div className="mt-1 font-semibold">{r.nextOwnerName || "—"}</div>
              <div className="mt-1 text-xs text-gray-300">{r.currentPick ? `#${nf0.format(r.currentPick)}` : "—"}</div>
              <div className="mt-2 text-sm font-bold tabular-nums">{clockText}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-gray-400">Your Next Pick</div>
              <div className="mt-1 font-semibold">{r.myNextPickOverall ? `#${nf0.format(r.myNextPickOverall)}` : "—"}</div>
              <div className="mt-1 text-xs text-gray-300">{r.picksUntilMyPick != null ? `${r.picksUntilMyPick} away` : "—"}</div>
              <div className="mt-2 text-sm font-bold tabular-nums">{etaHuman}</div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <a
              href={`https://sleeper.com/draft/nfl/${String(r.draftId)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded-2xl bg-cyan-500/90 px-4 py-2 text-center text-sm font-semibold text-black"
            >
              Open Draft
            </a>
          </div>
        </div>
      </div>
    );
  };

  // ---------------- UI bits ----------------

  const totalLeagues = filteredDraftRows.length;

  // During the first scan there are no rows yet, so rendering the normal empty
  // state incorrectly suggests that the scan has already found no leagues.
  if (loading && rows.length === 0) {
    return <LoadingScreen progress={scanProgress} text="Loading your draft leagues..." />;
  }

  return (
    <div className="mt-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
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

        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={refresh}
            disabled={loading}
            className="px-5 py-2.5 rounded-2xl bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-700 disabled:opacity-60 text-white font-semibold shadow-[0_18px_40px_rgba(37,99,235,0.25)] border border-white/10"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          
        </div>
      </div>

      <div className="mt-6 rounded-3xl border border-white/10 bg-gradient-to-b from-gray-900/80 to-black/40 shadow-[0_20px_70px_rgba(0,0,0,0.45)] overflow-hidden">
        <div className="px-5 py-4 bg-black/20 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone="cyan">{totalLeagues} leagues</Pill>
            {includePaused && onlyDrafting && <Pill tone="yellow">Paused included</Pill>}
            {onlyOnDeckOrClock && <Pill tone="purple">Hot only</Pill>}
            {maxPicksAway < 999 ? <Pill tone="blue">≤ {maxPicksAway} picks</Pill> : null}
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={classNames(
              "px-4 py-2.5 rounded-2xl text-sm font-semibold border border-white/10 bg-black/20 text-gray-200 hover:bg-white/5",
              filtersOpen && "bg-white/10 border-white/20 text-white"
            )}
            aria-expanded={filtersOpen}
          >
            {filtersOpen ? "Close" : "Filters"}
          </button>

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

              {/* <div className="xl:col-span-3">
                <div className="text-xs text-gray-300 mb-2">Window</div>
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
                </div>
              </div> */}
            </div>

            {err && <p className="text-red-300 mt-4">{err}</p>}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Pill tone="cyan">{totalLeagues} leagues</Pill>
        <Pill tone="blue">On-deck alert</Pill>
        <Pill tone="purple">ETA uses timer + clock</Pill>
        {includePaused && onlyDrafting && <Pill tone="yellow">Showing paused</Pill>}
      </div>

      {/* Card view */}
      {view === "cards" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {filteredDraftRows.map((r) => {
            const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
            const rawClockLeft = Math.max(0, safeNum(r.clockLeftMs) - elapsed);
            const attention = getRowAttentionState(r, rawClockLeft);
            const clockText = getDisplayClockText(attention, rawClockLeft);

            const liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);
            const etaLabel = getDisplayEtaText(r, attention, liveEta) || "â€”";
            const etaHuman = etaLabel;

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
                  "bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden",
                  attention.cardAccentClass
                )}
              >
                <div className="p-4 border-b border-white/10 bg-black/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-white font-semibold truncate">
                          {r.leagueName}
                        </div>
                        <Pill tone={statusTone}>{r.draftStatus || "—"}</Pill>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {r.teams ? `${r.teams} teams` : "—"}
                        {r.rounds ? ` · ${r.rounds} rounds` : ""}
                        {r.timerSec ? ` · ${r.timerSec}s timer` : ""}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {attention.showOnClockBadge && clockText && (
                        <Pill tone="green">ON CLOCK · {clockText}</Pill>
                      )}
                      {attention.showOnDeckBadge && (
                        <Pill tone="yellow">ON DECK</Pill>
                      )}
                      {upIn != null && upIn >= 0 && (
                        <Pill tone={upIn <= 1 ? "yellow" : "cyan"}>
                          Up in {upIn} pick{upIn === 1 ? "" : "s"}
                        </Pill>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">Current Pick</div>
                      <div className="text-white text-lg font-semibold">
                        {r.currentPick ? `#${nf0.format(r.currentPick)}` : "—"}
                      </div>
                      {attention.showOnClockBadge && clockText && (
                        <div className="text-xs text-gray-400 mt-1">
                          {attention.isPaused ? "Paused on your pick" : `${clockText} left`}
                        </div>
                      )}
                      {!attention.showOnClockBadge && attention.isPaused && (
                        <div className="text-xs text-yellow-200/80 mt-1">
                          Draft paused
                        </div>
                      )}
                    </div>

                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">Who’s Up</div>
                      <div className="text-white text-lg font-semibold truncate">
                        {r.nextOwnerName || "—"}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {r.myNextPickOverall
                          ? `Your next: #${nf0.format(r.myNextPickOverall)}`
                          : "Your next: —"}
                      </div>
                    </div>

                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">ETA</div>
                      <div className="text-white text-lg font-semibold">
                        {r.myNextPickOverall ? etaHuman : "—"}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {attention.isPaused
                          ? "ETA unavailable while paused"
                          : `Uses ${r.timerSec ? `${r.timerSec}s` : "timer"} per pick`}
                      </div>
                    </div>

                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">Timer</div>
                      <div className="text-white text-lg font-semibold">
                        {r.timerSec ? `${r.timerSec}s` : "—"}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        League pick timer setting
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 bg-black/20 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-white font-semibold">
                        Recent picks
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRecent((prev) => ({
                            ...prev,
                            [r.leagueId]: !prev?.[r.leagueId],
                          }))
                        }
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10"
                        disabled={(r.recent || []).length <= 3}
                        title="Expand/collapse recent picks"
                      >
                        {(r.recent || []).length <= 3
                          ? `last ${Math.min(10, (r.recent || []).length)}`
                          : isExpanded
                          ? "Collapse"
                          : "Expand"}
                      </button>
                    </div>

                    <div className="mt-2 space-y-1">
                      {recentToShow.map((p, idx) => (
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
                            <span className="text-xs text-gray-600 flex-shrink-0">
                              —
                            </span>
                          )}
                        </div>
                      ))}

                      {(r.recent || []).length === 0 && (
                        <div className="text-sm text-gray-400">No picks yet.</div>
                      )}
                    </div>
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

      {/* Table view (mobile-optimized) */}
      {view === "table" && (
        <div className="mt-6 bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone="cyan">{filteredDraftRows.length} leagues</Pill>
              <Pill tone="blue">Timer + clock</Pill>
              <Pill tone="yellow">On-deck alert</Pill>
              {includePaused && onlyDrafting && <Pill tone="yellow">Paused</Pill>}
            </div>
            
          </div>

          {/* MOBILE: stacked rows */}
          <div className="sm:hidden">
            <div className="overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-black/20 text-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left">League</th>
                    <th className="px-3 py-2 text-left">Current</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDraftRows.map((r, idx) => {
                    const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
                    const rawClockLeft = Math.max(0, safeNum(r.clockLeftMs) - elapsed);
                    const attention = getRowAttentionState(r, rawClockLeft);
                    const clockText = getDisplayClockText(attention, rawClockLeft) || "—";
                    const liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);
                    const etaHuman = r.myNextPickOverall != null ? msToHuman(liveEta) : "—";

                    return (
                      <tr
                        key={r.leagueId || `mrow:${idx}`}
                        className={classNames("border-t border-white/5 cursor-pointer", attention.rowTone)}
                        onClick={() => setMobileDetailRow(r)}
                      >
                        <td className="px-3 py-3 align-top">
                          <div className="font-semibold text-white leading-tight break-words">{r.leagueName}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Pill tone={r.draftStatus === "drafting" ? "green" : r.draftStatus === "paused" ? "yellow" : r.draftStatus === "complete" ? "gray" : "yellow"} size="xs">
                              {r.draftStatus || "—"}
                            </Pill>
                            {attention.showOnClockBadge ? <Pill tone="green" size="xs">ON CLOCK</Pill> : null}
                            {attention.showOnDeckBadge ? <Pill tone="yellow" size="xs">ON DECK</Pill> : null}
                          </div>
                          <div className="mt-1 text-[11px] text-cyan-200/80">Tap for details</div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="min-w-[110px]">
                            <div className="text-white font-semibold truncate">{r.nextOwnerName || "—"}</div>
                            <div className="mt-1 text-[11px] text-gray-300">{r.currentPick ? `#${nf0.format(r.currentPick)}` : "—"}</div>
                            <div className="mt-1 text-[11px] font-bold tabular-nums text-white">{clockText}</div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredDraftRows.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-5 py-10 text-center text-gray-300">
                        No leagues found. Try adjusting filters or hit Refresh.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {renderMobileDetailModal()}
            </div>
          </div>

          {/* DESKTOP: full table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/20 text-gray-200">
                <tr>
                  <th className="px-5 py-3">
                    <SortHeader
                      label="League"
                      col="leagueName"
                      {...{ sortKey, sortDir, setSortKey, setSortDir }}
                    />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader
                      label="Status"
                      col="draftStatus"
                      {...{ sortKey, sortDir, setSortKey, setSortDir }}
                    />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader
                      label="Current Pick"
                      col="currentPick"
                      {...{ sortKey, sortDir, setSortKey, setSortDir }}
                    />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader
                      label="Who's Up"
                      col="nextOwnerName"
                      {...{ sortKey, sortDir, setSortKey, setSortDir }}
                    />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader
                      label="Your Pick"
                      col="myNextPickOverall"
                      {...{ sortKey, sortDir, setSortKey, setSortDir }}
                    />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader
                      label="Up In"
                      col="picksUntilMyPick"
                      {...{ sortKey, sortDir, setSortKey, setSortDir }}
                    />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader
                      label="ETA"
                      col="etaMs"
                      {...{ sortKey, sortDir, setSortKey, setSortDir }}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDraftRows.map((r) => {
                  const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));
                  const rawClockLeft = Math.max(0, safeNum(r.clockLeftMs) - elapsed);
                  const attention = getRowAttentionState(r, rawClockLeft);
                  const clockText = getDisplayClockText(attention, rawClockLeft);
                  const liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);
                  const etaHuman = getDisplayEtaText(r, attention, liveEta) || "—";

                  const statusTone =
                    r.draftStatus === "drafting"
                      ? "green"
                      : r.draftStatus === "paused"
                      ? "yellow"
                      : r.draftStatus === "complete"
                      ? "gray"
                      : "yellow";

                  return (
                    <tr
                      key={r.leagueId}
                      className={classNames(
                        "border-t border-white/5 hover:bg-white/5",
                        attention.rowTone
                      )}
                    >
                      <td className="px-5 py-4">
                        <div>
                          <div className="text-white font-semibold">{r.leagueName}</div>
                          <div className="text-xs text-gray-400">
                            {r.teams ? `${r.teams} teams` : "—"}
                            {r.rounds ? ` · ${r.rounds} rounds` : ""}
                            {r.timerSec ? ` · ${r.timerSec}s timer` : ""}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <Pill tone={statusTone}>{r.draftStatus || "—"}</Pill>
                      </td>
                      <td className="px-5 py-4">
                        {r.currentPick ? (
                          <div className="flex flex-col">
                            <span className="text-gray-100">{nf0.format(r.currentPick)}</span>
                            {attention.showOnClockBadge && clockText && (
                              <span className="text-xs text-gray-400">
                                {attention.isPaused ? "Paused on your pick" : `${clockText} left`}
                              </span>
                            )}
                            {!attention.showOnClockBadge && attention.isPaused && (
                              <span className="text-xs text-yellow-200/80">paused</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-gray-100">{r.nextOwnerName || "—"}</td>
                      <td className="px-5 py-4">
                        {r.myNextPickOverall ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Pill tone="purple">#{nf0.format(r.myNextPickOverall)}</Pill>
                            {attention.showOnClockBadge && clockText && (
                              <Pill tone="green">ON CLOCK · {clockText}</Pill>
                            )}
                            {attention.showOnDeckBadge && (
                              <Pill tone="yellow">ON DECK</Pill>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {r.picksUntilMyPick != null ? (
                          <Pill tone={r.picksUntilMyPick <= 1 ? "yellow" : "cyan"}>
                            {r.picksUntilMyPick}
                          </Pill>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {r.myNextPickOverall ? (
                          <div className="flex flex-col">
                            <span className="text-white font-semibold">{etaHuman}</span>
                            <span className="text-xs text-gray-400">
                              {attention.isPaused
                                ? "ETA unavailable while paused"
                                : `uses ${r.timerSec ? `${r.timerSec}s` : "timer"} / pick`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
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

          
        </div>
      )}
    </div>
  );
}
