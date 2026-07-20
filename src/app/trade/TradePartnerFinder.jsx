"use client";

import { useEffect, useMemo, useState } from "react";
import AvatarImage from "../../components/AvatarImage";

const CORE_POSITIONS = ["QB", "RB", "WR", "TE"];
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const PICK_ROUNDS = 4;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sum = (rows, getter = (row) => row.value) => rows.reduce((total, row) => total + Number(getter(row) || 0), 0);
const assetKey = (asset) => `${asset.kind}:${asset.id}`;
const playerName = (player, fallback) => player?.full_name || player?.search_full_name || `${player?.first_name || ""} ${player?.last_name || ""}`.trim() || fallback;

function normalizePosition(position) {
  const pos = String(position || "").toUpperCase();
  if (pos === "DST") return "DEF";
  return pos;
}

function combinations(items, size, cap = 260) {
  if (size <= 1) return items.map((item) => [item]);
  const output = [];
  const walk = (start, selected) => {
    if (output.length >= cap) return;
    if (selected.length === size) { output.push(selected); return; }
    for (let index = start; index < items.length; index += 1) {
      walk(index + 1, [...selected, items[index]]);
      if (output.length >= cap) break;
    }
  };
  walk(0, []);
  return output;
}

function nearestPackages(indexedPackages, targetValue, limit = 24) {
  if (!indexedPackages.length) return [];
  let low = 0;
  let high = indexedPackages.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (indexedPackages[middle].total < targetValue) low = middle + 1;
    else high = middle;
  }
  let left = low - 1;
  let right = low;
  const output = [];
  while (output.length < limit && (left >= 0 || right < indexedPackages.length)) {
    const leftGap = left >= 0 ? Math.abs(indexedPackages[left].total - targetValue) : Infinity;
    const rightGap = right < indexedPackages.length ? Math.abs(indexedPackages[right].total - targetValue) : Infinity;
    if (leftGap <= rightGap) output.push(indexedPackages[left--].assets);
    else output.push(indexedPackages[right++].assets);
  }
  return output;
}

function parseStarterNeeds(rosterPositions = []) {
  const needs = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER_FLEX: 0 };
  rosterPositions.forEach((raw) => {
    const slot = String(raw || "").toUpperCase();
    if (CORE_POSITIONS.includes(slot)) needs[slot] += 1;
    else if (["FLEX", "WRRB_FLEX", "REC_FLEX", "RBTE_FLEX"].includes(slot)) needs.FLEX += 1;
    else if (["SUPER_FLEX", "SF", "OP"].includes(slot)) needs.SUPER_FLEX += 1;
  });
  return needs;
}

function lineupScore(assets, starterNeeds) {
  const byPos = Object.fromEntries(CORE_POSITIONS.map((pos) => [pos, []]));
  assets.filter((asset) => asset.kind === "player").forEach((asset) => {
    if (byPos[asset.pos]) byPos[asset.pos].push(asset.lineupValue);
  });
  CORE_POSITIONS.forEach((pos) => byPos[pos].sort((a, b) => b - a));
  let score = 0;
  const leftovers = [];
  CORE_POSITIONS.forEach((pos) => {
    score += sum(byPos[pos].slice(0, starterNeeds[pos]), Number);
    byPos[pos].slice(starterNeeds[pos]).forEach((value) => leftovers.push({ pos, value }));
  });
  leftovers.sort((a, b) => b.value - a.value);
  const flexEligible = leftovers.filter((row) => FLEX_POSITIONS.has(row.pos));
  score += sum(flexEligible.slice(0, starterNeeds.FLEX), (row) => row.value);
  const usedFlex = new Set(flexEligible.slice(0, starterNeeds.FLEX));
  const superflexPool = leftovers.filter((row) => !usedFlex.has(row)).sort((a, b) => b.value - a.value);
  score += sum(superflexPool.slice(0, starterNeeds.SUPER_FLEX), (row) => row.value);
  return score;
}

function pickValue(baseValue, seasonOffset, round) {
  const roundFactor = [0, 0.23, 0.1, 0.045, 0.02][round] || 0.01;
  return Math.round(baseValue * roundFactor * Math.pow(0.88, seasonOffset));
}

