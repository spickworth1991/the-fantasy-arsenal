"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "../../../components/Navbar";
import BackgroundParticles from "../../../components/BackgroundParticles";
import { accountAvatar, useArsenalAccount } from "../../../context/ArsenalAccountContext";

const HISTORY_START = 2017;
const number = (value) => Number(value || 0);
const ownsRoster = (roster, userId) => String(roster?.owner_id || "") === String(userId || "")
  || (Array.isArray(roster?.co_owners) && roster.co_owners.some((id) => String(id) === String(userId || "")));
const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sleeper returned HTTP ${response.status}.`);
  return response.json();
};
const concurrentMap = async (rows, limit, worker) => {
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length:Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await worker(rows[index], index);
    }
  }));
  return output;
};

const winRate = (record) => {
  const games = Number(record?.wins || 0) + Number(record?.losses || 0) + Number(record?.ties || 0);
  return games ? ((Number(record.wins || 0) + Number(record.ties || 0) * 0.5) / games) * 100 : 0;
};

function Stat({ label, value, accent = false }) {
  return <div className="rounded-2xl border border-white/10 bg-black/15 p-4"><div className={`text-2xl font-black ${accent ? "text-emerald-100" : ""}`}>{value}</div><div className="mt-1 text-[9px] font-bold uppercase tracking-[.16em] text-white/30">{label}</div></div>;
}

function LifetimeRivalry({ viewer, subject }) {
  const [state, setState] = useState({ loading:true, error:"", data:null });
  useEffect(() => {
    if (!viewer || !subject || String(viewer).toLowerCase() === String(subject).toLowerCase()) {
      setState({ loading:false, error:"", data:null });
      return;
    }
    let active = true;
    const load = async () => {
      const cacheKey = `tfa:profile-rivalry:${String(viewer).toLowerCase()}:${String(subject).toLowerCase()}`;
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
        if (cached?.savedAt > Date.now() - 6 * 60 * 60 * 1000 && cached?.data) {
          setState({ loading:false, error:"", data:cached.data });
          return;
        }
      } catch {}
      try {
        const users = await Promise.all([viewer, subject].map((name) => getJson(`https://api.sleeper.app/v1/user/${encodeURIComponent(name)}`)));
        if (!users.every((user) => user?.user_id)) throw new Error("One of the connected Sleeper managers could not be verified.");
        const currentYear = new Date().getFullYear();
        const years = Array.from({ length:currentYear - HISTORY_START + 1 }, (_, index) => currentYear - index);
        const histories = await Promise.all(users.map((user) => concurrentMap(years, 5, async (year) => ({
          year,
          leagues:await getJson(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${year}`).catch(() => []),
        }))));
        const shared = years.flatMap((year, index) => histories[0][index].leagues
          .filter((league) => histories[1][index].leagues.some((other) => String(other.league_id) === String(league.league_id)))
          .map((league) => ({ year, league })));
        const leagueResults = await concurrentMap(shared, 4, async ({ year, league }) => {
          const rosters = await getJson(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).catch(() => []);
          const rosterIds = users.map((user) => String(rosters.find((roster) => ownsRoster(roster, user.user_id))?.roster_id || ""));
          if (rosterIds.some((id) => !id)) return [];
          const weeks = await concurrentMap(Array.from({ length:18 }, (_, index) => index + 1), 6, async (week) => {
            const matchups = await getJson(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`).catch(() => []);
            const sides = rosterIds.map((id) => matchups.find((matchup) => String(matchup.roster_id) === id));
            if (!sides[0] || !sides[1] || sides[0].matchup_id == null || String(sides[0].matchup_id) !== String(sides[1].matchup_id)) return null;
            return { year, week, league:league.name, left:number(sides[0].points), right:number(sides[1].points) };
          });
          return weeks.filter(Boolean);
        });
        const games = leagueResults.flat();
        const data = {
          leftWins:games.filter((game) => game.left > game.right).length,
          rightWins:games.filter((game) => game.right > game.left).length,
          ties:games.filter((game) => game.left === game.right).length,
          meetings:games.length,
          sharedLeagues:shared.length,
          sharedSeasons:new Set(shared.map((row) => row.year)).size,
          pointsLeft:games.reduce((sum, game) => sum + game.left, 0),
          pointsRight:games.reduce((sum, game) => sum + game.right, 0),
          latest:games.sort((a, b) => b.year - a.year || b.week - a.week)[0] || null,
        };
        try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt:Date.now(), data })); } catch {}
        if (active) setState({ loading:false, error:"", data });
      } catch (error) {
        if (active) setState({ loading:false, error:error?.message || "Lifetime rivalry unavailable.", data:null });
      }
    };
    load();
    return () => { active = false; };
  }, [viewer, subject]);
  if (!viewer || String(viewer).toLowerCase() === String(subject).toLowerCase()) return null;
  const { data, loading, error } = state;
  const rivalryHref = `/manager-intelligence?tab=rivalry&left=${encodeURIComponent(viewer)}&right=${encodeURIComponent(subject)}`;
  return <section className="mt-5 overflow-hidden rounded-[30px] border border-pink-300/15 bg-[radial-gradient(circle_at_95%_0%,rgba(244,114,182,.12),transparent_42%),linear-gradient(145deg,rgba(15,23,42,.96),rgba(2,6,23,.94))]">
    <div className="flex flex-col gap-3 border-b border-white/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="text-[10px] font-black uppercase tracking-[.22em] text-pink-200/55">Your lifetime rivalry</div><h2 className="mt-1 text-xl font-black">@{viewer} vs @{subject}</h2><p className="mt-1 text-xs text-white/38">Verified head-to-head meetings across shared Sleeper league seasons since {HISTORY_START}.</p></div>
      <Link href={rivalryHref} className="w-fit rounded-xl bg-pink-300/10 px-4 py-2.5 text-xs font-black text-pink-100">Open complete rivalry</Link>
    </div>
    {loading ? <div className="p-5 text-sm text-white/42">Reconstructing shared seasons and matchup history…</div> : null}
    {error ? <div className="p-5 text-sm text-rose-100/75">{error}</div> : null}
    {data ? <div className="p-4 sm:p-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label={`Your wins`} value={data.leftWins} accent/><Stat label={`${subject}'s wins`} value={data.rightWins}/><Stat label="Ties" value={data.ties}/><Stat label="Meetings" value={data.meetings}/></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div className="rounded-xl bg-white/[0.035] p-3"><b>{data.sharedLeagues}</b><span className="ml-1 text-white/35">shared league-seasons</span></div><div className="rounded-xl bg-white/[0.035] p-3"><b>{data.sharedSeasons}</b><span className="ml-1 text-white/35">shared seasons</span></div><div className="rounded-xl bg-white/[0.035] p-3"><b>{data.pointsLeft.toFixed(1)}–{data.pointsRight.toFixed(1)}</b><span className="ml-1 text-white/35">lifetime points</span></div></div>{!data.meetings ? <p className="mt-3 text-xs leading-5 text-white/35">These managers have no verified head-to-head meetings in their shared Sleeper history.</p> : data.latest ? <p className="mt-3 text-xs text-white/35">Latest meeting: {data.latest.league} · {data.latest.year} Week {data.latest.week} · {data.latest.left.toFixed(1)}–{data.latest.right.toFixed(1)}</p> : null}</div> : null}
  </section>;
}

