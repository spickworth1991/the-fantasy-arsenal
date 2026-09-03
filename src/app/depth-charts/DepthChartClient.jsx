"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";

const TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS"];
const POSITIONS = ["QB","RB","WR","TE","K","DEF"];
const n = (value) => Number(value || 0);
const upper = (value) => String(value || "").toUpperCase();
const normalizedTeam = (value) => ({ JAC:"JAX", LA:"LAR", WSH:"WAS" }[upper(value)] || upper(value));
const playerName = (player) => player?.full_name || player?.search_full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || "Unknown player";
const risk = (player) => ["OUT","DOUBTFUL","QUESTIONABLE","IR","PUP","SUSPENDED"].includes(upper(player?.injury_status));

function Panel({ children, className = "" }) {
  return <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>{children}</div>;
}

export default function DepthChartClient() {
  const { username, players, leagues = [], sourceKey, setSourceKey, format, setFormat, qbType, setQbType, getPlayerValue, getProjection, projectionSource, fetchLeagueRostersSilent } = useSleeper();
  const [team, setTeam] = useState("BUF");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const missing = leagues.filter((league) => !Array.isArray(league.rosters) || !Array.isArray(league.users));
    if (!missing.length) return;
    Promise.allSettled(missing.map((league) => fetchLeagueRostersSilent(league.league_id)));
  }, [fetchLeagueRostersSilent, leagues]);

  const exposure = useMemo(() => {
    const map = new Map();
    leagues.forEach((league) => (league.rosters || []).forEach((roster) => {
      const user = (league.users || []).find((item) => String(item.user_id) === String(roster.owner_id));
      if (String(user?.username || user?.display_name || "").toLowerCase() !== String(username || "").toLowerCase()) return;
      (roster.players || []).forEach((id) => {
        const current = map.get(String(id)) || [];
        current.push({ id:league.league_id, name:league.name });
        map.set(String(id), current);
      });
    }));
    return map;
  }, [leagues, username]);

  const teamPlayers = useMemo(() => Object.values(players || {}).filter((player) => normalizedTeam(player.team) === team && POSITIONS.includes(upper(player.position))).filter((player) => positionFilter === "ALL" || upper(player.position) === positionFilter).filter((player) => !query.trim() || playerName(player).toLowerCase().includes(query.toLowerCase())).sort((a, b) => upper(a.position).localeCompare(upper(b.position)) || (n(a.depth_chart_order) || 99) - (n(b.depth_chart_order) || 99) || n(getPlayerValue(b)) - n(getPlayerValue(a))), [players, team, positionFilter, query, getPlayerValue]);
  const groups = POSITIONS.map((pos) => {
    const rows = teamPlayers.filter((player) => upper(player.position) === pos);
    const starter = rows.find((player) => n(player.depth_chart_order) === 1) || rows[0];
    const opportunity = starter && risk(starter) ? `${playerName(starter)} is ${starter.injury_status}; the next healthy option has elevated opportunity.` : rows.length < (pos === "WR" ? 5 : pos === "RB" ? 3 : 2) ? "Depth is thin relative to a typical NFL room." : "No obvious injury-created vacancy.";
    return { pos, rows, opportunity };
  }).filter((group) => group.rows.length);
  const totalExposure = [...exposure.entries()].filter(([id]) => normalizedTeam(players?.[id]?.team) === team).reduce((sum, [, rows]) => sum + rows.length, 0);
  const injured = teamPlayers.filter(risk).length;
  const rookies = teamPlayers.filter((player) => n(player.years_exp) === 0).length;

  return <main className="min-h-screen text-white"><BackgroundParticles /><Navbar pageTitle="Depth Charts" /><div className="mx-auto max-w-7xl px-3 pb-20 pt-20 sm:px-4">
    <header className="rounded-[34px] border border-cyan-300/15 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.18),transparent_38%),radial-gradient(circle_at_8%_100%,rgba(139,92,246,.12),transparent_35%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-7"><div className="text-[10px] font-semibold uppercase tracking-[.25em] text-cyan-200/55">NFL opportunity intelligence</div><h1 className="mt-2 text-3xl font-black sm:text-5xl">Depth-Chart Explorer</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/45">Team position trees connected to market value, projections, injuries, rookie competition, handcuffs, contract research, and your portfolio exposure.</p><div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-[140px_150px_1fr]"><select value={team} onChange={(event) => setTeam(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3">{TEAMS.map((value) => <option key={value}>{value}</option>)}</select><select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3"><option>ALL</option>{POSITIONS.map((value) => <option key={value}>{value}</option>)}</select><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${team} players`} className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3" /></div></header>
    <Panel className="mt-4 p-4"><details className="premium-disclosure"><summary>Player model <span className="ml-auto text-xs font-normal text-white/35">{sourceKey}</span></summary><div className="mt-3"><SourceSelector sources={DEFAULT_SOURCES} value={sourceKey} onChange={setSourceKey} mode={format} onModeChange={setFormat} qbType={qbType} onQbTypeChange={setQbType} layout="inline" /></div></details></Panel>
    <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Panel className="p-3"><div className="text-[9px] uppercase tracking-wider text-white/30">Team</div><div className="mt-1 text-xl font-black text-cyan-100">{team}</div></Panel><Panel className="p-3"><div className="text-[9px] uppercase tracking-wider text-white/30">Fantasy players</div><div className="mt-1 text-xl font-black">{teamPlayers.length}</div></Panel><Panel className="p-3"><div className="text-[9px] uppercase tracking-wider text-white/30">Injury watch</div><div className={`mt-1 text-xl font-black ${injured ? "text-amber-100" : "text-emerald-100"}`}>{injured}</div></Panel><Panel className="p-3"><div className="text-[9px] uppercase tracking-wider text-white/30">Portfolio shares</div><div className="mt-1 text-xl font-black text-violet-100">{totalExposure}</div><div className="text-[10px] text-white/30">{rookies} rookies in room</div></Panel></section>
    <div className="mt-4 space-y-4">{groups.map((group) => <Panel key={group.pos} className="overflow-hidden"><div className="border-b border-white/10 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-200/45">{team} position tree</div><h2 className="mt-1 text-2xl font-black">{group.pos}</h2></div><span className="rounded-full bg-white/[0.05] px-3 py-1 text-[10px] text-white/40">{group.rows.length} players</span></div><p className="mt-2 text-xs leading-5 text-white/38">{group.opportunity}</p></div><div className="divide-y divide-white/[0.06]">{group.rows.map((player, index) => {
      const id = String(player.player_id);
      const order = n(player.depth_chart_order) || index + 1;
      const value = n(getPlayerValue(player));
      const projection = n(getProjection?.(player, projectionSource));
      const held = exposure.get(id) || [];
      const role = order === 1 ? "Starter" : order === 2 && ["RB","QB","TE"].includes(group.pos) ? "Primary handcuff" : `Depth ${order}`;
      return <div key={id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_110px_110px_150px] sm:items-center sm:p-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-xs font-black text-cyan-100">{order}</div><AvatarImage name={playerName(player)} playerId={id} size={42} className="rounded-xl" alt="" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("tfa:inspect-player", { detail:{ playerId:id } }))} className="truncate font-bold hover:text-cyan-100">{playerName(player)}</button>{risk(player) ? <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[9px] text-amber-100">{player.injury_status}</span> : null}{n(player.years_exp) === 0 ? <span className="rounded-full bg-violet-300/10 px-2 py-0.5 text-[9px] text-violet-100">ROOKIE</span> : null}</div><div className="mt-1 text-[10px] text-white/32">{role} · {player.status || "Unknown"} · {n(player.years_exp)} years exp.</div></div></div><div><div className="text-[9px] uppercase text-white/25">Value</div><div className="font-black text-cyan-100">{value ? Math.round(value).toLocaleString() : "—"}</div></div><div><div className="text-[9px] uppercase text-white/25">Projection</div><div className="font-black text-emerald-100">{projection ? projection.toFixed(1) : "—"}</div></div><div className="flex flex-wrap items-center gap-2 sm:justify-end"><span className="text-[10px] text-white/35">{held.length ? `Held in ${held.length} league${held.length === 1 ? "" : "s"}` : "No loaded exposure"}</span><a href={`https://www.spotrac.com/search?q=${encodeURIComponent(playerName(player))}`} target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.05] px-2 py-1.5 text-[10px] text-violet-100">Contract ↗</a></div></div>;
    })}</div></Panel>)}</div>
  </div></main>;
}