function inferDirection(profile, rank, teamCount) {
  const topThird = rank < Math.max(1, Math.ceil(teamCount / 3));
  const bottomThird = rank >= Math.max(1, Math.floor((teamCount * 2) / 3));
  if (topThird && profile.averageAge >= 25.2) return "Contender";
  if (bottomThird || profile.averageAge < 24.2) return "Rebuilder";
  return "Retooling";
}

function directionFit(direction, assets) {
  if (!assets.length) return 0;
  const picks = assets.filter((asset) => asset.kind === "pick").length;
  const players = assets.filter((asset) => asset.kind === "player");
  const averageAge = players.length ? sum(players, (asset) => asset.age || 25) / players.length : 0;
  if (direction === "Contender") return players.length * 0.5 + (averageAge >= 25 ? 0.7 : 0) - picks * 0.2;
  if (direction === "Rebuilder") return picks * 0.9 + (players.length && averageAge <= 24 ? 0.8 : 0);
  return picks * 0.3 + players.length * 0.35;
}

function needFit(profile, assets) {
  return assets.reduce((score, asset) => score + (asset.kind === "player" ? Number(profile.needScores[asset.pos] || 0) : 0), 0);
}

function replaceAssets(currentAssets, outgoing, incoming) {
  const outgoingKeys = new Set(outgoing.map(assetKey));
  return [...currentAssets.filter((asset) => !outgoingKeys.has(assetKey(asset))), ...incoming];
}

function describePackage({ mine, partner, give, receive, myLineupDelta, partnerLineupDelta, myPlayoffImpact, partnerPlayoffImpact }) {
  const reasons = [];
  const theirIncomingPositions = [...new Set(give.filter((asset) => asset.kind === "player").map((asset) => asset.pos))];
  const myIncomingPositions = [...new Set(receive.filter((asset) => asset.kind === "player").map((asset) => asset.pos))];
  if (theirIncomingPositions.length) reasons.push(`${partner.name} gets help at ${theirIncomingPositions.join("/")}, where their roster grades below the league.`);
  if (myIncomingPositions.length) reasons.push(`You add ${myIncomingPositions.join("/")} help without ignoring ${partner.name}’s roster direction.`);
  if (partner.direction === "Rebuilder" && give.some((asset) => asset.kind === "pick")) reasons.push("The future pick capital fits a rebuilding timeline.");
  if (partner.direction === "Contender" && give.some((asset) => asset.kind === "player" && asset.age >= 25)) reasons.push("The incoming veteran production fits a contender’s window.");
  if (myLineupDelta > 0.05 || partnerLineupDelta > 0.05) reasons.push(`Estimated weekly lineup change: you ${myLineupDelta >= 0 ? "+" : ""}${myLineupDelta.toFixed(1)}, ${partner.name} ${partnerLineupDelta >= 0 ? "+" : ""}${partnerLineupDelta.toFixed(1)}.`);
  reasons.push(`Estimated playoff leverage: you ${myPlayoffImpact >= 0 ? "+" : ""}${myPlayoffImpact.toFixed(1)} pts, ${partner.name} ${partnerPlayoffImpact >= 0 ? "+" : ""}${partnerPlayoffImpact.toFixed(1)} pts.`);
  return reasons.slice(0, 4);
}

