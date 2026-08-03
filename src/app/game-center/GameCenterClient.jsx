"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import AvatarImage from "../../components/AvatarImage";
import { useSleeper } from "../../context/SleeperContext";
import { classifyLeagueFormat } from "../../lib/leagueFormat";

const n = (value) => Number(value || 0);
const getJson = async (url) => {
  const response = await fetch(url, { cache:"no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const playerName = (players, id) => players?.[id]?.full_name || players?.[id]?.search_full_name || id;
const position = (player) => String(player?.position || player?.fantasy_positions?.[0] || "").toUpperCase();
const injury = (player) => String(player?.injury_status || "").toUpperCase();
const isRisk = (player) => ["OUT", "DOUBTFUL", "QUESTIONABLE", "IR", "PUP", "SUSPENDED"].includes(injury(player)) || String(player?.status || "").toLowerCase() === "inactive";
const isUnavailable = (player) => ["OUT", "DOUBTFUL", "IR", "PUP", "SUSPENDED"].includes(injury(player)) || String(player?.status || "").toLowerCase() === "inactive";
const isFinal = (game) => String(game?.status || "").toLowerCase().startsWith("final");
const isGameActive = (game) => {
  const status = String(game?.status || "").toLowerCase();
  return !isFinal(game) && ["live","progress","quarter","halftime","q1","q2","q3","q4","ot"].some((value) => status.includes(value));
};
const leagueFormat = (league) => {
  if (Number(league?.settings?.best_ball) === 1) return "bestball";
  if (Number(league?.settings?.type) === 2) return "dynasty";
  if (Number(league?.settings?.type) === 1) return "keeper";
  return classifyLeagueFormat(league, []).key;
};

async function concurrentMap(rows, limit, worker, onProgress) {
  const results = new Array(rows.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(Array.from({ length:Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      results[index] = await worker(rows[index], index);
      done += 1;
      onProgress?.(done, rows.length);
    }
  }));
  return results;
}

function Panel({ children, className = "" }) {
  return <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 shadow-[0_30px_90px_-65px_rgba(16,185,129,.7)] ${className}`}>{children}</div>;
}

function Stat({ label, value, detail, tone = "white" }) {
  const color = tone === "emerald" ? "text-emerald-100" : tone === "rose" ? "text-rose-100" : tone === "amber" ? "text-amber-100" : tone === "cyan" ? "text-cyan-100" : "text-white";
  return <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3"><div className="text-[9px] font-semibold uppercase tracking-[.16em] text-white/32">{label}</div><div className={`mt-1 break-words text-lg font-black sm:text-xl ${color}`}>{value}</div>{detail ? <div className="mt-1 break-words text-[10px] leading-4 text-white/32">{detail}</div> : null}</div>;
}

function weatherLine(game) {
  const roof = game?.venue?.roofType;
  const weather = game?.weather;
  if (game?.venue?.indoor) return "Indoor · no weather impact";
  const temperature = weather?.temperature ?? weather?.highTemperature;
  const pieces = [
    roof === "retractable" ? "Roof TBD" : roof === "canopy" ? "Covered · open sides" : "",
    weather?.summary || (!isFinal(game) ? "Forecast pending" : ""),
    temperature != null ? `${Math.round(temperature)}°F` : "",
    n(weather?.windSpeed) ? `${Math.round(n(weather.windSpeed))} mph wind` : "",
    n(weather?.windGusts) > n(weather?.windSpeed) + 3 ? `gusts ${Math.round(n(weather.windGusts))}` : "",
    n(weather?.precipitationProbability) ? `${Math.round(n(weather.precipitationProbability))}% precip.` : "",
  ];
  return pieces.filter(Boolean).join(" · ");
}

function matchupHref(leagueId) {
  return `https://sleeper.com/leagues/${leagueId}/matchup`;
}

export default function GameCenterClient() {
  const { username, year, leagues = [], players, getProjection, getWeeklyProjection, projectionSource } = useSleeper();
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState("command");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState("all");
  const [bestBallFilter, setBestBallFilter] = useState("include");
  const [liveMode, setLiveMode] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const priorPoints = useRef(new Map());
  const priorWinProbabilities = useRef(new Map());
  const scanRunning = useRef(false);

  useEffect(() => {
    getJson("https://api.sleeper.app/v1/state/nfl")
      .then((state) => setWeek(Math.max(1, n(state.week) || 1)))
      .catch(() => {});
  }, []);

  const scan = useCallback(async (quiet = false) => {
    if (!username || scanRunning.current) return;
    scanRunning.current = true;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const root = await getJson(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`);
      const scanned = await concurrentMap(leagues, 12, async (league) => {
        try {
          const [rosters, users, matchups] = await Promise.all([
            league.rosters?.length ? Promise.resolve(league.rosters) : getJson(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
            league.users?.length ? Promise.resolve(league.users) : getJson(`https://api.sleeper.app/v1/league/${league.league_id}/users`),
            getJson(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`),
          ]);
          const mine = rosters.find((roster) => String(roster.owner_id) === String(root.user_id));
          if (!mine) return null;
          const myMatch = matchups.find((matchup) => String(matchup.roster_id) === String(mine.roster_id));
          if (!myMatch) return null;
          const opponentMatch = matchups.find((matchup) => matchup.matchup_id === myMatch.matchup_id && String(matchup.roster_id) !== String(mine.roster_id));
          const opponentRoster = rosters.find((roster) => String(roster.roster_id) === String(opponentMatch?.roster_id));
          const opponentUser = users.find((user) => String(user.user_id) === String(opponentRoster?.owner_id));
          return {
            league:{ ...league, rosters, users },
            mine,
            myMatch,
            opponentMatch,
            opponentRoster,
            opponentName:opponentUser?.metadata?.team_name || opponentUser?.display_name || opponentUser?.username || "Opponent",
          };
        } catch {
          return null;
        }
      }, quiet ? undefined : (done, total) => setProgress(`Scanning ${done}/${total} leagues`));
      const schedule = await getJson(`/api/nfl-scoreboard?season=${year || new Date().getFullYear()}&week=${week}`).catch(() => ({ games:[] }));
      setRows(scanned.filter(Boolean));
      setGames(schedule.games || []);
      setLastUpdated(new Date());
    } catch {
      setError("The portfolio scan could not be completed. Your previous results have been preserved.");
    } finally {
      scanRunning.current = false;
      setLoading(false);
      setProgress("");
    }
  }, [username, leagues, week, year]);

  useEffect(() => {
    if (username && leagues.length) scan(false);
  }, [username, week]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRows = useMemo(() => rows.filter((row) => {
    const format = leagueFormat(row.league);
    if (bestBallFilter === "exclude" && format === "bestball") return false;
    if (bestBallFilter === "only" && format !== "bestball") return false;
    return formatFilter === "all" || format === formatFilter;
  }), [rows, formatFilter, bestBallFilter]);

  const gameByTeam = useMemo(() => {
    const map = new Map();
    games.forEach((game) => (game.teams || []).forEach((team) => map.set(team, game)));
    return map;
  }, [games]);
  const activeGameCount = useMemo(() => games.filter(isGameActive).length, [games]);
  const upcomingSoon = useMemo(() => games.some((game) => {
    const kickoff = new Date(game?.date || 0).getTime();
    return !isFinal(game) && kickoff > Date.now() && kickoff - Date.now() < 90 * 60 * 1000;
  }), [games]);
  const liveRefreshSeconds = activeGameCount ? 10 : upcomingSoon ? 30 : 90;

  useEffect(() => {
    if (!liveMode) return undefined;
    let timer;
    let stopped = false;
    const schedule = () => {
      const hiddenMultiplier = document.visibilityState === "hidden" ? 4 : 1;
      timer = window.setTimeout(async () => {
        await scan(true);
        if (!stopped) schedule();
      }, liveRefreshSeconds * hiddenMultiplier * 1000);
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (!stopped) schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [liveMode, liveRefreshSeconds, scan]);

  const weeklyProjection = useCallback((id) => {
    if (projectionSource === "ARSENAL_MODEL") {
      return n(getWeeklyProjection?.(players?.[id], projectionSource, week));
    }
    return n(getProjection?.(players?.[id], projectionSource)) / 17;
  }, [getProjection, getWeeklyProjection, players, projectionSource, week]);

  const matchupRows = useMemo(() => visibleRows.map((row) => {
    const myIds = (row.myMatch?.starters || []).map(String).filter((id) => id && id !== "0");
    const opponentIds = (row.opponentMatch?.starters || []).map(String).filter((id) => id && id !== "0");
    const remaining = (ids) => ids.filter((id) => !isFinal(gameByTeam.get(players?.[id]?.team)));
    const myRemaining = remaining(myIds);
    const opponentRemaining = remaining(opponentIds);
    const myRemainingProjection = myRemaining.reduce((sum, id) => sum + weeklyProjection(id), 0);
    const opponentRemainingProjection = opponentRemaining.reduce((sum, id) => sum + weeklyProjection(id), 0);
    const actual = n(row.myMatch?.points);
    const opponentActual = n(row.opponentMatch?.points);
    const projected = actual + myRemainingProjection;
    const opponentProjected = opponentActual + opponentRemainingProjection;
    const winProbability = Math.round(100 / (1 + Math.exp(-(projected - opponentProjected) / 12)));
    const emptySlots = (row.myMatch?.starters || []).filter((id) => !id || id === "0").length;
    const riskyStarters = myIds.filter((id) => isRisk(players?.[id]));
    const startedSet = new Set(myIds);
    const benchIds = (row.mine?.players || []).map(String).filter((id) => !startedSet.has(id));
    const lateSwap = riskyStarters.map((starterId) => {
      const starter = players?.[starterId];
      const starterGame = gameByTeam.get(starter?.team);
      const replacement = benchIds
        .filter((id) => position(players?.[id]) === position(starter) && !isUnavailable(players?.[id]))
        .filter((id) => {
          const game = gameByTeam.get(players?.[id]?.team);
          return game && !isFinal(game) && new Date(game.date).getTime() >= new Date(starterGame?.date || 0).getTime();
        })
        .sort((a, b) => weeklyProjection(b) - weeklyProjection(a))[0];
      return replacement ? { starterId, replacement } : null;
    }).filter(Boolean);
    const completed = !myRemaining.length && !opponentRemaining.length;
    const status = completed ? "completed" : projected > opponentProjected ? "winning" : projected < opponentProjected ? "losing" : "close";
    return {
      ...row,
      actual,
      opponentActual,
      projected,
      opponentProjected,
      myRemaining,
      opponentRemaining,
      winProbability,
      margin:Math.abs(projected - opponentProjected),
      status,
      emptySlots,
      riskyStarters,
      lateSwap,
    };
  }), [visibleRows, gameByTeam, players, weeklyProjection]);

  const playerRows = useMemo(() => {
    const map = new Map();
    matchupRows.forEach((row) => {
      const add = (id, side, points) => {
        if (!id || id === "0") return;
        const current = map.get(id) || { id, for:[], against:[], points:0 };
        current[side].push({ league:row.league, opponent:row.opponentName, points:n(points) });
        current.points = Math.max(current.points, n(points));
        map.set(id, current);
      };
      (row.myMatch?.starters || []).map(String).forEach((id) => add(id, "for", row.myMatch?.players_points?.[id]));
      (row.opponentMatch?.starters || []).map(String).forEach((id) => add(id, "against", row.opponentMatch?.players_points?.[id]));
    });
    return [...map.values()].map((row) => {
      const player = players?.[row.id];
      return {
        ...row,
        player,
        name:playerName(players, row.id),
        game:gameByTeam.get(player?.team),
        conflict:row.for.length > 0 && row.against.length > 0,
        impact:row.for.length + row.against.length,
        projection:weeklyProjection(row.id),
      };
    }).sort((a, b) => String(a.game?.date || "9999").localeCompare(String(b.game?.date || "9999")) || b.impact - a.impact);
  }, [matchupRows, players, gameByTeam, weeklyProjection]);

  useEffect(() => {
    if (!liveMode || !playerRows.length) {
      priorPoints.current = new Map(playerRows.map((row) => [row.id, row.points]));
      return;
    }
    const nextEvents = [];
    playerRows.forEach((row) => {
      const previous = priorPoints.current.get(row.id);
      const delta = previous == null ? 0 : row.points - previous;
      if (delta >= 1 && row.impact >= 2) {
        nextEvents.push({
          id:`${Date.now()}-${row.id}`,
          text:`${row.name} added ${delta.toFixed(1)} points and changed ${row.impact} of your matchups.`,
        });
      }
    });
    priorPoints.current = new Map(playerRows.map((row) => [row.id, row.points]));
    if (nextEvents.length) setLiveEvents((current) => [...nextEvents, ...current].slice(0, 8));
  }, [playerRows, liveMode]);

  useEffect(() => {
    if (!liveMode || !matchupRows.length) {
      priorWinProbabilities.current = new Map(matchupRows.map((row) => [String(row.league.league_id), row.winProbability]));
      return;
    }
    const alerts = [];
    matchupRows.forEach((row) => {
      const id = String(row.league.league_id);
      const previous = priorWinProbabilities.current.get(id);
      if (previous == null) return;
      const crossed = (previous < 50 && row.winProbability >= 50) || (previous >= 50 && row.winProbability < 50);
      const becameClose = Math.abs(previous - 50) > 10 && Math.abs(row.winProbability - 50) <= 10;
      if (crossed || becameClose) alerts.push({
        id:`matchup-${Date.now()}-${id}`,
        text:crossed
          ? `${row.league.name} flipped to ${row.winProbability >= 50 ? "your side" : row.opponentName} (${row.winProbability}% win probability).`
          : `${row.league.name} moved into one-play territory at ${row.winProbability}% win probability.`,
      });
    });
    priorWinProbabilities.current = new Map(matchupRows.map((row) => [String(row.league.league_id), row.winProbability]));
    if (alerts.length) setLiveEvents((current) => [...alerts, ...current].slice(0, 12));
  }, [liveMode, matchupRows]);

  const counts = useMemo(() => ({
    winning:matchupRows.filter((row) => row.status === "winning").length,
    losing:matchupRows.filter((row) => row.status === "losing").length,
    close:matchupRows.filter((row) => !["completed"].includes(row.status) && row.margin <= 10).length,
    completed:matchupRows.filter((row) => row.status === "completed").length,
  }), [matchupRows]);
  const totalActual = matchupRows.reduce((sum, row) => sum + row.actual, 0);
  const totalProjected = matchupRows.reduce((sum, row) => sum + row.projected, 0);
  const riskyLineups = matchupRows.filter((row) => row.riskyStarters.length || row.emptySlots);
  const lateSwaps = matchupRows.flatMap((row) => row.lateSwap.map((swap) => ({ ...swap, row })));
  const averageWin = matchupRows.length ? matchupRows.reduce((sum, row) => sum + row.winProbability, 0) / matchupRows.length : 0;
  const compliancePenalty = riskyLineups.reduce((sum, row) => sum + row.emptySlots * 10 + row.riskyStarters.length * 3, 0);
  const gradeScore = Math.max(0, Math.min(100, averageWin - compliancePenalty / Math.max(1, matchupRows.length)));
  const grade = gradeScore >= 90 ? "A+" : gradeScore >= 83 ? "A" : gradeScore >= 75 ? "B" : gradeScore >= 65 ? "C" : gradeScore >= 55 ? "D" : "F";
  const swingPlayers = [...playerRows].sort((a, b) => b.impact * b.projection - a.impact * a.projection).slice(0, 10);
  const gameGroups = [...games].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const filteredPlayers = playerRows.filter((row) => !query.trim() || `${row.name} ${row.player?.team} ${row.player?.position}`.toLowerCase().includes(query.toLowerCase()));
  const filteredMatchups = matchupRows.filter((row) => filter === "all" || (filter === "close" ? row.margin <= 10 && row.status !== "completed" : filter === "not-started" ? row.actual === 0 && row.opponentActual === 0 : row.status === filter));

  const shellClass = liveMode
    ? "fixed inset-0 z-[105] h-[100dvh] overflow-y-auto overscroll-contain bg-slate-950 text-white"
    : "min-h-screen text-white";

  return <main className={shellClass}>
    <BackgroundParticles />
    {!liveMode ? <Navbar pageTitle="Game Center" /> : null}
    <div className={`mx-auto max-w-[1600px] px-3 pb-20 sm:px-4 ${liveMode ? "pt-[max(1rem,env(safe-area-inset-top))]" : "pt-20"}`}>
      <header className="rounded-[30px] border border-emerald-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(16,185,129,.2),transparent_36%),radial-gradient(circle_at_8%_100%,rgba(34,211,238,.13),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-4 sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[.24em] text-emerald-200/60"><span>Weekly portfolio command</span>{liveMode ? <span className="rounded-full bg-emerald-300/12 px-2 py-1 tracking-normal text-emerald-100">LIVE · {liveRefreshSeconds}s{activeGameCount ? ` · ${activeGameCount} game${activeGameCount === 1 ? "" : "s"} active` : " · waiting for kickoff"}</span> : null}</div>
            <h1 className="mt-2 text-3xl font-black sm:text-5xl">Fantasy Game Center</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">One Sunday screen for scores, remaining players, lineup risk, late swaps, conflicts, weather, and the plays moving several leagues at once.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => scan(false)} disabled={loading} className="min-h-11 rounded-2xl bg-white/[0.06] px-4 py-2 text-xs font-bold text-white/70 disabled:opacity-40">{loading ? progress || "Refreshing…" : "Refresh now"}</button>
            <button type="button" onClick={() => setLiveMode((value) => !value)} className={`min-h-11 rounded-2xl px-5 py-2 text-xs font-black ${liveMode ? "bg-rose-300/12 text-rose-100" : "bg-emerald-300/12 text-emerald-100"}`}>{liveMode ? "Exit Live Mode" : "Enter Sunday Live Mode"}</button>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-[110px_170px_170px_1fr]">
          <select value={week} onChange={(event) => setWeek(n(event.target.value))} className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm">{Array.from({ length:18 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>Week {value}</option>)}</select>
          <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm"><option value="all">All league types</option><option value="dynasty">Dynasty</option><option value="keeper">Keeper</option><option value="redraft">Redraft</option><option value="bestball">Best Ball</option></select>
          <select value={bestBallFilter} onChange={(event) => setBestBallFilter(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm"><option value="include">Include Best Ball</option><option value="exclude">Exclude Best Ball</option><option value="only">Only Best Ball</option></select>
          <div className="flex items-center justify-end text-[10px] text-white/30">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour:"numeric", minute:"2-digit", second:"2-digit" })}` : "Waiting for first scan"}</div>
        </div>
      </header>

      {error ? <div className="mt-4 rounded-2xl border border-rose-300/15 bg-rose-300/[0.07] p-4 text-sm text-rose-100">{error}</div> : null}
      {!username ? <Panel className="mt-5 p-8 text-center text-white/50">Load a Sleeper portfolio to build its weekly command center.</Panel> : null}

      {username ? <>
        <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          <Stat label="Actual points" value={totalActual.toFixed(1)} detail={`${matchupRows.length} leagues`} tone="cyan" />
          <Stat label="Projected finish" value={totalProjected.toFixed(1)} detail={`+${Math.max(0, totalProjected - totalActual).toFixed(1)} remaining`} tone="emerald" />
          <Stat label="Winning" value={counts.winning} tone="emerald" />
          <Stat label="Losing" value={counts.losing} tone="rose" />
          <Stat label="Close" value={counts.close} detail="Within 10 projected" tone="amber" />
          <Stat label="Completed" value={counts.completed} />
          <Stat label="Lineup actions" value={riskyLineups.length} detail={`${lateSwaps.length} late swaps`} tone={riskyLineups.length ? "amber" : "emerald"} />
          <Stat label="Portfolio grade" value={grade} detail={`${Math.round(gradeScore)} command score`} tone={gradeScore >= 75 ? "emerald" : gradeScore >= 55 ? "amber" : "rose"} />
        </section>

        <Panel className="sticky top-0 z-30 mt-4 overflow-x-auto rounded-2xl bg-slate-950/95 p-2 backdrop-blur-xl">
          <div className="flex w-max gap-1">{[["command", "Command"], ["timeline", "Player Timeline"], ["matchups", "Matchups"]].map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`min-h-11 rounded-xl px-4 py-2 text-sm font-semibold ${tab === key ? "bg-white/10 text-white" : "text-white/42"}`}>{label}</button>)}</div>
        </Panel>

        {tab === "command" ? <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
          <div className="space-y-4">
            <Panel className="overflow-hidden">
              <div className="border-b border-white/10 p-4 sm:p-5"><div className="text-[10px] font-semibold uppercase tracking-[.2em] text-amber-200/50">Decision queue</div><h2 className="mt-1 text-2xl font-black">Act before kickoff</h2><p className="mt-1 text-xs text-white/35">Empty slots and unavailable starters are prioritized ahead of speculative swaps.</p></div>
              <div className="divide-y divide-white/[0.06]">
                {riskyLineups.sort((a, b) => b.emptySlots - a.emptySlots || b.riskyStarters.length - a.riskyStarters.length).map((row) => <a key={row.league.league_id} href={matchupHref(row.league.league_id)} target="_blank" rel="noreferrer" className="flex min-h-16 min-w-0 items-start gap-3 p-3 transition hover:bg-white/[0.04] sm:items-center sm:p-4"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${row.emptySlots ? "bg-rose-300/10 text-rose-100" : "bg-amber-300/10 text-amber-100"}`}>{row.emptySlots ? "!" : "⚕"}</div><div className="min-w-0 flex-1"><div className="break-words font-bold">{row.league.name}</div><div className="mt-1 break-words text-xs leading-5 text-white/38">{row.emptySlots ? `${row.emptySlots} empty starting slot${row.emptySlots === 1 ? "" : "s"}` : ""}{row.emptySlots && row.riskyStarters.length ? " · " : ""}{row.riskyStarters.map((id) => `${playerName(players, id)} (${injury(players?.[id]) || "inactive"})`).join(" · ")}</div><span className="mt-2 inline-block text-[10px] font-semibold text-cyan-100 sm:hidden">Open lineup ↗</span></div><span className="hidden shrink-0 text-[10px] font-semibold text-cyan-100 sm:block">Open lineup ↗</span></a>)}
                {!riskyLineups.length ? <div className="p-6 text-sm text-emerald-100/65">No empty slots or injury-designated starters detected.</div> : null}
              </div>
            </Panel>
            <Panel className="overflow-hidden">
              <div className="border-b border-white/10 p-4 sm:p-5"><h2 className="text-xl font-black">Late-swap opportunities</h2><p className="mt-1 text-xs text-white/35">Healthy same-position bench options that lock no earlier than the risky starter.</p></div>
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {lateSwaps.slice(0, 12).map(({ starterId, replacement, row }) => <a key={`${row.league.league_id}-${starterId}`} href={matchupHref(row.league.league_id)} target="_blank" rel="noreferrer" className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 transition hover:bg-white/[0.055]"><div className="break-words text-[9px] font-semibold uppercase tracking-wider text-white/30">{row.league.name}</div><div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"><b className="break-words text-amber-100">{playerName(players, starterId)}</b><span className="text-white/20">→</span><b className="break-words text-emerald-100">{playerName(players, replacement)}</b></div><div className="mt-1 break-words text-[10px] text-white/32">{injury(players?.[starterId])} contingency · {weeklyProjection(replacement).toFixed(1)} projected</div></a>)}
                {!lateSwaps.length ? <div className="p-3 text-sm text-white/35">No direct late-swap chain is currently required.</div> : null}
              </div>
            </Panel>
          </div>
          <div className="space-y-4">
            {liveMode ? <Panel className="overflow-hidden border-emerald-300/15"><div className="border-b border-white/10 p-4"><h2 className="font-black text-emerald-100">Live impact feed</h2><p className="mt-1 text-[10px] text-white/32">New scoring events affecting multiple matchups.</p></div><div className="divide-y divide-white/[0.06]">{liveEvents.map((event) => <div key={event.id} className="p-3 text-xs leading-5 text-white/60">{event.text}</div>)}{!liveEvents.length ? <div className="p-4 text-xs text-white/32">Watching for portfolio-changing plays…</div> : null}</div></Panel> : null}
            <Panel className="min-w-0 p-4">
              <h2 className="font-black">Swing players</h2>
              <p className="mt-1 text-[10px] text-white/32">Projection × number of affected matchups.</p>
              <div className="mt-3 space-y-2">{swingPlayers.map((row) => <div key={row.id} className="flex items-center gap-3 rounded-xl bg-black/15 p-2"><AvatarImage name={row.name} playerId={row.id} size={34} className="rounded-lg" alt="" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{row.name}</div><div className="text-[9px] text-white/30">{row.for.length} for · {row.against.length} against · {row.impact} leagues</div></div><div className="text-right"><b className="text-amber-100">{(row.impact * row.projection).toFixed(1)}</b><small className="block text-[8px] text-white/25">impact</small></div></div>)}</div>
            </Panel>
            <Panel className="p-4">
              <h2 className="font-black">Weekly recap</h2>
              <p className="mt-2 break-words text-xs leading-5 text-white/42">{counts.winning > counts.losing ? `Your portfolio is projected ahead in ${counts.winning} leagues with an average ${Math.round(averageWin)}% win probability.` : `Your portfolio needs leverage: ${counts.losing} leagues project behind and ${counts.close} remain within one scoring swing.`} {riskyLineups.length ? `${riskyLineups.length} lineups still need attention before their players lock.` : "Every observed lineup is currently compliant."}</p>
            </Panel>
          </div>
        </div> : null}

        {tab === "timeline" ? <div className="mt-4 space-y-4">
          <Panel className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-black">Player kickoff timeline</h2><p className="mt-1 text-xs text-white/35">Every involved player grouped by NFL window with live points and portfolio direction.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or team" className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm" /></div></Panel>
          {gameGroups.map((game) => {
            const involved = filteredPlayers.filter((row) => row.game?.id === game.id);
            if (!involved.length) return null;
            return <Panel key={game.id} className="overflow-hidden"><div className="border-b border-white/10 bg-white/[0.025] p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-black">{(game.teams || []).join(" vs ")}</h3><div className="mt-1 text-xs text-white/38">{game.date ? new Date(game.date).toLocaleString([], { weekday:"short", hour:"numeric", minute:"2-digit" }) : "Kickoff unavailable"} · {game.status}</div></div><div className="text-[10px] text-cyan-100/55 sm:max-w-md sm:text-right">{weatherLine(game)}</div></div></div><div className="grid gap-px bg-white/[0.05] sm:grid-cols-2 xl:grid-cols-3">{involved.map((row) => <div key={row.id} className="flex items-center gap-3 bg-slate-950/90 p-3"><AvatarImage name={row.name} playerId={row.id} size={40} className="rounded-xl" alt="" /><div className="min-w-0 flex-1"><div className="truncate font-semibold">{row.name}</div><div className="text-[10px] text-white/32">{row.player?.position} · {row.for.length} for · {row.against.length} against{row.conflict ? " · CONFLICT" : ""}</div></div><div className="text-right"><b>{row.points.toFixed(1)}</b><small className="block text-[8px] text-white/25">fantasy pts</small></div></div>)}</div></Panel>;
          })}
        </div> : null}

        {tab === "matchups" ? <div className="mt-4">
          <Panel className="mb-4 overflow-x-auto p-2"><div className="flex w-max gap-1">{[["all", "All"], ["close", "Close"], ["winning", "Winning"], ["losing", "Losing"], ["completed", "Completed"], ["not-started", "Not started"]].map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`min-h-10 rounded-xl px-3 text-xs font-semibold ${filter === key ? "bg-emerald-300/10 text-emerald-100" : "text-white/40"}`}>{label}</button>)}</div></Panel>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredMatchups.map((row) => <a key={row.league.league_id} href={matchupHref(row.league.league_id)} target="_blank" rel="noreferrer" className={`rounded-[24px] border p-4 transition hover:-translate-y-0.5 ${row.margin <= 10 && row.status !== "completed" ? "border-amber-300/20 bg-amber-300/[0.035]" : "border-white/10 bg-slate-900/80"}`}><div className="flex items-center justify-between gap-3"><div className="truncate font-black">{row.league.name}</div><span className={`rounded-full px-2 py-1 text-[10px] ${row.winProbability >= 60 ? "bg-emerald-300/10 text-emerald-100" : row.winProbability <= 40 ? "bg-rose-300/10 text-rose-100" : "bg-amber-300/10 text-amber-100"}`}>{row.winProbability}% win</span></div><div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center"><div><b className="text-2xl">{row.actual.toFixed(1)}</b><small className="block text-[9px] text-white/30">You · {row.projected.toFixed(1)} modeled</small></div><span className="text-xs text-white/20">VS</span><div><b className="text-2xl">{row.opponentActual.toFixed(1)}</b><small className="block truncate text-[9px] text-white/30">{row.opponentName} · {row.opponentProjected.toFixed(1)}</small></div></div><div className="mt-3 flex justify-between gap-3 text-[10px] text-white/35"><span>{row.myRemaining.length} vs {row.opponentRemaining.length} remaining</span><span>Open matchup ↗</span></div>{row.emptySlots || row.riskyStarters.length ? <div className="mt-3 rounded-xl bg-rose-300/[0.06] px-3 py-2 text-[10px] text-rose-100">{row.emptySlots ? `${row.emptySlots} empty · ` : ""}{row.riskyStarters.length} injury risk</div> : null}</a>)}</div>
        </div> : null}
      </> : null}
    </div>
  </main>;
}
