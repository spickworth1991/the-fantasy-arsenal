"use client";

import { useEffect, useMemo, useState } from "react";
import { classifyLeagueFormat, classifyQbFormat } from "../../lib/leagueFormat";
import { makeGetPlayerValue } from "../../lib/values";

const asNumber = (value) => Number(value || 0);
const cleanIdentity = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

async function sleeperJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sleeper request failed (${response.status})`);
  return response.json();
}

async function mapLimited(rows, limit, worker) {
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        output[index] = await worker(rows[index], index);
      }
    }),
  );
  return output;
}

function Hint({ children, text }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <span
        title={text}
        aria-label={text}
        className="grid h-4 w-4 cursor-help place-items-center rounded-full border border-white/15 text-[9px] font-black text-white/40"
      >
        ?
      </span>
    </span>
  );
}

function identitySignals(target, candidate) {
  const targetNames = [target?.username, target?.display_name].map(cleanIdentity).filter(Boolean);
  const candidateNames = [candidate?.username, candidate?.display_name].map(cleanIdentity).filter(Boolean);
  const similarName = targetNames.some((left) =>
    candidateNames.some(
      (right) => left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left)),
    ),
  );
  const sameAvatar = Boolean(target?.avatar && candidate?.avatar && target.avatar === candidate.avatar);
  return { similarName, sameAvatar };
}

function playerName(players, playerId) {
  const player = players?.[String(playerId)];
  return player?.full_name || player?.search_full_name || `Player ${playerId}`;
}

function tradeAssets(transaction, rosterId, players, getValue, getProjection) {
  const playerIds = Object.entries(transaction?.adds || {})
    .filter(([, receivingRoster]) => String(receivingRoster) === String(rosterId))
    .map(([playerId]) => String(playerId));
  const picks = (transaction?.draft_picks || []).filter(
    (pick) => String(pick.owner_id) === String(rosterId),
  );
  const playerRows = playerIds.map((playerId) => {
    const player = players?.[playerId];
    return {
      id: playerId,
      name: playerName(players, playerId),
      value: asNumber(getValue(player)),
      projection: asNumber(getProjection?.(player, "ARSENAL_MODEL")),
    };
  });
  return {
    players: playerRows,
    picks,
    value: playerRows.reduce((sum, row) => sum + row.value, 0),
    projection: playerRows.reduce((sum, row) => sum + row.projection, 0),
  };
}

function AssetSide({ title, assets }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/15 p-3">
      <div className="flex items-start justify-between gap-3">
        <b className="text-xs text-white/75">{title} received</b>
        <div className="text-right text-[10px] text-white/35">
          <div>{Math.round(assets.value).toLocaleString()} current value</div>
          <div>{assets.projection.toFixed(1)} current projected pts</div>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs text-white/52">
        {assets.players.map((player) => (
          <div key={player.id} className="flex justify-between gap-3">
            <span className="truncate">{player.name}</span>
            <span className="shrink-0 text-white/30">
              {Math.round(player.value).toLocaleString()} · {player.projection.toFixed(1)}
            </span>
          </div>
        ))}
        {assets.picks.map((pick, index) => (
          <div key={`${pick.season}:${pick.round}:${index}`}>
            {pick.season} round {pick.round} pick
          </div>
        ))}
        {!assets.players.length && !assets.picks.length ? (
          <div className="text-white/25">No received assets were returned.</div>
        ) : null}
      </div>
    </div>
  );
}

function SharedLeagueAudit({ entry, targetUser, candidate, players, getProjection }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [trades, setTrades] = useState(null);

  const loadTrades = async () => {
    if (trades || loading) return;
    setLoading(true);
    setError("");
    try {
      const weekly = await mapLimited(
        Array.from({ length: 19 }, (_, week) => week),
        6,
        (week) =>
          sleeperJson(
            `https://api.sleeper.app/v1/league/${entry.league.league_id}/transactions/${week}`,
          ).catch(() => []),
      );
      const targetRosterId = String(entry.targetRoster?.roster_id || "");
      const candidateRosterId = String(entry.candidateRoster?.roster_id || "");
      const direct = weekly
        .flat()
        .filter((transaction) => {
          const rosterIds = (transaction.roster_ids || []).map(String);
          return (
            transaction.type === "trade" &&
            transaction.status === "complete" &&
            rosterIds.includes(targetRosterId) &&
            rosterIds.includes(candidateRosterId)
          );
        })
        .sort((a, b) => asNumber(b.created) - asNumber(a.created));
      setTrades(direct);
    } catch {
      setError("Trade history could not be loaded from Sleeper.");
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  const leagueFormat = classifyLeagueFormat(entry.league).key === "dynasty" ? "dynasty" : "redraft";
  const leagueQb = classifyQbFormat(entry.league).key;
  const getValue = useMemo(
    () => makeGetPlayerValue("TheFantasyArsenal", leagueFormat, leagueQb, "ppr"),
    [leagueFormat, leagueQb],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) loadTrades();
        }}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-white/[0.035]"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-black">{entry.league.name}</div>
          <div className="mt-1 text-[10px] text-white/35">
            {entry.season || entry.league.season || "—"} · {entry.league.total_rosters || "—"} teams · {leagueFormat} · {leagueQb === "sf" ? "Superflex" : "1QB"}
          </div>
        </div>
        {String(entry.league.commissioner_id) === String(targetUser.user_id) ||
        String(entry.league.commissioner_id) === String(candidate.user_id) ? (
          <span className="rounded-full bg-amber-300/10 px-2 py-1 text-[9px] font-bold text-amber-100">
            COMMISSIONER LINK
          </span>
        ) : null}
        <span className="text-white/35">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="border-t border-white/[0.07] p-4">
          <div className="mb-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3 text-[10px] leading-5 text-white/40">
            Values and projections below are today&apos;s Arsenal readings, not historical values frozen when the trade occurred.
          </div>
          {loading ? <div className="text-sm text-cyan-100">Auditing transaction periods 0–18…</div> : null}
          {error ? <div className="text-sm text-rose-100">{error}</div> : null}
          {trades && !trades.length ? (
            <div className="text-sm text-white/35">No completed direct trades found in this league season.</div>
          ) : null}
          <div className="space-y-3">
            {(trades || []).map((transaction) => {
              const targetAssets = tradeAssets(
                transaction,
                entry.targetRoster.roster_id,
                players,
                getValue,
                getProjection,
              );
              const candidateAssets = tradeAssets(
                transaction,
                entry.candidateRoster.roster_id,
                players,
                getValue,
                getProjection,
              );
              const valueDelta = targetAssets.value - candidateAssets.value;
              return (
                <div key={transaction.transaction_id} className="rounded-2xl border border-white/[0.08] bg-slate-950/65 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/35">
                    <span>{transaction.created ? new Date(asNumber(transaction.created)).toLocaleDateString() : "Date unavailable"}</span>
                    <span title="Positive means the searched manager currently holds more value from this trade.">
                      Current value direction: {valueDelta >= 0 ? "+" : ""}{Math.round(valueDelta).toLocaleString()}
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <AssetSide title={targetUser.display_name || targetUser.username} assets={targetAssets} />
                    <AssetSide title={candidate.display_name || candidate.username} assets={candidateAssets} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CandidateModal({ candidate, targetUser, totalLeagues, players, getProjection, onClose }) {
  if (!candidate) return null;
  const identity = identitySignals(targetUser, candidate.user);
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Shared leagues with ${candidate.user.display_name || candidate.user.username}`}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-[30px] border border-white/10 bg-slate-950 shadow-2xl sm:rounded-[30px]"
      >
        <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 p-5 backdrop-blur-xl">
          <div className="flex items-start gap-4">
            {candidate.user.avatar ? (
              <img src={`https://sleepercdn.com/avatars/thumbs/${candidate.user.avatar}`} alt="" className="h-12 w-12 rounded-2xl" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.06] font-black">?</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[.2em] text-violet-200/55">Relationship evidence</div>
              <h2 className="truncate text-2xl font-black">{candidate.user.display_name || candidate.user.username}</h2>
              <p className="mt-1 text-xs text-white/40">
                {candidate.leagues.length} of {totalLeagues} selected league-seasons shared with {targetUser.display_name || targetUser.username}.
              </p>
            </div>
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white/45 hover:bg-white/[0.06]" aria-label="Close">
              ×
            </button>
          </div>
          {identity.sameAvatar || identity.similarName ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {identity.sameAvatar ? <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[10px] font-bold text-amber-100">Same public avatar</span> : null}
              {identity.similarName ? <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[10px] font-bold text-amber-100">Similar public name</span> : null}
            </div>
          ) : null}
        </header>
        <div className="p-4 sm:p-5">
          <div className="mb-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.055] p-4 text-xs leading-5 text-amber-50/75">
            <b className="text-amber-100">Evidence, not a verdict.</b> Shared leagues, public-name similarities, commissioner links, and uneven trades cannot prove multiple accounts or collusion. They become context worth reviewing only alongside repeated one-way behavior, lineup manipulation, or other independent evidence.
          </div>
          <div className="space-y-3">
            {candidate.leagues.map((entry) => (
              <SharedLeagueAudit
                key={`${entry.season || entry.league.season}:${entry.league.league_id}`}
                entry={entry}
                targetUser={targetUser}
                candidate={candidate.user}
                players={players}
                getProjection={getProjection}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CollusionDetector({
  targetUser,
  leagues,
  yearLeagueGroups,
  players,
  getProjection,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [network, setNetwork] = useState([]);
  const [selected, setSelected] = useState(null);
  const availableGroups = useMemo(() => {
    const supplied = (yearLeagueGroups || []).filter(
      (group) => Number(group?.year) && Array.isArray(group?.leagues),
    );
    if (supplied.length) return supplied.sort((a, b) => Number(b.year) - Number(a.year));
    const fallbackYear = Number(leagues?.[0]?.season || new Date().getFullYear());
    return [{ year: fallbackYear, leagues: leagues || [] }];
  }, [yearLeagueGroups, leagues]);
  const availableYears = useMemo(
    () => availableGroups.map((group) => Number(group.year)),
    [availableGroups],
  );
  const [selectedYears, setSelectedYears] = useState([]);

  useEffect(() => {
    setSelectedYears((current) => {
      const stillAvailable = current.filter((year) => availableYears.includes(Number(year)));
      if (stillAvailable.length) return stillAvailable;
      return availableYears.slice(0, Math.min(3, availableYears.length));
    });
  }, [availableYears]);

  const scanLeagues = useMemo(
    () =>
      availableGroups.flatMap((group) =>
        selectedYears.includes(Number(group.year))
          ? group.leagues.map((league) => ({ ...league, _detectorSeason: Number(group.year) }))
          : [],
      ),
    [availableGroups, selectedYears],
  );

  useEffect(() => {
    let active = true;
    if (!targetUser?.user_id || !scanLeagues.length) {
      setNetwork([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError("");
    mapLimited(scanLeagues, 7, async (league) => {
      const [rosters, users] = await Promise.all([
        sleeperJson(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).catch(() => []),
        sleeperJson(`https://api.sleeper.app/v1/league/${league.league_id}/users`).catch(() => []),
      ]);
      const userMap = new Map(users.map((user) => [String(user.user_id), user]));
      const targetRoster = rosters.find(
        (roster) =>
          String(roster.owner_id) === String(targetUser.user_id) ||
          (roster.co_owners || []).map(String).includes(String(targetUser.user_id)),
      );
      return { league, rosters, userMap, targetRoster };
    })
      .then((rows) => {
        if (!active) return;
        const people = new Map();
        rows.forEach(({ league, rosters, userMap, targetRoster }) => {
          if (!targetRoster) return;
          rosters.forEach((candidateRoster) => {
            const ownerIds = [candidateRoster.owner_id, ...(candidateRoster.co_owners || [])]
              .map(String)
              .filter(Boolean);
            ownerIds.forEach((ownerId) => {
              if (ownerId === String(targetUser.user_id)) return;
              const user = userMap.get(ownerId);
              if (!user) return;
              const existing = people.get(ownerId) || { user, leagues: [] };
              existing.leagues.push({
                league,
                season: league._detectorSeason || league.season,
                targetRoster,
                candidateRoster,
              });
              people.set(ownerId, existing);
            });
          });
        });
        setNetwork(
          [...people.values()].sort(
            (left, right) =>
              right.leagues.length - left.leagues.length ||
              String(left.user.display_name || left.user.username).localeCompare(
                String(right.user.display_name || right.user.username),
              ),
          ),
        );
      })
      .catch(() => active && setError("The shared-league network could not be loaded from Sleeper."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [targetUser?.user_id, scanLeagues]);

  const chooseYears = (years) => {
    setSelected(null);
    setSelectedYears([...new Set(years.map(Number))].sort((a, b) => b - a));
  };

  return (
    <section className="mt-5 overflow-hidden rounded-[28px] border border-violet-300/15 bg-gradient-to-b from-slate-900/95 to-slate-950/90">
      <header className="border-b border-white/10 bg-[radial-gradient(circle_at_85%_0%,rgba(139,92,246,.18),transparent_42%)] p-5 sm:p-6">
        <div className="text-[10px] font-black uppercase tracking-[.24em] text-violet-200/55">Public relationship audit</div>
        <h2 className="mt-1 text-2xl font-black sm:text-3xl">Collusion Detector</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">
          Compare the searched manager with every manager found across the selected seasons. Open a relationship to inspect each shared league and audit completed direct trades.
        </p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.18em] text-white/45">Seasons to scan</div>
              <div className="mt-1 text-[10px] text-white/30">Choose any combination. The newest three are selected by default.</div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => chooseYears(availableYears.slice(0, 3))} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-white/50 hover:bg-white/[0.05]">
                Recent 3
              </button>
              <button type="button" onClick={() => chooseYears(availableYears)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-white/50 hover:bg-white/[0.05]">
                All years
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {availableGroups.map((group) => {
              const year = Number(group.year);
              const active = selectedYears.includes(year);
              return (
                <button
                  type="button"
                  key={year}
                  onClick={() => {
                    if (active && selectedYears.length === 1) return;
                    chooseYears(active ? selectedYears.filter((item) => item !== year) : [...selectedYears, year]);
                  }}
                  className={`rounded-xl border px-3 py-2 text-xs font-black transition ${active ? "border-violet-300/35 bg-violet-300/10 text-violet-100" : "border-white/10 bg-white/[0.025] text-white/35 hover:text-white/60"}`}
                >
                  {year} <span className="ml-1 text-[9px] opacity-55">{group.leagues.length}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-xs leading-5 text-amber-50/70">
          This is a lead-finding tool, not proof of wrongdoing. Sleeper&apos;s public API cannot identify account ownership, intent, side agreements, or off-platform activity.
        </div>
      </header>
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-white/40">
            {loading ? "Scanning league membership…" : `${network.length} unique managers found across ${scanLeagues.length} league-seasons`}
          </div>
          <div className="text-[10px] text-white/30">
            <Hint text="Higher overlap is a relationship signal only. Large tournament groups and recurring home leagues can naturally create many shared leagues.">
              Ranked by shared leagues
            </Hint>
          </div>
        </div>
        {error ? <div className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-100">{error}</div> : null}
        {!loading && !error && !network.length ? <div className="p-6 text-center text-sm text-white/35">No other managers were found in the selected seasons.</div> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {network.map((candidate) => {
            const identity = identitySignals(targetUser, candidate.user);
            const shareRate = scanLeagues.length ? candidate.leagues.length / scanLeagues.length : 0;
            return (
              <button
                type="button"
                key={candidate.user.user_id}
                onClick={() => setSelected(candidate)}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:-translate-y-0.5 hover:border-violet-300/25 hover:bg-violet-300/[0.045]"
              >
                <div className="flex items-center gap-3">
                  {candidate.user.avatar ? (
                    <img src={`https://sleepercdn.com/avatars/thumbs/${candidate.user.avatar}`} alt="" className="h-11 w-11 rounded-2xl" />
                  ) : (
                    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.06] font-black">?</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-black">{candidate.user.display_name || candidate.user.username}</div>
                    <div className="truncate text-[10px] text-white/32">@{candidate.user.username || "unknown"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-violet-100">{candidate.leagues.length}</div>
                    <div className="text-[9px] uppercase tracking-wider text-white/28">shared</div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-300/70 to-violet-300/80" style={{ width: `${Math.max(4, shareRate * 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/35">
                  <span>{Math.round(shareRate * 100)}% of searched portfolio</span>
                  <span>Inspect evidence →</span>
                </div>
                {identity.sameAvatar || identity.similarName ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {identity.sameAvatar ? <span className="rounded-full bg-amber-300/10 px-2 py-1 text-[9px] font-bold text-amber-100">Same avatar</span> : null}
                    {identity.similarName ? <span className="rounded-full bg-amber-300/10 px-2 py-1 text-[9px] font-bold text-amber-100">Similar name</span> : null}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <CandidateModal
        candidate={selected}
        targetUser={targetUser}
        totalLeagues={scanLeagues.length}
        players={players}
        getProjection={getProjection}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
