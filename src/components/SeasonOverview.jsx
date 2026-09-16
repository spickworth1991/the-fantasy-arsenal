"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { classifyLeagueFormat } from "../lib/leagueFormat";

const n = (value) => Number(value || 0);

export default function SeasonOverview({ account, leagues = [], pinned = [], bookmarks = [] }) {
  const record = account?.record || {};
  const [choppedIds, setChoppedIds] = useState([]);
  const active = useMemo(() => leagues.filter((league) => ["in_season", "post_season"].includes(String(league.status))), [leagues]);
  const medianLeagues = useMemo(() => leagues.filter((league) => n(league.settings?.league_average_match) === 1), [leagues]);
  const bestBall = useMemo(() => leagues.filter((league) => classifyLeagueFormat(league).flags.bestBall), [leagues]);
  useEffect(() => {
    let live = true;
    const isChopped = (matchups) => {
      const counts = new Map();
      (matchups || []).forEach((matchup) => {
        if (matchup?.matchup_id == null || matchup.matchup_id === "") return;
        const id = String(matchup.matchup_id);
        counts.set(id, n(counts.get(id)) + 1);
      });
      return matchups.length > 2 && ![...counts.values()].some((count) => count === 2);
    };
    Promise.all(active.map(async (league) => {
      const week = Math.max(1, n(league.settings?.leg) || 1);
      const response = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`);
      const matchups = response.ok ? await response.json() : [];
      return isChopped(matchups) ? String(league.league_id) : null;
    })).then((ids) => live && setChoppedIds(ids.filter(Boolean))).catch(() => live && setChoppedIds([]));
    return () => { live = false; };
  }, [active]);
  const recordText = `${n(record.wins)}-${n(record.losses)}${n(record.ties) ? `-${n(record.ties)}` : ""}`;
  return <div className="mt-5 space-y-5">
    <section className="overflow-hidden rounded-[28px] border border-cyan-300/15 bg-[radial-gradient(circle_at_92%_0%,rgba(34,211,238,.14),transparent_38%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-7">
      <div className="text-[10px] font-black uppercase tracking-[.22em] text-cyan-200/55">{record.season || new Date().getFullYear()} season</div>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-3xl font-black">Portfolio overview</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">Your verified all-league record lives here. Weekly decisions and digest suggestions remain scoped to the leagues you choose in Digest.</p></div><Link href="/account/digest" className="rounded-xl bg-cyan-300/10 px-4 py-3 text-xs font-black text-cyan-100">Open weekly digest</Link></div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"><div title="The record totals every official result across your portfolio. Median-matchup leagues add a second weekly win, loss, or tie, so the record can contain more results than the number of leagues." className="cursor-help rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4"><b className="text-2xl text-emerald-100">{recordText}</b><small className="mt-1 block text-[9px] font-black uppercase tracking-wider text-white/35">Verified record ⓘ</small></div><div className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"><b className="text-2xl">{n(record.leagues) || leagues.length}</b><small className="mt-1 block text-[9px] font-black uppercase tracking-wider text-white/35">Leagues in record</small></div><div className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.05] p-4"><b className="text-2xl text-violet-100">{choppedIds.length}</b><small className="mt-1 block text-[9px] font-black uppercase tracking-wider text-white/35">Chopped entries</small></div><div className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"><b className="text-2xl">{active.length}</b><small className="mt-1 block text-[9px] font-black uppercase tracking-wider text-white/35">In-season leagues</small></div><div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4"><b className="text-2xl text-amber-100">{medianLeagues.length}</b><small className="mt-1 block text-[9px] font-black uppercase tracking-wider text-white/35">Median formats</small></div><div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4"><b className="text-2xl text-cyan-100">{bestBall.length}</b><small className="mt-1 block text-[9px] font-black uppercase tracking-wider text-white/35">Best Ball leagues</small></div></div>
    </section>
    {(bookmarks || []).length ? <section className="rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 p-5"><div className="flex items-end justify-between gap-4"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-pink-200/55">Manager bookmarks</div><h3 className="mt-1 text-xl font-black">Your rivalry board</h3></div><Link href="/account/library" className="text-xs font-black text-cyan-100">Manage bookmarks</Link></div><div className="mt-4 flex flex-wrap gap-2">{bookmarks.slice(0, 8).map((row) => <Link key={row.id} href={`/manager-intelligence?tab=rivalry&left=${encodeURIComponent(account.sleeperUsername || "")}&right=${encodeURIComponent(row.username)}`} className="rounded-xl border border-pink-300/15 bg-pink-300/[0.05] px-3 py-2 text-xs font-black text-pink-100">@{row.username}</Link>)}</div></section> : null}
    <section className="rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 p-5"><div className="flex items-end justify-between gap-4"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-200/45">Quick access</div><h3 className="mt-1 text-xl font-black">Pinned leagues</h3></div><Link href="/account/library" className="text-xs font-black text-cyan-100">Manage library</Link></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{pinned.map((league) => <Link key={league.id} href={`/league-hub?league=${league.id}`} className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 text-sm font-bold hover:bg-white/[0.07]">{league.name}</Link>)}{!pinned.length ? <p className="rounded-xl bg-black/15 p-4 text-xs text-white/35">Pin a league from Library to keep it here.</p> : null}</div></section>
  </div>;
}
