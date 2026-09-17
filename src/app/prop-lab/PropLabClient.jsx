"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import { useArsenalAccount } from "../../context/ArsenalAccountContext";
import { PROJ_ARSENAL_MODEL_JSON_URL, PROJECTION_DATA_SEASON } from "../../lib/projectionSeason";

const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });

const PROPS = [
  { key: "pass_yd", market: "player_pass_yds", label: "Passing yards", positions: ["QB"], step: 0.5, min: 80, cv: 0.24 },
  { key: "pass_td", market: "player_pass_tds", label: "Passing TDs", positions: ["QB"], step: 0.5, min: 0.2, cv: 0.65 },
  { key: "pass_cmp", market: "player_pass_completions", label: "Completions", positions: ["QB"], step: 0.5, min: 8, cv: 0.25 },
  { key: "rush_yd", market: "player_rush_yds", label: "Rushing yards", positions: ["QB", "RB", "WR"], step: 0.5, min: 8, cv: 0.55 },
  { key: "rush_att", market: "player_rush_attempts", label: "Rush attempts", positions: ["QB", "RB", "WR"], step: 0.5, min: 2, cv: 0.42 },
  { key: "rec", market: "player_receptions", label: "Receptions", positions: ["RB", "WR", "TE"], step: 0.5, min: 1.2, cv: 0.48 },
  { key: "rec_yd", market: "player_reception_yds", label: "Receiving yards", positions: ["RB", "WR", "TE"], step: 0.5, min: 10, cv: 0.58 },
  { key: "rec_tgt", label: "Targets", positions: ["RB", "WR", "TE"], step: 0.5, min: 2, cv: 0.43 },
];

const n = (value) => Number(value || 0);
const round = (value, digits = 1) => Number(n(value).toFixed(digits));
const gameKey = (week) => `${week.home ? week.team : week.opponent}-${week.home ? week.opponent : week.team}-${week.kickoff || "TBD"}`;
const normalCdf = (z) => {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return (1 + erf) / 2;
};
const americanOdds = (probability) => {
  const p = Math.min(0.99, Math.max(0.01, probability));
  return Math.round(p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p);
};
const oddsProfit = (odds, stake) => odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds || -100);
const decimalOdds = (odds) => odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds || -100);
const decimalToAmerican = (decimal) => Math.round(decimal >= 2 ? (decimal - 1) * 100 : -100 / Math.max(0.01, decimal - 1));
const authError = (error) => /unauthorized/i.test(String(error?.message || error));
const nameKey = (value) => String(value || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "").replace(/[^a-z0-9]/g, "");
const impliedProbability = (odds) => odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);

function Panel({ children, className = "" }) {
  return <section className={`rounded-3xl border border-white/10 bg-slate-950/80 ${className}`}>{children}</section>;
}

