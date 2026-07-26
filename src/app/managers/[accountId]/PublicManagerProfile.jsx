"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "../../../components/Navbar";
import BackgroundParticles from "../../../components/BackgroundParticles";
import { accountAvatar } from "../../../context/ArsenalAccountContext";

const winRate = (record) => {
  const games = Number(record?.wins || 0) + Number(record?.losses || 0) + Number(record?.ties || 0);
  return games ? ((Number(record.wins || 0) + Number(record.ties || 0) * 0.5) / games) * 100 : 0;
};

function Stat({ label, value, accent = false }) {
  return <div className="rounded-2xl border border-white/10 bg-black/15 p-4"><div className={`text-2xl font-black ${accent ? "text-emerald-100" : ""}`}>{value}</div><div className="mt-1 text-[9px] font-bold uppercase tracking-[.16em] text-white/30">{label}</div></div>;
}

export default function PublicManagerProfile({ accountId }) {
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
        <div className="mt-7 flex flex-wrap gap-2"><Link href={`/manager-intelligence?username=${encodeURIComponent(account.sleeperUsername)}`} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-slate-950">Open manager intelligence</Link><Link href="/leaderboard" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-bold">View leaderboard</Link></div>
      </section> : null}
    </div>
  </main>;
}
