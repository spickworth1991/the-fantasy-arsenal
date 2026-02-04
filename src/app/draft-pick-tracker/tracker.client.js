"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";

const TABS = {
  DRAFTING: "Drafting",
  PICKS: "Future Picks",
};

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
    <span className={classNames("inline-flex items-center px-2.5 py-1 rounded-full text-xs border", tones[tone] || tones.gray)}>
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
      {active && <span className="text-xs opacity-80">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

/**
 * Draft Pick Tracker
 * - Pull leagues from context (already fetched on login)
 * - For each league with a draft_id, fetch draft + picks + traded_picks
 * - Compute:
 *   - currentPick = picks.length + 1
 *   - yourNextPick + ETA using avg pick time or timer fallback
 */
export default function DraftPickTrackerClient() {
  const { username, leagues, year } = useSleeper();

  const [tab, setTab] = useState(TABS.DRAFTING);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [search, setSearch] = useState("");
  const [onlyDrafting, setOnlyDrafting] = useState(true);

  const [sortKey, setSortKey] = useState("etaMs"); // default: soonest pick
  const [sortDir, setSortDir] = useState("asc");

  const [rows, setRows] = useState([]); // drafting rows
  const [pickRows, setPickRows] = useState([]); // traded picks rows

  // Live ticker so ETAs count down without refetching
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Helper: map roster_id -> display name
  const buildRosterNameMap = (users = [], rosters = []) => {
    const ownerToName = new Map();
    (users || []).forEach((u) => {
      const nm = u?.display_name || u?.metadata?.team_name || u?.user_id;
      if (u?.user_id) ownerToName.set(String(u.user_id), nm);
    });
    const rosterToName = new Map();
    (rosters || []).forEach((r) => {
      const nm = ownerToName.get(String(r?.owner_id)) || r?.owner_id || `Roster ${r?.roster_id}`;
      rosterToName.set(String(r?.roster_id), nm);
    });
    return rosterToName;
  };

  const isDraftingLeague = (lg) => {
    const st = String(lg?.status || "").toLowerCase();
    // Sleeper league status can be "in_season" etc. Draft status is in draft endpoint.
    // We'll treat "has draft_id" as eligible; actual drafting is determined by draft.status.
    return !!lg?.draft_id && st !== "complete";
  };

  async function fetchDraftBundle(league) {
    const leagueId = league?.league_id;
    const draftId = league?.draft_id;
    if (!draftId) return null;

    const [draftRes, picksRes, tradedRes, usersRes, rostersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/draft/${draftId}`),
      fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`),
      fetch(`https://api.sleeper.app/v1/draft/${draftId}/traded_picks`),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    ]);

    if (!draftRes.ok) throw new Error(`Draft fetch failed: ${league?.name || leagueId}`);
    const draft = await draftRes.json();
    const picks = picksRes.ok ? await picksRes.json() : [];
    const traded_picks = tradedRes.ok ? await tradedRes.json() : [];
    const users = usersRes.ok ? await usersRes.json() : [];
    const rosters = rostersRes.ok ? await rostersRes.json() : [];

    return { league, draft, picks: Array.isArray(picks) ? picks : [], traded_picks: Array.isArray(traded_picks) ? traded_picks : [], users, rosters };
  }

  function computeAvgPickMs(picks) {
    // picks include picked_at timestamps (ms). Use deltas between consecutive picks.
    const ts = (picks || [])
      .map((p) => safeNum(p?.picked_at))
      .filter((x) => x > 0)
      .sort((a, b) => a - b);

    if (ts.length < 4) return 0; // need some data
    const deltas = [];
    for (let i = 1; i < ts.length; i++) {
      const d = ts[i] - ts[i - 1];
      // ignore absurd gaps (overnight pauses); keep 5s..2h
      if (d >= 5000 && d <= 2 * 60 * 60 * 1000) deltas.push(d);
    }
    if (deltas.length < 3) return 0;
    deltas.sort((a, b) => a - b);
    // median
    return deltas[Math.floor(deltas.length / 2)];
  }

  function getUserRosterIdForLeague(users, rosters) {
    const u = (users || []).find((x) => String(x?.display_name || "").toLowerCase() === String(username || "").toLowerCase());
    if (!u?.user_id) return null;
    const r = (rosters || []).find((x) => String(x?.owner_id) === String(u.user_id));
    return r?.roster_id ? String(r.roster_id) : null;
  }

  function calcPickInfo({ league, draft, picks, users, rosters }) {
    const rosterName = buildRosterNameMap(users, rosters);

    const draftStatus = String(draft?.status || "").toLowerCase(); // "drafting", "complete", etc.
    const rounds = safeNum(draft?.settings?.rounds);
    const slots = safeNum(draft?.settings?.teams);
    const timerSec = safeNum(draft?.settings?.pick_timer);

    const currentPick = (picks?.length || 0) + 1;

    // Draft order: maps roster_id -> slot (or vice versa). Sleeper uses draft_order: { roster_id: slot }
    const draftOrder = draft?.draft_order || {};
    const slotByRoster = new Map();
    Object.keys(draftOrder || {}).forEach((rosterId) => {
      slotByRoster.set(String(rosterId), safeNum(draftOrder[rosterId]));
    });

    // Build reverse mapping slot -> roster_id
    const rosterBySlot = new Map();
    slotByRoster.forEach((slot, rosterId) => {
      if (slot) rosterBySlot.set(slot, rosterId);
    });

    // Determine next roster up:
    // For snake drafts: derive round + pickInRound from currentPick and slots.
    const totalSlots = slots || safeNum(draft?.settings?.slots) || 0;
    const s = totalSlots > 0 ? totalSlots : 0;

    let nextRosterId = null;
    if (s > 0) {
      const pickIndex0 = currentPick - 1;
      const round = Math.floor(pickIndex0 / s) + 1;
      const pickInRound0 = pickIndex0 % s; // 0..s-1
      const isReverse = round % 2 === 0;
      const slot = isReverse ? s - pickInRound0 : pickInRound0 + 1;
      nextRosterId = rosterBySlot.get(slot) || null;
    }

    const nextOwnerName = nextRosterId ? (rosterName.get(String(nextRosterId)) || `Roster ${nextRosterId}`) : "—";

    // Your next pick:
    const myRosterId = getUserRosterIdForLeague(users, rosters);
    let myNextPickOverall = null;
    if (myRosterId && s > 0) {
      // Find the first pick number >= currentPick that belongs to myRosterId in the snake sequence.
      for (let pk = currentPick; pk <= (rounds > 0 && s > 0 ? rounds * s : currentPick + 500); pk++) {
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

    // ETA calc:
    const avgMs = computeAvgPickMs(picks);
    const fallbackMs = timerSec > 0 ? timerSec * 1000 : 90 * 1000;
    const perPickMs = avgMs > 0 ? avgMs : fallbackMs;

    let etaMs = 0;
    if (myNextPickOverall != null) {
      const picksUntil = Math.max(0, myNextPickOverall - currentPick);
      etaMs = picksUntil * perPickMs;
    } else {
      etaMs = 0;
    }

    return {
      leagueId: league?.league_id,
      leagueName: league?.name || "Unnamed League",
      season: league?.season || year,
      draftId: draft?.draft_id || draft?.draft_id || league?.draft_id,
      draftStatus,
      currentPick,
      nextOwnerName,
      myNextPickOverall,
      etaMs,
      perPickMs,
      timerSec,
      teams: s,
      rounds,
    };
  }

  function buildTradedPickRows({ league, draft, traded_picks, users, rosters }) {
    const rosterName = buildRosterNameMap(users, rosters);
    const out = [];

    (traded_picks || []).forEach((tp) => {
      const season = safeNum(tp?.season);
      const round = safeNum(tp?.round);
      const rosterId = tp?.roster_id != null ? String(tp.roster_id) : "";
      const prevOwnerId = tp?.previous_owner_id != null ? String(tp.previous_owner_id) : "";
      const ownerId = tp?.owner_id != null ? String(tp.owner_id) : "";

      // Only show future-ish picks (season >= current league season)
      const lgSeason = safeNum(league?.season || 0);
      if (season && lgSeason && season < lgSeason) return;

      out.push({
        leagueId: league?.league_id,
        leagueName: league?.name || "Unnamed League",
        draftStatus: String(draft?.status || "").toLowerCase(),
        season,
        round,
        originalRoster: rosterId ? (rosterName.get(rosterId) || `Roster ${rosterId}`) : "—",
        from: prevOwnerId ? (rosterName.get(prevOwnerId) || `Roster ${prevOwnerId}`) : "—",
        to: ownerId ? (rosterName.get(ownerId) || `Roster ${ownerId}`) : "—",
      });
    });

    return out;
  }

  async function refresh() {
    setErr("");
    setLoading(true);
    try {
      const eligible = (leagues || []).filter((lg) => !!lg?.draft_id);
      const bundles = [];

      // Keep it reasonable: only leagues in the selected year (or current) with a draft_id.
      // If you want “all years”, we can expand later.
      for (const lg of eligible) {
        try {
          const b = await fetchDraftBundle(lg);
          if (b) bundles.push(b);
        } catch (e) {
          console.warn("Draft bundle failed:", lg?.name, e);
        }
      }

      const draftRows = [];
      const tradedRows = [];

      bundles.forEach((b) => {
        const info = calcPickInfo(b);
        draftRows.push(info);

        const tps = buildTradedPickRows(b);
        tradedRows.push(...tps);
      });

      setRows(draftRows);
      setPickRows(tradedRows);
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

  const filteredDraftRows = useMemo(() => {
    const q = String(search || "").toLowerCase().trim();
    let r = rows || [];

    if (onlyDrafting) r = r.filter((x) => x.draftStatus === "drafting");
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

      // strings
      if (typeof av === "string" || typeof bv === "string") {
        return String(av || "").localeCompare(String(bv || "")) * dir;
      }
      return (safeNum(av) - safeNum(bv)) * dir;
    });

    return r;
  }, [rows, search, onlyDrafting, sortKey, sortDir]);

  const filteredPickRows = useMemo(() => {
    const q = String(search || "").toLowerCase().trim();
    let r = pickRows || [];
    if (q) {
      r = r.filter((x) => {
        return (
          String(x.leagueName || "").toLowerCase().includes(q) ||
          String(x.originalRoster || "").toLowerCase().includes(q) ||
          String(x.from || "").toLowerCase().includes(q) ||
          String(x.to || "").toLowerCase().includes(q) ||
          String(x.season || "").includes(q) ||
          String(x.round || "").includes(q)
        );
      });
    }
    // stable sort by season then round
    r = [...r].sort((a, b) => {
      if (a.season !== b.season) return safeNum(a.season) - safeNum(b.season);
      if (a.round !== b.round) return safeNum(a.round) - safeNum(b.round);
      return String(a.leagueName || "").localeCompare(String(b.leagueName || ""));
    });
    return r;
  }, [pickRows, search]);

  return (
    <div className="mt-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold text-white">Draft Pick Tracker</h2>
            <Pill tone="purple">NEW</Pill>
          </div>
          <p className="text-gray-300 mt-1">
            Live ETAs for your next pick across leagues — plus future pick ownership from traded picks.
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
              placeholder="Search league / owner / pick…"
              className="w-full sm:w-[360px] px-4 py-2 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />

            {tab === TABS.DRAFTING && (
              <label className="inline-flex items-center gap-2 text-gray-200 select-none">
                <input
                  type="checkbox"
                  checked={onlyDrafting}
                  onChange={(e) => setOnlyDrafting(e.target.checked)}
                />
                Only actively drafting
              </label>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setTab(TABS.DRAFTING)}
              className={classNames(
                "px-4 py-2 rounded-xl border text-sm font-semibold transition",
                tab === TABS.DRAFTING
                  ? "bg-white/10 border-white/20 text-white"
                  : "bg-black/20 border-white/10 text-gray-200 hover:bg-white/5"
              )}
            >
              {TABS.DRAFTING}
            </button>
            <button
              onClick={() => setTab(TABS.PICKS)}
              className={classNames(
                "px-4 py-2 rounded-xl border text-sm font-semibold transition",
                tab === TABS.PICKS
                  ? "bg-white/10 border-white/20 text-white"
                  : "bg-black/20 border-white/10 text-gray-200 hover:bg-white/5"
              )}
            >
              {TABS.PICKS}
            </button>
          </div>
        </div>

        {err && <p className="text-red-300 mt-3">{err}</p>}
      </div>

      {/* Drafting Table */}
      {tab === TABS.DRAFTING && (
        <div className="mt-6 bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pill tone="cyan">{filteredDraftRows.length} leagues</Pill>
              <Pill tone="blue">Live ETA</Pill>
            </div>
            <div className="text-xs text-gray-400">
              ETA uses median pick time (or timer fallback)
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/20 text-gray-200">
                <tr>
                  <th className="px-5 py-3">
                    <SortHeader label="League" col="leagueName" {...{ sortKey, sortDir, setSortKey, setSortDir }} />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader label="Status" col="draftStatus" {...{ sortKey, sortDir, setSortKey, setSortDir }} />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader label="Current Pick" col="currentPick" {...{ sortKey, sortDir, setSortKey, setSortDir }} />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader label="Next Up" col="nextOwnerName" {...{ sortKey, sortDir, setSortKey, setSortDir }} />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader label="Your Next Pick" col="myNextPickOverall" {...{ sortKey, sortDir, setSortKey, setSortDir }} />
                  </th>
                  <th className="px-5 py-3">
                    <SortHeader label="ETA" col="etaMs" {...{ sortKey, sortDir, setSortKey, setSortDir }} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDraftRows.map((r) => {
                  const liveEta = Math.max(0, safeNum(r.etaMs) - (0)); // eta is relative
                  const human = r.myNextPickOverall ? msToHuman(liveEta) : "—";

                  const statusTone = r.draftStatus === "drafting" ? "green" : r.draftStatus === "complete" ? "gray" : "yellow";

                  return (
                    <tr key={r.leagueId} className="border-t border-white/5 hover:bg-white/5">
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-white font-semibold">{r.leagueName}</div>
                            <div className="text-xs text-gray-400">
                              {r.teams ? `${r.teams} teams` : "—"}{r.rounds ? ` · ${r.rounds} rounds` : ""}{r.timerSec ? ` · ${r.timerSec}s timer` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <Pill tone={statusTone}>{r.draftStatus || "—"}</Pill>
                      </td>
                      <td className="px-5 py-4 text-gray-100">{r.currentPick ? nf0.format(r.currentPick) : "—"}</td>
                      <td className="px-5 py-4 text-gray-100">{r.nextOwnerName || "—"}</td>
                      <td className="px-5 py-4">
                        {r.myNextPickOverall ? (
                          <div className="flex items-center gap-2">
                            <Pill tone="purple">#{nf0.format(r.myNextPickOverall)}</Pill>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {r.myNextPickOverall ? (
                          <div className="flex flex-col">
                            <span className="text-white font-semibold">{human}</span>
                            <span className="text-xs text-gray-400">
                              ~{msToHuman(r.perPickMs)} / pick
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
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-300">
                      No leagues found. Try turning off “Only actively drafting” or hit Refresh.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Future Picks / Traded Picks */}
      {tab === TABS.PICKS && (
        <div className="mt-6 bg-gray-900/70 border border-white/10 rounded-2xl shadow-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pill tone="cyan">{filteredPickRows.length} traded picks</Pill>
              <Pill tone="yellow">Best-effort</Pill>
            </div>
            <div className="text-xs text-gray-400">
              Sleeper provides ownership; “what they got” requires trade transaction linking (phase 2)
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/20 text-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left">League</th>
                  <th className="px-5 py-3 text-left">Pick</th>
                  <th className="px-5 py-3 text-left">Original</th>
                  <th className="px-5 py-3 text-left">From</th>
                  <th className="px-5 py-3 text-left">To</th>
                </tr>
              </thead>
              <tbody>
                {filteredPickRows.map((r, idx) => (
                  <tr key={`${r.leagueId}-${r.season}-${r.round}-${idx}`} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-5 py-4">
                      <div className="text-white font-semibold">{r.leagueName}</div>
                      <div className="text-xs text-gray-400">{r.draftStatus || "—"}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-100">
                      <Pill tone="purple">
                        {r.season ? r.season : "—"} R{r.round ? r.round : "—"}
                      </Pill>
                    </td>
                    <td className="px-5 py-4 text-gray-100">{r.originalRoster}</td>
                    <td className="px-5 py-4 text-gray-100">{r.from}</td>
                    <td className="px-5 py-4 text-gray-100">{r.to}</td>
                  </tr>
                ))}

                {filteredPickRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-gray-300">
                      No traded picks found for your leagues.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 border-t border-white/10 text-xs text-gray-400">
            Next upgrade: link traded picks to trade transactions to show “what they got” and run value fairness using your existing sources.
          </div>
        </div>
      )}
    </div>
  );
}
