"use client";

import { useState } from "react";
import Link from "next/link";

const Panel = ({ children, className = "" }) => <section className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>{children}</section>;

export default function ArsenalLibrary({ data, save, log, leagues = [], toggleLeague, username }) {
  const [savedName, setSavedName] = useState("");
  const [manager, setManager] = useState("");
  const addSaved = () => {
    const name = savedName.trim();
    if (!name) return;
    const next = log("save", "Library item saved", name);
    next.saved = [{ id: crypto.randomUUID(), kind: "note", name, at: Date.now() }, ...(data.saved || [])];
    save(next, "Saved to your Arsenal library.");
    setSavedName("");
  };
  const addManager = () => {
    const clean = manager.trim().replace(/^@/, "");
    if (!clean || (data.connections || []).some((row) => row.username.toLowerCase() === clean.toLowerCase())) return;
    const next = log("connection", "Manager bookmarked", clean);
    next.connections = [...(data.connections || []), { id: crypto.randomUUID(), username: clean, at: Date.now() }];
    save(next, "Manager bookmarked and synchronized.");
    setManager("");
  };
  const remove = (key, id) => {
    const next = { ...data, [key]: (data[key] || []).filter((row) => row.id !== id) };
    save(next, "Library updated.");
  };
  return <div className="mt-5 grid gap-5 xl:grid-cols-2">
    <Panel className="p-5"><div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-200/55">League shortcuts</div><h2 className="mt-1 text-xl font-black">Pinned leagues</h2><p className="mt-1 text-xs leading-5 text-white/38">Pin the leagues you use most. They appear in your season overview.</p><div className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto">{leagues.map((league) => { const pinned = (data.pinnedLeagues || []).some((row) => String(row.id) === String(league.league_id)); return <button key={league.league_id} type="button" onClick={() => toggleLeague(league)} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm ${pinned ? "border-cyan-300/25 bg-cyan-300/[0.06]" : "border-white/[0.07] bg-black/15"}`}><span className="truncate font-bold">{league.name}</span><span className={pinned ? "text-cyan-100" : "text-white/45"}>{pinned ? "Pinned" : "Pin"}</span></button>; })}</div></Panel>
    <Panel className="p-5"><div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-200/55">Saved work</div><h2 className="mt-1 text-xl font-black">Private library</h2><p className="mt-1 text-xs leading-5 text-white/38">Keep a small set of personal notes, players, or ideas you want to revisit. Tool-specific saved work remains inside its own tool.</p><div className="mt-4 flex gap-2"><input value={savedName} onChange={(event) => setSavedName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSaved()} placeholder="Save a note or reminder" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm"/><button type="button" onClick={addSaved} className="rounded-xl bg-cyan-300/10 px-4 text-xs font-black text-cyan-100">Save</button></div><div className="mt-4 space-y-2">{(data.saved || []).map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3"><div className="min-w-0 flex-1"><b className="block truncate text-sm">{item.name}</b><small className="text-white/28">Saved {new Date(item.at).toLocaleDateString()}</small></div><button type="button" onClick={() => remove("saved", item.id)} className="text-xs font-bold text-rose-100/60">Remove</button></div>)}{!(data.saved || []).length ? <p className="rounded-xl bg-black/15 p-4 text-xs text-white/35">Nothing saved here yet.</p> : null}</div></Panel>
    <Panel className="p-5 xl:col-span-2"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-pink-200/55">Manager bookmarks</div><h2 className="mt-1 text-xl font-black">People you want to research</h2><p className="mt-1 text-xs leading-5 text-white/38">Bookmarks are private. Open any manager directly in Rivalry Center with you already filled in.</p></div><Link href="/leaderboard" className="rounded-xl bg-white/[0.05] px-4 py-3 text-xs font-black">Arsenal leaderboard</Link></div><div className="mt-4 flex gap-2"><input value={manager} onChange={(event) => setManager(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addManager()} placeholder="Sleeper username" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm"/><button type="button" onClick={addManager} className="rounded-xl bg-violet-300/10 px-4 text-xs font-black text-violet-100">Bookmark</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{(data.connections || []).map((row) => <div key={row.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3"><b className="min-w-0 flex-1 truncate text-sm">@{row.username}</b><Link href={`/manager-intelligence?tab=rivalry&left=${encodeURIComponent(username || "")}&right=${encodeURIComponent(row.username)}`} className="rounded-lg bg-pink-300/10 px-3 py-2 text-[10px] font-black text-pink-100">Open rivalry</Link><button type="button" onClick={() => remove("connections", row.id)} className="text-xs font-bold text-rose-100/60">×</button></div>)}{!(data.connections || []).length ? <p className="rounded-xl bg-black/15 p-4 text-xs text-white/35">Bookmark a manager to launch a one-click rivalry comparison.</p> : null}</div></Panel>
  </div>;
}