function RecommendationCard({ prop, index, tracked, busy, onSave }) {
  const combo = Array.isArray(prop.legs) && prop.legs.length > 1;
  const odds = Number(prop.sportsbookOdds);
  return <Panel className="overflow-hidden">
    <div className="flex items-start justify-between gap-4 border-b border-white/[.07] bg-white/[.025] p-4">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[.18em] text-cyan-200/50">Recommendation #{index + 1} · {prop.sportsbook}</div>
        <h2 className="mt-1 truncate text-lg font-black">{combo ? prop.playerName : prop.playerName}</h2>
        <div className="mt-1 text-xs text-white/40">{prop.team} vs {prop.opponent}{combo ? ` · ${prop.legs.length} legs` : ""}</div>
      </div>
      <div className="shrink-0 rounded-xl border border-amber-300/15 bg-amber-300/[.07] px-3 py-2 text-right">
        <div className="text-xl font-black text-amber-100">{odds > 0 ? "+" : ""}{odds}</div>
        <div className="text-[9px] uppercase tracking-wider text-white/35">{combo ? "Est. combined" : "Book odds"}</div>
      </div>
    </div>

    <div className="space-y-2 p-4">
      {(combo ? prop.legs : [prop]).map((leg, legIndex) => <div key={`${leg.id}:${legIndex}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{leg.playerName}</div>
          <div className="mt-0.5 text-xs text-white/45">{leg.statLabel}</div>
        </div>
        <div className="text-right">
          <div className={`text-base font-black ${leg.direction === "over" ? "text-emerald-200" : "text-violet-200"}`}>{leg.direction.toUpperCase()} {leg.line}</div>
          <div className="text-[10px] text-white/35">Proj. {leg.projection}{Number.isFinite(leg.lineCushionPercent) ? ` · ${leg.lineCushionPercent}% cushion` : ""}</div>
        </div>
      </div>)}
    </div>

    <div className="grid grid-cols-3 gap-px border-y border-white/[.07] bg-white/[.07] text-center text-xs">
      <div className="bg-slate-950/95 p-3"><small className="block text-white/35">Hit probability</small><b>{Math.round(prop.probability * 100)}%</b></div>
      <div className="bg-slate-950/95 p-3"><small className="block text-white/35">Model edge</small><b className={prop.edge > 0 ? "text-emerald-200" : "text-rose-200"}>{prop.edge > 0 ? "+" : ""}{Math.round(prop.edge * 100)}%</b></div>
      <div className="bg-slate-950/95 p-3"><small className="block text-white/35">Fair odds</small><b>{prop.fairOdds > 0 ? "+" : ""}{prop.fairOdds}</b></div>
    </div>

    <div className="p-4"><button type="button" disabled={busy || tracked} onClick={() => onSave(prop)} className="w-full rounded-xl bg-amber-300/15 px-4 py-2.5 text-sm font-bold text-amber-100 transition hover:bg-amber-300/20 disabled:opacity-40">{tracked ? "Tracked in My Bets" : "I took this bet"}</button></div>
  </Panel>;
}

export default function PropLabClient() {
  const { account, isConnected, ready, accountRequest } = useArsenalAccount();
  const [feed, setFeed] = useState(null);
  const [oddsFeed, setOddsFeed] = useState(null);
  const [week, setWeek] = useState(1);
  const [selectedGames, setSelectedGames] = useState(new Set());
  const [amount, setAmount] = useState(12);
  const [minLegs, setMinLegs] = useState(1);
  const [maxLegs, setMaxLegs] = useState(3);
  const [recommendationMode, setRecommendationMode] = useState("balanced");
  const [lineStyle, setLineStyle] = useState("safer");
  const [minLineCushion, setMinLineCushion] = useState(0);
  const [betStructure, setBetStructure] = useState("same-game");
  const [maxLegsPerPlayer, setMaxLegsPerPlayer] = useState(1);
  const [minEdge, setMinEdge] = useState(-25);
  const [enabledMarkets, setEnabledMarkets] = useState(new Set(["player_pass_yds", "player_pass_tds", "player_pass_completions", "player_rush_yds", "player_rush_attempts", "player_receptions", "player_reception_yds"]));
  const [enabledBooks, setEnabledBooks] = useState(new Set(["DraftKings", "FanDuel"]));
  const [minOdds, setMinOdds] = useState(-10000);
  const [maxOdds, setMaxOdds] = useState(200);
  const [minProbability, setMinProbability] = useState(50);
  const [maxProbability, setMaxProbability] = useState(99);
  const [direction, setDirection] = useState("both");
  const [bets, setBets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadBets = async () => {
    if (!isConnected) return;
    try {
      const result = await accountRequest("/api/prop-bets");
      setBets(result.bets || []);
    } catch (error) {
      setMessage(error?.message || "Tracked bets could not be loaded.");
    }
  };

  useEffect(() => {
    fetch(PROJ_ARSENAL_MODEL_JSON_URL, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Projection feed unavailable.")))
      .then((data) => {
        setFeed(data);
        const current = (data.rows || []).flatMap((row) => row.weeks || []).find((entry) => !entry.completed && !entry.bye)?.week;
        setWeek(Number(current || 1));
      })
      .catch((error) => setMessage(error.message));
    fetch("/data/odds/nfl-props-snapshot.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Saved sportsbook snapshot unavailable.")))
      .then(setOddsFeed)
      .catch((error) => setMessage(error.message));
  }, []);
  useEffect(() => { loadBets(); }, [isConnected]);

  const games = useMemo(() => {
    const map = new Map();
    (feed?.rows || []).forEach((player) => {
      const row = (player.weeks || []).find((entry) => Number(entry.week) === Number(week));
      if (!row || row.bye || !row.opponent) return;
      const enriched = { ...row, team: player.team };
      const key = gameKey(enriched);
      if (!map.has(key)) map.set(key, { key, kickoff: row.kickoff, home: row.home ? player.team : row.opponent, away: row.home ? row.opponent : player.team });
    });
    return [...map.values()].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  }, [feed, week]);

  useEffect(() => { setSelectedGames(new Set(games.map((game) => game.key))); }, [games]);

  const availableOdds = useMemo(() => {
    const rows = [];
    (oddsFeed?.events || []).forEach((event) => (event.bookmakers || []).forEach((bookmaker) =>
      (bookmaker.markets || []).forEach((market) => (market.outcomes || []).forEach((outcome) => {
        if (!outcome.description || !Number.isFinite(Number(outcome.point)) || !Number.isFinite(Number(outcome.price))) return;
        rows.push({
          eventId: event.id, kickoff: event.commence_time, home: event.home_team, away: event.away_team,
          market: market.key, player: outcome.description, side: String(outcome.name).toLowerCase(),
          line: Number(outcome.point), sportsbookOdds: Number(outcome.price), sportsbook: bookmaker.title,
        });
      })),
    ));
    return rows;
  }, [oddsFeed]);

  const straightCandidates = useMemo(() => {
    const rows = [];
    (feed?.rows || []).forEach((player) => {
      const forecast = (player.weeks || []).find((entry) => Number(entry.week) === Number(week));
      if (!forecast || forecast.bye || forecast.completed || !forecast.stat_line) return;
      const enriched = { ...forecast, team: player.team };
      const key = gameKey(enriched);
      if (!selectedGames.has(key)) return;
      PROPS.filter((prop) => prop.market && enabledMarkets.has(prop.market) && prop.positions.includes(String(player.position).toUpperCase())).forEach((prop) => {
        const mean = n(forecast.stat_line[prop.key]);
        if (mean < prop.min) return;
        const sd = Math.max(prop.step * 1.4, mean * prop.cv);
        const offers = availableOdds.filter((offer) => enabledBooks.has(offer.sportsbook) && (offer.market === prop.market || offer.market === `${prop.market}_alternate`) && nameKey(offer.player) === nameKey(player.name) && Math.abs(new Date(offer.kickoff).getTime() - new Date(forecast.kickoff).getTime()) < 6 * 60 * 60 * 1000);
        offers.forEach((offer) => {
          const line = offer.line;
          const overProbability = 1 - normalCdf((line - mean) / sd);
          [{ side: offer.side, probability: offer.side === "over" ? overProbability : 1 - overProbability }].forEach(({ side, probability }) => {
            if (direction !== "both" && direction !== side) return;
            const cushion = side === "over" ? mean - line : line - mean;
            const cushionPercent = mean > 0 ? (cushion / mean) * 100 : 0;
            if (lineStyle === "safer" && cushion <= 0) return;
            if (lineStyle === "lower-overs" && (side !== "over" || cushion <= 0)) return;
            if (lineStyle === "higher-unders" && (side !== "under" || cushion <= 0)) return;
            if (lineStyle !== "any" && cushionPercent < minLineCushion) return;
            const odds = americanOdds(probability);
            const edge = probability - impliedProbability(offer.sportsbookOdds);
          if (odds < minOdds || odds > maxOdds || probability * 100 < minProbability || probability * 100 > maxProbability || edge * 100 < minEdge) return;
            rows.push({
              id: `${player.player_id}:${week}:${prop.key}:${side}:${Number(line)}`,
              trackingId: `${player.player_id}:${week}:${prop.key}:${side}:${Number(line)}`,
              season: Number(feed.season || PROJECTION_DATA_SEASON), week, gameKey: key, kickoff: forecast.kickoff,
              playerId: String(player.player_id), playerName: player.name, team: player.team, opponent: forecast.opponent,
              statKey: prop.key, statLabel: prop.label, direction: side, line: round(line), projection: round(mean, 2),
              probability: round(probability, 4), fairOdds: odds, sportsbookOdds: offer.sportsbookOdds,
              sportsbook: offer.sportsbook, edge: round(edge, 4),
              lineCushion: round(cushion, 2), lineCushionPercent: round(cushionPercent, 1),
              confidence: Number(player.confidence || forecast.confidence || 0),
            });
          });
        });
      });
    });
    const seen = new Set();
    const score = (row) => recommendationMode === "safest" ? row.probability : recommendationMode === "edge" ? row.edge : row.probability * 0.6 + Math.max(-0.25, row.edge) * 0.4;
    return rows
      .sort((a, b) => score(b) - score(a))
      .filter((row) => !seen.has(row.id) && seen.add(row.id))
      .slice(0, 200);
  }, [availableOdds, direction, enabledBooks, enabledMarkets, feed, lineStyle, maxOdds, maxProbability, minEdge, minLineCushion, minOdds, minProbability, recommendationMode, selectedGames, week]);

  const candidates = useMemo(() => {
    const recommendations = [];
    if (minLegs <= 1) recommendations.push(...straightCandidates);
    const groups = new Map();
    straightCandidates.forEach((row) => {
      const key = `${betStructure === "same-game" ? row.gameKey : "all-games"}:${row.sportsbook}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    groups.forEach((rows) => {
      const pool = rows.filter((row, index, all) => all.findIndex((other) => other.playerId === row.playerId && other.statKey === row.statKey) === index).slice(0, 30);
      for (let size = Math.max(2, minLegs); size <= Math.min(20, maxLegs, pool.length); size += 1) {
        const variants = Array.from({ length: Math.min(8, pool.length - size + 1) }, (_, offset) => pool.slice(offset, offset + size));
        variants.forEach((legs) => {
          const playerCounts = legs.reduce((counts, leg) => ({ ...counts, [leg.playerId]: (counts[leg.playerId] || 0) + 1 }), {});
          if (Object.values(playerCounts).some((count) => count > maxLegsPerPlayer)) return;
          const probability = legs.reduce((value, leg) => value * leg.probability, 1);
          const bookDecimal = legs.reduce((value, leg) => value * decimalOdds(leg.sportsbookOdds), 1);
          const sportsbookOdds = decimalToAmerican(bookDecimal);
          const fairOdds = americanOdds(probability);
          recommendations.push({
            ...legs[0], id: `sgx:${legs.map((leg) => leg.id).join("|")}`, trackingId: `sgx:${legs.map((leg) => leg.trackingId).join("|")}`,
            playerId: `sgx-${legs.map((leg) => leg.playerId).join("-")}`, playerName: `${size}-leg ${betStructure === "same-game" ? "SGX" : "parlay"}`, statKey: "sgx",
            statLabel: legs.map((leg) => `${leg.playerName} ${leg.direction.toUpperCase()} ${leg.line} ${leg.statLabel}`).join(" + "),
            direction: "sgx", line: size, projection: 0, probability, fairOdds, sportsbookOdds,
            edge: probability - impliedProbability(sportsbookOdds), legs, estimatedCombo: true,
          });
        });
      }
    });
    const score = (row) => recommendationMode === "safest" ? row.probability : recommendationMode === "edge" ? row.edge : row.probability * 0.6 + Math.max(-0.25, row.edge) * 0.4;
    return recommendations.sort((a, b) => score(b) - score(a)).slice(0, amount);
  }, [amount, betStructure, maxLegs, maxLegsPerPlayer, minLegs, recommendationMode, straightCandidates]);

  const trackedIds = useMemo(() => new Set(bets.map((bet) => `${bet.player_id}:${bet.week}:${bet.stat_key}:${bet.direction}:${Number(bet.line)}`)), [bets]);
  const settled = bets.filter((bet) => ["won", "lost"].includes(bet.result));
  const wins = settled.filter((bet) => bet.result === "won").length;
  const units = bets.reduce((total, bet) => {
    if (bet.result === "lost") return total - n(bet.stake);
    if (bet.result === "won") return total + oddsProfit(n(bet.sportsbook_odds || bet.model_fair_odds), n(bet.stake));
    return total;
  }, 0);

  const saveBet = async (candidate) => {
    setBusy(true); setMessage("");
    try {
      await accountRequest("/api/prop-bets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...candidate, stake: 1 }) });
      await loadBets();
    } catch (error) { setMessage(authError(error) ? "Sign into an Arsenal account to track bets." : error?.message); }
    finally { setBusy(false); }
  };
  const updateBet = async (bet, changes) => {
    setBusy(true);
    try {
      await accountRequest("/api/prop-bets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ betId: bet.bet_id, ...changes }) });
      await loadBets();
    } catch (error) { setMessage(error?.message || "Bet could not be updated."); }
    finally { setBusy(false); }
  };

  return <>
    <div aria-hidden className="h-[35px]" /><Navbar pageTitle="Prop Lab" /><BackgroundParticles /><div aria-hidden className="h-[50px]" />
    <main className="mx-auto max-w-7xl px-4 pb-14">
      <div className="mb-6 rounded-[2rem] border border-amber-300/15 bg-[radial-gradient(circle_at_85%_0%,rgba(251,191,36,.16),transparent_38%),rgba(2,6,23,.9)] p-6 sm:p-8">
        <div className="text-[11px] font-bold uppercase tracking-[.28em] text-amber-200/60">Admin experiment · Arsenal Safe Model</div>
        <h1 className="mt-2 text-3xl font-black sm:text-5xl">Prop Lab</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Compare the model’s player-stat forecasts with a saved sportsbook snapshot, then track what you actually played. The snapshot is intentionally updated manually while we validate the tool, so no page view spends API credits.</p>
        {oddsFeed ? <p className="mt-2 text-xs text-white/35">Odds snapshot: {new Date(oddsFeed.fetched_at).toLocaleString()} · {(oddsFeed.requested_bookmakers || []).join(" + ")} · alternate lines {oddsFeed.includes_alternate_lines ? "included" : "not included"} · {oddsFeed.quota?.remaining} monthly objects remained after capture. Combined payouts and probabilities are preliminary combinations of individual legs; sportsbooks reprice correlated same-game bets, and even individually likely legs produce a much lower joint hit rate as leg count grows. Confirm the offered price before betting.</p> : null}
      </div>
      {!ready ? <Panel className="p-6 text-white/50">Checking Arsenal account…</Panel> : !isConnected ? <Panel className="p-6"><h2 className="text-xl font-black">Arsenal account required</h2><p className="mt-2 text-sm text-white/50">Sign in from My Arsenal, then return here. Tracked bets and results are stored with your account and are never saved locally.</p><a href="/account" className="mt-4 inline-block rounded-xl bg-amber-300/15 px-4 py-2 text-sm font-bold text-amber-100">Open My Arsenal</a></Panel> : <>
        <Panel className="p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs text-white/50">Fantasy week<select value={week} onChange={(e) => setWeek(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white">{Array.from({ length: 18 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}</select></label>
            <label className="text-xs text-white/50">Number of props<input type="number" min="1" max="50" value={amount} onChange={(e) => setAmount(Math.max(1, Math.min(50, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Minimum legs per bet<input type="number" min="1" max="20" value={minLegs} onChange={(e) => { const value = Math.max(1, Math.min(20, Number(e.target.value))); setMinLegs(value); setMaxLegs((current) => Math.max(current, value)); }} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Maximum legs per bet<input type="number" min="1" max="20" value={maxLegs} onChange={(e) => { const value = Math.max(1, Math.min(20, Number(e.target.value))); setMaxLegs(value); setMinLegs((current) => Math.min(current, value)); }} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Recommendation strategy<select value={recommendationMode} onChange={(e) => setRecommendationMode(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white"><option value="safest">Highest hit chance</option><option value="balanced">Balanced safety + value</option><option value="edge">Best model edge</option></select></label>
            <label className="text-xs text-white/50">Alternate-line style<select value={lineStyle} onChange={(e) => setLineStyle(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white"><option value="safer">Lower Overs + higher Unders</option><option value="lower-overs">Lower Overs only</option><option value="higher-unders">Higher Unders only</option><option value="any">Any available line</option></select></label>
            <label className="text-xs text-white/50">Minimum line cushion %<input type="number" min="0" max="90" step="1" value={minLineCushion} onChange={(e) => setMinLineCushion(Math.max(0, Math.min(90, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Bet structure<select value={betStructure} onChange={(e) => setBetStructure(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white"><option value="same-game">Same-game (SGX)</option><option value="cross-game">Cross-game parlay</option></select></label>
            <label className="text-xs text-white/50">Maximum legs per player<input type="number" min="1" max="4" value={maxLegsPerPlayer} onChange={(e) => setMaxLegsPerPlayer(Math.max(1, Math.min(4, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Minimum model edge %<input type="number" min="-50" max="100" value={minEdge} onChange={(e) => setMinEdge(Math.max(-50, Math.min(100, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Minimum fair odds<input type="number" step="5" min="-10000" max="10000" value={minOdds} onChange={(e) => setMinOdds(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Maximum fair odds<input type="number" step="5" min="-10000" max="10000" value={maxOdds} onChange={(e) => setMaxOdds(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Minimum leg probability<input type="number" min="1" max="99" value={minProbability} onChange={(e) => setMinProbability(Math.max(1, Math.min(99, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Maximum leg probability<input type="number" min="1" max="99" value={maxProbability} onChange={(e) => setMaxProbability(Math.max(1, Math.min(99, Number(e.target.value))))} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white" /></label>
            <label className="text-xs text-white/50">Direction<select value={direction} onChange={(e) => setDirection(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white"><option value="both">Overs + unders</option><option value="over">Overs only</option><option value="under">Unders only</option></select></label>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div><div className="mb-2 text-xs font-bold uppercase tracking-wider text-white/40">Allowed prop markets</div><div className="flex flex-wrap gap-2">{PROPS.filter((prop) => prop.market).map((prop) => <button type="button" key={prop.market} onClick={() => setEnabledMarkets((current) => { const next = new Set(current); next.has(prop.market) ? next.delete(prop.market) : next.add(prop.market); return next; })} className={`rounded-lg border px-3 py-1.5 text-xs ${enabledMarkets.has(prop.market) ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-white/35"}`}>{prop.label}</button>)}</div></div>
            <div><div className="mb-2 text-xs font-bold uppercase tracking-wider text-white/40">Sportsbooks</div><div className="flex flex-wrap gap-2">{[...new Set(availableOdds.map((row) => row.sportsbook))].map((book) => <button type="button" key={book} onClick={() => setEnabledBooks((current) => { const next = new Set(current); next.has(book) ? next.delete(book) : next.add(book); return next; })} className={`rounded-lg border px-3 py-1.5 text-xs ${enabledBooks.has(book) ? "border-amber-300/25 bg-amber-300/10 text-amber-100" : "border-white/10 text-white/35"}`}>{book}</button>)}</div></div>
          </div>
          <div className="mt-5"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-white/40">Games and game days</span><button type="button" onClick={() => setSelectedGames(new Set(selectedGames.size === games.length ? [] : games.map((game) => game.key)))} className="text-xs font-bold text-cyan-200">{selectedGames.size === games.length ? "Clear all" : "Select all"}</button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{games.map((game) => <label key={game.key} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${selectedGames.has(game.key) ? "border-cyan-300/25 bg-cyan-300/[.06]" : "border-white/10 bg-white/[.02]"}`}><input type="checkbox" checked={selectedGames.has(game.key)} onChange={() => setSelectedGames((current) => { const next = new Set(current); next.has(game.key) ? next.delete(game.key) : next.add(game.key); return next; })} className="accent-cyan-300" /><span><b className="text-sm">{game.away} @ {game.home}</b><small className="block text-[10px] text-white/35">{game.kickoff ? new Date(game.kickoff).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Time TBD"}</small></span></label>)}</div></div>
        </Panel>

        {message ? <div role="alert" className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">{message}</div> : null}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">{candidates.map((prop, index) => <RecommendationCard key={prop.id} prop={prop} index={index} tracked={trackedIds.has(prop.id)} busy={busy} onSave={saveBet} />)}</div>
        {!candidates.length ? <Panel className="mt-6 p-6 text-sm text-white/50">No props fit the selected games and odds range. Widen the odds range or select more games.</Panel> : null}

        <div className="mt-10 flex flex-wrap items-end justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-[.22em] text-amber-200/55">Account history</div><h2 className="mt-1 text-2xl font-black">My tracked bets</h2></div><div className="flex gap-2 text-center text-xs"><div className="rounded-xl bg-white/[.04] px-4 py-2"><b className="block text-lg">{settled.length ? Math.round(wins / settled.length * 100) : 0}%</b>Accuracy</div><div className="rounded-xl bg-white/[.04] px-4 py-2"><b className={`block text-lg ${units >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{units >= 0 ? "+" : ""}{units.toFixed(2)}</b>Units</div></div></div>
        <Panel className="mt-4 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-white/[.04] text-left text-[10px] uppercase tracking-wider text-white/35"><tr><th className="p-3">Bet</th><th className="p-3">Model</th><th className="p-3">Book odds</th><th className="p-3">Stake</th><th className="p-3">Actual</th><th className="p-3">Result</th></tr></thead><tbody>{bets.map((bet) => <tr key={bet.bet_id} className="border-t border-white/[.06]"><td className="p-3"><b>{bet.player_name}</b><div className="text-xs text-white/45">{bet.direction.toUpperCase()} {bet.line} {bet.stat_label} · W{bet.week}</div></td><td className="p-3">{Math.round(n(bet.model_probability) * 100)}% · {n(bet.model_fair_odds) > 0 ? "+" : ""}{bet.model_fair_odds}</td><td className="p-3"><input type="number" defaultValue={bet.sportsbook_odds ?? bet.model_fair_odds} onBlur={(e) => updateBet(bet, { sportsbookOdds: Number(e.target.value), stake: n(bet.stake), result: bet.result, actual: bet.actual })} className="w-24 rounded-lg border border-white/10 bg-slate-900 px-2 py-1" /></td><td className="p-3"><input type="number" min=".01" step=".25" defaultValue={bet.stake} onBlur={(e) => updateBet(bet, { stake: Number(e.target.value), result: bet.result, actual: bet.actual })} className="w-20 rounded-lg border border-white/10 bg-slate-900 px-2 py-1" /></td><td className="p-3"><input type="number" step=".1" defaultValue={bet.actual ?? ""} onBlur={(e) => updateBet(bet, { actual: e.target.value, result: bet.result })} className="w-20 rounded-lg border border-white/10 bg-slate-900 px-2 py-1" /></td><td className="p-3"><select value={bet.result} onChange={(e) => updateBet(bet, { result: e.target.value, actual: bet.actual })} className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1"><option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option><option value="push">Push</option><option value="void">Void</option></select></td></tr>)}</tbody></table></div>{!bets.length ? <div className="p-6 text-center text-sm text-white/40">No tracked bets yet.</div> : null}</Panel>
      </>}
    </main>
  </>;
}
