"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSleeper } from "../context/SleeperContext";

const n = (value) => Number(value || 0);
const CACHE_MS = 5 * 60 * 1000;
const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

async function concurrentMap(rows, limit, worker, progress) {
  const output = new Array(rows.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(Array.from({ length:Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await worker(rows[index]);
      done += 1;
      progress?.(done, rows.length);
    }
  }));
  return output;
}

function toneClass(tone) {
  if (tone === "critical") return "border-rose-300/15 bg-rose-300/[0.045] text-rose-100";
  if (tone === "warning") return "border-amber-300/15 bg-amber-300/[0.045] text-amber-100";
  if (tone === "live") return "border-emerald-300/15 bg-emerald-300/[0.045] text-emerald-100";
  return "border-cyan-300/15 bg-cyan-300/[0.04] text-cyan-100";
}

export default function DecisionInbox() {
  const { username, leagues = [], players, year } = useSleeper();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const cacheKey = `tfa:decision-inbox:${String(username || "").toLowerCase()}:${year || new Date().getFullYear()}`;

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached?.at && Date.now() - cached.at < CACHE_MS && Array.isArray(cached.items)) {
        setItems(cached.items);
        setUpdatedAt(new Date(cached.at));
      }
    } catch {}
  }, [cacheKey]);

  const scan = async () => {
    if (!username || loading) return;
    setLoading(true);
    setError("");
    try {
      const [root, state] = await Promise.all([
        getJson(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`),
        getJson("https://api.sleeper.app/v1/state/nfl"),
      ]);
      const week = Math.max(1, n(state.week) || 1);
      const detected = await concurrentMap(leagues, 12, async (league) => {
        try {
          const [rosters, matchups] = await Promise.all([
            league.rosters?.length ? Promise.resolve(league.rosters) : getJson(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
            getJson(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`),
          ]);
          const mine = rosters.find((roster) => String(roster.owner_id) === String(root.user_id));
          if (!mine) return [];
          const matchup = matchups.find((row) => String(row.roster_id) === String(mine.roster_id));
          const starters = (matchup?.starters || []).map(String);
          const empty = starters.filter((id) => !id || id === "0").length;
          const risks = starters
            .filter((id) => id && id !== "0")
            .map((id) => ({ id, player:players?.[id] }))
            .filter(({ player }) => {
              const status = String(player?.injury_status || "").toUpperCase();
              return ["OUT", "DOUBTFUL", "QUESTIONABLE", "IR", "PUP", "SUSPENDED"].includes(status) || String(player?.status || "").toLowerCase() === "inactive";
            });
          const leagueItems = [];
          if (empty) leagueItems.push({
            id:`empty-${league.league_id}`,
            priority:100 + empty,
            tone:"critical",
            title:`${empty} empty starter${empty === 1 ? "" : "s"}`,
            detail:league.name,
            href:`https://sleeper.com/leagues/${league.league_id}/matchup`,
            external:true,
            action:"Fix lineup",
          });
          risks.forEach(({ id, player }) => leagueItems.push({
            id:`injury-${league.league_id}-${id}`,
            priority:["OUT", "IR", "PUP", "SUSPENDED"].includes(String(player.injury_status || "").toUpperCase()) ? 95 : 75,
            tone:["OUT", "IR", "PUP", "SUSPENDED"].includes(String(player.injury_status || "").toUpperCase()) ? "critical" : "warning",
            title:`${player.full_name || player.search_full_name || id} · ${player.injury_status || "Inactive"}`,
            detail:league.name,
            href:"/lineup",
            action:"Open optimizer",
          }));
          if (week >= 11 && String(league.status || "").toLowerCase() === "in_season") leagueItems.push({
            id:`playoffs-${league.league_id}`,
            priority:35,
            tone:"info",
            title:"Playoff leverage is active",
            detail:`${league.name} · Week ${week}`,
            href:"/playoff-odds",
            action:"Explore scenarios",
          });
          return leagueItems;
        } catch {
          return [];
        }
      }, (done, total) => setProgress(`${done}/${total}`));
      const activeDrafts = leagues.filter((league) => String(league.status || "").toLowerCase() === "drafting").map((league) => ({
        id:`draft-${league.league_id}`,
        priority:90,
        tone:"live",
        title:"Draft currently active",
        detail:league.name,
        href:`/draft-helper?league=${league.league_id}`,
        action:"Open draft room",
      }));
      const next = [...activeDrafts, ...detected.flat()].sort((a, b) => b.priority - a.priority);
      const at = Date.now();
      setItems(next);
      setUpdatedAt(new Date(at));
      try { localStorage.setItem(cacheKey, JSON.stringify({ at, items:next })); } catch {}
    } catch {
      setError("The decision scan could not be completed. Try again in a moment.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const critical = items.filter((item) => item.tone === "critical").length;
  const warning = items.filter((item) => item.tone === "warning").length;
  const visible = useMemo(() => items.slice(0, 10), [items]);

  return <section className="overflow-hidden rounded-[30px] border border-amber-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(251,191,36,.12),transparent_38%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95))]">
    <div className="border-b border-white/10 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="text-[10px] font-semibold uppercase tracking-[.24em] text-amber-200/55">Daily workflow</div><h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">Decision Inbox</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">A prioritized queue across your leagues. Sleeper remains read-only; every action opens the correct Arsenal workspace or Sleeper lineup.</p></div>
        <button type="button" onClick={scan} disabled={loading} className="min-h-11 rounded-2xl bg-amber-300/10 px-5 py-3 text-sm font-black text-amber-100 disabled:opacity-50">{loading ? `Scanning ${progress}` : items.length ? "Refresh decisions" : "Scan my decisions"}</button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md"><div className="rounded-xl bg-black/20 p-3"><div className="text-xl font-black text-white">{items.length}</div><div className="text-[9px] uppercase text-white/30">Open items</div></div><div className="rounded-xl bg-rose-300/[0.05] p-3"><div className="text-xl font-black text-rose-100">{critical}</div><div className="text-[9px] uppercase text-white/30">Critical</div></div><div className="rounded-xl bg-amber-300/[0.05] p-3"><div className="text-xl font-black text-amber-100">{warning}</div><div className="text-[9px] uppercase text-white/30">Watch</div></div></div>
    </div>
    {error ? <div className="border-b border-white/10 p-4 text-sm text-rose-100">{error}</div> : null}
    <div className="divide-y divide-white/[0.06]">
      {visible.map((item) => {
        const content = <><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${toneClass(item.tone)}`}>{item.tone === "critical" ? "!" : item.tone === "warning" ? "⚕" : item.tone === "live" ? "●" : "→"}</div><div className="min-w-0 flex-1"><div className="truncate font-bold text-white">{item.title}</div><div className="mt-1 truncate text-xs text-white/35">{item.detail}</div></div><span className="shrink-0 text-[10px] font-semibold text-cyan-100">{item.action} →</span></>;
        return item.external ? <a key={item.id} href={item.href} target="_blank" rel="noreferrer" className="flex min-h-16 items-center gap-3 p-3 transition hover:bg-white/[0.035] sm:px-5">{content}</a> : <Link key={item.id} href={item.href} className="flex min-h-16 items-center gap-3 p-3 transition hover:bg-white/[0.035] sm:px-5">{content}</Link>;
      })}
      {!visible.length && !loading ? <div className="p-5 text-sm text-white/38">Run the scan to check every league for active drafts, empty slots, injury designations, and playoff decisions. Results are cached for five minutes.</div> : null}
    </div>
    <details className="border-t border-white/10 p-4 sm:px-6"><summary className="cursor-pointer text-xs font-semibold text-white/50">Connected workflow shortcuts</summary><div className="mt-3 flex flex-wrap gap-2">{[["/player-availability", "Multi-league availability"], ["/draft-pick-tracker", "Active drafts"], ["/trade", "Trade workspace"], ["/commissioner-dashboard", "Trade reviews"], ["/playoff-odds", "Playoff scenarios"]].map(([href, label]) => <Link key={href} href={href} className="rounded-xl bg-white/[0.045] px-3 py-2 text-xs text-white/55 hover:text-white">{label} →</Link>)}</div></details>
    {updatedAt ? <div className="border-t border-white/[0.06] px-5 py-2 text-[9px] text-white/22">Last checked {updatedAt.toLocaleTimeString()}</div> : null}
  </section>;
}
