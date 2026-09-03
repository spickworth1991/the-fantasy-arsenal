"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSleeper } from "../context/SleeperContext";
import { useArsenalAccount } from "../context/ArsenalAccountContext";
import { classifyLeagueFormat } from "../lib/leagueFormat";
import { fantasyWeekFromNflState } from "../lib/nflSeasonState";

const n = (value) => Number(value || 0);
const CACHE_MS = 5 * 60 * 1000;
const ACTIONS_KEY = "tfa:intelligence-actions";
const getJson = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const name = (players, id) =>
  players?.[id]?.full_name || players?.[id]?.search_full_name || id;
const pos = (player) =>
  String(
    player?.position || player?.fantasy_positions?.[0] || "",
  ).toUpperCase();
const rosterAllowsPosition = (league, position) => {
  const slots = new Set(
    (league?.roster_positions || []).map((slot) => String(slot).toUpperCase()),
  );
  if (!slots.size) return true;
  if (slots.has(position)) return true;
  if (position === "QB") return slots.has("SUPER_FLEX");
  if (["RB", "WR", "TE"].includes(position)) {
    if (slots.has("SUPER_FLEX") || slots.has("FLEX")) return true;
    if (["WR", "TE"].includes(position) && slots.has("REC_FLEX")) return true;
    if (["RB", "WR"].includes(position) && slots.has("WRRB_FLEX")) return true;
  }
  return false;
};
const injury = (player) => String(player?.injury_status || "").toUpperCase();
const unavailable = (player) =>
  ["OUT", "DOUBTFUL", "IR", "PUP", "NFI", "SUSPENDED"].includes(injury(player)) ||
  /inactive|injured.reserve|physically.unable|non.football.injury|suspend/.test(String(player?.status || "").toLowerCase());
const longTermUnavailable = (player) => {
  const detail = [player?.injury_status, player?.status, player?.practice_participation, player?.injury_notes, player?.news_updated]
    .filter(Boolean).join(" ").toLowerCase();
  return unavailable(player) || /season.?ending|out for (the )?season|miss (most|all) of|injured.reserve|\bir\b|\bpup\b|physically.unable|non.football.injury|\bnfi\b/.test(detail);
};
const usableOpportunity = (player, leagueFormat) =>
  leagueFormat?.key === "dynasty" || !longTermUnavailable(player);
const risk = (player) =>
  unavailable(player) || injury(player) === "QUESTIONABLE";
const deadlineText = (deadline) => {
  if (!deadline) return "No immediate lock";
  const date = new Date(deadline);
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "Locked";
  if (ms < 3600000) return `${Math.max(1, Math.ceil(ms / 60000))}m remaining`;
  if (ms < 86400000) return `${Math.ceil(ms / 3600000)}h remaining`;
  return date.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

async function concurrentMap(rows, limit, worker, progress) {
  const output = new Array(rows.length);
  let cursor = 0;
  let complete = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        output[index] = await worker(rows[index]);
        complete += 1;
        progress?.(complete, rows.length);
      }
    }),
  );
  return output;
}

function tone(priority) {
  if (priority >= 90) return "critical";
  if (priority >= 70) return "warning";
  if (priority >= 45) return "opportunity";
  return "planning";
}
function toneClass(value) {
  if (value === "critical")
    return "border-rose-300/20 bg-rose-300/[0.06] text-rose-100";
  if (value === "warning")
    return "border-amber-300/20 bg-amber-300/[0.06] text-amber-100";
  if (value === "opportunity")
    return "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100";
  return "border-cyan-300/20 bg-cyan-300/[0.05] text-cyan-100";
}
function priorityLabel(priority) {
  return priority >= 90
    ? "Critical"
    : priority >= 70
      ? "High"
      : priority >= 45
        ? "Opportunity"
        : "Planning";
}
function actionHref(path, leagueId) {
  if (!path || path.startsWith("http")) return path;
  if (!leagueId) return path;
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (!params.has("league")) params.set("league", leagueId);
  return `${base}?${params.toString()}`;
}
function mergeDecisionRows(serverRows = [], localRows = []) {
  const merged = new Map();
  [...serverRows, ...localRows].forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id) || {};
    merged.set(item.id, {
      ...existing,
      ...item,
      evidence: item.evidence?.length ? item.evidence : existing.evidence,
      priorityReason: item.priorityReason || existing.priorityReason,
      previousPriority: item.previousPriority ?? existing.previousPriority,
      priorityChange: item.priorityChange ?? existing.priorityChange ?? 0,
    });
  });
  return [...merged.values()].sort((a, b) => n(b.priority) - n(a.priority));
}

