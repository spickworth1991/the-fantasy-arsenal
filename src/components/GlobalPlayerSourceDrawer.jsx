"use client";

import { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../context/SleeperContext";
import AvatarImage from "./AvatarImage";
import PlayerResearchPanel from "./PlayerResearchPanel";
import { DEFAULT_SOURCES } from "./SourceSelector";
import {
  scoreSleeperStats,
  sleeperScoringCoverage,
} from "../lib/sleeperScoring";

const TABS = [
  ["overview", "Overview"],
  ["sources", "All sources"],
  ["live", "Live Game"],
  ["production", "Games"],
  ["research", "News"],
];
let ballsvilleDraftersPromise;
const loadBallsvilleDrafters = () => {
  if (!ballsvilleDraftersPromise) {
    const season = new Date().getFullYear();
    ballsvilleDraftersPromise = fetch(
      `/data/player-stock-drafters-${season}.json`,
    )
      .then((response) => (response.ok ? response.json() : { players: {} }))
      .catch(() => ({ players: {} }));
  }
  return ballsvilleDraftersPromise;
};
const n = (value) => Number(value) || 0;
const pct = (value) => `${Math.round(value * 100)}%`;
const norm = (value) =>
  String(value || "")
    .toLowerCase()
    .trim();
const playerIds = (roster) =>
  new Set(
    [
      ...(roster?.players || []),
      ...(roster?.reserve || []),
      ...(roster?.taxi || []),
    ].map(String),
  );
const displayUser = (user) =>
  user?.display_name ||
  user?.metadata?.team_name ||
  user?.username ||
  "Unknown manager";
const positionFamily = (position) => {
  const pos = String(position || "").toUpperCase();
  if (["CB", "S", "FS", "SS"].includes(pos)) return "DB";
  if (["DE", "DT", "EDGE"].includes(pos)) return "DL";
  return pos;
};
const normalizedName = (value) =>
  norm(value)
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const LIVE_STAT_LABELS = {
  pass_att: "Pass attempts",
  pass_cmp: "Completions",
  pass_yd: "Passing yards",
  pass_td: "Passing TD",
  pass_int: "Interceptions",
  rush_att: "Carries",
  rush_yd: "Rushing yards",
  rush_td: "Rushing TD",
  rec_tgt: "Targets",
  rec: "Receptions",
  rec_yd: "Receiving yards",
  rec_td: "Receiving TD",
  fum: "Fumbles",
  fum_lost: "Fumbles lost",
  fgm: "Field goals made",
  xpm: "Extra points made",
  idp_tkl: "Tackles",
  idp_tkl_solo: "Solo tackles",
  idp_sack: "Sacks",
  idp_int: "Defensive INT",
  idp_ff: "Forced fumbles",
  idp_fum_rec: "Fumble recoveries",
  def_td: "Defensive TD",
};
async function readArchivedJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Archive HTTP ${response.status}`);
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser cannot decompress archive history.");
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

const archiveSourceFile = {
  "val:fantasycalc": "fantasycalc_cache.json",
  "val:keeptradecut": "ktc_cache.json",
  "val:dynastyprocess": "dynastyprocess_cache.json",
  "val:fantasynav": "fantasynav_cache.json",
  "val:fantasypros": "fantasypros_cache.json",
  "val:fantasypros-ecr": "fantasypros_ecr_cache.json",
  "val:idynastyp": "idynastyp_cache.json",
  "val:idpshow": "idpshow_cache.json",
  "val:thefantasyarsenal": "stickypicky_cache.json",
  "proj:ffa": (season) => `projections_${season}.json`,
  "proj:espn": (season) => `projections_espn_${season}.json`,
  "proj:cbs": (season) => `projections_cbs_${season}.json`,
  "proj:sleeper": (season) => `projections_sleeper_${season}.json`,
  "proj:fantasysharks": (season) => `projections_fantasysharks_${season}.json`,
  "proj:draftsharks": (season) => `projections_draftsharks_${season}.json`,
  "proj:fantasypros": (season) => `projections_fantasypros_${season}.json`,
  "proj:thefantasyarsenal": (season) =>
    `projections_thefantasyarsenal_${season}.json`,
  "proj:thefantasyarsenal-model": (season) =>
    `projections_thefantasyarsenal_model_${season}.json`,
};

function archivedSourceAmount(payload, sourceKey, { name, position, format, qbType }) {
  if (!payload) return 0;
  const targetName = normalizedName(name);
  const targetPosition = positionFamily(position);
  const matches = (row) =>
    row &&
    normalizedName(row.name) === targetName &&
    (!targetPosition || !row.position || positionFamily(row.position) === targetPosition);
  const bucket = `${format === "redraft" ? "Redraft" : "Dynasty"}_${qbType === "sf" ? "SF" : "1QB"}`;
  const findIn = (rows) => (Array.isArray(rows) ? rows.find(matches) : null);

  if (sourceKey === "val:dynastyprocess") {
    const match = Object.entries(payload).find(([rowName, row]) =>
      normalizedName(rowName) === targetName &&
      (!targetPosition || positionFamily(row?.pos) === targetPosition),
    )?.[1];
    return n(match?.[qbType === "sf" ? "superflex" : "one_qb"]);
  }
  if (sourceKey === "val:keeptradecut") {
    return n(findIn(payload?.[qbType === "sf" ? "Superflex" : "OneQB"])?.value);
  }
  if (sourceKey === "val:fantasypros-ecr") {
    return n(findIn(payload?.formats?.[bucket])?.value);
  }
  if (sourceKey === "val:idynastyp") {
    return n(findIn(payload)?.[qbType === "sf" ? "superflex" : "one_qb"]);
  }
  if (sourceKey.startsWith("proj:")) return n(findIn(payload?.rows)?.points);
  return n(findIn(payload?.[bucket])?.value);
}

function Metric({ label, value, detail, tone = "cyan" }) {
  const colors =
    tone === "emerald"
      ? "text-emerald-100"
      : tone === "amber"
        ? "text-amber-100"
        : tone === "violet"
          ? "text-violet-100"
          : "text-cyan-100";
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="break-words text-[9px] font-semibold uppercase tracking-[.13em] text-white/30 sm:tracking-[.16em]">
        {label}
      </div>
      <div
        className={`mt-1 break-words text-base font-black leading-tight min-[390px]:text-lg sm:text-xl ${colors}`}
      >
        {value}
      </div>
      {detail ? (
        <div className="mt-1 break-words text-[10px] leading-4 text-white/35">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function SourceTable({
  title,
  rows,
  currentSource,
  movement = {},
  suffix = "",
  rawScale = false,
}) {
  const usable = rows.filter((row) => row.supported && row.amount > 0);
  const values = usable.map((row) => row.amount);
  const average = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const floor = values.length ? Math.min(...values) : 0;
  const ceiling = values.length ? Math.max(...values) : 0;
  const spread = average ? (ceiling - floor) / average : 0;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-black">{title}</h3>
          <p className="text-[10px] text-white/30">
            {usable.length} reporting sources ·{" "}
            {spread > 0.25
              ? "high disagreement"
              : spread > 0.12
                ? "moderate disagreement"
                : "tight consensus"}
          </p>
        </div>
        <div className="text-left text-[10px] text-white/35 min-[390px]:text-right">
          {rawScale ? "Raw source average" : "Consensus"}{" "}
          <b className="text-white/70">
            {average
              ? suffix
                ? average.toFixed(1)
                : Math.round(average).toLocaleString()
              : "—"}
            {average ? suffix : ""}
          </b>
        </div>
      </div>
      <div className="mb-2 grid grid-cols-1 gap-2 min-[350px]:grid-cols-3">
        <Metric
          label="Floor"
          value={
            floor
              ? `${suffix ? floor.toFixed(1) : Math.round(floor).toLocaleString()}${suffix}`
              : "—"
          }
        />
        <Metric
          label="Consensus"
          value={
            average
              ? `${suffix ? average.toFixed(1) : Math.round(average).toLocaleString()}${suffix}`
              : "—"
          }
          tone="emerald"
        />
        <Metric
          label="Ceiling"
          value={
            ceiling
              ? `${suffix ? ceiling.toFixed(1) : Math.round(ceiling).toLocaleString()}${suffix}`
              : "—"
          }
          tone="violet"
        />
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full table-fixed text-left text-[11px] sm:text-xs">
          <thead className="bg-white/[0.04] text-[9px] uppercase tracking-wider text-white/30">
            <tr>
              <th className="w-[56%] px-2.5 py-2.5 sm:px-3">Source</th>
              <th className="px-2.5 py-2.5 text-right sm:px-3">Result</th>
              <th className="px-2.5 py-2.5 text-right sm:px-3">7d move</th>
              <th className="hidden px-3 py-2.5 text-right sm:table-cell">
                {rawScale ? "vs raw avg" : "vs consensus"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {rows.map((row) => {
              const delta =
                average && row.amount ? (row.amount - average) / average : 0;
              const outlier =
                Math.abs(delta) >= 0.2 &&
                !(rawScale && row.key === "val:thefantasyarsenal");
              const sourceMovement = movement[row.key];
              return (
                <tr
                  key={row.key}
                  className={
                    row.key === currentSource ? "bg-cyan-300/[0.055]" : ""
                  }
                >
                  <td className="px-2.5 py-3 sm:px-3">
                    <div className="break-words font-semibold leading-4 text-white/75">
                      {row.label}
                    </div>
                    <div className="text-[8px] font-semibold uppercase tracking-wider text-white/25">
                      {row.key === currentSource
                        ? "Current source"
                        : outlier
                          ? "Source outlier"
                          : ""}
                    </div>
                  </td>
                  <td className="break-words px-2.5 py-3 text-right font-black sm:px-3">
                    {!row.supported ? (
                      <span className="font-normal text-white/25">
                        Not offered
                      </span>
                    ) : row.amount > 0 ? (
                      `${suffix ? row.amount.toFixed(1) : Math.round(row.amount).toLocaleString()}${suffix}`
                    ) : (
                      <span className="font-normal text-white/25">
                        Unavailable
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-2.5 py-3 text-right text-[10px] font-bold sm:px-3 ${sourceMovement?.delta > 0 ? "text-emerald-200" : sourceMovement?.delta < 0 ? "text-amber-200" : "text-white/30"}`}
                    title={sourceMovement?.detail}
                  >
                    {sourceMovement
                      ? `${sourceMovement.delta > 0 ? "+" : ""}${suffix ? sourceMovement.delta.toFixed(1) : Math.round(sourceMovement.delta).toLocaleString()}${suffix}`
                      : "—"}
                  </td>
                  <td
                    className={`hidden px-3 py-3 text-right text-[10px] sm:table-cell ${outlier ? "text-amber-200" : "text-white/30"}`}
                  >
                    {row.amount && average
                      ? `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function GlobalPlayerSourceDrawer() {
  const {
    username,
    players,
    leagues = [],
    activeLeague,
    setActiveLeague,
    fetchLeagueRostersSilent,
    preloadProjections,
    getPlayerValue,
    getProjection,
    sourceKey,
    setSourceKey,
    format,
    qbType,
  } = useSleeper();
  const [playerId, setPlayerId] = useState("");
  const [tab, setTab] = useState("overview");
  const [leagueData, setLeagueData] = useState(null);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [trend, setTrend] = useState({ adds: 0, drops: 0 });
  const [production, setProduction] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [archive, setArchive] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sourceMovement, setSourceMovement] = useState({});
  const [projectionSourcesLoading, setProjectionSourcesLoading] = useState(false);
  const [ballsvilleDrafters, setBallsvilleDrafters] = useState([]);
  const [portfolioExposure, setPortfolioExposure] = useState({
    loading: false,
    count: 0,
    scanned: 0,
  });
  const [liveGame, setLiveGame] = useState({
    loading: false,
    season: null,
    week: null,
    seasonType: "",
    stats: null,
    updatedAt: null,
    error: "",
  });

  useEffect(() => {
    const open = (event) => {
      setPlayerId(String(event.detail?.playerId || ""));
      setTab("overview");
    };
    window.addEventListener("tfa:inspect-player", open);
    return () => window.removeEventListener("tfa:inspect-player", open);
  }, []);
  useEffect(() => {
    if (!playerId) return undefined;
    const close = (event) => {
      if (event.key === "Escape") setPlayerId("");
    };
    window.addEventListener("keydown", close);
    const prior = document.body.style.overflow;
    const priorRoot = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = prior;
      document.documentElement.style.overflow = priorRoot;
    };
  }, [playerId]);

  const player = players?.[playerId];
  const name =
    player?.full_name ||
    player?.search_full_name ||
    [player?.first_name, player?.last_name].filter(Boolean).join(" ") ||
    playerId;
  const injuryStatus = String(player?.injury_status || "").trim();
  const playerStatus = String(player?.status || "").trim();
  const depthOrder = player?.depth_chart_order;
  const depthRole = player?.depth_chart_position || player?.position || "";
  const depthStatus = depthOrder
    ? `${depthRole} ${depthOrder}`
    : depthRole
      ? `${depthRole} depth unknown`
      : "Unavailable";

  useEffect(() => {
    let active = true;
    if (!playerId) {
      setBallsvilleDrafters([]);
      return () => {
        active = false;
      };
    }
    loadBallsvilleDrafters().then((payload) => {
      if (active) setBallsvilleDrafters(payload?.players?.[playerId] || []);
    });
    return () => {
      active = false;
    };
  }, [playerId]);

  const rows = useMemo(
    () =>
      player
        ? DEFAULT_SOURCES.map((source) => {
            const supported =
              source.type === "projection" ||
              source.supports?.[format] !== false;
            const amount = supported ? n(source.type === "projection" ? getProjection(player, source.key) : getPlayerValue(player, { sourceKey:source.key, format, qbType })) : 0;
            return { ...source, supported, amount };
          })
        : [],
    [format, getPlayerValue, getProjection, player, qbType],
  );
  const valueRows = rows.filter((row) => row.type === "value");
  const projectionRows = rows.filter((row) => row.type === "projection");

  useEffect(() => {
    let active = true;
    if (tab !== "sources" || !playerId) return undefined;
    setProjectionSourcesLoading(true);
    Promise.all(
      DEFAULT_SOURCES.filter((source) => source.type === "projection").map(
        (source) => preloadProjections(source.key).catch(() => null),
      ),
    ).finally(() => {
      if (active) setProjectionSourcesLoading(false);
    });
    return () => {
      active = false;
    };
    // Projection loader is recreated by the provider; source/view changes are
    // the intentional triggers here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, playerId]);
  const consensus = (group) => {
    const values = group.map((row) => row.amount).filter((value) => value > 0);
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  };

  const league =
    leagues.find((row) => String(row.league_id) === String(activeLeague)) ||
    null;
  useEffect(() => {
    let active = true;
    if (!playerId || !activeLeague) {
      setLeagueData(null);
      return undefined;
    }
    if (league?.rosters && league?.users) {
      setLeagueData({ rosters: league.rosters, users: league.users });
      return undefined;
    }
    setLeagueLoading(true);
    fetchLeagueRostersSilent(activeLeague)
      .then((payload) => {
        if (active) setLeagueData(payload);
      })
      .catch(() => {
        if (active) setLeagueData(null);
      })
      .finally(() => {
        if (active) setLeagueLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeLeague, playerId, league?.rosters, league?.users]);

  useEffect(() => {
    if (!playerId || !leagues.length) {
      setPortfolioExposure({ loading: false, count: 0, scanned: 0 });
      return undefined;
    }
    let active = true;
    setPortfolioExposure((current) => ({ ...current, loading: true }));
    const run = async () => {
      let count = 0;
      let scanned = 0;
      const root = await fetch(
        `https://api.sleeper.app/v1/user/${encodeURIComponent(username || "")}`,
      )
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (!root?.user_id) {
        if (active)
          setPortfolioExposure({ loading: false, count: 0, scanned: 0 });
        return;
      }
      const queue = [...leagues];
      await Promise.all(
        Array.from({ length: Math.min(8, queue.length) }, async () => {
          while (queue.length) {
            const leagueRow = queue.shift();
            let rosters = leagueRow?.rosters;
            if (!Array.isArray(rosters)) {
              const loaded = await fetchLeagueRostersSilent(
                leagueRow.league_id,
              ).catch(() => null);
              rosters = loaded?.rosters;
            }
            if (Array.isArray(rosters)) {
              scanned += 1;
              const myRoster = rosters.find(
                (roster) => String(roster.owner_id) === String(root.user_id),
              );
              if (myRoster && playerIds(myRoster).has(playerId)) count += 1;
            }
          }
        }),
      );
      if (active) setPortfolioExposure({ loading: false, count, scanned });
    };
    run();
    return () => {
      active = false;
    };
  }, [playerId, username, leagues.length, fetchLeagueRostersSilent]);

  useEffect(() => {
    let active = true;
    if (!playerId || !player?.team) return undefined;
    Promise.all([
      fetch(
        "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=500",
      ).then((response) => (response.ok ? response.json() : [])),
      fetch(
        "https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=24&limit=500",
      ).then((response) => (response.ok ? response.json() : [])),
      fetch("https://api.sleeper.app/v1/state/nfl").then((response) =>
        response.ok ? response.json() : {},
      ),
      fetch("/archive/index.json").then((response) =>
        response.ok ? response.json() : null,
      ),
    ])
      .then(async ([adds, drops, state, archiveIndex]) => {
        if (!active) return;
        setTrend({
          adds: n(
            adds.find((row) => String(row.player_id) === playerId)?.count,
          ),
          drops: n(
            drops.find((row) => String(row.player_id) === playerId)?.count,
          ),
        });
        setArchive(archiveIndex);
        const inSeason =
          String(state?.season_type || "").toLowerCase() === "regular" &&
          n(state?.week) > 1;
        const statSeason = inSeason
          ? n(state.season)
          : Math.max(2020, n(state.season || new Date().getFullYear()) - 1);
        const lastWeek = inSeason ? Math.min(18, n(state.week) - 1) : 18;
        const weeks = Array.from(
          { length: Math.min(5, lastWeek) },
          (_, index) => lastWeek - index,
        ).filter((week) => week > 0);
        Promise.all(
          weeks.map((week) =>
            fetch(
              `https://api.sleeper.app/v1/stats/nfl/regular/${statSeason}/${week}`,
            )
              .then((response) => (response.ok ? response.json() : {}))
              .catch(() => ({})),
          ),
        ).then((weekRows) => {
          if (!active) return;
          setProduction(
            weekRows
              .map((stats, index) => {
                const row = stats?.[playerId] || {};
                return {
                  week: weeks[index],
                  season: statSeason,
                  points: n(row.pts_ppr ?? row.pts_half_ppr ?? row.pts_std),
                  stats: row,
                };
              })
              .filter((row) => row.points > 0),
          );
        });
        const scheduleSeason = n(state?.season) || new Date().getFullYear();
        const startWeek = Math.max(1, Math.min(18, n(state?.week) || 1));
        Promise.all(
          [startWeek, Math.min(18, startWeek + 1)].map((week) =>
            fetch(`/api/nfl-scoreboard?season=${scheduleSeason}&week=${week}`)
              .then((response) =>
                response.ok ? response.json() : { games: [] },
              )
              .then((payload) =>
                (payload.games || []).map((game) => {
                  const indoor = Boolean(game.venue?.indoor);
                  const roofType = game.venue?.roofType;
                  const temperature =
                    game.weather?.temperature ?? game.weather?.highTemperature;
                  const wind = n(game.weather?.windSpeed);
                  const gusts = n(game.weather?.windGusts);
                  const rainChance = n(game.weather?.precipitationProbability);
                  const conditions = indoor
                    ? "Indoor venue"
                    : game.weather
                      ? [
                          game.weather.summary,
                          temperature != null
                            ? `${Math.round(temperature)}°F`
                            : "",
                          wind
                            ? `Wind ${Math.round(wind)} mph${gusts > wind + 3 ? `, gusts ${Math.round(gusts)}` : ""}`
                            : "",
                          rainChance
                            ? `${Math.round(rainChance)}% precipitation`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "Forecast pending";
                  const roofLabel =
                    roofType === "retractable"
                      ? "Retractable roof decision pending"
                      : roofType === "canopy"
                        ? "Covered field with open sides"
                        : "";
                  return {
                    ...game,
                    week,
                    status: [game.status, roofLabel, conditions]
                      .filter(Boolean)
                      .join(" · "),
                  };
                }),
              ),
          ),
        ).then((games) => {
          if (active)
            setSchedule(
              games.flat().filter((game) => game.teams?.includes(player.team)),
            );
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [playerId, player?.team]);

  useEffect(() => {
    if (tab !== "live" || !playerId) return undefined;
    let active = true;
    let timer;
    const load = async () => {
      const shared = window.__TFA_LIVE_PLAYER_STATS__;
      if (shared?.stats?.[playerId] && active) {
        setLiveGame({
          loading: false,
          season: shared.season,
          week: shared.week,
          seasonType: shared.seasonType,
          stats: shared.stats[playerId],
          updatedAt: shared.updatedAt || new Date(),
          error: "",
        });
      }
      if (active)
        setLiveGame((current) => ({
          ...current,
          loading: !current.updatedAt,
          error: "",
        }));
      try {
        const stateResponse = await fetch(
          "https://api.sleeper.app/v1/state/nfl",
          { cache: "no-store" },
        );
        if (!stateResponse.ok)
          throw new Error(`NFL state HTTP ${stateResponse.status}`);
        const state = await stateResponse.json();
        const season = n(state?.season) || new Date().getFullYear();
        const week = Math.max(1, n(state?.week) || 1);
        const seasonType = String(state?.season_type || "regular")
          .toLowerCase()
          .startsWith("pre")
          ? "pre"
          : "regular";
        const statsResponse = await fetch(
          `https://api.sleeper.app/v1/stats/nfl/${seasonType}/${season}/${week}`,
          { cache: "no-store" },
        );
        if (!statsResponse.ok)
          throw new Error(`Live stats HTTP ${statsResponse.status}`);
        const payload = await statsResponse.json();
        window.__TFA_LIVE_PLAYER_STATS__ = {
          season,
          week,
          seasonType,
          stats: payload || {},
          updatedAt: new Date(),
        };
        if (active)
          setLiveGame({
            loading: false,
            season,
            week,
            seasonType,
            stats: payload?.[playerId] || null,
            updatedAt: new Date(),
            error: "",
          });
      } catch (error) {
        if (active)
          setLiveGame((current) => ({
            ...current,
            loading: false,
            error: error?.message || "Live stats unavailable",
          }));
      }
      if (active) timer = window.setTimeout(load, 15000);
    };
    load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tab, playerId]);

  useEffect(() => {
    let active = true;
    if (tab !== "market" || !activeLeague || !playerId) return undefined;
    setMarketLoading(true);
    Promise.all(
      Array.from({ length: 18 }, (_, index) => index + 1).map((week) =>
        fetch(
          `https://api.sleeper.app/v1/league/${activeLeague}/transactions/${week}`,
        )
          .then((response) => (response.ok ? response.json() : []))
          .catch(() => []),
      ),
    )
      .then((weeks) => {
        if (!active) return;
        setTransactions(
          weeks
            .flat()
            .filter(
              (tx) =>
                tx.type === "trade" &&
                Object.values(tx.adds || {}).some(
                  (id) => String(id) === playerId,
                ),
            ),
        );
      })
      .finally(() => {
        if (active) setMarketLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, activeLeague, playerId]);

  useEffect(() => {
    let active = true;
    if (tab !== "sources" || !playerId || !archive?.archives?.length)
      return undefined;
    setHistoryLoading(true);
    const latestEntry = archive.archives[0];
    const targetDate = new Date(`${latestEntry.date}T00:00:00Z`);
    targetDate.setUTCDate(targetDate.getUTCDate() - 7);
    const weekAgoEntry =
      archive.archives.find(
        (entry) => new Date(`${entry.date}T00:00:00Z`) <= targetDate,
      ) || archive.archives.at(-1);
    const snapshots = [latestEntry, weekAgoEntry].filter(Boolean);
    const readSnapshot = async (entry) => {
      const manifest = await fetch(`/archive/${entry.manifest}`).then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("Archive manifest unavailable")),
      );
      const season = n(entry.season) || new Date().getFullYear();
      const files = Object.fromEntries(
        (manifest.files || []).map((file) => [file.source, file.file]),
      );
      const amounts = await Promise.all(
        DEFAULT_SOURCES.map(async (source) => {
          const archiveFile = archiveSourceFile[source.key];
          const sourceName = typeof archiveFile === "function" ? archiveFile(season) : archiveFile;
          const file = files[sourceName];
          if (!file) return [source.key, 0];
          const payload = await readArchivedJson(`/archive/${file}`).catch(() => null);
          return [
            source.key,
            archivedSourceAmount(payload, source.key, {
              name,
              position: player?.position,
              format,
              qbType,
            }),
          ];
        }),
      );
      return { date: entry.date, amounts: Object.fromEntries(amounts) };
    };
    Promise.all(snapshots.map(readSnapshot))
      .then(([latest, earliest]) => {
        if (!active || !latest || !earliest) return;
        setSourceMovement(
          Object.fromEntries(
            DEFAULT_SOURCES.map((source) => {
              const before = n(earliest.amounts[source.key]);
              const after = n(latest.amounts[source.key]);
              return [
                source.key,
                before || after
                  ? {
                      delta: after - before,
                      detail: `${earliest.date} → ${latest.date}`,
                    }
                  : null,
              ];
            }).filter(([, movement]) => movement),
          ),
        );
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, playerId, archive, format, qbType, name, player?.position]);

  const users = leagueData?.users || league?.users || [];
  const rosters = leagueData?.rosters || league?.rosters || [];
  const ownerRoster = rosters.find((roster) => playerIds(roster).has(playerId));
  const owner = users.find(
    (user) => String(user.user_id) === String(ownerRoster?.owner_id),
  );
  const myUser = users.find(
    (user) =>
      norm(user.display_name) === norm(username) ||
      norm(user.username) === norm(username),
  );
  const myRoster = rosters.find(
    (roster) => String(roster.owner_id) === String(myUser?.user_id),
  );
  const myPositionCount = myRoster
    ? [...playerIds(myRoster)].filter(
        (id) =>
          positionFamily(players?.[id]?.position) ===
          positionFamily(player?.position),
      ).length
    : 0;
  const requiredAtPosition = (league?.roster_positions || []).filter(
    (position) => positionFamily(position) === positionFamily(player?.position),
  ).length;
  const need = Math.max(0, requiredAtPosition - myPositionCount);
  const age = n(player?.age);
  const timeline =
    age && age <= 25
      ? "Rebuilder-friendly asset"
      : age >= 29
        ? "Contender-window asset"
        : "Flexible competitive timeline";
  const guidance = ownerRoster
    ? String(ownerRoster.owner_id) === String(myRoster?.owner_id)
      ? "Hold / lineup decision"
      : "Trade target"
    : need > 0
      ? "Priority add"
      : "Watch / depth add";
  const productionAverage = production.length
    ? production.reduce((sum, row) => sum + row.points, 0) / production.length
    : 0;
  const projectionConsensus = consensus(projectionRows);
  const pace = projectionConsensus ? projectionConsensus / 17 : 0;
  const archiveDates = archive?.archives || [];
  const historyDelta = (key) =>
    history.length > 1 ? n(history.at(-1)?.[key]) - n(history[0]?.[key]) : 0;
  const maxHistoryValue = Math.max(1, ...history.map((row) => row.value));
  const maxHistoryProjection = Math.max(
    1,
    ...history.map((row) => row.projection),
  );
  const liveStats = liveGame.stats || {};
  const liveStatRows = Object.entries(LIVE_STAT_LABELS)
    .map(([key, label]) => ({ key, label, value: liveStats[key] }))
    .filter(
      (row) => Number.isFinite(Number(row.value)) && Number(row.value) !== 0,
    );
  const leaguePoints = league?.scoring_settings
    ? scoreSleeperStats(liveStats, league.scoring_settings, player?.position)
    : null;
  const scoringCoverage = league?.scoring_settings
    ? sleeperScoringCoverage(
        liveStats,
        league.scoring_settings,
        player?.position,
      )
    : null;
  const sleeperPoints =
    liveStats.pts_ppr ?? liveStats.pts_half_ppr ?? liveStats.pts_std;

  if (!playerId || !player) return null;
  return (
    <div
      className="fixed inset-0 z-[110] flex h-[100dvh] max-h-[100dvh] items-end justify-center overflow-hidden overscroll-none bg-slate-950/85 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPlayerId("");
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Player intelligence for ${name}`}
        className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border border-white/12 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.1),transparent_26%),linear-gradient(160deg,#07101f,#020617_58%)] shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-4xl sm:rounded-[30px]"
      >
        <div className="z-20 shrink-0 border-b border-white/10 bg-slate-950/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:pt-0">
          <div className="flex items-center gap-3 px-3 pb-2 pt-3 sm:p-4">
            <AvatarImage
              inspectable={false}
              name={name}
              playerId={playerId}
              size={48}
              className="shrink-0 rounded-2xl ring-1 ring-white/10"
              alt=""
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-black sm:text-2xl">
                {name}
              </div>
              <div className="line-clamp-2 text-[11px] leading-4 text-white/38 sm:text-xs">
                {player.position || "—"} · {player.team || "FA"} ·{" "}
                {age ? `Age ${age}` : "Age unavailable"} · {format} ·{" "}
                {qbType === "sf" ? "Superflex" : "1QB"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPlayerId("")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-xl text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              aria-label="Close player intelligence"
            >
              ×
            </button>
          </div>
          <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain px-3 pb-3 [-webkit-overflow-scrolling:touch]">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`min-h-11 shrink-0 snap-start rounded-xl px-3 py-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${tab === key ? "bg-cyan-300/12 text-cyan-100 ring-1 ring-cyan-300/20" : "text-white/38 hover:bg-white/[0.05] hover:text-white/70"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 touch-pan-y space-y-4 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 [-webkit-overflow-scrolling:touch] sm:space-y-5 sm:p-5">
          {["overview", "live"].includes(tab) ? (
            <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3">
              <label
                htmlFor="player-modal-league"
                className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-100/50"
              >
                League context
              </label>
              <select
                id="player-modal-league"
                value={activeLeague || ""}
                onChange={(event) =>
                  setActiveLeague(event.target.value || null)
                }
                className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-sm text-white"
              >
                <option value="">Select a league</option>
                {leagues.map((leagueRow) => (
                  <option key={leagueRow.league_id} value={leagueRow.league_id}>
                    {leagueRow.name || leagueRow.league_id}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[10px] leading-4 text-white/30">
                Controls ownership, roster fit, and exact live scoring
                throughout this player window.
              </p>
              <details className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3"><summary className="cursor-pointer text-[10px] font-black uppercase tracking-[.15em] text-white/55">Value / projection source</summary><select value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} className="mt-2 min-h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-xs text-white">{DEFAULT_SOURCES.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select><p className="mt-2 text-[10px] leading-4 text-white/30">This source controls the values or projections used throughout this player drawer.</p></details>
            </div>
          ) : null}
          {tab === "overview" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <Metric
                  label="Value consensus"
                  value={
                    consensus(valueRows)
                      ? Math.round(consensus(valueRows)).toLocaleString()
                      : "—"
                  }
                  detail={`${valueRows.filter((row) => row.amount > 0).length} reporting sources`}
                />
                <Metric
                  label="Season projection"
                  value={
                    projectionConsensus
                      ? `${projectionConsensus.toFixed(1)} pts`
                      : "—"
                  }
                  detail="Generic PPR consensus"
                  tone="emerald"
                />
                <Metric
                  label="24h movement"
                  value={
                    trend.adds || trend.drops
                      ? `+${trend.adds} / -${trend.drops}`
                      : "Quiet"
                  }
                  detail="Sleeper adds and drops"
                  tone="violet"
                />
                <Metric
                  label="Action lens"
                  value={guidance}
                  detail={timeline}
                  tone="amber"
                />
                <Metric
                  label="Depth chart"
                  value={depthStatus}
                  detail={player?.team || "No current team"}
                  tone="violet"
                />
                <Metric
                  label="Injury status"
                  value={injuryStatus || "Clear"}
                  detail={
                    player?.injury_notes ||
                    (playerStatus && playerStatus.toLowerCase() !== "active"
                      ? playerStatus
                      : "No active injury designation")
                  }
                  tone={injuryStatus ? "amber" : "emerald"}
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-cyan-100/45">
                    Selected league
                  </div>
                  <div className="mt-2 text-lg font-black">
                    {league?.name || "Choose a league for context"}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/42">
                    {leagueLoading
                      ? "Loading roster ownership…"
                      : !league
                        ? "League-aware ownership, fit, trades, and availability appear after a league is selected."
                        : ownerRoster
                          ? `Rostered by ${displayUser(owner)}. ${myRoster ? `${myPositionCount} ${positionFamily(player.position)}s are currently on your roster.` : "Your roster could not be matched to the signed-in username."}`
                          : `Available in this league. ${need > 0 ? `Your roster is below the league's starting requirement at ${positionFamily(player.position)}.` : "This profiles as depth or upside rather than an immediate starting-slot need."}`}
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-300/10 bg-violet-300/[0.035] p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-100/45">
                    Portfolio exposure
                  </div>
                  <div className="mt-2 text-lg font-black">
                    {portfolioExposure.loading
                      ? `Scanning ${leagues.length} leagues…`
                      : `Rostered in ${portfolioExposure.count} league${portfolioExposure.count === 1 ? "" : "s"}`}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/42">
                    {portfolioExposure.loading
                      ? "Loading ownership across your attached Sleeper portfolio."
                      : `${portfolioExposure.scanned ? Math.round((portfolioExposure.count / portfolioExposure.scanned) * 100) : 0}% exposure across ${portfolioExposure.scanned || leagues.length} scanned leagues.`}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-violet-300/10 bg-gradient-to-br from-violet-300/[0.07] to-cyan-300/[0.025] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-100/55">
                      Top Ballsville manager exposure
                    </div>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      Exposure is each manager’s share of unique Ballsville leagues rostering this player. Leagues shows that manager’s count and the player’s Ballsville total.
                    </p>
                  </div>
                  <span className="rounded-full border border-violet-200/10 bg-violet-200/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-violet-100/55">
                    Top 5
                  </span>
                </div>
                {ballsvilleDrafters.length ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
                    <div className="grid grid-cols-[minmax(0,1fr)_72px_68px] gap-2 border-b border-white/[0.06] px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/30"><span>Manager</span><span className="text-right">Exposure</span><span className="text-right">Leagues</span></div>
                    {[...ballsvilleDrafters].sort((left, right) => Number(right.count || 0) - Number(left.count || 0)).slice(0, 5).map((manager, index) => (
                      <div key={`${manager.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_72px_68px] items-center gap-2 border-b border-white/[0.05] px-3 py-2.5 last:border-0">
                        <span className="truncate text-xs font-semibold text-white/75">{manager.name}</span>
                        <span className="text-right text-xs font-black text-violet-200">{Number(manager.percentage || 0).toFixed(1)}%</span>
                        <span className="text-right text-xs font-bold text-white/55">{manager.count}/{manager.totalLeagues || manager.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-white/35">No published Ballsville roster exposure is available for this player yet.</p>
                )}
              </div>
            </>
          ) : null}
          {tab === "sources" ? (
            <>
              <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] p-3 text-xs leading-5 text-white/45">
                Publisher values are displayed on their original scales. Arsenal
                values are a separate, percentile-normalized market consensus,
                so its row is not a raw average of the rows above it. Season
                projections share a comparable points scale.
              </div>
              <SourceTable
                title="Player values"
                rows={valueRows}
                currentSource={sourceKey}
                movement={sourceMovement}
                rawScale
              />
              <SourceTable
                title="Season projections"
                rows={projectionRows}
                currentSource={sourceKey}
                movement={sourceMovement}
                suffix=" pts"
              />
              {projectionSourcesLoading ? (
                <p className="-mt-1 text-[10px] text-cyan-100/55">
                  Loading current publisher projections…
                </p>
              ) : null}
            </>
          ) : null}
          {tab === "league" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric
                  label="Availability"
                  value={
                    !league
                      ? "Select league"
                      : ownerRoster
                        ? "Rostered"
                        : "Available"
                  }
                  detail={ownerRoster ? displayUser(owner) : league?.name}
                />
                <Metric
                  label="Your position room"
                  value={myRoster ? myPositionCount : "—"}
                  detail={`${positionFamily(player.position)} players`}
                />
                <Metric
                  label="Required starters"
                  value={league ? requiredAtPosition : "—"}
                  detail="Exact-position league slots"
                />
                <Metric
                  label="Roster fit"
                  value={need > 0 ? "Direct need" : "Depth / upgrade"}
                  detail={timeline}
                  tone="emerald"
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <h3 className="font-black">Decision explanation</h3>
                <p className="mt-2 text-sm leading-6 text-white/48">
                  {!league
                    ? "Select a league in one of the league-aware tools to activate this analysis."
                    : !myRoster
                      ? "The signed-in Sleeper username was not matched to an owner in this league, so personal roster-need claims are withheld."
                      : ownerRoster &&
                          String(ownerRoster.owner_id) ===
                            String(myRoster.owner_id)
                        ? `${name} is already on your roster. Compare the projection pace and recent production before treating the source value as a lineup recommendation.`
                        : ownerRoster
                          ? `${displayUser(owner)} currently controls ${name}. ${need > 0 ? `Your roster has a direct ${positionFamily(player.position)} need, making this a contextual trade target.` : "This would be an upgrade or depth pursuit rather than filling an empty positional requirement."}`
                          : `${name} is currently unrostered. ${need > 0 ? "The player fills a direct positional need and should receive priority waiver consideration." : "The player is an upside/depth decision; roster limits and the weakest player you would drop matter more than raw availability."}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`/trade?league=${encodeURIComponent(activeLeague || "")}`}
                    className="rounded-xl bg-violet-300/10 px-3 py-2 text-xs font-semibold text-violet-100"
                  >
                    Open Trade Analyzer →
                  </a>
                  <a
                    href={`/player-availability?league=${encodeURIComponent(activeLeague || "")}`}
                    className="rounded-xl bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100"
                  >
                    Open Availability →
                  </a>
                  <a
                    href={`/draft-helper?league=${encodeURIComponent(activeLeague || "")}`}
                    className="rounded-xl bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100"
                  >
                    Draft Command Center →
                  </a>
                </div>
              </div>
            </>
          ) : null}
          {tab === "live" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric
                  label="NFL week"
                  value={
                    liveGame.week
                      ? `${liveGame.season} · Week ${liveGame.week}`
                      : "—"
                  }
                  detail={
                    liveGame.seasonType === "pre"
                      ? "Preseason"
                      : "Regular season"
                  }
                />
                <Metric
                  label="Sleeper points"
                  value={
                    Number.isFinite(Number(sleeperPoints))
                      ? Number(sleeperPoints).toFixed(1)
                      : "—"
                  }
                  detail="Published live-feed total"
                />
                <Metric
                  label="League points"
                  value={
                    leaguePoints == null
                      ? "Select league"
                      : leaguePoints.toFixed(1)
                  }
                  detail={league?.name || "Exact league scoring"}
                  tone="emerald"
                />
                <Metric
                  label="Last refresh"
                  value={
                    liveGame.updatedAt
                      ? liveGame.updatedAt.toLocaleTimeString()
                      : liveGame.loading
                        ? "Loading…"
                        : "—"
                  }
                  detail="Every 15 seconds"
                  tone="violet"
                />
              </div>
              {liveGame.error ? (
                <div className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-xs text-rose-100">
                  {liveGame.error}
                </div>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <h3 className="font-black">Current game stats</h3>
                  <p className="mt-1 text-[10px] text-white/30">
                    Current-week statistics reported by Sleeper.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {liveStatRows.map((row) => (
                      <div key={row.key} className="rounded-xl bg-black/15 p-3">
                        <div className="text-[9px] text-white/32">
                          {row.label}
                        </div>
                        <div className="mt-1 text-lg font-black">
                          {Number(row.value).toLocaleString()}
                        </div>
                      </div>
                    ))}
                    {!liveGame.loading && !liveStatRows.length ? (
                      <div className="col-span-full p-5 text-xs text-white/35">
                        No current-week box-score stats have been posted for
                        this player yet.
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.035] p-4">
                  <h3 className="font-black text-emerald-100">
                    League scoring calculation
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-white/45">
                    {!league
                      ? "Select a league to calculate these stats using its exact Sleeper scoring settings."
                      : `Calculated from ${league.name}. ${scoringCoverage?.percentage || 0}% of active scoring categories are represented.`}
                  </p>
                  {scoringCoverage?.unsupported?.length ? (
                    <p className="mt-3 text-[10px] text-amber-100/70">
                      Potentially incomplete categories:{" "}
                      {scoringCoverage.unsupported.slice(0, 10).join(", ")}.
                    </p>
                  ) : null}
                  <p className="mt-3 text-[10px] text-white/25">
                    Sleeper’s matchup total remains authoritative.
                  </p>
                </div>
              </div>
            </>
          ) : null}
          {tab === "production" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric
                  label="Recent PPR average"
                  value={production.length ? productionAverage.toFixed(1) : "—"}
                  detail={`${production.length} scored games`}
                />
                <Metric
                  label="Season pace"
                  value={pace ? `${pace.toFixed(1)}/wk` : "—"}
                  detail="Season projection ÷ 17, not weekly accuracy"
                />
                <Metric
                  label="Pace difference"
                  value={
                    production.length && pace
                      ? `${productionAverage - pace >= 0 ? "+" : ""}${(productionAverage - pace).toFixed(1)}`
                      : "—"
                  }
                  detail="Recent production vs projection pace"
                  tone="amber"
                />
                <Metric
                  label="Volatility"
                  value={
                    production.length > 1
                      ? (
                          Math.max(...production.map((row) => row.points)) -
                          Math.min(...production.map((row) => row.points))
                        ).toFixed(1)
                      : "—"
                  }
                  detail="Recent high-to-low spread"
                  tone="violet"
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <h3 className="font-black">Recent game log</h3>
                  <div className="mt-3 space-y-2">
                    {production.length ? (
                      production.map((row) => (
                        <div
                          key={`${row.season}-${row.week}`}
                          className="flex items-center justify-between rounded-xl bg-black/15 px-3 py-2 text-xs"
                        >
                          <span>
                            {row.season} · Week {row.week}
                          </span>
                          <b className="text-cyan-100">
                            {row.points.toFixed(1)} PPR
                          </b>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs leading-5 text-white/35">
                        No recent Sleeper fantasy-point games were available.
                        Offseason and inactive-player gaps are expected.
                      </p>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <h3 className="font-black">NFL schedule</h3>
                  <div className="mt-3 space-y-2">
                    {schedule.length ? (
                      schedule.map((game) => (
                        <div
                          key={game.id}
                          className="rounded-xl bg-black/15 p-3 text-xs"
                        >
                          <div className="font-semibold">
                            Week {game.week} · {game.name}
                          </div>
                          <div className="mt-1 text-white/35">
                            {new Date(game.date).toLocaleString()} ·{" "}
                            {game.status}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs leading-5 text-white/35">
                        No upcoming game was found in the current two-week
                        window.
                      </p>
                    )}
                  </div>
                  <p className="mt-3 text-[10px] leading-4 text-white/25">
                    Kickoff forecasts appear within Open-Meteo’s 16-day window.
                    Retractable-roof conditions remain provisional until the
                    venue confirms whether the roof will be open.
                  </p>
                </div>
              </div>
            </>
          ) : null}
          {tab === "market" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric
                  label="24h adds"
                  value={trend.adds.toLocaleString()}
                  detail="Sleeper platform trend"
                  tone="emerald"
                />
                <Metric
                  label="24h drops"
                  value={trend.drops.toLocaleString()}
                  detail="Sleeper platform trend"
                  tone="amber"
                />
                <Metric
                  label="Selected-league trades"
                  value={marketLoading ? "…" : transactions.length}
                  detail="Observable current league history"
                />
                <Metric
                  label="Timeline"
                  value={timeline.replace(" asset", "")}
                  detail="Age-based roster-direction fit"
                  tone="violet"
                />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <h3 className="font-black">Trade occurrences</h3>
                <div className="mt-3 space-y-2">
                  {marketLoading ? (
                    <p className="text-xs text-white/35">
                      Reviewing selected-league transactions…
                    </p>
                  ) : transactions.length ? (
                    transactions.map((tx) => (
                      <div
                        key={tx.transaction_id}
                        className="rounded-xl bg-black/15 p-3 text-xs"
                      >
                        <div className="font-semibold">
                          Trade · Week {tx.leg || "—"}
                        </div>
                        <div className="mt-1 text-white/35">
                          {new Date(n(tx.created)).toLocaleDateString()} ·{" "}
                          {Object.keys(tx.roster_ids || {}).length ||
                            tx.roster_ids?.length ||
                            "Multiple"}{" "}
                          managers involved
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs leading-5 text-white/35">
                      {league
                        ? "No selected-league trade containing this player was found."
                        : "Select a league to review its player-specific trades."}
                    </p>
                  )}
                </div>
                <p className="mt-3 text-[10px] leading-4 text-white/25">
                  This is selected-league evidence, not a platform-wide trade
                  database.
                </p>
              </div>
            </>
          ) : null}
          {tab === "research" ? (
            <>
              <PlayerResearchPanel player={player} name={name} expanded />
              {false ? <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-black">Value and projection history</h3>
                    <p className="text-[10px] text-white/30">
                      The Fantasy Arsenal consensus · latest 14 archive days
                    </p>
                  </div>
                  <span className="text-[10px] text-white/30">
                    {archiveDates.length} snapshot day
                    {archiveDates.length === 1 ? "" : "s"}
                  </span>
                </div>
                {historyLoading ? (
                  <p className="mt-3 text-xs text-white/35">
                    Opening compressed history…
                  </p>
                ) : history.length < 2 ? (
                  <p className="mt-3 text-xs leading-5 text-white/42">
                    Tracking started July 2026. A trend requires at least two
                    daily snapshots, so movement will appear automatically after
                    another successful update.
                  </p>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Metric
                        label={`${format} value change`}
                        value={`${historyDelta("value") >= 0 ? "+" : ""}${Math.round(historyDelta("value")).toLocaleString()}`}
                        detail={`${history[0].date} to ${history.at(-1).date}`}
                        tone={historyDelta("value") >= 0 ? "emerald" : "amber"}
                      />
                      <Metric
                        label="Projection change"
                        value={`${historyDelta("projection") >= 0 ? "+" : ""}${historyDelta("projection").toFixed(1)} pts`}
                        detail="Season PPR consensus"
                        tone={
                          historyDelta("projection") >= 0 ? "emerald" : "amber"
                        }
                      />
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <div
                        className="flex min-w-[420px] items-end gap-2 border-b border-white/10 pb-2"
                        style={{ height: 150 }}
                      >
                        {history.map((row) => (
                          <div
                            key={row.date}
                            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                            title={`${row.date}: value ${Math.round(row.value)}, projection ${row.projection.toFixed(1)}`}
                          >
                            <div
                              className="w-full rounded-t bg-violet-300/55"
                              style={{
                                height: `${Math.max(3, (row.projection / maxHistoryProjection) * 62)}px`,
                              }}
                            />
                            <div
                              className="w-full rounded-t bg-cyan-300/60"
                              style={{
                                height: `${Math.max(3, (row.value / maxHistoryValue) * 62)}px`,
                              }}
                            />
                            <span className="rotate-[-35deg] whitespace-nowrap text-[8px] text-white/25">
                              {row.date.slice(5)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-4 text-[9px] text-white/35">
                        <span>
                          <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-300/60" />
                          Value
                        </span>
                        <span>
                          <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-300/55" />
                          Projection
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div> : null}
              <div className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-4">
                <h3 className="font-black text-amber-100">Data boundaries</h3>
                <p className="mt-2 text-xs leading-5 text-white/40">
                  Projection totals are generic PPR unless a source supplies a
                  full projected stat line. Exact custom-scoring claims are
                  intentionally withheld when the inputs cannot support them.
                  Recent production uses Sleeper fantasy points.
                </p>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
