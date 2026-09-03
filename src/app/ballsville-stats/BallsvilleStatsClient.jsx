"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector, {
  DEFAULT_SOURCES,
} from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";
import { makeGetPlayerValue } from "../../lib/values";
import {
  metricModeFromSourceKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";

const n = (value) => Number(value || 0);
const avatarUrl = (id) =>
  id ? `https://sleepercdn.com/avatars/thumbs/${id}` : "/avatars/default.webp";
function Card({ children, className = "" }) {
  return (
    <section
      className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/92 to-slate-950/88 ${className}`}
    >
      {children}
    </section>
  );
}
function Metric({ label, value, detail }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-3">
      <div className="text-[9px] font-bold uppercase tracking-[.16em] text-white/35">
        {label}
      </div>
      <div className="mt-1 text-xl font-black">{value}</div>
      {detail ? (
        <div className="mt-1 text-[10px] text-white/35">{detail}</div>
      ) : null}
    </div>
  );
}
function SortHeader({
  label,
  sortKey,
  activeSort,
  direction,
  onSort,
  align = "left",
}) {
  const active = activeSort === sortKey;
  return (
    <th className={`p-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-white/[0.06] hover:text-white/70 ${active ? "text-cyan-100" : ""}`}
      >
        {label}
        <span
          aria-hidden="true"
          className={active ? "text-cyan-200" : "text-white/15"}
        >
          {active ? (direction === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function PlayerDetails({ row, modes, selectedModes, onClose }) {
  const selected = [...selectedModes];
  const modeRows = selected
    .map((slug) => ({
      slug,
      title: modes.find((mode) => mode.modeSlug === slug)?.title || slug,
      ...row.modeDetails?.[slug],
    }))
    .filter((item) => item.drafts);
  const managers = new Map();
  selected.forEach((slug) =>
    (Array.isArray(row.draftersByMode?.[slug])
      ? row.draftersByMode[slug]
      : []
    ).forEach((manager) => {
      const current = managers.get(manager.key) || {
        ...manager,
        count: 0,
        pickSum: 0,
        bestPick: null,
        worstPick: 0,
        modes: new Set(),
      };
      current.count += n(manager.count);
      current.pickSum += n(manager.pickSum);
      current.bestPick =
        current.bestPick == null
          ? n(manager.bestPick)
          : Math.min(current.bestPick, n(manager.bestPick));
      current.worstPick = Math.max(current.worstPick, n(manager.worstPick));
      current.modes.add(slug);
      managers.set(manager.key, current);
    }),
  );
  const top = [...managers.values()]
    .map((manager) => ({
      ...manager,
      adp: manager.count ? manager.pickSum / manager.count : 0,
    }))
    .sort((a, b) => b.count - a.count || a.adp - b.adp)
    .slice(0, 10);
  const total = modeRows.reduce((sum, item) => sum + n(item.drafts), 0);
  const pickSum = modeRows.reduce((sum, item) => sum + n(item.pickSum), 0);
  const owners = managers.size;
  const rounds = {};
  modeRows.forEach((item) =>
    Object.entries(item.rounds || {}).forEach(([round, count]) => {
      rounds[round] = (rounds[round] || 0) + n(count);
    }),
  );
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-[30px] border border-white/12 bg-slate-950 shadow-2xl sm:rounded-[30px]"
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-slate-950/95 p-4">
          <AvatarImage
            name={row.name}
            playerId={row.playerId}
            size={52}
            className="rounded-2xl"
            alt=""
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-black">{row.name}</h2>
            <p className="text-xs text-white/38">
              {row.position || "—"} · {row.team || "FA"} · {total} selections in
              the active filter
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-xl text-white/60"
          >
            ×
          </button>
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          {selected.length > 1 ? (
            <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-4 text-xs leading-5 text-amber-50/80">
              <b>Mixed-mode ADP warning:</b> this combined{" "}
              {pickSum && total ? (pickSum / total).toFixed(1) : "—"} average
              blends formats with different player pools, roster rules, and
              draft lengths. Use the per-mode figures below for draft-position
              decisions.
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Selections" value={total} />
            <Metric label="Unique managers" value={owners} />
            <Metric
              label="Combined average"
              value={total ? (pickSum / total).toFixed(1) : "—"}
              detail={
                selected.length > 1 ? "Directional only" : "Mode-specific ADP"
              }
            />
            <Metric
              label="Repeat rate"
              value={owners ? (total / owners).toFixed(1) : "—"}
              detail="Selections per manager"
            />
          </div>
          <div>
            <h3 className="text-lg font-black">ADP by game mode</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {modeRows
                .sort((a, b) => n(a.adp) - n(b.adp))
                .map((item) => (
                  <div
                    key={item.slug}
                    className="rounded-2xl bg-white/[0.035] p-3"
                  >
                    <div className="flex justify-between gap-3">
                      <b>{item.title}</b>
                      <b className="text-cyan-100">
                        ADP {n(item.adp).toFixed(1)}
                      </b>
                    </div>
                    <div className="mt-1 text-[10px] text-white/35">
                      {item.drafts} drafts · range {item.bestPick}–
                      {item.worstPick}
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <h3 className="text-lg font-black">Top 10 Ballsville drafters</h3>
            <p className="mt-1 text-xs text-white/35">
              Ranked by how many times each Sleeper manager selected {row.name}{" "}
              in the active modes.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {top.map((manager, index) => (
                <div
                  key={manager.key}
                  className="flex items-center gap-3 rounded-2xl bg-white/[0.035] p-3"
                >
                  <span className="w-5 text-xs font-black text-white/25">
                    #{index + 1}
                  </span>
                  <img
                    src={avatarUrl(manager.avatar)}
                    alt=""
                    className="h-10 w-10 rounded-xl object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{manager.name}</b>
                    <div className="truncate text-[10px] text-white/32">
                      {manager.username ? `@${manager.username} · ` : ""}
                      {manager.modes.size} mode
                      {manager.modes.size === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="text-right">
                    <b className="text-amber-100">{manager.count}×</b>
                    <div className="text-[9px] text-white/30">
                      ADP {manager.adp.toFixed(1)}
                    </div>
                  </div>
                </div>
              ))}
              {!top.length ? (
                <div className="text-sm text-white/35">
                  Manager detail will appear after the next cache update.
                </div>
              ) : null}
            </div>
          </div>
          <div>
            <h3 className="text-lg font-black">Draft pattern</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(rounds)
                .sort((a, b) => n(a[0]) - n(b[0]))
                .map(([round, count]) => (
                  <span
                    key={round}
                    className="rounded-xl bg-violet-300/[0.07] px-3 py-2 text-xs"
                  >
                    <b>Round {round}</b> · {count} picks ·{" "}
                    {total ? Math.round((count / total) * 100) : 0}%
                  </span>
                ))}
            </div>
            {row.returning ? (
              <p className="mt-3 text-xs text-white/40">
                Year over year: {row.previousDrafts} prior-season selections ·
                overall ADP moved {Math.abs(n(row.adpChange)).toFixed(1)} picks{" "}
                {n(row.adpChange) >= 0 ? "earlier" : "later"}. Compare
                like-for-like modes before treating this as a true market move.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamDetails({ team, sourceLabel, onClose }) {
  if (!team) return null;
  const groups = [
    ["Power starters", team.starters],
    ["Roster depth", team.bench],
  ];
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-[30px] border border-white/12 bg-slate-950 shadow-2xl sm:rounded-[30px]"
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-slate-950/95 p-4">
          <img
            src={avatarUrl(team.owner?.avatar)}
            alt=""
            className="h-12 w-12 rounded-2xl object-cover"
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-black">
              {team.owner?.name || `Roster ${team.rosterId}`}
            </h2>
            <p className="truncate text-xs text-white/38">
              {team.leagueName} · {sourceLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-xl text-white/60"
          >
            ×
          </button>
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Power score" value={team.rating.toLocaleString()} />
            <Metric
              label={`Top ${team.starterCount}`}
              value={Math.round(team.stars).toLocaleString()}
            />
            <Metric
              label="Depth"
              value={Math.round(team.depth).toLocaleString()}
            />
            <Metric label="Coverage" value={`${team.covered}/${team.total}`} />
          </div>
          {groups.map(([label, rows]) => (
            <div key={label}>
              <h3 className="text-lg font-black">{label}</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {rows.map(({ id, player, value }, index) => (
                  <div
                    key={id}
                    className="flex items-center gap-3 rounded-2xl bg-white/[0.035] p-3"
                  >
                    <span className="w-5 text-xs font-black text-white/20">
                      {index + 1}
                    </span>
                    <AvatarImage
                      name={player?.full_name || id}
                      playerId={id}
                      size={40}
                      className="rounded-xl"
                      alt=""
                    />
                    <div className="min-w-0 flex-1">
                      <b className="block truncate">
                        {player?.full_name || player?.search_full_name || id}
                      </b>
                      <div className="text-[10px] text-white/30">
                        {player?.position || "—"} · {player?.team || "FA"}
                      </div>
                    </div>
                    <b className="text-cyan-100">
                      {Math.round(value).toLocaleString()}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BallsvilleStatsClient() {
  const {
    players: nflPlayers,
    projectionScoring,
    getProjection,
  } = useSleeper();
  const season = new Date().getFullYear();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState("drafts");
  const [sortDirection, setSortDirection] = useState("desc");
  const [selectedModes, setSelectedModes] = useState(new Set());
  const [detail, setDetail] = useState(null);
  const [powerTeamKey, setPowerTeamKey] = useState("");
  const [rankingSource, setRankingSource] = useState("val:thefantasyarsenal");
  const [rankingFormat, setRankingFormat] = useState("dynasty");
  const [rankingQb, setRankingQb] = useState("sf");
  const [workspaceTab, setWorkspaceTab] = useState("players");
  useEffect(() => {
    let active = true;
    fetch(`/data/ballsville-stats-${season}.json`, { cache: "no-store" })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(
              new Error(
                response.status === 404
                  ? "The Ballsville statistics cache has not been generated yet."
                  : `Cached statistics request failed (${response.status}).`,
              ),
            ),
      )
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setSelectedModes(
          new Set(
            (Array.isArray(payload?.modes) ? payload.modes : []).map(
              (mode) => mode.modeSlug,
            ),
          ),
        );
      })
      .catch(
        (reason) =>
          active &&
          setError(reason?.message || "Ballsville statistics are unavailable."),
      );
    return () => {
      active = false;
    };
  }, [season]);
  const modes = Array.isArray(data?.modes) ? data.modes : [];
  const cachePlayers = Array.isArray(data?.players) ? data.players : [];
  const summary = data?.summary || {};
  const visible = useMemo(
    () =>
      cachePlayers
        .map((row) => {
          const modeEntries = Object.entries(
            row?.modes && typeof row.modes === "object" ? row.modes : {},
          ).filter(([slug]) => selectedModes.has(slug));
          const selectedDrafts = modeEntries.reduce(
            (sum, [, count]) => sum + n(count),
            0,
          );
          const ownerKeys = new Set(
            Object.entries(
              row?.ownerKeysByMode && typeof row.ownerKeysByMode === "object"
                ? row.ownerKeysByMode
                : {},
            )
              .filter(([slug]) => selectedModes.has(slug))
              .flatMap(([, keys]) => (Array.isArray(keys) ? keys : [])),
          );
          const details = modeEntries
            .map(([slug]) => row.modeDetails?.[slug])
            .filter(Boolean);
          const pickSum = details.reduce(
            (sum, item) => sum + n(item.pickSum),
            0,
          );
          return {
            ...row,
            modeEntries,
            selectedDrafts,
            selectedOwners: ownerKeys.size,
            selectedAdp: selectedDrafts ? pickSum / selectedDrafts : 0,
            selectedBest: details.length
              ? Math.min(
                  ...details.map((item) => n(item.bestPick)).filter(Boolean),
                )
              : 0,
            selectedWorst: details.length
              ? Math.max(...details.map((item) => n(item.worstPick)))
              : 0,
          };
        })
        .filter(
          (row) =>
            row.selectedDrafts > 0 &&
            (position === "ALL" || row.position === position) &&
            (!query.trim() ||
              String(row.name || "")
                .toLowerCase()
                .includes(query.trim().toLowerCase())),
        )
        .sort((a, b) => {
          let result =
            sort === "name"
              ? String(a.name || "").localeCompare(String(b.name || ""))
              : sort === "owners"
                ? a.selectedOwners - b.selectedOwners
                : sort === "adp"
                  ? n(a.selectedAdp) - n(b.selectedAdp)
                  : sort === "range"
                    ? n(a.selectedBest) - n(b.selectedBest) ||
                      n(a.selectedWorst) - n(b.selectedWorst)
                    : sort === "modes"
                      ? a.modeEntries.length - b.modeEntries.length
                      : sort === "rise"
                        ? n(a.adpChange) - n(b.adpChange)
                        : a.selectedDrafts - b.selectedDrafts;
          if (result === 0)
            result = String(a.name || "").localeCompare(String(b.name || ""));
          return sortDirection === "asc" ? result : -result;
        }),
    [cachePlayers, position, query, selectedModes, sort, sortDirection],
  );
  const valueMetric = useMemo(
    () =>
      makeGetPlayerValue(
        valueSourceFromKey(rankingSource),
        rankingFormat,
        rankingQb,
        projectionScoring,
      ),
    [rankingSource, rankingFormat, rankingQb, projectionScoring],
  );
  const teamMetric = useMemo(
    () =>
      metricModeFromSourceKey(rankingSource) === "projections"
        ? (player) => n(getProjection?.(player, rankingSource))
        : (player) => n(valueMetric(player)),
    [getProjection, rankingSource, valueMetric],
  );
  const rankedTeams = useMemo(() => {
    const rows = Array.isArray(data?.teams) ? data.teams : [];
    return rows
      .filter((team) => selectedModes.has(team.modeSlug))
      .map((team) => {
        const valued = (team.playerIds || [])
          .map((id) => ({
            id,
            player: nflPlayers?.[id],
            value: n(teamMetric(nflPlayers?.[id])),
          }))
          .filter((row) => row.player && row.value > 0)
          .sort((a, b) => b.value - a.value);
        const starters = valued.slice(0, n(team.starterCount) || 8);
        const bench = valued.slice(n(team.starterCount) || 8);
        const stars = starters.reduce((sum, row) => sum + row.value, 0);
        const depth = bench.reduce((sum, row) => sum + row.value, 0);
        return {
          ...team,
          starters,
          bench,
          stars,
          depth,
          rating: Math.round(stars * 0.7 + depth * 0.3),
          covered: valued.length,
          total: (team.playerIds || []).length,
        };
      })
      .filter((team) => team.covered > 0)
      .sort((a, b) => b.rating - a.rating || b.stars - a.stars);
  }, [data?.teams, nflPlayers, selectedModes, teamMetric]);
  const topTeams = rankedTeams.slice(0, 10);
  const selectedPowerTeam = rankedTeams.find(
    (team) => `${team.key}:${team.modeSlug}` === powerTeamKey,
  );
  const selectedPopulation = useMemo(() => {
    const activeModes = modes.filter((mode) => selectedModes.has(mode.modeSlug));
    const selectedTeams = (Array.isArray(data?.teams) ? data.teams : []).filter((team) => selectedModes.has(team.modeSlug));
    return {
      modes: activeModes.length,
      leagues: activeModes.reduce((sum, mode) => sum + n(mode.leagues), 0),
      drafts: activeModes.reduce((sum, mode) => sum + n(mode.drafts), 0),
      seats: activeModes.reduce((sum, mode) => sum + n(mode.seats), 0),
      picks: activeModes.reduce((sum, mode) => sum + n(mode.picks), 0),
      managers: new Set(selectedTeams.map((team) => String(team.owner?.key || "")).filter(Boolean)).size,
      players: cachePlayers.filter((player) => Object.keys(player?.modes || {}).some((slug) => selectedModes.has(slug))).length,
    };
  }, [cachePlayers, data?.teams, modes, selectedModes]);
  const rankingSourceLabel =
    DEFAULT_SOURCES.find((source) => source.key === rankingSource)?.label ||
    rankingSource;
  const toggleMode = (slug) =>
    setSelectedModes((current) => {
      const next = new Set(current);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  const defaultDirection = (key) =>
    ["name", "adp", "range"].includes(key) ? "asc" : "desc";
  const changeSort = (key) => {
    if (key === sort)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setSortDirection(defaultDirection(key));
    }
  };
  const chooseSort = (key) => {
    setSort(key);
    setSortDirection(defaultDirection(key));
  };
  return (
    <main className="min-h-screen text-white">
      <BackgroundParticles />
      <Navbar pageTitle="Ballsville Stats" />
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-20">
        <header className="overflow-hidden rounded-[34px] border border-amber-300/15 bg-[radial-gradient(circle_at_85%_0%,rgba(245,158,11,.2),transparent_36%),radial-gradient(circle_at_8%_100%,rgba(34,211,238,.14),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-7">
          <div className="text-[11px] font-bold uppercase tracking-[.28em] text-amber-200/60">
            Ballsville draft intelligence
          </div>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">
            What Ballsville managers are drafting
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/52">
            Precomputed Ballsville and Sleeper draft statistics. Select a player
            row for manager leaders, mode-specific ADP, and draft patterns;
            select the player avatar for the existing player inspector.
          </p>
          {data?.generatedAt ? (
            <div className="mt-4 text-[10px] text-white/35">
              Updated {new Date(data.generatedAt).toLocaleString()} ·{" "}
              {data.season} season
            </div>
          ) : null}
        </header>
        {!data && !error ? (
          <Card className="mt-5 p-8 text-center text-cyan-100">
            Loading cached Ballsville statistics…
          </Card>
        ) : error ? (
          <Card className="mt-5 border-rose-300/15 p-6">
            <div className="font-black text-rose-100">
              Statistics cache unavailable
            </div>
            <p className="mt-2 text-sm text-white/45">{error}</p>
            <code className="mt-3 block rounded-xl bg-black/20 p-3 text-xs text-cyan-100">
              npm run update:ballsville-stats
            </code>
          </Card>
        ) : (
          <>
            <div data-guide-tip="ballsville-totals" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric
                label="Unique managers"
                value={n(summary.totalOwners).toLocaleString()}
                detail="Distinct Sleeper manager IDs"
              />
              <Metric
                label="Ballsville leagues"
                value={n(summary.totalLeagues).toLocaleString()}
                detail={`${n(data?.coverage?.includedLeagues)} included in this cache`}
              />
              <Metric
                label="Completed draft boards"
                value={n(summary.totalDrafts).toLocaleString()}
                detail="A league can have startup and rookie drafts"
              />
              <Metric
                label="Distinct players selected"
                value={n(summary.totalPlayers).toLocaleString()}
                detail={`${n(summary.totalModes)} game modes · ${n(summary.crossModeOwners)} cross-mode managers`}
              />
            </div>
            {Array.isArray(data?.coverage?.missingLeagues) &&
            data.coverage.missingLeagues.length ? (
              <Card className="mt-4 border-amber-300/20 bg-amber-300/[0.06] p-4">
                <div className="font-black text-amber-100">
                  ADP coverage is missing {data.coverage.missingLeagues.length}{" "}
                  leaderboard league
                  {data.coverage.missingLeagues.length === 1 ? "" : "s"}
                </div>
                <p className="mt-1 text-xs leading-5 text-amber-50/60">
                  Those leagues are excluded from player counts, ADP, manager
                  totals, and team rankings until they are added to the
                  Ballsville Draft Compare feed.
                </p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-bold text-amber-100/75">
                    Show missing leagues
                  </summary>
                  <div className="mt-2 grid gap-1 text-[10px] text-white/45 sm:grid-cols-2">
                    {data.coverage.missingLeagues.map((row) => (
                      <div
                        key={row.leagueId}
                        className="rounded-lg bg-black/15 px-3 py-2"
                      >
                        {row.name || row.leagueId} · {row.mode}
                      </div>
                    ))}
                  </div>
                </details>
              </Card>
            ) : null}
            <Card data-guide-tip="ballsville-modes" className="mt-5 p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Game-mode population</h2>
                  <p className="mt-1 text-xs text-white/38">
                    Unique manager IDs versus total draft seats.
                  </p>
                </div>
                <button
                  onClick={() =>
                    setSelectedModes(
                      new Set(
                        selectedModes.size === modes.length
                          ? []
                          : modes.map((mode) => mode.modeSlug),
                      ),
                    )
                  }
                  className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs text-white/55"
                >
                  {selectedModes.size === modes.length
                    ? "Clear all"
                    : "Select all"}
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {modes.map((mode) => (
                  <button
                    type="button"
                    onClick={() => toggleMode(mode.modeSlug)}
                    key={mode.modeSlug}
                    className={`rounded-2xl border p-4 text-left ${selectedModes.has(mode.modeSlug) ? "border-amber-300/20 bg-amber-300/[0.055]" : "border-white/8 bg-white/[0.02] opacity-55"}`}
                  >
                    <div className="flex justify-between gap-2">
                      <b>{mode.title}</b>
                      <span className="text-[10px] text-white/35">
                        {mode.drafts} drafts
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <b className="block text-lg">{mode.owners}</b>
                        <small className="text-[9px] text-white/30">
                          Managers
                        </small>
                      </div>
                      <div>
                        <b className="block text-lg">{mode.seats}</b>
                        <small className="text-[9px] text-white/30">
                          Seats
                        </small>
                      </div>
                      <div>
                        <b className="block text-lg">{mode.players}</b>
                        <small className="text-[9px] text-white/30">
                          Players
                        </small>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4 sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Selected managers" value={selectedPopulation.managers.toLocaleString()} detail="Unique across selected modes" />
                <Metric label="Selected leagues" value={selectedPopulation.leagues.toLocaleString()} />
                <Metric label="Selected drafts" value={selectedPopulation.drafts.toLocaleString()} />
                <Metric label="Draft seats" value={selectedPopulation.seats.toLocaleString()} detail="Managers can repeat" />
                <Metric label="Selections" value={selectedPopulation.picks.toLocaleString()} />
                <Metric label="Players" value={selectedPopulation.players.toLocaleString()} detail="In active player table" />
              </div>
            </Card>
            {selectedModes.size > 1 ? (
              <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-4 text-sm leading-6 text-amber-50/80">
                <b>Multiple game modes selected.</b> Draft counts and
                unique-manager totals can be combined, but combined ADP can
                misrepresent where a player is actually drafted because formats
                use different pools, rules, and draft lengths. Open a player for
                mode-by-mode ADP, or select one mode for a clean ranking.
              </div>
            ) : null}
            <nav data-guide-tip="ballsville-tabs" className="sticky top-14 z-30 mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/95 p-2 backdrop-blur-xl">
              <div className="flex w-max gap-1">{[["players","Player Popularity"],["teams","Team Power Board"]].map(([key,label]) => <button type="button" key={key} onClick={()=>setWorkspaceTab(key)} className={`rounded-xl px-5 py-2.5 text-sm font-black ${workspaceTab===key ? "bg-amber-300/10 text-amber-100" : "text-white/40"}`}>{label}</button>)}</div>
            </nav>
            {workspaceTab === "teams" ? <Card data-guide-tip="ballsville-teams" className="mt-5 overflow-visible p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-200/55">
                    Ballsville power board
                  </div>
                  <h2 className="mt-1 text-2xl font-black">Top 10 teams</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-white/38">
                    Uses the same Power Rankings split: 70% top-starter
                    production/value and 30% depth. Rankings recalculate from
                    the selected projection or value source, format, and active
                    Ballsville modes. Click a team to inspect its roster.
                  </p>
                </div>
                <SourceSelector
                  sources={DEFAULT_SOURCES}
                  value={rankingSource}
                  onChange={setRankingSource}
                  mode={rankingFormat}
                  qbType={rankingQb}
                  onModeChange={setRankingFormat}
                  onQbTypeChange={setRankingQb}
                  layout="inline"
                  className="w-full lg:w-auto"
                />
              </div>
              {selectedModes.size > 1 ? (
                <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3 text-[10px] leading-4 text-amber-100/65">
                  Teams from different game modes are being compared on one
                  selected lens. Choose one mode and match its format for the
                  most defensible ranking.
                </div>
              ) : null}
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {topTeams.map((team, index) => (
                  <button
                    type="button"
                    onClick={() =>
                      setPowerTeamKey(`${team.key}:${team.modeSlug}`)
                    }
                    key={`${team.key}:${team.modeSlug}`}
                    className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 text-left transition hover:-translate-y-0.5 hover:border-violet-300/20 hover:bg-white/[0.05]"
                  >
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black ${index < 3 ? "bg-violet-300/10 text-violet-100" : "bg-white/[0.04] text-white/35"}`}
                    >
                      #{index + 1}
                    </span>
                    <img
                      src={avatarUrl(team.owner?.avatar)}
                      alt=""
                      className="h-11 w-11 rounded-xl object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <b className="block truncate">
                        {team.owner?.name || `Roster ${team.rosterId}`}
                      </b>
                      <div className="truncate text-[10px] text-white/32">
                        {team.leagueName} ·{" "}
                        {modes.find((mode) => mode.modeSlug === team.modeSlug)
                          ?.title || team.modeSlug}
                      </div>
                      <div className="mt-1 text-[9px] text-white/25">
                        {team.covered}/{team.total} covered · top{" "}
                        {team.starterCount}:{" "}
                        {Math.round(team.stars).toLocaleString()} · depth:{" "}
                        {Math.round(team.depth).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <b className="text-lg text-cyan-100">
                        {team.rating.toLocaleString()}
                      </b>
                      <div className="text-[8px] uppercase text-white/25">
                        power · view →
                      </div>
                    </div>
                  </button>
                ))}
                {!topTeams.length ? (
                  <div className="p-4 text-sm text-white/35">
                    {Array.isArray(data?.teams)
                      ? "No teams have coverage in the selected source and modes."
                      : "Team rankings will appear after the Ballsville cache is regenerated."}
                  </div>
                ) : null}
              </div>
            </Card> : null}
            {workspaceTab === "players" ? <Card data-guide-tip="ballsville-players" className="mt-5 overflow-hidden">
              <div className="border-b border-white/10 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-black">Most drafted players</h2>
                    <p className="mt-1 text-xs text-white/38">
                      Click a row for top drafters and trends. Click an avatar
                      for the full player inspector.
                    </p>
                  </div>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search players…"
                    className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none"
                  />
                  <select
                    value={position}
                    onChange={(event) => setPosition(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"
                  >
                    <option value="ALL">All positions</option>
                    {["QB", "RB", "WR", "TE", "K", "DEF"].map((pos) => (
                      <option key={pos}>{pos}</option>
                    ))}
                  </select>
                  <select
                    value={sort}
                    onChange={(event) => chooseSort(event.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm"
                  >
                    <option value="drafts">Most drafted</option>
                    <option value="owners">Most managers</option>
                    <option value="adp">Earliest ADP</option>
                    <option value="modes">Most modes</option>
                    <option value="rise">Biggest YoY riser</option>
                    <option value="name">Player name</option>
                    <option value="range">Best pick</option>
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="bg-white/[0.025] text-[10px] uppercase tracking-wider text-white/35">
                    <tr>
                      <SortHeader
                        label="Player"
                        sortKey="name"
                        activeSort={sort}
                        direction={sortDirection}
                        onSort={changeSort}
                      />
                      <SortHeader
                        label="Drafted"
                        sortKey="drafts"
                        activeSort={sort}
                        direction={sortDirection}
                        onSort={changeSort}
                        align="right"
                      />
                      <SortHeader
                        label="Managers"
                        sortKey="owners"
                        activeSort={sort}
                        direction={sortDirection}
                        onSort={changeSort}
                        align="right"
                      />
                      <SortHeader
                        label="ADP"
                        sortKey="adp"
                        activeSort={sort}
                        direction={sortDirection}
                        onSort={changeSort}
                        align="right"
                      />
                      <SortHeader
                        label="Range"
                        sortKey="range"
                        activeSort={sort}
                        direction={sortDirection}
                        onSort={changeSort}
                        align="right"
                      />
                      <SortHeader
                        label="Modes"
                        sortKey="modes"
                        activeSort={sort}
                        direction={sortDirection}
                        onSort={changeSort}
                      />
                      <SortHeader
                        label="Prior year"
                        sortKey="rise"
                        activeSort={sort}
                        direction={sortDirection}
                        onSort={changeSort}
                        align="right"
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.055]">
                    {visible.slice(0, 300).map((row, index) => (
                      <tr
                        key={row.key}
                        tabIndex={0}
                        onClick={() => setDetail(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setDetail(row);
                        }}
                        className="cursor-pointer hover:bg-white/[0.04]"
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <span className="w-7 text-xs font-black text-white/20">
                              #{index + 1}
                            </span>
                            <AvatarImage
                              name={row.name}
                              playerId={row.playerId}
                              size={42}
                              className="rounded-xl"
                              alt=""
                            />
                            <div>
                              <b>{row.name}</b>
                              <div className="text-[10px] text-white/30">
                                {row.position || "—"} · {row.team || "FA"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-right font-black">
                          {row.selectedDrafts}
                        </td>
                        <td className="p-3 text-right">{row.selectedOwners}</td>
                        <td className="p-3 text-right">
                          {n(row.selectedAdp) > 0
                            ? n(row.selectedAdp).toFixed(1)
                            : "—"}
                          {selectedModes.size > 1 ? (
                            <div className="text-[8px] font-bold uppercase text-amber-200/55">
                              mixed
                            </div>
                          ) : null}
                        </td>
                        <td className="p-3 text-right text-white/45">
                          {row.selectedBest || "—"}–{row.selectedWorst || "—"}
                        </td>
                        <td className="p-3">
                          <div className="flex max-w-sm flex-wrap gap-1">
                            {row.modeEntries.map(([slug, count]) => (
                              <span
                                key={slug}
                                className="rounded bg-cyan-300/[0.07] px-1.5 py-1 text-[9px] text-cyan-100/65"
                              >
                                {modes.find((mode) => mode.modeSlug === slug)
                                  ?.title || slug}{" "}
                                · {count}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          {row.returning ? (
                            <>
                              <div>{row.previousDrafts} drafts</div>
                              <div
                                className={`text-[10px] ${row.adpChange > 0 ? "text-emerald-100" : row.adpChange < 0 ? "text-rose-100" : "text-white/30"}`}
                              >
                                {row.adpChange == null
                                  ? "ADP unavailable"
                                  : `${row.adpChange > 0 ? "↑" : "↓"} ${Math.abs(row.adpChange).toFixed(1)} picks`}
                              </div>
                            </>
                          ) : (
                            <span className="text-white/25">New</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-white/10 p-4 text-[10px] text-white/30">
                Showing {Math.min(300, visible.length)} of {visible.length}{" "}
                matching players. All details come from the scheduled cache, not
                live league requests.
              </div>
            </Card> : null}
          </>
        )}
      </div>
      {detail ? (
        <PlayerDetails
          row={detail}
          modes={modes}
          selectedModes={selectedModes}
          onClose={() => setDetail(null)}
        />
      ) : null}
      {selectedPowerTeam ? (
        <TeamDetails
          team={selectedPowerTeam}
          sourceLabel={rankingSourceLabel}
          onClose={() => setPowerTeamKey("")}
        />
      ) : null}
    </main>
  );
}
