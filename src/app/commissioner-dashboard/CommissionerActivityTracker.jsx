"use client";

import { useEffect, useMemo, useState } from "react";

const number = (value) => Number(value || 0);
const categoryFor = (type) =>
  type === "trade"
    ? "Trades"
    : type === "waiver"
      ? "Waivers"
      : type === "free_agent"
        ? "Free agents"
        : type === "commissioner"
          ? "Commissioner"
          : "Other";

const toneFor = (category) =>
  category === "Trades"
    ? "text-violet-100 bg-violet-300/[0.08]"
    : category === "Waivers"
      ? "text-emerald-100 bg-emerald-300/[0.08]"
      : category === "Free agents"
        ? "text-cyan-100 bg-cyan-300/[0.08]"
        : category === "Draft"
          ? "text-amber-100 bg-amber-300/[0.08]"
          : "text-white/55 bg-white/[0.05]";

function Panel({ children, className = "" }) {
  return <div className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/85 to-slate-950/80 ${className}`}>{children}</div>;
}

function Metric({ label, value, detail }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
    <div className="text-[9px] font-semibold uppercase tracking-[.17em] text-white/35">{label}</div>
    <div className="mt-1 text-xl font-black">{value}</div>
    {detail ? <div className="mt-1 text-[10px] leading-4 text-white/35">{detail}</div> : null}
  </div>;
}

export default function CommissionerActivityTracker({ league, data, players }) {
  const [draftEvents, setDraftEvents] = useState([]);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError, setDraftError] = useState("");
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const managers = useMemo(() => new Map((data.managers || []).map((manager) => [String(manager.rosterId), manager])), [data.managers]);
  const ownerByUser = useMemo(() => new Map((data.managers || []).map((manager) => [String(manager.ownerId), manager])), [data.managers]);
  const playerName = (id) => players?.[id]?.full_name || players?.[id]?.search_full_name || String(id);

  useEffect(() => {
    let active = true;
    setDraftLoading(true);
    setDraftError("");
    (async () => {
      try {
        const response = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const drafts = await response.json();
        const currentDrafts = (drafts || []).filter((draft) => String(draft.season) === String(league.season));
        const pickLists = await Promise.all(currentDrafts.map(async (draft) => {
          const result = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`, { cache: "no-store" });
          if (!result.ok) return [];
          return (await result.json()).map((pick) => ({
            ...pick,
            draftName: draft.metadata?.name || `${draft.season} draft`,
            draftId: draft.draft_id,
          }));
        }));
        if (active) setDraftEvents(pickLists.flat());
      } catch {
        if (active) {
          setDraftEvents([]);
          setDraftError("Draft activity could not be loaded.");
        }
      } finally {
        if (active) setDraftLoading(false);
      }
    })();
    return () => { active = false; };
  }, [league.league_id, league.season]);

  const transactionEvents = useMemo(() => (data.completedTransactions || []).map((transaction) => {
    const rosterIds = [...new Set([
      ...(transaction.roster_ids || []),
      ...Object.values(transaction.adds || {}),
      ...Object.values(transaction.drops || {}),
    ].filter((value) => value != null).map(String))];
    const category = categoryFor(transaction.type);
    const names = rosterIds.map((id) => managers.get(id)?.ownerName || managers.get(id)?.name || `Roster ${id}`);
    const assets = Object.keys(transaction.adds || {}).map(playerName);
    const bid = number(transaction.settings?.waiver_bid);
    const title = category === "Trades"
      ? `${names.join(" vs. ")} completed a trade`
      : category === "Waivers"
        ? `${names.join(", ")} won a waiver claim`
        : `${names.join(", ")} recorded ${category.toLowerCase()} activity`;
    const detail = [assets.length ? assets.slice(0, 4).join(" | ") : "", bid ? `${bid} FAAB` : ""].filter(Boolean).join(" | ")
      || `${Object.keys(transaction.drops || {}).length} drop(s)`;
    return {
      id: String(transaction.transaction_id),
      category,
      created: number(transaction.created),
      week: number(transaction.leg),
      managers: rosterIds.map((id) => managers.get(id)).filter(Boolean),
      title,
      detail,
    };
  }), [data.completedTransactions, managers, players]);

  const normalizedDraftEvents = useMemo(() => draftEvents.map((pick) => {
    const manager = ownerByUser.get(String(pick.picked_by)) || managers.get(String(pick.roster_id));
    return {
      id: `draft:${pick.draftId}:${pick.pick_no}`,
      category: "Draft",
      created: number(pick.picked_at || pick.created),
      week: 0,
      managers: manager ? [manager] : [],
      title: `${manager?.ownerName || manager?.name || "Unknown manager"} made draft pick ${pick.round}.${String(pick.draft_slot || "").padStart(2, "0")}`,
      detail: `${playerName(pick.player_id)} | ${pick.draftName}`,
    };
  }), [draftEvents, managers, ownerByUser, players]);

  const allEvents = useMemo(() => [...transactionEvents, ...normalizedDraftEvents].sort((a, b) => b.created - a.created), [normalizedDraftEvents, transactionEvents]);
  const managerRows = useMemo(() => (data.managers || []).map((manager) => {
    const events = allEvents.filter((event) => event.managers.some((row) => row.rosterId === manager.rosterId));
    const counts = { Trades: 0, Waivers: 0, "Free agents": 0, Draft: 0, Commissioner: 0, Other: 0 };
    events.forEach((event) => { counts[event.category] = (counts[event.category] || 0) + 1; });
    const validLineups = Math.max(0, number(manager.measuredWeeks) - number(manager.emptyLineups));
    const lineupChanges = Math.max(0, number(manager.measuredWeeks) - 1 - number(manager.unchangedLineups));
    return { ...manager, events: events.length, counts, validLineups, lineupChanges, totalSignals: events.length + validLineups };
  }).sort((a, b) => b.totalSignals - a.totalSignals || String(a.ownerName || a.name).localeCompare(String(b.ownerName || b.name))), [allEvents, data.managers]);

  const categories = ["All", "Trades", "Waivers", "Free agents", "Draft", "Commissioner", "Other"];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleEvents = allEvents.filter((event) =>
    (filter === "All" || event.category === filter)
    && (!normalizedQuery || `${event.title} ${event.detail}`.toLowerCase().includes(normalizedQuery)));
  const totals = Object.fromEntries(categories.slice(1).map((category) => [category, allEvents.filter((event) => event.category === category).length]));
  const chatTime = number(league.last_message_time);

  return <section className="mt-5 space-y-5">
    <Panel className="overflow-hidden">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.15),transparent_40%),radial-gradient(circle_at_10%_100%,rgba(16,185,129,.1),transparent_36%)] p-5 sm:p-6">
        <div className="text-[11px] font-semibold uppercase tracking-[.24em] text-cyan-200/55">League activity tracker</div>
        <h2 className="mt-1 text-2xl font-black sm:text-3xl">Every observable sign of engagement</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">Completed transactions, draft selections, and weekly lineup evidence organized by manager. Sleeper does not expose chat content or per-user message counts.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4 lg:grid-cols-7">
        <Metric label="Tracked events" value={allEvents.length} />
        <Metric label="Trades" value={totals.Trades} />
        <Metric label="Waivers" value={totals.Waivers} />
        <Metric label="Free agents" value={totals["Free agents"]} />
        <Metric label="Draft picks" value={totals.Draft} detail={draftLoading ? "Loading..." : draftError || "Current season"} />
        <Metric label="Lineup weeks" value={managerRows.reduce((sum, row) => sum + row.validLineups, 0)} detail="Non-empty manager-weeks" />
        <Metric label="Latest league chat" value={chatTime ? new Date(chatTime).toLocaleDateString() : "Unavailable"} detail="League-level timestamp only" />
      </div>
    </Panel>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
      <Panel className="overflow-hidden">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div><h3 className="text-xl font-black">Activity timeline</h3><p className="mt-1 text-xs text-white/38">Newest observable events first.</p></div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search managers or assets..." className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none" />
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto">{categories.map((category) => <button key={category} onClick={() => setFilter(category)} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${filter === category ? "bg-cyan-300/10 text-cyan-100" : "text-white/40"}`}>{category}</button>)}</div>
        </div>
        <div className="max-h-[720px] divide-y divide-white/[0.06] overflow-y-auto">
          {visibleEvents.map((event) => <div key={event.id} className="p-4"><div className="flex items-start gap-3">
            <span className={`shrink-0 rounded-lg px-2 py-1 text-[9px] font-semibold uppercase ${toneFor(event.category)}`}>{event.category}</span>
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{event.title}</div><div className="mt-1 text-xs text-white/38">{event.detail}</div><div className="mt-1.5 text-[10px] text-white/25">{event.created ? new Date(event.created).toLocaleString() : event.week ? `Week ${event.week}` : "Time unavailable"}{event.week ? ` | Week ${event.week}` : ""}</div></div>
          </div></div>)}
          {!visibleEvents.length ? <div className="p-8 text-center text-sm text-white/35">No activity matches this view.</div> : null}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="border-b border-white/10 p-5"><h3 className="text-xl font-black">Manager breakdown</h3><p className="mt-1 text-xs text-white/38">Counts are evidence of observable activity, not a reliability score.</p></div>
        <div className="divide-y divide-white/[0.06]">{managerRows.map((manager) => <details key={manager.rosterId} className="p-4">
          <summary className="flex cursor-pointer list-none items-center gap-3">
            {manager.avatar ? <img src={`https://sleepercdn.com/avatars/thumbs/${manager.avatar}`} alt="" className="h-10 w-10 rounded-xl" /> : <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-xs font-black">R{manager.rosterId}</div>}
            <div className="min-w-0 flex-1"><div className="truncate font-semibold">{manager.ownerName || manager.name}</div><div className="text-xs text-white/35">{manager.events} events | {manager.validLineups} valid lineup weeks</div></div>
            <span className="text-white/25">+</span>
          </summary>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6 xl:grid-cols-3">{[["Trades", manager.counts.Trades], ["Waivers", manager.counts.Waivers], ["Free agents", manager.counts["Free agents"]], ["Draft", manager.counts.Draft], ["Lineups", manager.validLineups], ["Changes", manager.lineupChanges]].map(([label, value]) => <div key={label} className="rounded-xl bg-white/[0.025] p-2"><b>{value}</b><small className="block text-[9px] text-white/30">{label}</small></div>)}</div>
        </details>)}</div>
      </Panel>
    </div>

    <Panel className="p-4 text-[11px] leading-5 text-white/35"><b className="text-white/55">Chat limitation:</b> Sleeper's documented API exposes the league's latest-message timestamp but not message bodies, authors, or per-manager message totals. This tracker therefore uses chat only as league-wide recency context and does not invent manager activity.</Panel>
  </section>;
}
