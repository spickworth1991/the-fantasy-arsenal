"use client";

import { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";
import { makeGetPlayerValue } from "../../lib/values";

/** Visual bits */
function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-white/10 bg-gray-900 ${className}`}>{children}</div>;
}

export default function TradeFinder() {
  const { activeLeague, leagues, players, format, qbType } = useSleeper();
  const league = useMemo(() => (leagues || []).find((l) => l.league_id === activeLeague) || null, [leagues, activeLeague]);

  const [valueSource, setValueSource] = useState("FantasyCalc");
  const getPlayerValue = useMemo(() => makeGetPlayerValue(valueSource, format, qbType), [valueSource, format, qbType]);

  const [nflWeek, setNflWeek] = useState(1);
  const [startWeek, setStartWeek] = useState(1);
  const [endWeek, setEndWeek] = useState(4);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [minDelta, setMinDelta] = useState(0);
  const [byeMap, setByeMap] = useState(null);

  // fetch NFL state + byes
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("https://api.sleeper.app/v1/state/nfl");
        const data = await res.json();
        if (!mounted) return;
        const w = data?.week || 1;
        setNflWeek(w);
        setStartWeek(Math.max(1, w - 1));
        setEndWeek(w);
        const season = data?.season || new Date().getFullYear();
        const byeRes = await fetch(`/byes/${season}.json`);
        if (byeRes.ok) {
          const byeJson = await byeRes.json();
          setByeMap(byeJson);
        }
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // roster_id → nice name
  const rosterName = useMemo(() => {
    const byRid = {};
    (league?.rosters || []).forEach((r) => {
      const u = (league?.users || []).find((x) => x.user_id === r.owner_id);
      byRid[r.roster_id] = u?.metadata?.team_name || u?.display_name || u?.username || `Roster ${r.roster_id}`;
    });
    return byRid;
  }, [league]);

  const valueWithBye = (p, week) => {
    if (!p || !byeMap) return getPlayerValue(p) || 0;
    const team = (p.team || "").toUpperCase();
    const byeWeeks = byeMap.by_team?.[team] || [];
    const isOnBye = Array.isArray(byeWeeks) && byeWeeks.includes(week);
    return isOnBye ? 0 : getPlayerValue(p) || 0;
  };

  const loadTrades = async () => {
    if (!activeLeague) {
      setRows([]);
      return;
    }
    setBusy(true);
    try {
      const weeks = [];
      for (let w = startWeek; w <= endWeek; w++) weeks.push(w);

      const results = await Promise.all(
        weeks.map(async (w) => {
          const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague}/transactions/${w}`);
          if (!res.ok) return [];
          const data = await res.json();
          return data.filter((t) => t.type === "trade" && t.status === "complete").map((t) => ({ ...t, week: w }));
        })
      );

      const trades = results.flat();
      const parsed = trades
        .map((t) => {
          const teamIds = t.roster_ids || [];
          const validTeamIds = teamIds.filter((rid) => rosterName[rid]);

          const sent = {};
          const recv = {};
          validTeamIds.forEach((rid) => {
            sent[rid] = [];
            recv[rid] = [];
          });

          if (t.adds) {
            Object.entries(t.adds).forEach(([pid, rid]) => {
              if (!recv[rid]) return;
              const pobj = players?.[pid];
              const val = valueWithBye(pobj, t.week);
              recv[rid].push({
                kind: "player",
                id: pid,
                name: pobj?.full_name || pobj?.search_full_name || pid,
                pos: pobj?.position || "",
                team: pobj?.team || "",
                value: val,
              });
            });
          }
          if (t.drops) {
            Object.entries(t.drops).forEach(([pid, rid]) => {
              if (!sent[rid]) return;
              const pobj = players?.[pid];
              const val = valueWithBye(pobj, t.week);
              sent[rid].push({
                kind: "player",
                id: pid,
                name: pobj?.full_name || pobj?.search_full_name || pid,
                pos: pobj?.position || "",
                team: pobj?.team || "",
                value: val,
              });
            });
          }
          (t.draft_picks || []).forEach((pick) => {
            const fromRid = pick.previous_owner_id;
            const toRid = pick.owner_id;
            const label = `${pick.season} R${pick.round} (orig ${pick.roster_id})`;
            if (recv[toRid]) recv[toRid].push({ kind: "pick", id: `${pick.season}-${pick.round}-${pick.roster_id}`, name: label, value: 0 });
            if (sent[fromRid]) sent[fromRid].push({ kind: "pick", id: `${pick.season}-${pick.round}-${pick.roster_id}`, name: label, value: 0 });
          });

          const teams = validTeamIds.map((rid) => {
            const got = recv[rid] || [];
            const gave = sent[rid] || [];
            const gotVal = got.reduce((s, x) => s + (x.value || 0), 0);
            const gaveVal = gave.reduce((s, x) => s + (x.value || 0), 0);
            const delta = Math.round(gotVal - gaveVal);
            return {
              rid,
              name: rosterName[rid],
              got,
              gave,
              gotVal: Math.round(gotVal),
              gaveVal: Math.round(gaveVal),
              delta,
            };
          });

          const best = Math.max(...teams.map((x) => x.delta));
          const winners = teams.filter((x) => x.delta === best).map((x) => x.name);

          return {
            id: t.transaction_id,
            leg: t.leg,
            when: new Date(t.created || t.status_updated || Date.now()).toLocaleString(),
            week: t.week,
            teams,
            winners,
          };
        })
        .sort((a, b) => (b.leg || 0) - (a.leg || 0));

      setRows(parsed);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadTrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, startWeek, endWeek, valueSource, format, qbType, byeMap]);

  const filtered = rows.filter((r) => Math.max(...r.teams.map((t) => t.delta)) >= minDelta);

  // suggested swaps (bye-aware)
  const suggestions = useMemo(() => {
    if (!league?.rosters?.length || !byeMap) return [];
    const valued = [];
    (league.rosters || []).forEach((r) => {
      const name = rosterName[r.roster_id];
      if (!name) return;
      (r.players || []).forEach((pid) => {
        const p = players?.[pid];
        const v = valueWithBye(p, nflWeek);
        if (!p || !v) return;
        valued.push({
          pid,
          val: v,
          name: p.full_name || p.search_full_name || pid,
          pos: (p.position || "").toUpperCase(),
          team: (p.team || "").toUpperCase(),
          rid: r.roster_id,
          owner: name,
        });
      });
    });

    const out = [];
    for (let i = 0; i < valued.length; i++) {
      for (let j = i + 1; j < valued.length; j++) {
        const A = valued[i];
        const B = valued[j];
        if (A.rid === B.rid) continue;
        if (A.pos === B.pos) continue;
        const diff = Math.abs(A.val - B.val);
        const thresh = Math.max(100, 0.04 * (A.val + B.val));
        if (diff <= thresh) {
          out.push({
            aOwner: A.owner,
            bOwner: B.owner,
            aGive: `${A.name} (${A.pos})`,
            bGive: `${B.name} (${B.pos})`,
            delta: Math.round(A.val - B.val),
          });
        }
      }
    }
    return out.sort((x, y) => Math.abs(x.delta) - Math.abs(y.delta)).slice(0, 10);
  }, [league, players, getPlayerValue, rosterName, nflWeek, byeMap]);

  return (
    <Card className="p-4 mt-8">
      {/* header controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Values:</span>
          <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Start Week</label>
          <input type="number" className="bg-gray-800 text-white p-2 rounded w-28" value={startWeek} min={1} max={18} onChange={(e) => setStartWeek(parseInt(e.target.value || "1", 10))} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">End Week</label>
          <input type="number" className="bg-gray-800 text-white p-2 rounded w-28" value={endWeek} min={startWeek} max={18} onChange={(e) => setEndWeek(parseInt(e.target.value || String(startWeek), 10))} />
        </div>
        <div className="text-sm opacity-80 self-end mb-2">
          NFL Week now: <b>{nflWeek}</b>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Min Δ (filter)</label>
          <input type="number" className="bg-gray-800 text-white p-2 rounded w-32" value={minDelta} min={0} step={50} onChange={(e) => setMinDelta(parseInt(e.target.value || "0", 10))} />
        </div>
        {busy && <div className="text-sm opacity-70 self-end mb-2">Loading…</div>}
      </div>

      {/* Suggestions */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 mb-4">
        <div className="font-semibold mb-2">Suggested even swaps (1–for–1, bye adjusted)</div>
        {suggestions.length ? (
          <ul className="text-sm space-y-1">
            {suggestions.map((s, idx) => (
              <li key={idx} className="flex justify-between gap-3">
                <span>{s.aOwner} ➜ {s.bGive}</span>
                <span className="opacity-70">⇄</span>
                <span>{s.bOwner} ➜ {s.aGive}</span>
                <span className="opacity-60 text-xs">Δ≈{Math.abs(s.delta)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm opacity-70">No obvious even-value swaps right now.</div>
        )}
      </div>

      {/* Trade Log */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left">
              <th className="py-2 px-3">Week</th>
              <th className="py-2 px-3">When</th>
              <th className="py-2 px-3">Winner(s)</th>
              <th className="py-2 px-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-t border-white/10 align-top">
                <td className="py-2 px-3">W{t.leg ?? "?"}</td>
                <td className="py-2 px-3 whitespace-nowrap">{t.when}</td>
                <td className="py-2 px-3">{t.winners.join(", ") || "—"}</td>
                <td className="py-2 px-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    {t.teams.map((team) => (
                      <div key={team.rid} className="p-2 rounded border border-white/10 bg-white/5">
                        <div className="font-semibold mb-1">
                          {team.name} {team.delta >= 0 ? "🟢" : "🔴"}{" "}
                          <span className="opacity-70">(Δ {team.delta})</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-xs font-semibold mb-1">Got (≈{team.gotVal})</div>
                            <ul className="text-xs space-y-1">
                              {team.got.map((x) => (
                                <li key={x.kind + x.id}>
                                  {x.kind === "pick" ? "🎟️ " : ""}
                                  {x.name}{x.pos ? ` (${x.pos})` : ""}{" "}
                                  {x.kind === "player" ? <span className="opacity-60">· {Math.round(x.value)}</span> : null}
                                </li>
                              ))}
                              {!team.got.length && <li className="opacity-60">—</li>}
                            </ul>
                          </div>
                          <div>
                            <div className="text-xs font-semibold mb-1">Gave (≈{team.gaveVal})</div>
                            <ul className="text-xs space-y-1">
                              {team.gave.map((x) => (
                                <li key={x.kind + x.id}>
                                  {x.kind === "pick" ? "🎟️ " : ""}
                                  {x.name}{x.pos ? ` (${x.pos})` : ""}{" "}
                                  {x.kind === "player" ? <span className="opacity-60">· {Math.round(x.value)}</span> : null}
                                </li>
                              ))}
                              {!team.gave.length && <li className="opacity-60">—</li>}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={4} className="py-4 px-3 text-sm opacity-70">
                  No trades in range (or all below Δ filter).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
