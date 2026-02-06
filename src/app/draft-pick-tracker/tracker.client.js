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
  const [err, setErr] = useState("");

  const [search, setSearch] = useState("");
  const [onlyDrafting, setOnlyDrafting] = useState(true);
  const [includePaused, setIncludePaused] = useState(false); // NEW

  const [view, setView] = useState("cards"); // cards | table
  const [onlyOnDeckOrClock, setOnlyOnDeckOrClock] = useState(false);
  const [maxPicksAway, setMaxPicksAway] = useState(999); // slider, 999 = off
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [sortKey, setSortKey] = useState("etaMs");
  const [sortDir, setSortDir] = useState("asc");

  const [rows, setRows] = useState([]); // computed draft rows
  const [bundles, setBundles] = useState([]); // cached bundles

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

  function computeAvgPickMs(picks) {
    const ts = (picks || [])
      .map((p) => safeNum(p?.picked_at))
      .filter((x) => x > 0)
      .sort((a, b) => a - b);

    if (ts.length < 4) return 0;
    const deltas = [];
    for (let i = 1; i < ts.length; i++) {
      const d = ts[i] - ts[i - 1];
      if (d >= 5000 && d <= 2 * 60 * 60 * 1000) deltas.push(d);
    }
    if (deltas.length < 3) return 0;
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
  }

  function playerLabel(pid) {
    const p = players?.[String(pid)];
    const name =
      String(p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`)
        .trim() || `#${pid}`;
    const pos = String(p?.position || "").trim();
    return pos ? `${name} (${pos})` : name;
  }

  async function fetchDraftBundle(league) {
    const leagueId = league?.league_id;
    const draftId = league?.draft_id;
    if (!draftId) return null;

    const [draftRes, picksRes, usersRes, rostersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/draft/${draftId}`),
      fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    ]);

    if (!draftRes.ok)
      throw new Error(`Draft fetch failed: ${league?.name || leagueId}`);
    const draft = await draftRes.json();
    const picks = picksRes.ok ? await picksRes.json() : [];
    const users = usersRes.ok ? await usersRes.json() : [];
    const rosters = rostersRes.ok ? await rostersRes.json() : [];

    return {
      league,
      draft,
      picks: Array.isArray(picks) ? picks : [],
      users,
      rosters,
    };
  }

  function calcPickInfo({ league, draft, picks, users, rosters }) {
    const rosterName = buildRosterNameMap(users, rosters);

    const draftStatus = String(draft?.status || "").toLowerCase();
    const rounds = safeNum(draft?.settings?.rounds);
    const slots = safeNum(draft?.settings?.teams);
    const timerSec = safeNum(draft?.settings?.pick_timer);

    const currentPick = (picks?.length || 0) + 1;

    const slotToRoster = draft?.slot_to_roster_id || {};
    const rosterBySlot = new Map();
    Object.keys(slotToRoster || {}).forEach((slot) => {
      const rosterId = slotToRoster[slot];
      const s = safeNum(slot);
      if (s && rosterId != null) rosterBySlot.set(s, String(rosterId));
    });

    const totalSlots = slots || safeNum(draft?.settings?.slots) || 0;
    const s = totalSlots > 0 ? totalSlots : 0;

    let nextRosterId = null;
    if (s > 0) {
      const pickIndex0 = currentPick - 1;
      const round = Math.floor(pickIndex0 / s) + 1;
      const pickInRound0 = pickIndex0 % s;
      const isReverse = round % 2 === 0;
      const slot = isReverse ? s - pickInRound0 : pickInRound0 + 1;
      nextRosterId = rosterBySlot.get(slot) || null;
    }

    const nextOwnerName = nextRosterId
      ? rosterName.get(String(nextRosterId)) || `Roster ${nextRosterId}`
      : "—";

    const myRosterId = getUserRosterIdForLeague(users, rosters);

    // Find my next pick overall
    let myNextPickOverall = null;
    if (myRosterId && s > 0) {
      const maxPk = rounds > 0 && s > 0 ? rounds * s : currentPick + 500;
      for (let pk = currentPick; pk <= maxPk; pk++) {
        const idx0 = pk - 1;
        const r = Math.floor(idx0 / s) + 1;
        const in0 = idx0 % s;
        const rev = r % 2 === 0;
        const slot = rev ? s - in0 : in0 + 1;
        const rosterIdAtPick = rosterBySlot.get(slot);
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
    const onClockRosterId = nextRosterId;
    const onClockIsMe = !!(
      myRosterId &&
      onClockRosterId &&
      String(onClockRosterId) === String(myRosterId)
    );

    // Clock left
    const lastPickTs = Math.max(
      safeNum(draft?.last_picked),
      ...(Array.isArray(picks) ? picks.map((p) => safeNum(p?.picked_at)) : [0])
    );
    const clockEndsAt =
      lastPickTs > 0 && timerSec > 0 ? lastPickTs + timerSec * 1000 : 0;
    const clockLeftMs =
      clockEndsAt > 0 ? Math.max(0, clockEndsAt - now) : 0;

    // per-pick ms
    const avgMs = computeAvgPickMs(picks);
    const fallbackMs = timerSec > 0 ? timerSec * 1000 : 90 * 1000;
    const perPickMs = avgMs > 0 ? avgMs : fallbackMs;

    // ETA = clockLeftMs + (picksUntil - 1)*perPickMs (when we have a clock)
    let etaMs = 0;
    if (picksUntilMyPick != null) {
      if (clockLeftMs > 0 && picksUntilMyPick > 0) {
        etaMs = clockLeftMs + Math.max(0, picksUntilMyPick - 1) * perPickMs;
      } else {
        etaMs = picksUntilMyPick * perPickMs;
      }
    }

    // Recent picks (last 10)
    const recent = (Array.isArray(picks) ? picks : [])
      .slice(-10)
      .reverse()
      .map((p) => ({
        player_id: p?.player_id,
        label: p?.player_id ? playerLabel(p.player_id) : "—",
        pick_no: safeNum(p?.pick_no) || null,
        picked_at: safeNum(p?.picked_at) || 0,
      }));

    const upIn = picksUntilMyPick != null ? picksUntilMyPick : null;

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
      upIn,
      etaMs,
      perPickMs,
      timerSec,
      teams: s,
      rounds,
      recent,
      computedAt: Date.now(),
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

      const draftRows = [];
      nextBundles.forEach((b) => {
        draftRows.push(calcPickInfo(b));
      });

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

  // ---------------- Filters + sorting ----------------

  const filteredDraftRows = useMemo(() => {
    const q = String(search || "").toLowerCase().trim();
    let r = rows || [];

    if (onlyDrafting) {
      // NEW: allow "paused" when requested
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
  // Keep auto-refresh tied to active "drafting" only (paused shouldn't keep polling)

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
  // Alerts should be for active drafting only (paused = no alarm)

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
            Clean, multi-league drafting dashboard: on-deck alerts, realistic
            ETAs, and recent pick momentum.
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

              {/* NEW: Include paused */}
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

      {/* Summary row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Pill tone="cyan">{totalLeagues} leagues</Pill>
        <Pill tone="blue">On-deck alert</Pill>
        <Pill tone="purple">ETA uses clock + pace</Pill>
        {includePaused && onlyDrafting && <Pill tone="yellow">Showing paused</Pill>}
      </div>

      {/* Card view */}
      {view === "cards" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {filteredDraftRows.map((r) => {
            const elapsed = Math.max(0, safeNum(now) - safeNum(r.computedAt));

            const liveClockLeft = Math.max(
              0,
              safeNum(r.clockLeftMs) - elapsed
            );
            const clockText = liveClockLeft > 0 ? msToClock(liveClockLeft) : null;

            const liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);
            const etaHuman =
              r.myNextPickOverall != null ? msToHuman(liveEta) : "—";

            const statusTone =
              r.draftStatus === "drafting"
                ? "green"
                : r.draftStatus === "paused"
                ? "yellow"
                : r.draftStatus === "complete"
                ? "gray"
                : "yellow";

            const upIn = r.upIn != null ? r.upIn : null;

            return (
              <div
                key={r.leagueId}
                className={classNames(
                  "bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden",
                  (r.onClockIsMe || r.onDeck) && r.draftStatus === "drafting" && "ring-1 ring-emerald-400/30"
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
                      {r.draftStatus === "drafting" && r.onClockIsMe && clockText && (
                        <Pill tone="green">ON CLOCK · {clockText}</Pill>
                      )}
                      {r.draftStatus === "drafting" && !r.onClockIsMe && r.onDeck && (
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
                      {r.draftStatus === "drafting" && clockText && (
                        <div className="text-xs text-gray-400 mt-1">
                          {clockText} left
                        </div>
                      )}
                      {r.draftStatus === "paused" && (
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
                        ~{msToHuman(r.perPickMs)} / pick
                      </div>
                    </div>

                    <div className="bg-black/20 border border-white/10 rounded-xl p-3">
                      <div className="text-xs text-gray-400">Pace</div>
                      <div className="text-white text-lg font-semibold">
                        {r.perPickMs ? msToHuman(r.perPickMs) : "—"}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        Median (fallback timer)
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 bg-black/20 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-white font-semibold">
                        Recent picks
                      </div>
                      <div className="text-xs text-gray-400">
                        last {Math.min(10, (r.recent || []).length)}
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      {(r.recent || []).slice(0, 10).map((p, idx) => (
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

      {/* Table view */}
      {view === "table" && (
        <div className="mt-6 bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pill tone="cyan">{filteredDraftRows.length} leagues</Pill>
              <Pill tone="blue">Live ETA</Pill>
              <Pill tone="yellow">On deck alert</Pill>
              {includePaused && onlyDrafting && <Pill tone="yellow">Paused</Pill>}
            </div>
            <div className="text-xs text-gray-400">ETA = clock + pace</div>
          </div>

          <div className="overflow-x-auto">
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
                      label="Next Up"
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
                  const liveEta = Math.max(0, safeNum(r.etaMs) - elapsed);
                  const etaHuman = r.myNextPickOverall != null ? msToHuman(liveEta) : "—";

                  const liveClockLeft = Math.max(0, safeNum(r.clockLeftMs) - elapsed);
                  const clockText = liveClockLeft > 0 ? msToClock(liveClockLeft) : null;

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
                        (r.onClockIsMe || r.onDeck) && r.draftStatus === "drafting" && "bg-emerald-500/5"
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
                            {r.draftStatus === "drafting" && clockText && (
                              <span className="text-xs text-gray-400">{clockText} left</span>
                            )}
                            {r.draftStatus === "paused" && (
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
                            {r.draftStatus === "drafting" && r.onClockIsMe && clockText && (
                              <Pill tone="green">ON CLOCK · {clockText}</Pill>
                            )}
                            {r.draftStatus === "drafting" && !r.onClockIsMe && r.onDeck && (
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
                            <span className="text-xs text-gray-400">~{msToHuman(r.perPickMs)} / pick</span>
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

          <div className="px-5 py-4 border-t border-white/10 text-xs text-gray-400">
            Tip: Card view shows the last 10 picks per league to spot positional runs.
          </div>
        </div>
      )}
    </div>
  );
}