function RecommendationCard({ item, state, update, compact = false }) {
  const content = (
    <>
      <div
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-sm font-black ${toneClass(item.tone)}`}
      >
        {item.priority >= 90
          ? "!"
          : item.category === "draft"
            ? "D"
            : item.category === "waiver"
              ? "W"
              : item.category === "trade"
                ? "T"
                : "A"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-black text-white">{item.title}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${toneClass(item.tone)}`}
          >
            {priorityLabel(item.priority)}
          </span>
        </div>
        <div className="mt-1 text-xs text-white/38">
          {item.leagueName}
          {item.teamName ? ` · ${item.teamName}` : ""}
        </div>
        {!compact ? (
          <>
            <p className="mt-2 text-xs leading-5 text-white/55">{item.why}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[9px]">
              <span className="rounded-full bg-white/[0.04] px-2 py-1 text-white/42">
                Impact · {item.impact}
              </span>
              <span className="rounded-full bg-white/[0.04] px-2 py-1 text-white/42">
                Confidence · {item.confidence}%
              </span>
              <span className="rounded-full bg-white/[0.04] px-2 py-1 text-white/42">
                {deadlineText(item.deadline)}
              </span>
            </div>
          </>
        ) : null}
      </div>
      <span className="shrink-0 text-[10px] font-bold text-cyan-100">
        {item.action} →
      </span>
    </>
  );
  const href = actionHref(item.href, item.leagueId);
  return (
    <article className="rounded-[24px] border border-white/[0.07] bg-white/[0.025] p-3 sm:p-4">
      {item.external ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3"
        >
          {content}
        </a>
      ) : (
        <Link href={href} className="flex items-center gap-3">
          {content}
        </Link>
      )}
      {!compact ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
          <button
            type="button"
            onClick={() =>
              update(item.id, { saved: !state?.saved, decision: item })
            }
            className={`rounded-xl px-3 py-2 text-[10px] font-bold ${state?.saved ? "bg-violet-300/12 text-violet-100" : "bg-white/[0.045] text-white/45"}`}
          >
            {state?.saved ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            onClick={() =>
              update(item.id, {
                snoozedUntil: Date.now() + 4 * 3600000,
                status: "snoozed",
                decision: item,
              })
            }
            className="rounded-xl bg-white/[0.045] px-3 py-2 text-[10px] font-bold text-white/45"
          >
            Snooze 4h
          </button>
          <button
            type="button"
            onClick={() =>
              update(
                item.id,
                {
                  status: "completed",
                  completedAt: Date.now(),
                  decision: item,
                },
                "completed",
              )
            }
            className="rounded-xl bg-emerald-300/10 px-3 py-2 text-[10px] font-bold text-emerald-100"
          >
            Mark completed
          </button>
          <button
            type="button"
            onClick={() =>
              update(item.id, {
                status: "dismissed",
                completedAt: Date.now(),
                decision: item,
              })
            }
            className="rounded-xl bg-white/[0.035] px-3 py-2 text-[10px] font-bold text-white/30"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {!compact && (item.priorityReason || item.evidence?.length) ? (
        <details className="mt-3 rounded-xl border border-white/[0.06] bg-black/15 p-3">
          <summary className="cursor-pointer text-[10px] font-bold text-white/45">
            Why this priority?
          </summary>
          <p className="mt-2 text-xs leading-5 text-white/48">
            {item.priorityReason || item.why}
          </p>
          {item.priorityChange ? (
            <div
              className={`mt-2 text-[10px] font-bold ${item.priorityChange > 0 ? "text-rose-100" : "text-emerald-100"}`}
            >
              {item.priorityChange > 0
                ? "Priority increased"
                : "Priority decreased"}{" "}
              by {Math.abs(item.priorityChange)} points since the prior server
              snapshot.
            </div>
          ) : null}
          {item.evidence?.length ? (
            <ul className="mt-2 space-y-1 text-[10px] text-white/32">
              {item.evidence.map((row, index) => (
                <li key={`${row}-${index}`}>• {row}</li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
      {!compact && state?.status === "completed" && !state?.outcome ? (
        <div className="mt-3 rounded-xl bg-cyan-300/[0.04] p-3 text-xs text-white/50">
          <span>Did this decision help?</span>
          <button
            onClick={() => update(item.id, { outcome: "helped" })}
            className="ml-3 text-emerald-100"
          >
            Yes
          </button>
          <button
            onClick={() => update(item.id, { outcome: "did-not-help" })}
            className="ml-3 text-rose-100"
          >
            No
          </button>
        </div>
      ) : null}
      {!compact && state?.history?.length ? (
        <details className="mt-3 rounded-xl border border-white/[0.06] bg-black/10 p-3">
          <summary className="cursor-pointer text-[10px] font-bold text-white/40">
            Decision timeline · {state.history.length} event
            {state.history.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 space-y-2">
            {[...state.history].reverse().map((event, index) => (
              <div
                key={`${event.at}-${index}`}
                className="flex items-center justify-between gap-3 text-[10px]"
              >
                <span className="capitalize text-white/55">
                  {String(event.event || "updated").replaceAll("-", " ")}
                </span>
                <span className="shrink-0 text-white/25">
                  {new Date(event.at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

export default function DecisionInbox({ full = false }) {
  const {
    username,
    leagues = [],
    players,
    year,
    getPlayerValue,
    getWeeklyProjection,
    metricType,
    projectionSource,
    sourceKey,
  } = useSleeper();
  const { isConnected, syncNow, accountRequest } = useArsenalAccount();
  const [items, setItems] = useState([]);
  const [actions, setActions] = useState({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tab, setTab] = useState("now");
  const [category, setCategory] = useState("all");
  const [leagueScope, setLeagueScope] = useState({
    includeBestBall: false,
    leagueIds: [],
  });
  const cacheKey = `tfa:intelligence-cache:v2:${String(username || "").toLowerCase()}:${year || new Date().getFullYear()}:${sourceKey || "default"}`;

  useEffect(() => {
    try {
      setActions(JSON.parse(localStorage.getItem(ACTIONS_KEY) || "{}"));
      const preferences = JSON.parse(
        localStorage.getItem("tfa:account-preferences") || "{}",
      );
      if (preferences.intelligenceLeagueScope)
        setLeagueScope((current) => ({
          ...current,
          ...preferences.intelligenceLeagueScope,
        }));
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (
        cached?.at &&
        Date.now() - cached.at < CACHE_MS &&
        Array.isArray(cached.items)
      ) {
        setItems(cached.items);
        setUpdatedAt(new Date(cached.at));
      }
    } catch {}
  }, [cacheKey]);

  const defaultLeagueIds = useMemo(
    () =>
      leagues
        .filter((league) => !classifyLeagueFormat(league).flags.bestBall)
        .map((league) => String(league.league_id)),
    [leagues],
  );
  const targetLeagues = useMemo(() => {
    const selected = new Set((leagueScope.leagueIds || []).map(String));
    return selected.size
      ? leagues.filter((league) => selected.has(String(league.league_id)))
      : leagues.filter(
          (league) =>
            leagueScope.includeBestBall ||
            !classifyLeagueFormat(league).flags.bestBall,
        );
  }, [leagueScope.includeBestBall, leagueScope.leagueIds, leagues]);
  const targetLeagueIds = useMemo(
    () => targetLeagues.map((league) => String(league.league_id)),
    [targetLeagues],
  );
  const saveLeagueScope = (next) => {
    setLeagueScope(next);
    try {
      const preferences = JSON.parse(
        localStorage.getItem("tfa:account-preferences") || "{}",
      );
      localStorage.setItem(
        "tfa:account-preferences",
        JSON.stringify({ ...preferences, intelligenceLeagueScope: next }),
      );
    } catch {}
    if (isConnected) window.setTimeout(() => syncNow({ quiet: true }), 100);
  };


  useEffect(() => {
    if (!isConnected) return;
    let active = true;
    const hydrate = async () => {
      try {
        const result = await accountRequest("/api/arsenal/intelligence");
        if (!active) return;
        if (result?.snapshot?.items?.length) {
          setItems((current) =>
            mergeDecisionRows(result.snapshot.items, current),
          );
          setUpdatedAt(new Date(result.snapshot.generatedAt));
        }
        if (result?.stale) {
          const refreshed = await accountRequest("/api/arsenal/intelligence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              force: false,
              leagueIds: targetLeagueIds,
              replaceSelection: true,
            }),
          });
          if (active && refreshed?.snapshot) {
            setItems((current) =>
              mergeDecisionRows(refreshed.snapshot.items, current),
            );
            setUpdatedAt(new Date(refreshed.snapshot.generatedAt));
          }
        }
      } catch {}
    };
    hydrate();
    return () => {
      active = false;
    };
  }, [accountRequest, isConnected, targetLeagueIds]);

  const updateAction = (id, patch, eventType = "") => {
    const previous = actions[id] || {};
    const event =
      eventType ||
      (patch.status
        ? patch.status
        : patch.saved !== undefined
          ? patch.saved
            ? "saved"
            : "unsaved"
          : patch.outcome
            ? `outcome:${patch.outcome}`
            : "updated");
    const history = [
      ...(previous.history || []),
      { event, at: Date.now() },
    ].slice(-40);
    const next = {
      ...actions,
      [id]: { ...previous, ...patch, history, updatedAt: Date.now() },
    };
    setActions(next);
    try {
      localStorage.setItem(ACTIONS_KEY, JSON.stringify(next));
    } catch {}
    if (isConnected) window.setTimeout(() => syncNow({ quiet: true }), 100);
  };

  const scan = async () => {
    if (!username || loading) return;
    setLoading(true);
    setError("");
    try {
      let serverItems = [];
      if (isConnected) {
        try {
          const result = await accountRequest("/api/arsenal/intelligence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              force: true,
              leagueIds: targetLeagueIds,
              replaceSelection: true,
            }),
          });
          serverItems = result?.snapshot?.items || [];
        } catch {}
      }
      const [root, nflState, scoreboard, byeData] = await Promise.all([
        getJson(
          `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`,
        ),
        getJson("https://api.sleeper.app/v1/state/nfl"),
        getJson(
          `/api/nfl-scoreboard?season=${year || new Date().getFullYear()}&week=1`,
        ).catch(() => ({ games: [] })),
        getJson(`/byes/${year || new Date().getFullYear()}.json`).catch(() => ({
          by_team: {},
        })),
      ]);
      const week = fantasyWeekFromNflState(nflState);
      const metricForWeek = (player) => {
        if (metricType !== "projection") return n(getPlayerValue(player));
        if (projectionSource === "ARSENAL_MODEL")
          return n(getWeeklyProjection?.(player, projectionSource, week));
        return n(getPlayerValue(player)) / 17;
      };
      const score =
        week === 1
          ? scoreboard
          : await getJson(
              `/api/nfl-scoreboard?season=${nflState.season || year}&week=${week}`,
            ).catch(() => ({ games: [] }));
      const games = score.games || [];
      const gameByTeam = new Map(
        games.flatMap((game) => (game.teams || []).map((team) => [team, game])),
      );
      const rankedPlayers = Object.entries(players || {})
        .map(([id, player]) => ({ id, player, value: metricForWeek(player) }))
        .filter(
          (row) =>
            row.value > 0 &&
            ["QB", "RB", "WR", "TE", "K", "DEF"].includes(pos(row.player)),
        )
        .sort((a, b) => b.value - a.value)
        .slice(0, 220);
      const exposure = new Map();

      const scans = await concurrentMap(
        targetLeagues,
        8,
        async (league) => {
          try {
            const leagueId = league.league_id;
            const [rosters, users, matchups, transactions, drafts] =
              await Promise.all([
                league.rosters?.length
                  ? league.rosters
                  : getJson(
                      `https://api.sleeper.app/v1/league/${leagueId}/rosters`,
                    ),
                league.users?.length
                  ? league.users
                  : getJson(
                      `https://api.sleeper.app/v1/league/${leagueId}/users`,
                    ),
                getJson(
                  `https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`,
                ).catch(() => []),
                getJson(
                  `https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`,
                ).catch(() => []),
                getJson(
                  `https://api.sleeper.app/v1/league/${leagueId}/drafts`,
                ).catch(() => []),
              ]);
            const mine = rosters.find(
              (roster) => String(roster.owner_id) === String(root.user_id),
            );
            if (!mine) return { items: [], exposure: [] };
            const user = users.find(
              (row) => String(row.user_id) === String(root.user_id),
            );
            const teamName =
              user?.metadata?.team_name || user?.display_name || username;
            const matchup = matchups.find(
              (row) => String(row.roster_id) === String(mine.roster_id),
            );
            const starters = (matchup?.starters || []).map(String);
            const starterSet = new Set(starters);
            const rosterIds = (mine.players || []).map(String);
            const bench = rosterIds.filter((id) => !starterSet.has(id));
            const rostered = new Set(
              rosters.flatMap((roster) => roster.players || []).map(String),
            );
            const leagueItems = [];
            const base = { leagueId, leagueName: league.name, teamName };
            const leagueStatus = String(league.status || "").toLowerCase();
            const leagueFormat = classifyLeagueFormat(league, drafts);
            const isRegularBestBall =
              leagueFormat.flags.bestBall &&
              n(league?.settings?.type) !== 2 &&
              !leagueFormat.flags.strongDynastySignal;
            const opportunitiesAvailable =
              !["pre_draft", "drafting"].includes(leagueStatus) &&
              !isRegularBestBall;
            const empty = starters.filter((id) => !id || id === "0").length;
            if (empty)
              leagueItems.push({
                ...base,
                id: `empty:${leagueId}:${week}`,
                category: "lineup",
                priority: 100,
                tone: "critical",
                title: `Fill ${empty} empty starting slot${empty === 1 ? "" : "s"}`,
                impact: "Prevents a zero",
                confidence: 100,
                deadline: null,
                why: "An empty starter guarantees lost scoring opportunity and is the highest-priority action in the portfolio.",
                href: `https://sleeper.com/leagues/${leagueId}/matchup`,
                external: true,
                action: "Fix in Sleeper",
              });

            for (const starterId of starters.filter((id) => id && id !== "0")) {
              const player = players?.[starterId];
              const onBye = (
                byeData?.by_team?.[String(player?.team || "").toUpperCase()] ||
                []
              )
                .map(Number)
                .includes(week);
              if (onBye) {
                const byeReplacement = bench
                  .map((id) => ({
                    id,
                    player: players?.[id],
                    value: metricForWeek(players?.[id]),
                  }))
                  .filter(
                    (row) =>
                      row.player &&
                      !unavailable(row.player) &&
                      pos(row.player) === pos(player) &&
                      !(
                        byeData?.by_team?.[
                          String(row.player?.team || "").toUpperCase()
                        ] || []
                      )
                        .map(Number)
                        .includes(week),
                  )
                  .sort((a, b) => b.value - a.value)[0];
                leagueItems.push({
                  ...base,
                  id: `bye:${leagueId}:${week}:${starterId}`,
                  category: "lineup",
                  priority: 96,
                  tone: "critical",
                  title: `${name(players, starterId)} is on bye`,
                  impact: "Prevents a zero-point starter",
                  confidence: 100,
                  deadline: null,
                  why: byeReplacement
                    ? `${name(players, byeReplacement.id)} is the strongest same-position bench option not on bye.`
                    : "No same-position bench replacement is available, so this roster needs waiver or trade depth.",
                  href: byeReplacement
                    ? `/lineup?player=${starterId}&replacement=${byeReplacement.id}&reason=bye`
                    : `/player-availability?player=${starterId}&need=${pos(player)}&reason=bye`,
                  action: byeReplacement
                    ? "Set bye replacement"
                    : "Find bye-week help",
                });
              }
              if (!risk(player)) continue;
              const replacements = bench
                .map((id) => ({
                  id,
                  player: players?.[id],
                  value: metricForWeek(players?.[id]),
                }))
                .filter(
                  (row) =>
                    row.player &&
                    !unavailable(row.player) &&
                    pos(row.player) === pos(player),
                )
                .sort((a, b) => b.value - a.value);
              const replacement = replacements[0];
              const game = gameByTeam.get(player?.team);
              const impact = replacement
                ? metricType === "projection"
                  ? `Protects ${replacement.value.toFixed(1)} expected Week ${week} pts`
                  : `Protects ${Math.round(replacement.value).toLocaleString()} market value`
                : "Avoids inactive exposure";
              leagueItems.push({
                ...base,
                id: `injury:${leagueId}:${week}:${starterId}`,
                category: "lineup",
                priority: unavailable(player) ? 97 : 78,
                tone: tone(unavailable(player) ? 97 : 78),
                title: `${name(players, starterId)} is ${injury(player) || "inactive"}`,
                impact,
                confidence: replacement ? 88 : 75,
                deadline: game?.date || null,
                why: replacement
                  ? `${name(players, replacement.id)} is the strongest healthy same-position bench alternative under the selected source.`
                  : "No healthy same-position bench replacement was identified, so waiver or roster action may be required.",
                href: replacement
                  ? `/lineup?player=${starterId}&replacement=${replacement.id}`
                  : `/player-availability?player=${starterId}&need=${pos(player)}&reason=injury`,
                action: replacement
                  ? "Compare replacement"
                  : "Find waiver or trade help",
              });
              if (
                game?.weather &&
                !game?.venue?.indoor &&
                (n(game.weather.windSpeed) >= 18 ||
                  n(game.weather.precipitationProbability) >= 65)
              )
                leagueItems.push({
                  ...base,
                  id: `weather:${leagueId}:${week}:${starterId}`,
                  category: "weather",
                  priority: 58,
                  tone: "opportunity",
                  title: `Weather watch · ${name(players, starterId)}`,
                  impact: "Raises scoring volatility",
                  confidence: 72,
                  deadline: game.date,
                  why: `${game.weather.summary || "Outdoor conditions"} with ${n(game.weather.windSpeed)} mph wind and ${n(game.weather.precipitationProbability)}% precipitation probability deserves a final pre-kickoff check.`,
                  href: "/game-center",
                  action: "Review game context",
                });
            }

            if (opportunitiesAvailable) {
              const weakestByPos = new Map();
              rosterIds.forEach((id) => {
                const player = players?.[id];
                const position = pos(player);
                const value = metricForWeek(player);
                if (
                  !weakestByPos.has(position) ||
                  value < weakestByPos.get(position).value
                )
                  weakestByPos.set(position, { id, value });
              });
              const waiver = rankedPlayers.find(
                (row) =>
                  rosterAllowsPosition(league, pos(row.player)) &&
                  usableOpportunity(row.player, leagueFormat) &&
                  !rostered.has(row.id) &&
                  row.value >
                    n(weakestByPos.get(pos(row.player))?.value) * 1.15,
              );
              if (waiver) {
                const weakest = weakestByPos.get(pos(waiver.player));
                const waiverDelta = waiver.value - n(weakest?.value);
                leagueItems.push({
                  ...base,
                  id: `waiver:${leagueId}:${week}:${waiver.id}`,
                  category: "waiver",
                  priority: 68,
                  tone: "opportunity",
                  title: `${name(players, waiver.id)} is available`,
                  impact:
                    metricType === "projection"
                      ? `+${waiverDelta.toFixed(1)} expected Week ${week} pts`
                      : `+${Math.round(waiverDelta).toLocaleString()} market value`,
                  confidence: 80,
                  playerId: waiver.id,
                  playerPosition: pos(waiver.player),
                  deadline: null,
                  why: `${leagueFormat.key === "dynasty" && longTermUnavailable(waiver.player) ? "This is a dynasty stash rather than immediate lineup help. " : ""}The selected source grades this free agent at least 15% above your weakest ${pos(waiver.player)}. Confirm role, schedule, health, and the proposed drop before claiming.`,
                  href: `/player-availability?player=${waiver.id}&drop=${weakest?.id || ""}&need=${pos(waiver.player)}&source=${encodeURIComponent(sourceKey || "")}`,
                  action: "Build waiver claim",
                });
              }

              const counts = rosterIds.reduce((map, id) => {
                const p = pos(players?.[id]);
                map[p] = (map[p] || 0) + 1;
                return map;
              }, {});
              const surplus = Object.entries(counts)
                .filter(
                  ([position, count]) =>
                    ["QB", "RB", "WR", "TE"].includes(position) &&
                    count >= ({ QB: 4, RB: 7, WR: 9, TE: 4 }[position] || 99),
                )
                .sort((a, b) => b[1] - a[1])[0];
              const need = ["QB", "RB", "WR", "TE"].sort(
                (a, b) => n(counts[a]) - n(counts[b]),
              )[0];
              if (surplus && surplus[0] !== need)
                leagueItems.push({
                  ...base,
                  id: `trade-fit:${leagueId}:${week}:${surplus[0]}:${need}`,
                  category: "trade",
                  priority: 44,
                  tone: "planning",
                  title: `Convert ${surplus[0]} depth into ${need}`,
                  impact: "Improves roster balance",
                  confidence: 65,
                  deadline: null,
                  why: `Your roster carries ${surplus[1]} ${surplus[0]}s while ${need} is the thinnest core position. Trade Partner Finder can identify a manager with the inverse need.`,
                  href: `/trade?tab=finder&surplus=${surplus[0]}&need=${need}`,
                  action: "Find a partner",
                });
            }

            const activeDraft = drafts.find((draft) =>
              ["drafting", "paused"].includes(
                String(draft.status).toLowerCase(),
              ),
            );
            if (
              activeDraft ||
              String(league.status).toLowerCase() === "drafting"
            )
              leagueItems.push({
                ...base,
                id: `draft:${activeDraft?.draft_id || leagueId}`,
                category: "draft",
                priority: 92,
                tone: "critical",
                title: "Draft currently active",
                impact: "Live selection clock",
                confidence: 100,
                deadline: null,
                why: "The Draft Command Center can refresh every five seconds, remove selected players, and tailor recommendations to this roster.",
                href: `/draft-helper?league=${leagueId}${activeDraft?.draft_id ? `&draft=${activeDraft.draft_id}` : ""}`,
                action: "Enter draft room",
              });

            const pendingTrades = transactions.filter(
              (row) =>
                row.type === "trade" &&
                !["complete", "failed"].includes(
                  String(row.status).toLowerCase(),
                ),
            );
            if (pendingTrades.length)
              leagueItems.push({
                ...base,
                id: `pending-trades:${leagueId}:${week}`,
                category: "trade",
                priority: 74,
                tone: "warning",
                title: `${pendingTrades.length} trade${pendingTrades.length === 1 ? "" : "s"} awaiting resolution`,
                impact: "Roster and market decision",
                confidence: 95,
                deadline: null,
                why: "A pending trade can alter lineup, roster-limit, and playoff decisions. Review it before making dependent moves.",
                href: "/trade",
                action: "Review trade context",
              });
            const isCommissioner =
              String(league.owner_id || "") === String(root.user_id) ||
              user?.is_owner === true;
            if (isCommissioner) {
              const managerName = (rosterId) => {
                const targetRoster = rosters.find(
                  (row) => String(row.roster_id) === String(rosterId),
                );
                const targetUser = users.find(
                  (row) =>
                    String(row.user_id) === String(targetRoster?.owner_id),
                );
                return (
                  targetUser?.metadata?.team_name ||
                  targetUser?.display_name ||
                  targetUser?.username ||
                  `Roster ${rosterId}`
                );
              };
              matchups.forEach((row) => {
                const count = (row.starters || []).filter(
                  (id) => !id || String(id) === "0",
                ).length;
                if (!count) return;
                leagueItems.push({
                  ...base,
                  id: `commissioner-empty:${leagueId}:${week}:${row.roster_id}`,
                  category: "commissioner",
                  priority: 100,
                  tone: "critical",
                  title: `${managerName(row.roster_id)} has ${count} empty starting slot${count === 1 ? "" : "s"}`,
                  impact: "League lineup compliance",
                  confidence: 100,
                  deadline: null,
                  why: "Sleeper reports an empty starting position for a manager in a league you commission.",
                  evidence: [
                    `Manager: ${managerName(row.roster_id)}`,
                    `Roster ${row.roster_id}`,
                    `Week ${week}`,
                  ],
                  href: `/commissioner-dashboard?league=${leagueId}&tab=activity`,
                  action: "Review manager activity",
                });
              });
              rosters
                .filter((row) => !row.owner_id)
                .forEach((row) =>
                  leagueItems.push({
                    ...base,
                    id: `commissioner-orphan:${leagueId}:${row.roster_id}`,
                    category: "commissioner",
                    priority: 84,
                    tone: "warning",
                    title: `Roster ${row.roster_id} has no assigned manager`,
                    impact: "League continuity",
                    confidence: 100,
                    deadline: null,
                    why: "Sleeper exposes this roster without an owner ID.",
                    evidence: [
                      `Roster ${row.roster_id}`,
                      "No Sleeper owner ID",
                    ],
                    href: `/commissioner-dashboard?league=${leagueId}&tab=orphan`,
                    action: "Open orphan evaluator",
                  }),
                );
              if (pendingTrades.length)
                leagueItems.push({
                  ...base,
                  id: `commissioner-trades:${leagueId}:${week}`,
                  category: "commissioner",
                  priority: 78,
                  tone: "warning",
                  title: `Review ${pendingTrades.length} unresolved league trade${pendingTrades.length === 1 ? "" : "s"}`,
                  impact: "Transaction review",
                  confidence: 96,
                  deadline: null,
                  why: "One or more league trades have not reached a completed or failed state.",
                  evidence: pendingTrades
                    .slice(0, 4)
                    .map(
                      (row) => `Transaction ${row.transaction_id || "pending"}`,
                    ),
                  href: `/commissioner-dashboard?league=${leagueId}&tab=review`,
                  action: "Review trade evidence",
                });

              const completedWeek = Math.max(0, week - 1);
              if (completedWeek) {
                const historyWeeks = Array.from(
                  { length: completedWeek },
                  (_, index) => index + 1,
                );
                const [matchupHistory, transactionHistory] = await Promise.all([
                  concurrentMap(historyWeeks, 6, async (scanWeek) => ({
                    week: scanWeek,
                    rows: await getJson(
                      `https://api.sleeper.app/v1/league/${leagueId}/matchups/${scanWeek}`,
                    ).catch(() => []),
                  })),
                  concurrentMap([0, ...historyWeeks], 6, async (scanWeek) =>
                    getJson(
                      `https://api.sleeper.app/v1/league/${leagueId}/transactions/${scanWeek}`,
                    ).catch(() => []),
                  ),
                ]);
                const completedMoves = transactionHistory
                  .flat()
                  .filter(
                    (row) => String(row.status).toLowerCase() === "complete",
                  );
                const movesByRoster = new Map();
                completedMoves.forEach((row) =>
                  (row.roster_ids || Object.values(row.adds || {}))
                    .map(String)
                    .forEach((id) =>
                      movesByRoster.set(id, n(movesByRoster.get(id)) + 1),
                    ),
                );
                const lineupsByRoster = new Map();
                matchupHistory.forEach(({ week: scanWeek, rows }) =>
                  rows.forEach((row) => {
                    const id = String(row.roster_id);
                    const startersKey = (row.starters || [])
                      .map(String)
                      .join("|");
                    const existing = lineupsByRoster.get(id) || [];
                    existing.push({ week: scanWeek, startersKey });
                    lineupsByRoster.set(id, existing);
                  }),
                );
                rosters.forEach((row) => {
                  const rosterId = String(row.roster_id);
                  if (completedWeek >= 4 && !n(movesByRoster.get(rosterId)))
                    leagueItems.push({
                      ...base,
                      id: `commissioner-inactive:${leagueId}:${rosterId}:${completedWeek}`,
                      category: "commissioner",
                      priority: 70,
                      tone: "warning",
                      title: `${managerName(rosterId)} has no recorded activity`,
                      impact: "Manager participation review",
                      confidence: 96,
                      deadline: null,
                      why: "No completed trade, waiver, or free-agent move was found during the same completed-week window used by the Commissioner Dashboard.",
                      evidence: [
                        `Manager: ${managerName(rosterId)}`,
                        `Weeks 1-${completedWeek}`,
                        "0 completed transactions",
                      ],
                      href: `/commissioner-dashboard?league=${leagueId}&tab=activity`,
                      action: "Review activity evidence",
                    });
                  const history = lineupsByRoster.get(rosterId) || [];
                  let unchanged = 0;
                  history.forEach((entry, index) => {
                    if (
                      index &&
                      entry.startersKey &&
                      entry.startersKey === history[index - 1].startersKey
                    )
                      unchanged += 1;
                  });
                  if (
                    unchanged >= Math.max(3, Math.floor(history.length * 0.65))
                  )
                    leagueItems.push({
                      ...base,
                      id: `commissioner-unchanged:${leagueId}:${rosterId}:${completedWeek}`,
                      category: "commissioner",
                      priority: 58,
                      tone: "opportunity",
                      title: `${managerName(rosterId)} has a frequently unchanged lineup`,
                      impact: "Lineup-management context",
                      confidence: 82,
                      deadline: null,
                      why: "The same starter combination crossed the Commissioner Dashboard’s consecutive-week threshold. Byes, injuries, Best Ball, and intentional lineup choices may explain it.",
                      evidence: [
                        `Manager: ${managerName(rosterId)}`,
                        `${unchanged} unchanged consecutive-week comparisons`,
                      ],
                      href: `/commissioner-dashboard?league=${leagueId}&tab=activity`,
                      action: "Review lineup history",
                    });
                });
                const pairCounts = new Map();
                completedMoves
                  .filter((row) => row.type === "trade")
                  .forEach((row) => {
                    const ids = [
                      ...new Set((row.roster_ids || []).map(String)),
                    ].sort();
                    if (ids.length < 2) return;
                    const key = ids.join("|");
                    pairCounts.set(key, n(pairCounts.get(key)) + 1);
                  });
                [...pairCounts.entries()]
                  .filter(([, count]) => count >= 4)
                  .forEach(([key, count]) => {
                    const ids = key.split("|");
                    leagueItems.push({
                      ...base,
                      id: `commissioner-repeat-trades:${leagueId}:${key}`,
                      category: "commissioner",
                      priority: 64,
                      tone: "opportunity",
                      title: `${managerName(ids[0])} and ${managerName(ids[1])} traded ${count} times`,
                      impact: "Repeated trade relationship",
                      confidence: 100,
                      deadline: null,
                      why: "This pair crossed the same repeated-trader review threshold used by the Commissioner Dashboard. Frequency alone is not evidence of misconduct.",
                      evidence: ids.map((id) => `Manager: ${managerName(id)}`),
                      href: `/commissioner-dashboard?league=${leagueId}&tab=review`,
                      action: "Review trade relationship",
                    });
                  });
              }
            }
            if (
              week >= 11 &&
              String(league.status).toLowerCase() === "in_season"
            )
              leagueItems.push({
                ...base,
                id: `playoffs:${leagueId}:${week}`,
                category: "playoffs",
                priority: 52,
                tone: "opportunity",
                title: "Playoff leverage is active",
                impact: "Seed and qualification odds",
                confidence: 82,
                deadline: null,
                why: `Week ${week} outcomes can materially change qualification and seeding paths. The Scenario Explorer identifies the matchups that matter most.`,
                href: "/playoff-odds",
                action: "Explore scenarios",
              });
            return { items: leagueItems, exposure: rosterIds };
          } catch {
            return { items: [], exposure: [] };
          }
        },
        (done, total) => setProgress(`${done}/${total}`),
      );

      scans.forEach((scan) =>
        scan.exposure.forEach((id) =>
          exposure.set(id, n(exposure.get(id)) + 1),
        ),
      );
      const threshold = Math.max(3, Math.ceil(targetLeagues.length * 0.35));
      const concentrated = [...exposure.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([id, count]) => ({
          id: `exposure:${id}:${targetLeagues.length}`,
          category: "portfolio",
          priority: 40 + Math.min(20, count),
          tone: "planning",
          title: `High exposure · ${name(players, id)}`,
          leagueName: "Portfolio-wide",
          teamName: `Rostered in ${count} of ${targetLeagues.length} selected leagues`,
          impact: `${Math.round((count / Math.max(1, targetLeagues.length)) * 100)}% concentration`,
          confidence: 96,
          deadline: null,
          why: "Concentration can create an edge when correct, but one injury or role change affects several teams. Review whether this is intentional.",
          href: `/player-stock/results?player=${id}`,
          action: "Review exposure",
        }));
      const localItems = [
        ...scans.flatMap((scan) => scan.items),
        ...concentrated,
      ].map((item) => ({ ...item, tone: item.tone || tone(item.priority) }));
      const next = mergeDecisionRows(serverItems, localItems);
      const at = Date.now();
      setItems(next);
      setUpdatedAt(new Date(at));
      localStorage.setItem(cacheKey, JSON.stringify({ at, items: next }));
    } catch (scanError) {
      setError(
        scanError?.message || "The intelligence scan could not be completed.",
      );
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const itemsForView = useMemo(() => {
    const targetIds = new Set(targetLeagueIds);
    const scoped = items.filter(
      (item) => {
        if (item.leagueId && !targetIds.has(String(item.leagueId))) return false;
        if (item.category !== "waiver" || !item.playerId) return true;
        const league = leagues.find((row) => String(row.league_id) === String(item.leagueId));
        return usableOpportunity(players?.[item.playerId], classifyLeagueFormat(league || {}));
      },
    );
    if (tab !== "history") return scoped;
    return mergeDecisionRows(
      scoped,
      Object.values(actions)
        .map((state) => state?.decision)
        .filter(
          (item) =>
            item && (!item.leagueId || targetIds.has(String(item.leagueId))),
        ),
    );
  }, [actions, items, leagues, players, tab, targetLeagueIds]);
  const activeItems = useMemo(
    () =>
      itemsForView
        .filter((item) => {
          const state = actions[item.id] || {};
          if (tab === "history")
            return ["completed", "dismissed"].includes(state.status);
          if (tab === "saved")
            return (
              state.saved && !["completed", "dismissed"].includes(state.status)
            );
          if (["completed", "dismissed"].includes(state.status)) return false;
          if (state.status === "snoozed" && n(state.snoozedUntil) > Date.now())
            return false;
          if (tab === "now")
            return (
              item.priority >= 70 ||
              (item.deadline &&
                new Date(item.deadline).getTime() - Date.now() < 24 * 3600000)
            );
          if (tab === "week") return item.priority >= 45;
          if (tab === "opportunities")
            return ["waiver", "trade", "portfolio", "playoffs"].includes(
              item.category,
            );
          if (tab === "watching")
            return (
              ["weather", "lineup"].includes(item.category) &&
              item.priority < 70
            );
          return true;
        })
        .filter((item) => category === "all" || item.category === category),
    [actions, category, itemsForView, tab],
  );
  const categories = [...new Set(itemsForView.map((item) => item.category))];
  const visible = full ? activeItems : activeItems.slice(0, 8);
  const overallOpen = itemsForView.filter(
    (item) =>
      !["completed", "dismissed"].includes(actions[item.id]?.status) &&
      !(
        actions[item.id]?.status === "snoozed" &&
        n(actions[item.id]?.snoozedUntil) > Date.now()
      ),
  );
  const critical = activeItems.filter((item) => item.priority >= 90).length;
  const potential = activeItems.reduce(
    (sum, item) =>
      sum +
      (String(item.impact).startsWith("+")
        ? n(String(item.impact).match(/\d+/)?.[0])
        : 0),
    0,
  );
  const memoryRows = Object.values(actions);
  const completedCount = memoryRows.filter(
    (row) => row.status === "completed",
  ).length;
  const helpedCount = memoryRows.filter(
    (row) => row.outcome === "helped",
  ).length;
  const ratedCount = memoryRows.filter((row) => row.outcome).length;

  return (
    <section data-guide-tip="intelligence-workspace" className="overflow-hidden rounded-[30px] border border-amber-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(251,191,36,.13),transparent_38%),radial-gradient(circle_at_8%_100%,rgba(139,92,246,.1),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95))]">
      <div data-guide-tip="intelligence-header" className="border-b border-white/10 p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.24em] text-amber-200/55">
              Arsenal Intelligence
            </div>
            <h2 className="mt-1 text-2xl font-black sm:text-4xl">
              What should I do today?
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/44">
              One prioritized workflow across lineups, injuries, weather,
              waivers, drafts, trades, playoffs, portfolio exposure, and
              commissioner responsibilities.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={scan}
              disabled={loading || !username}
              className="min-h-11 rounded-2xl bg-amber-300/10 px-5 text-sm font-black text-amber-100 disabled:opacity-40"
            >
              {loading
                ? `Scanning ${progress}`
                : items.length
                  ? "Refresh intelligence"
                  : "Scan every league"}
            </button>
            {!full ? (
              <Link
                href="/intelligence"
                className="grid min-h-11 place-items-center rounded-2xl bg-violet-300/10 px-5 text-sm font-black text-violet-100"
              >
                Open command center
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl bg-black/20 p-3">
            <b className="text-2xl">{overallOpen.length}</b>
            <small className="block text-[9px] uppercase text-white/30">
              Open decisions
            </small>
          </div>
          <div className="rounded-2xl bg-rose-300/[0.05] p-3">
            <b className="text-2xl text-rose-100">
              {overallOpen.filter((item) => item.priority >= 90).length}
            </b>
            <small className="block text-[9px] uppercase text-white/30">
              Critical now
            </small>
          </div>
          <div className="rounded-2xl bg-emerald-300/[0.05] p-3">
            <b className="text-2xl text-emerald-100">
              {ratedCount
                ? `${Math.round((helpedCount / ratedCount) * 100)}%`
                : "—"}
            </b>
            <small className="block text-[9px] uppercase text-white/30">
              Helpful outcomes
            </small>
          </div>
          <div
            title="Saved, snoozed, completed, dismissed, and outcome feedback are stored on this device or synchronized through your Arsenal account."
            className="rounded-2xl bg-violet-300/[0.05] p-3"
          >
            <b className="text-2xl text-violet-100">
              {isConnected ? "Synced" : "Device"}
            </b>
            <small className="block text-[9px] uppercase text-white/30">
              Decision memory · {completedCount} complete
            </small>
          </div>
        </div>
      </div>
      {full ? (
        <div data-guide-tip="intelligence-tabs" className="border-b border-white/10 p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex overflow-x-auto">
              {[
                ["now", "Today"],
                ["week", "This Week"],
                ["opportunities", "Opportunities"],
                ["watching", "Watching"],
                ["saved", "Saved"],
                ["history", "Memory"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold ${tab === key ? "bg-white/10 text-white" : "text-white/38"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs"
            >
              <option value="all">Every decision type</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      {full ? (
        <details data-guide-tip="intelligence-scope" className="border-b border-white/10 p-4">
          <summary className="cursor-pointer text-xs font-bold text-white/55">
            League scope · {targetLeagues.length} of {leagues.length} leagues
          </summary>
          <div className="mt-3 space-y-3">
            <div className="text-[10px] text-white/35">
              Standard leagues are included by default. Add only the Best Ball
              leagues you want, or customize any league individually.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  saveLeagueScope({ includeBestBall: false, leagueIds: [] })
                }
                className="rounded-xl bg-white/[0.05] px-3 py-2 text-[10px] font-bold text-white/55"
              >
                Standard only
              </button>
              <button
                type="button"
                onClick={() =>
                  saveLeagueScope({ includeBestBall: true, leagueIds: [] })
                }
                className="rounded-xl bg-white/[0.05] px-3 py-2 text-[10px] font-bold text-white/55"
              >
                All leagues
              </button>
            </div>
            <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {leagues.map((league) => {
                const id = String(league.league_id);
                const explicitIds = (leagueScope.leagueIds || []).map(String);
                const selected = explicitIds.length
                  ? explicitIds.includes(id)
                  : leagueScope.includeBestBall ||
                    defaultLeagueIds.includes(id);
                const bestBall = classifyLeagueFormat(league).flags.bestBall;
                return (
                  <label
                    key={id}
                    className="flex items-center gap-2 rounded-xl bg-white/[0.025] p-3 text-xs text-white/55"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        const ids = new Set(
                          explicitIds.length ? explicitIds : targetLeagueIds,
                        );
                        selected ? ids.delete(id) : ids.add(id);
                        saveLeagueScope({
                          includeBestBall: true,
                          leagueIds: [...ids],
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {league.name}
                    </span>
                    {bestBall ? (
                      <small className="shrink-0 text-[8px] font-black uppercase text-violet-200/55">
                        Best Ball
                      </small>
                    ) : null}
                  </label>
                );
              })}
            </div>
            {leagueScope.leagueIds?.length ? (
              <button
                type="button"
                onClick={() =>
                  saveLeagueScope({ includeBestBall: false, leagueIds: [] })
                }
                className="rounded-xl bg-white/[0.05] px-3 py-2 text-[10px] font-bold text-white/55"
              >
                Reset to standard leagues
              </button>
            ) : null}
          </div>
        </details>
      ) : null}
      {error ? (
        <div className="border-b border-white/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      <div
        data-guide-tip="intelligence-decisions"
        className={
          full
            ? "grid gap-3 p-3 sm:p-5 lg:grid-cols-2"
            : "divide-y divide-white/[0.06]"
        }
      >
        {visible.map((item) =>
          full ? (
            <RecommendationCard
              key={item.id}
              item={item}
              state={actions[item.id]}
              update={updateAction}
            />
          ) : (
            <div key={item.id} className="p-2 sm:p-3">
              <RecommendationCard
                item={item}
                state={actions[item.id]}
                update={updateAction}
                compact
              />
            </div>
          ),
        )}
        {!visible.length && !loading ? (
          tab === "now" && items.length ? (
            <div className="col-span-full rounded-[24px] border border-emerald-300/15 bg-emerald-300/[0.035] p-6">
              <div className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-200/60">
                All clear right now
              </div>
              <h3 className="mt-1 text-xl font-black">
                No urgent action crossed today’s threshold.
              </h3>
              <p className="mt-2 text-xs leading-5 text-white/40">
                The latest scan checked {leagues.length} leagues for empty
                starters, injury risk, active drafts, available-player upgrades,
                unresolved transactions, commissioner responsibilities, playoff
                leverage, and portfolio concentration.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  "Lineups checked",
                  "Transactions reviewed",
                  "Drafts checked",
                  "Commissioner leagues checked",
                ].map((label) => (
                  <div
                    key={label}
                    className="rounded-xl bg-black/15 p-3 text-[10px] text-white/45"
                  >
                    <b className="block text-emerald-100">✓</b>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="col-span-full p-6 text-sm text-white/38">
              {tab === "history"
                ? "Completed and dismissed decisions will appear here with their timelines and outcome feedback."
                : tab === "saved"
                  ? "Save a recommendation to build a focused shortlist."
                  : "No decisions match this view and filter."}
            </div>
          )
        ) : null}
      </div>
      <div className="border-t border-white/[0.06] px-5 py-3 text-[9px] text-white/25">
        {updatedAt ? `Last checked ${updatedAt.toLocaleTimeString()} · ` : ""}
        Recommendations are decision support, not automatic Sleeper actions.
        Confidence reflects data completeness and model specificity.
      </div>
    </section>
  );
}
