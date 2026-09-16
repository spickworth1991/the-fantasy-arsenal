"use client";

const number = (value) => Number(value || 0);

const Panel = ({ children, className = "" }) => (
  <section className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>
    {children}
  </section>
);

const tierStyle = {
  bronze: "border-orange-300/20 bg-orange-300/[0.045] text-orange-100",
  silver: "border-slate-200/20 bg-slate-200/[0.045] text-slate-100",
  gold: "border-amber-300/25 bg-amber-300/[0.06] text-amber-100",
  platinum: "border-cyan-300/25 bg-cyan-300/[0.06] text-cyan-100",
  mythic: "border-violet-300/25 bg-violet-300/[0.07] text-violet-100",
};

const tierLabel = (tier) => String(tier || "bronze").replace(/^./, (letter) => letter.toUpperCase());

function ProgressCard({ title, current, target, detail, tone = "cyan" }) {
  const safeCurrent = Math.max(0, number(current));
  const complete = safeCurrent >= target;
  const percent = Math.min(100, (safeCurrent / Math.max(1, target)) * 100);
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black">{title}</div>
          <div className="mt-1 text-[10px] leading-4 text-white/36">{detail}</div>
        </div>
        <b className={complete ? "text-emerald-100" : `text-${tone}-100`}>
          {safeCurrent}/{target}
        </b>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={`h-full rounded-full ${complete ? "bg-emerald-300" : tone === "violet" ? "bg-violet-300" : "bg-cyan-300"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 text-[9px] font-bold uppercase tracking-wider text-white/28">
        {complete ? "Milestone reached" : `${Math.max(0, target - safeCurrent)} to go`}
      </div>
    </div>
  );
}

export default function AchievementCabinet({ account, busy, scan }) {
  const career = account.career || {};
  const earned = [...(account.badges || [])].sort((a, b) => {
    const tiers = ["mythic", "platinum", "gold", "silver", "bronze"];
    return tiers.indexOf(a.tier) - tiers.indexOf(b.tier) || a.label.localeCompare(b.label);
  });
  const totalGames = number(career.wins) + number(career.losses) + number(career.ties);
  const winRate = totalGames
    ? ((number(career.wins) + number(career.ties) * 0.5) / totalGames) * 100
    : 0;
  const earnedKeys = new Set(earned.map((badge) => badge.key));
  const nextMilestones = [
    { key: "champion", title: "First championship", current: career.championships, target: 1, detail: "Win a verified Sleeper championship bracket." },
    { key: "playoff-regular", title: "Playoff regular", current: career.playoffs, target: 3, detail: "Finish in a verified playoff position three times." },
    { key: "century-club", title: "Century Club", current: career.wins, target: 100, detail: "Reach 100 verified career wins." },
    { key: "veteran", title: "Fantasy veteran", current: career.seasons, target: 5, detail: "Appear in five distinct Sleeper seasons." },
    { key: "multi", title: "Multi-league manager", current: career.leagueSeasons, target: 10, detail: "Build a ten league-season verified portfolio." },
  ].filter((milestone) => !earnedKeys.has(milestone.key)).slice(0, 3);
  const tiers = ["mythic", "platinum", "gold", "silver", "bronze"];
  return <div className="mt-5 space-y-5">
    <Panel className="overflow-hidden">
      <div className="bg-[radial-gradient(circle_at_92%_0%,rgba(139,92,246,.2),transparent_38%),linear-gradient(135deg,rgba(15,23,42,.96),rgba(9,15,30,.94))] p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.22em] text-violet-200/55">Earned, never reset</div>
            <h2 className="mt-1 text-3xl font-black">Achievement cabinet</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">Every badge below is retained from your current Arsenal history. Verified badges come from Sleeper league data; Arsenal badges come from account milestones.</p>
          </div>
          <button type="button" onClick={scan} disabled={busy} className="rounded-2xl bg-violet-300/12 px-4 py-3 text-xs font-black text-violet-100 disabled:opacity-40">{busy ? "Refreshing history…" : career.updatedAt ? "Refresh verification" : "Verify career history"}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-white/[0.06] sm:grid-cols-4">
        {[["Earned", earned.length], ["Verified", earned.filter((badge) => badge.verified).length], ["Career wins", number(career.wins)], ["Win rate", totalGames ? `${winRate.toFixed(1)}%` : "—"]].map(([label, value]) => <div key={label} className="bg-slate-950/80 p-4 text-center"><div className="text-2xl font-black">{value}</div><div className="mt-1 text-[9px] font-bold uppercase tracking-[.14em] text-white/30">{label}</div></div>)}
      </div>
    </Panel>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel className="p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-amber-200/55">Your collection</div><h3 className="mt-1 text-xl font-black">Earned achievements</h3></div><span className="text-xs text-white/35">{earned.length} total</span></div>
        {earned.length ? <div className="mt-5 space-y-5">{tiers.map((tier) => {
          const badges = earned.filter((badge) => (badge.tier || "bronze") === tier);
          if (!badges.length) return null;
          return <section key={tier}><div className="mb-2 text-[10px] font-black uppercase tracking-[.18em] text-white/35">{tierLabel(tier)}</div><div className="grid gap-2 sm:grid-cols-2">{badges.map((badge) => <article key={badge.key} className={`rounded-2xl border p-4 ${tierStyle[tier] || tierStyle.bronze}`}><div className="flex items-start justify-between gap-3"><b className="text-sm">{badge.label}</b><span className="rounded-full border border-current/20 px-2 py-1 text-[8px] font-black uppercase">{badge.verified ? "Verified" : "Arsenal"}</span></div><p className="mt-2 text-xs leading-5 text-white/55">{badge.reason}</p></article>)}</div></section>;
        })}</div> : <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-7 text-center text-sm text-white/38">Verify your Sleeper career to begin building your achievement cabinet.</div>}
      </Panel>
      <div className="space-y-5">
        <Panel className="p-5"><div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-200/55">Next milestones</div><h3 className="mt-1 text-xl font-black">What you are building toward</h3><div className="mt-4 space-y-3">{nextMilestones.length ? nextMilestones.map((milestone, index) => <ProgressCard key={milestone.key} {...milestone} tone={index % 2 ? "violet" : "cyan"} />) : <p className="rounded-xl bg-emerald-300/[0.05] p-4 text-xs leading-5 text-emerald-100">Every tracked starter milestone is already earned. More achievement paths will appear as your verified history grows.</p>}</div></Panel>
        <Panel className="p-5"><div className="text-[10px] font-black uppercase tracking-[.18em] text-white/35">How it works</div><p className="mt-2 text-xs leading-5 text-white/42">A refresh reads public Sleeper rosters and playoff brackets. It can add newly qualified badges, but it never takes away an earned badge because a league later becomes unavailable.</p></Panel>
      </div>
    </div>
  </div>;
}