function AssetPill({ asset }) {
  return <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
    {asset.kind === "player" ? <AvatarImage name={asset.name} playerId={asset.id} size={30} className="rounded-full" alt="" /> : <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-violet-400/15 text-xs">◆</div>}
    <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-white">{asset.name}</div><div className="text-[10px] text-white/40">{asset.kind === "player" ? `${asset.pos}${asset.team ? ` · ${asset.team}` : ""}` : "Draft capital"}</div></div>
    <div className="text-xs font-bold tabular-nums text-white/60">{Math.round(asset.value).toLocaleString()}</div>
  </div>;
}

export default function TradePartnerFinder({ league, players, getMetric, metricMode, username }) {
  const [userId, setUserId] = useState("");
  const [tradedPicks, setTradedPicks] = useState([]);
  const [completedDraftSeasons, setCompletedDraftSeasons] = useState(() => new Set());
  const [selectedRosterId, setSelectedRosterId] = useState("");
  const [packageShape, setPackageShape] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [targetAssetId, setTargetAssetId] = useState("all");
  const [showCount, setShowCount] = useState(8);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!username) return;
    fetch(`https://api.sleeper.app/v1/user/${username}`).then((response) => response.ok ? response.json() : null).then((user) => { if (active && user?.user_id) setUserId(String(user.user_id)); }).catch(() => {});
    return () => { active = false; };
  }, [username]);

  useEffect(() => {
    let active = true;
    if (!league?.league_id) { setTradedPicks([]); return; }
    setLoading(true);
    Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then((response) => response.ok ? response.json() : []),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then((response) => response.ok ? response.json() : []),
    ]).then(([picks, drafts]) => {
      if (!active) return;
      setTradedPicks(Array.isArray(picks) ? picks : []);
      setCompletedDraftSeasons(new Set((Array.isArray(drafts) ? drafts : []).filter((draft) => String(draft.status) === "complete").map((draft) => String(draft.season))));
    }).catch(() => {
      if (!active) return;
      setTradedPicks([]);
      setCompletedDraftSeasons(new Set());
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [league?.league_id]);

  useEffect(() => {
    const mine = (league?.rosters || []).find((roster) => String(roster.owner_id) === String(userId));
    if (mine) setSelectedRosterId(String(mine.roster_id));
    else if (league?.rosters?.[0]) setSelectedRosterId(String(league.rosters[0].roster_id));
  }, [league, userId]);

  useEffect(() => {
    setTargetAssetId("all");
    setShowCount(8);
  }, [selectedRosterId]);

  const analysis = useMemo(() => {
    if (!league?.rosters?.length || !selectedRosterId) return { profiles: [], suggestions: [], mine: null };
    const rosters = league.rosters.filter((roster) => Array.isArray(roster.players));
    const usersById = new Map((league.users || []).map((user) => [String(user.user_id), user]));
    const starterNeeds = parseStarterNeeds(league.roster_positions || []);
    const rosterCapacity = (league.roster_positions || []).filter((slot) => !["IR", "TAXI"].includes(String(slot).toUpperCase())).length;
    const currentSeason = Number(league.season || new Date().getFullYear());
    const futureSeasons = [currentSeason, currentSeason + 1, currentSeason + 2];
    const baseValues = rosters.flatMap((roster) => (roster.players || []).map((id) => Number(getMetric(players?.[id]) || 0))).filter((value) => value > 0).sort((a, b) => b - a);
    const pickBase = baseValues[Math.min(baseValues.length - 1, Math.max(0, Math.floor(baseValues.length * 0.12)))] || 5000;
    const tradedOwner = new Map(tradedPicks.map((pick) => [`${pick.season}-${pick.round}-${pick.roster_id}`, String(pick.owner_id)]));
    const profiles = rosters.map((roster) => {
      const user = usersById.get(String(roster.owner_id));
      const name = user?.metadata?.team_name || user?.display_name || user?.username || `Roster ${roster.roster_id}`;
      const playerAssets = (roster.players || []).map((id) => {
        const player = players?.[id];
        if (!player) return null;
        const value = Number(getMetric(player) || 0);
        const pos = normalizePosition(player.position);
        if (!value || pos === "PICK") return null;
        return { kind: "player", id: String(id), name: playerName(player, id), pos, team: String(player.team || "").toUpperCase(), age: Number(player.age || 25), value, lineupValue: metricMode === "projections" ? value / 17 : Math.sqrt(value) };
      }).filter(Boolean);
      const pickAssets = [];
      futureSeasons.forEach((season, seasonOffset) => {
        if (completedDraftSeasons.has(String(season))) return;
        for (let round = 1; round <= PICK_ROUNDS; round += 1) {
          rosters.forEach((originalRoster) => {
            const key = `${season}-${round}-${originalRoster.roster_id}`;
            const owner = tradedOwner.get(key) || String(originalRoster.roster_id);
            if (owner !== String(roster.roster_id)) return;
            pickAssets.push({ kind: "pick", id: key, name: `${season} Round ${round}${String(originalRoster.roster_id) !== String(roster.roster_id) ? ` · via R${originalRoster.roster_id}` : ""}`, pos: "PICK", age: 0, value: pickValue(pickBase, seasonOffset, round), lineupValue: 0 });
          });
        }
      });
      const positionValues = Object.fromEntries(CORE_POSITIONS.map((pos) => [pos, sum(playerAssets.filter((asset) => asset.pos === pos).sort((a, b) => b.value - a.value).slice(0, Math.max(1, starterNeeds[pos] + (pos === "WR" || pos === "RB" ? 1 : 0))))]));
      const fantasyPlayers = playerAssets.filter((asset) => CORE_POSITIONS.includes(asset.pos));
      const averageAge = fantasyPlayers.length ? sum(fantasyPlayers, (asset) => asset.age) / fantasyPlayers.length : 25;
      return { roster, rosterId: String(roster.roster_id), name, assets: [...playerAssets, ...pickAssets], playerAssets, pickAssets, positionValues, averageAge, starterNeeds, rosterCapacity: Math.max(rosterCapacity, (roster.players || []).length), rosterPlayerCount: (roster.players || []).length, currentLineup: lineupScore(playerAssets, starterNeeds), wins: Number(roster?.settings?.wins || 0), points: Number(roster?.settings?.fpts || 0) + Number(roster?.settings?.fpts_decimal || 0) / 100 };
    });
    const leagueAverages = Object.fromEntries(CORE_POSITIONS.map((pos) => [pos, sum(profiles, (profile) => profile.positionValues[pos]) / Math.max(1, profiles.length)]));
    profiles.forEach((profile) => {
      profile.needScores = Object.fromEntries(CORE_POSITIONS.map((pos) => [pos, clamp((leagueAverages[pos] - profile.positionValues[pos]) / Math.max(1, leagueAverages[pos]), 0, 1)]));
    });
    const ranked = [...profiles].sort((a, b) => b.wins - a.wins || b.points - a.points);
    ranked.forEach((profile, index) => { profile.direction = inferDirection(profile, index, ranked.length); profile.rank = index + 1; });
    const mine = profiles.find((profile) => profile.rosterId === String(selectedRosterId));
    if (!mine) return { profiles, suggestions: [], mine: null };

    const shapes = packageShape === "all" ? [[1,1],[1,2],[2,1],[2,2],[2,3],[3,2]] : [packageShape.split("x").map(Number)];
    const results = [];
    profiles.filter((partner) => partner.rosterId !== mine.rosterId && (directionFilter === "all" || partner.direction === directionFilter)).forEach((partner) => {
      const myPool = [...mine.playerAssets.sort((a,b) => b.value-a.value).slice(0, 14), ...mine.pickAssets.slice(0, 8)];
      const partnerPool = [...partner.playerAssets.sort((a,b) => b.value-a.value).slice(0, 14), ...partner.pickAssets.slice(0, 8)];
      shapes.forEach(([giveSize, receiveSize]) => {
        const giveCombos = combinations(myPool, giveSize);
        const receiveIndex = combinations(partnerPool, receiveSize)
          .map((assets) => ({ assets, total: sum(assets) }))
          .sort((a, b) => a.total - b.total);
        giveCombos.forEach((give) => {
          if (targetAssetId !== "all" && !give.some((asset) => assetKey(asset) === targetAssetId)) return;
          const giveValue = sum(give);
          nearestPackages(receiveIndex, giveValue).forEach((receive) => {
            const receiveValue = sum(receive);
            const valueGapPct = Math.abs(giveValue - receiveValue) / Math.max(1, (giveValue + receiveValue) / 2);
            if (valueGapPct > 0.2) return;
            const myPlayerCount = mine.rosterPlayerCount - give.filter((asset) => asset.kind === "player").length + receive.filter((asset) => asset.kind === "player").length;
            const partnerPlayerCount = partner.rosterPlayerCount - receive.filter((asset) => asset.kind === "player").length + give.filter((asset) => asset.kind === "player").length;
            if (myPlayerCount > mine.rosterCapacity || partnerPlayerCount > partner.rosterCapacity) return;
            const myAfter = replaceAssets(mine.assets, give, receive);
            const partnerAfter = replaceAssets(partner.assets, receive, give);
            const myLineupDelta = lineupScore(myAfter, starterNeeds) - mine.currentLineup;
            const partnerLineupDelta = lineupScore(partnerAfter, starterNeeds) - partner.currentLineup;
            const myNeedFit = needFit(mine, receive);
            const partnerNeedFit = needFit(partner, give);
            const myDirectionFit = directionFit(mine.direction, receive);
            const partnerDirectionFit = directionFit(partner.direction, give);
            const myUtility = myNeedFit * 2 + myDirectionFit + clamp(myLineupDelta / Math.max(1, mine.currentLineup) * 20, -2, 3) - valueGapPct * 3;
            const partnerUtility = partnerNeedFit * 2 + partnerDirectionFit + clamp(partnerLineupDelta / Math.max(1, partner.currentLineup) * 20, -2, 3) - valueGapPct * 3;
            if (myUtility < -0.2 || partnerUtility < -0.2) return;
            const mutualScore = Math.min(myUtility, partnerUtility) * 3 + myUtility + partnerUtility - valueGapPct * 8;
            const myPlayoffImpact = mine.direction === "Rebuilder" ? 0 : clamp(myLineupDelta / Math.max(1, mine.currentLineup) * 35, -8, 8);
            const partnerPlayoffImpact = partner.direction === "Rebuilder" ? 0 : clamp(partnerLineupDelta / Math.max(1, partner.currentLineup) * 35, -8, 8);
            results.push({ id: `${partner.rosterId}-${give.map(assetKey).join("_")}-${receive.map(assetKey).join("_")}`, mine, partner, give, receive, giveValue, receiveValue, valueGapPct, myLineupDelta, partnerLineupDelta, myPlayoffImpact, partnerPlayoffImpact, mutualScore, reasons: describePackage({ mine, partner, give, receive, myLineupDelta, partnerLineupDelta, myPlayoffImpact, partnerPlayoffImpact }) });
          });
        });
      });
    });
    const seen = new Set();
    const suggestions = results.sort((a, b) => b.mutualScore - a.mutualScore || a.valueGapPct - b.valueGapPct).filter((row) => { const key = `${row.partner.rosterId}:${row.give.map(assetKey).sort().join("|")}:${row.receive.map(assetKey).sort().join("|")}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 40);
    return { profiles, suggestions, mine };
  }, [completedDraftSeasons, directionFilter, getMetric, league, metricMode, packageShape, players, selectedRosterId, targetAssetId, tradedPicks]);

  if (!league) return null;
  const targetOptions = analysis.mine?.assets?.filter((asset) => asset.value > 0).sort((a, b) => b.value - a.value) || [];

  return <section className="relative mb-7 overflow-hidden rounded-[30px] border border-violet-300/15 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.18),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.94))] shadow-[0_38px_110px_-72px_rgba(139,92,246,.8)]">
    <div className="p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[.26em] text-violet-200/60">Trade Partner Finder 2.0</div><h2 className="mt-2 text-2xl font-black tracking-tight">Deals that help both teams</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-white/55">Packages are ranked by roster need, lineup impact, team direction, positional scarcity, roster limits, picks, and value—not equality alone.</p></div><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/10">{open ? "Collapse Finder" : `Show Finder · ${analysis.suggestions.length} ideas`}</button></div>
    {open ? <><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label><span className="mb-1.5 block text-xs text-white/45">Your team</span><select value={selectedRosterId} onChange={(event) => setSelectedRosterId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-3 py-3 text-sm">{analysis.profiles.map((profile) => <option key={profile.rosterId} value={profile.rosterId}>{profile.name}</option>)}</select></label><label><span className="mb-1.5 block text-xs text-white/45">Package shape</span><select value={packageShape} onChange={(event) => setPackageShape(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-3 py-3 text-sm"><option value="all">All package sizes</option><option value="1x1">1 for 1</option><option value="1x2">1 for 2</option><option value="2x1">2 for 1</option><option value="2x2">2 for 2</option><option value="2x3">2 for 3</option><option value="3x2">3 for 2</option></select></label><label><span className="mb-1.5 block text-xs text-white/45">Partner direction</span><select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-3 py-3 text-sm"><option value="all">Any direction</option><option value="Contender">Contenders</option><option value="Retooling">Retooling</option><option value="Rebuilder">Rebuilders</option></select></label><label><span className="mb-1.5 block text-xs text-white/45">Build around asset</span><select value={targetAssetId} onChange={(event) => setTargetAssetId(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/85 px-3 py-3 text-sm"><option value="all">Any of my assets</option>{targetOptions.map((asset) => <option key={assetKey(asset)} value={assetKey(asset)}>{asset.name}</option>)}</select></label></div>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-white/50"><span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Your direction: <b className="text-white/75">{analysis.mine?.direction || "—"}</b></span><span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">Roster rank: <b className="text-white/75">#{analysis.mine?.rank || "—"}</b></span><span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{loading ? "Loading pick ownership…" : `${analysis.mine?.pickAssets?.length || 0} picks modeled`}</span><span className="rounded-full border border-amber-300/15 bg-amber-300/[0.06] px-2.5 py-1 text-amber-100/65">Playoff change is an estimated impact, not a full re-simulation</span></div>
    </> : null}</div>

    {open ? <div className="border-t border-white/10 bg-black/10 p-4 sm:p-6">{analysis.suggestions.length ? <div className="space-y-4">{analysis.suggestions.slice(0, showCount).map((row, index) => <article key={row.id} className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.03]"><div className="flex flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400/12 text-sm font-black text-violet-100">{index + 1}</div><div><div className="font-bold">Trade with {row.partner.name}</div><div className="text-xs text-white/42">{row.partner.direction} · roster rank #{row.partner.rank} · {Math.round((1-row.valueGapPct)*100)}% value alignment</div></div></div><div className="flex gap-2"><span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-2.5 py-1 text-[11px] text-cyan-100">You {row.myLineupDelta >= 0 ? "+" : ""}{row.myLineupDelta.toFixed(1)} lineup</span><span className="rounded-full border border-violet-300/15 bg-violet-300/[0.06] px-2.5 py-1 text-[11px] text-violet-100">Them {row.partnerLineupDelta >= 0 ? "+" : ""}{row.partnerLineupDelta.toFixed(1)}</span></div></div><div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto_1fr]"><div><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold uppercase tracking-[.16em] text-rose-200/55">You send</span><span className="text-white/40">{Math.round(row.giveValue).toLocaleString()}</span></div><div className="space-y-2">{row.give.map((asset) => <AssetPill key={assetKey(asset)} asset={asset} />)}</div></div><div className="hidden items-center text-white/20 lg:flex">⇄</div><div><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold uppercase tracking-[.16em] text-emerald-200/55">You receive</span><span className="text-white/40">{Math.round(row.receiveValue).toLocaleString()}</span></div><div className="space-y-2">{row.receive.map((asset) => <AssetPill key={assetKey(asset)} asset={asset} />)}</div></div></div><div className="border-t border-white/8 bg-black/15 px-4 py-3"><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-white/35">Why they might accept</div><ul className="mt-2 grid gap-1.5 text-xs leading-5 text-white/55 md:grid-cols-2">{row.reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="text-violet-200/60">◆</span><span>{reason}</span></li>)}</ul></div></article>)}{showCount < analysis.suggestions.length ? <button type="button" onClick={() => setShowCount((count) => count + 8)} className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3 text-sm font-semibold text-white/65 hover:bg-white/[0.08]">Show more packages</button> : null}</div> : <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"><div className="text-lg font-bold">No mutually useful packages found</div><div className="mt-1 text-sm text-white/50">Try allowing every package size, removing the direction filter, or building around a different asset.</div></div>}</div> : null}
  </section>;
}