export default function PublicManagerProfile({ accountId }) {
  const { account:viewerAccount, isConnected } = useArsenalAccount();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/arsenal/profile/${encodeURIComponent(accountId)}`, { cache:"no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Profile unavailable.");
        setAccount(result.account);
      })
      .catch((reason) => setError(reason.message));
  }, [accountId]);

  return <main className="min-h-screen text-white">
    <BackgroundParticles />
    <Navbar pageTitle="Manager Profile" />
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-20">
      {error ? <section className="rounded-[30px] border border-rose-300/15 bg-slate-950/90 p-8 text-center"><h1 className="text-2xl font-black">Profile unavailable</h1><p className="mt-2 text-sm text-white/45">{error}</p><Link href="/leaderboard" className="mt-5 inline-flex rounded-xl bg-white/10 px-4 py-2 text-sm font-bold">Back to leaderboard</Link></section> : null}
      {!account && !error ? <div className="rounded-[30px] bg-white/[0.04] p-8 text-sm text-white/45">Loading manager profile...</div> : null}
      {account ? <section className="overflow-hidden rounded-[36px] border border-cyan-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(34,211,238,.18),transparent_35%),radial-gradient(circle_at_0%_100%,rgba(139,92,246,.18),transparent_36%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.97))] p-5 shadow-2xl shadow-black/30 sm:p-9">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-[30px] border border-white/10 bg-black/20"><img src={accountAvatar(account)} alt="" className="h-24 w-24 object-contain" /></div>
          <div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-[.28em] text-cyan-200/60">Arsenal manager profile</div><h1 className="mt-2 truncate text-3xl font-black sm:text-5xl">{account.displayName}</h1><p className="mt-2 text-sm text-white/45">@{account.sleeperUsername}{account.favoriteTeam ? ` · ${account.favoriteTeam} fan` : ""}</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold capitalize">{account.fantasyStyle}</span><span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold capitalize">{account.experienceLevel}</span><span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1.5 text-xs font-bold text-emerald-100">Sleeper verified</span></div></div>
        </div>
        {account.bio ? <p className="mt-7 max-w-3xl text-sm leading-7 text-white/60">{account.bio}</p> : null}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Win rate" value={`${winRate(account.record).toFixed(1)}%`} accent />
          <Stat label={`${account.record?.season || new Date().getFullYear()} record`} value={`${account.record?.wins || 0}-${account.record?.losses || 0}${account.record?.ties ? `-${account.record.ties}` : ""}`} />
          <Stat label="Verified leagues" value={account.record?.leagues || 0} />
          <Stat label="Portfolio points" value={Number(account.record?.pointsFor || 0).toLocaleString(undefined, { maximumFractionDigits:1 })} />
        </div>
        {account.publicSections?.career !== false && account.career ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="All-time win rate" value={`${winRate(account.career).toFixed(1)}%`} accent/><Stat label="Championships" value={account.career.championships || 0}/><Stat label="Playoff finishes" value={account.career.playoffs || 0}/><Stat label="Seasons" value={account.career.seasons || 0}/></div> : null}
        {account.publicSections?.badges !== false && account.badges?.length ? <div className="mt-6 flex flex-wrap gap-2">{account.badges.filter((badge)=>badge.visible!==false).map((badge)=><span key={badge.key} title={badge.reason} className="rounded-full border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs font-bold text-amber-100">{badge.label}</span>)}</div> : null}
        <div className="mt-7 flex flex-wrap gap-2"><Link href={`/manager-intelligence?username=${encodeURIComponent(account.sleeperUsername)}`} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-slate-950">Open manager intelligence</Link><Link href="/leaderboard" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-bold">View leaderboard</Link></div>
      </section> : null}
      {account && isConnected && viewerAccount?.sleeperUsername ? <LifetimeRivalry viewer={viewerAccount.sleeperUsername} subject={account.sleeperUsername}/> : null}
    </div>
  </main>;
}
