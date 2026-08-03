"use client";

import { useEffect, useMemo, useState } from "react";
import {
  leagueScoringLabel,
  scoreSleeperStats,
  sleeperScoringCoverage,
} from "../../lib/sleeperScoring";

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const POSITION_STATS = {
  QB: [
    ["Attempts", "pass_att"],
    ["Completions", "pass_cmp"],
    ["Pass yards", "pass_yd"],
    ["Pass TD", "pass_td"],
    ["Interceptions", "pass_int"],
    ["Rush attempts", "rush_att"],
    ["Rush yards", "rush_yd"],
    ["Rush TD", "rush_td"],
  ],
  RB: [
    ["Carries", "rush_att"],
    ["Rush yards", "rush_yd"],
    ["Rush TD", "rush_td"],
    ["Targets", "rec_tgt"],
    ["Receptions", "rec"],
    ["Receiving yards", "rec_yd"],
    ["Receiving TD", "rec_td"],
    ["Fumbles lost", "fum_lost"],
  ],
  WR: [
    ["Targets", "rec_tgt"],
    ["Receptions", "rec"],
    ["Receiving yards", "rec_yd"],
    ["Receiving TD", "rec_td"],
    ["Rush attempts", "rush_att"],
    ["Rush yards", "rush_yd"],
    ["Rush TD", "rush_td"],
    ["Fumbles lost", "fum_lost"],
  ],
  TE: [
    ["Targets", "rec_tgt"],
    ["Receptions", "rec"],
    ["Receiving yards", "rec_yd"],
    ["Receiving TD", "rec_td"],
    ["Rush attempts", "rush_att"],
    ["Rush yards", "rush_yd"],
    ["Rush TD", "rush_td"],
    ["Fumbles lost", "fum_lost"],
  ],
  K: [
    ["Field goals", "fgm"],
    ["FG attempts", "fga"],
    ["Extra points", "xpm"],
    ["XP attempts", "xpa"],
    ["Kicking points", "kick_pts"],
  ],
};

function Card({ children, className = "" }) {
  return (
    <section
      className={`min-w-0 max-w-full rounded-[24px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 sm:rounded-[28px] ${className}`}
    >
      {children}
    </section>
  );
}

function Kpi({ label, value, detail, tone = "cyan" }) {
  const tones = {
    cyan: "text-cyan-100",
    emerald: "text-emerald-100",
    violet: "text-violet-100",
    amber: "text-amber-100",
    rose: "text-rose-100",
  };
  return (
    <div className="min-w-0 max-w-full rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 sm:p-4">
      <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/30">
        {label}
      </div>
      <div
        className={`mt-1 break-words text-xl font-black leading-tight sm:text-2xl ${tones[tone] || tones.cyan}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] leading-4 text-white/35">{detail}</div>
    </div>
  );
}

function Filter({ label, value, onChange, children, preference }) {
  return (
    <label className="min-w-0">
      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.15em] text-white/30">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-account-preference={preference}
        className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
      >
        {children}
      </select>
    </label>
  );
}

function formatStat(key, value) {
  if (!Number.isFinite(Number(value))) return "—";
  const places =
    key.includes("yd") || key.includes("att") || key === "rec" ? 1 : 2;
  return number(value).toLocaleString(undefined, {
    maximumFractionDigits: places,
  });
}

function weeklyLine(position, stats = {}) {
  if (position === "QB")
    return `${number(stats.pass_yd).toFixed(0)} pass yd · ${number(stats.pass_td).toFixed(1)} pass TD · ${number(stats.rush_yd).toFixed(0)} rush yd`;
  if (position === "RB")
    return `${number(stats.rush_att).toFixed(1)} car · ${number(stats.rush_yd).toFixed(0)} rush yd · ${number(stats.rec_tgt).toFixed(1)} tgt`;
  if (position === "WR" || position === "TE")
    return `${number(stats.rec_tgt).toFixed(1)} tgt · ${number(stats.rec).toFixed(1)} rec · ${number(stats.rec_yd).toFixed(0)} yd`;
  return `${number(stats.kick_pts).toFixed(1)} kick pts · ${number(stats.fgm).toFixed(1)} FG`;
}

function recommendedWeek(model) {
  const now = Date.now();
  const scheduled = (model?.players || [])
    .flatMap((player) => player.weeks || [])
    .filter(
      (row) =>
        !row.bye && !row.completed && Number.isFinite(Date.parse(row.kickoff)),
    )
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  return (
    scheduled.find((row) => Date.parse(row.kickoff) >= now)?.week ||
    scheduled[0]?.week ||
    1
  );
}

function customWeekProjection(player, forecast, scoringSettings, lens) {
  if (!forecast || !scoringSettings) return 0;
  const expected = scoreSleeperStats(
    forecast.stat_line || {},
    scoringSettings,
    player?.position,
  );
  return forecast.completed || lens === "safe_expected"
    ? expected
    : expected * number(forecast.risky_factor || 1);
}

function projectionRow(player, week, scoring, lens, scoringSettings = null) {
  if (!player) return null;
  const forecast = player.weeks?.find((row) => row.week === week);
  const customScoring = scoring === "league" && scoringSettings;
  const expectedProjection = customScoring
    ? customWeekProjection(player, forecast, scoringSettings, "safe_expected")
    : number(forecast?.projections?.[scoring]);
  const projection = customScoring
    ? customWeekProjection(player, forecast, scoringSettings, lens)
    : forecast?.completed
      ? expectedProjection
      : number(
          forecast?.projection_lenses?.[scoring]?.[lens] ?? expectedProjection,
        );
  const customWeeks = customScoring
    ? (player.weeks || []).filter((row) => !row.bye).map((row) => ({
        completed: Boolean(row.completed),
        points: customWeekProjection(player, row, scoringSettings, lens),
      }))
    : [];
  const season = customScoring
    ? {
        season_points: customWeeks.reduce((sum, row) => sum + row.points, 0),
        remaining_points: customWeeks.filter((row) => !row.completed).reduce((sum, row) => sum + row.points, 0),
        custom: true,
      }
    : player.scoring?.[scoring] || {};
  const remainingGames = customScoring
    ? customWeeks.filter((row) => !row.completed).length || 1
    : number(player.remaining_games) || 17;
  const baseline = forecast?.completed
    ? projection
    : number(season.remaining_points ?? season.season_points) / remainingGames;
  return {
    ...player,
    forecast,
    projection,
    baseline,
    change: projection - baseline,
    season,
  };
}

export default function StatProjectionLab({
  model,
  leagues = [],
  scoringLeagueId = "",
  onScoringLeagueChange,
}) {
  const [week, setWeek] = useState(() => recommendedWeek(model));
  const [scoring, setScoring] = useState("ppr");
  const [lens, setLens] = useState("safe_expected");
  const [position, setPosition] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("projection");
  const [selectedName, setSelectedName] = useState("");
  const [visibleCount, setVisibleCount] = useState(40);
  const [accuracy, setAccuracy] = useState(null);
  const [accuracyCohort, setAccuracyCohort] = useState("projected_5_plus");
  const [view, setView] = useState("player");
  const selectedScoringLeague = leagues.find(
    (league) => String(league.league_id) === String(scoringLeagueId),
  ) || null;
  const leagueScoring = selectedScoringLeague?.scoring_settings || null;
  const scoringLabel = scoring === "league"
    ? leagueScoringLabel(selectedScoringLeague)
    : scoring.toUpperCase();
  const teams = useMemo(
    () =>
      [
        ...new Set(
          (model?.players || []).map((player) => player.team).filter(Boolean),
        ),
      ].sort(),
    [model],
  );

  const rows = useMemo(
    () =>
      (model?.players || [])
        .map((player) =>
          projectionRow(player, week, scoring, lens, leagueScoring),
        )
        .filter((player) => !player.forecast?.bye && player.projection > 0)
        .filter((player) => position === "ALL" || player.position === position)
        .filter((player) => team === "ALL" || player.team === team)
        .filter(
          (player) =>
            !query || normalize(player.name).includes(normalize(query)),
        )
        .sort((a, b) =>
          sort === "confidence"
            ? b.confidence - a.confidence
            : sort === "matchup"
              ? b.change - a.change
              : sort === "disagreement"
                ? b.disagreement - a.disagreement
                : b.projection - a.projection,
        ),
    [leagueScoring, lens, model, position, query, scoring, sort, team, week],
  );
  useEffect(() => setWeek(recommendedWeek(model)), [model]);
  useEffect(
    () => setVisibleCount(40),
    [lens, position, query, scoring, sort, team, week],
  );
  useEffect(() => {
    let live = true;
    fetch(`/stats/projections/${model?.season || 2026}/accuracy.json`, {
      cache: "no-cache",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (live) setAccuracy(payload);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [model?.season]);
  useEffect(() => {
    if (!rows.length) return;
    if (!selectedName || !rows.some((row) => row.name === selectedName))
      setSelectedName(rows[0].name);
  }, [rows, selectedName]);
  const pinnedPlayer = (model?.players || []).find(
    (player) => player.name === selectedName,
  );
  const selected =
    projectionRow(pinnedPlayer, week, scoring, lens, leagueScoring) ||
    rows[0] ||
    null;
  const seasonSeries = selected
    ? (selected.weeks || [])
        .filter((row) => !row.bye)
        .map((row) => ({
          ...row,
          projection:
            scoring === "league"
              ? customWeekProjection(selected, row, leagueScoring, lens)
              : row.completed
                ? number(row.projections?.[scoring])
                : number(
                    row.projection_lenses?.[scoring]?.[lens] ??
                      row.projections?.[scoring],
                  ),
        }))
    : [];
  const maxProjection = Math.max(
    1,
    ...seasonSeries.map((row) => row.projection),
  );
  const selectedWeekIndex = seasonSeries.findIndex((row) => row.week === week);
  const selectWeek = (value) => setWeek(number(value));
  const moveSelectedWeek = (direction) => {
    if (!seasonSeries.length) return;
    const current = selectedWeekIndex >= 0 ? selectedWeekIndex : 0;
    const next = Math.max(
      0,
      Math.min(seasonSeries.length - 1, current + direction),
    );
    selectWeek(seasonSeries[next].week);
  };

  if (!model?.players?.length)
    return (
      <Card className="p-8 text-center">
        <h2 className="text-xl font-black">Projection model unavailable</h2>
        <p className="mt-2 text-sm text-white/40">
          Run npm run update:stat-model after the current Arsenal projections
          are generated.
        </p>
      </Card>
    );

  const coverage = model.feature_coverage || {};
  const weeklyStats = selected?.forecast?.stat_line || {};
  const seasonStats =
    selected?.season_outlook_stat_line || selected?.projected_stat_line || {};
  const statRows = POSITION_STATS[selected?.position] || [];
  const matchupChange = selected?.forecast?.matchup_factor
    ? (number(selected.forecast.matchup_factor) - 1) * 100
    : 0;
  const roleFactor =
    number(selected?.role_calibration?.consensus_scale_factor) || 1;
  const independentSignalWeight =
    number(selected?.role_calibration?.independent_stat_signal_weight) * 100;
  const regressionBlend = number(selected?.regression?.blend) * 100;
  const anchorAvailable =
    scoring !== "league" &&
    selected?.season?.consensus_anchor != null &&
    selected?.season?.variance_from_anchor != null;
  const anchorVariance = anchorAvailable
    ? number(selected?.season?.variance_from_anchor)
    : null;
  const personalHistory = selected?.forecast?.personal_history || {};
  const outcomeProfile = selected?.forecast?.outcome_profile || {};
  const learnedAdjustment = selected?.forecast?.learned_adjustment || {};
  const advancedSignals = learnedAdjustment?.signals || {};
  const enabledAdvancedFeatures =
    selected?.learned_role?.advanced_features_enabled || [];
  const learnedHoldout = selected?.learned_role?.holdout || null;
  const advancedSeasons = coverage.advanced_context_seasons || [];
  const advancedTeamWeeks = advancedSeasons.reduce(
    (sum, row) => sum + number(row.team_weeks),
    0,
  );
  const weather = selected?.forecast?.weather || null;
  const opportunity = selected?.forecast?.opportunity_projection || null;
  const availability = selected?.forecast?.availability || null;
  const market = selected?.forecast?.market || null;
  const simulation = outcomeProfile?.simulation || null;
  const customScoringCoverage =
    scoring === "league" && selected?.forecast
      ? sleeperScoringCoverage(
          selected.forecast.stat_line || {},
          leagueScoring || {},
          selected.position,
        )
      : null;
  const modelAccuracy =
    scoring === "league"
      ? null
      : lens === "safe_expected"
      ? accuracy?.cumulative_by_model_version?.[
          model?.model_build_id || model?.model_version
        ]?.scoring?.[scoring] || null
      : accuracy?.cumulative_by_model_version?.[
          model?.model_build_id || model?.model_version
        ]?.projection_lenses?.[scoring]?.[lens] || null;
  const accuracyMetrics =
    lens !== "safe_expected"
      ? modelAccuracy
      : modelAccuracy?.cohorts?.[accuracyCohort] ||
        (accuracyCohort === "all_matched" ? modelAccuracy : null);

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-clip">
      <Card className="overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-100/55">
              The Fantasy Arsenal · {model.model_version}
            </div>
            <h2 className="mt-1 text-2xl font-black">
              {model.season} Weekly Projection Lab
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">
              Team volume is projected first, opportunity is allocated to each
              player, and efficiency is applied afterward. Adaptive source
              weighting, three years of production, matchup context, availability,
              and simulated outcomes are kept separate so every forecast can be audited.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Filter
              label="Week"
              value={week}
              onChange={selectWeek}
            >
              {Array.from({ length: 18 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  Week {index + 1}
                </option>
              ))}
            </Filter>
            <Filter
              label="Scoring"
              value={scoring}
              onChange={setScoring}
              preference="stat-central-projection-scoring"
            >
              <option value="ppr">PPR</option>
              <option value="half">Half PPR</option>
              <option value="std">Standard</option>
              <option value="league">League scoring</option>
            </Filter>
            <Filter label="Projection lens" value={lens} onChange={setLens}>
              <option value="safe_expected">Safe / Expected</option>
              <option value="risky">Risky boom / bust</option>
            </Filter>
            <Filter label="Position" value={position} onChange={setPosition}>
              {["ALL", "QB", "RB", "WR", "TE", "K"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Filter>
            <Filter label="Team" value={team} onChange={setTeam}>
              <option>ALL</option>
              {teams.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Filter>
            <label className="col-span-2 min-w-0 sm:col-span-1 lg:col-span-1">
              <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.15em] text-white/30">
                Find player
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search player…"
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              />
            </label>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Filter
              label="Selected player"
              value={selected?.name || rows[0]?.name || ""}
              onChange={(value) => {
                setSelectedName(value);
                setView("player");
              }}
            >
              {rows.map((player) => (
                <option key={`${player.player_id || player.name}-${player.position}`} value={player.name}>
                  {player.name} · {player.position} · {player.team} · {player.projection.toFixed(1)}
                </option>
              ))}
            </Filter>
            <button
              type="button"
              onClick={() => setView("board")}
              className="min-h-10 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-black text-cyan-100/75 transition hover:bg-cyan-300/[0.08] hover:text-cyan-100"
            >
              Browse weekly board
            </button>
          </div>
          {!rows.length ? (
            <div className="rounded-xl border border-amber-300/12 bg-amber-300/[0.04] px-3 py-2.5 text-xs text-amber-100/70">
              No active players match these filters for Week {week}. Clear the player search or broaden the position and team filters.
            </div>
          ) : null}
          {scoring === "league" ? (
            <div className="rounded-2xl border border-emerald-300/12 bg-emerald-300/[0.04] p-4">
              {leagues.length ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(250px,.7fr)] sm:items-end">
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-[.16em] text-emerald-100/55">
                      Exact Sleeper league scoring
                    </div>
                    <p className="mt-1 text-[10px] leading-5 text-white/40">
                      The same projected stat line is converted with this league&apos;s scoring rules. Change leagues without rebuilding the projection model.
                    </p>
                  </div>
                  <Filter
                    label="Scoring league"
                    value={scoringLeagueId}
                    onChange={onScoringLeagueChange || (() => {})}
                    preference="stat-central-scoring-league"
                  >
                    {leagues.map((league) => (
                      <option key={league.league_id} value={league.league_id}>
                        {league.name}
                      </option>
                    ))}
                  </Filter>
                </div>
              ) : (
                <p className="text-xs leading-5 text-amber-100/70">
                  Load a Sleeper portfolio to use league scoring. PPR, Half PPR, and Standard remain available.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Projected-stat coverage"
          value={`${number(coverage.projected_stat_source_players).toLocaleString()} players`}
          detail={`${number(coverage.bounded_fallback_players)} bounded fallbacks`}
          tone="emerald"
        />
        <Kpi
          label="Historical regression"
          value={`${number(coverage.historical_raw_stat_players).toLocaleString()} players`}
          detail={`${(model.evidence_seasons || []).join(", ")} raw evidence`}
        />
        <Kpi
          label="Current board"
          value={`${rows.length} active`}
          detail={`Week ${week} · ${rows.some((row) => row.forecast?.completed) ? "final results" : "forecast"} · ${scoringLabel}`}
          tone="violet"
        />
        <Kpi
          label="Advanced matchup context"
          value={`${advancedTeamWeeks.toLocaleString()} team-weeks`}
          detail={`${advancedSeasons.map((row) => row.year).join(", ")} efficiency, pressure, coverage & snaps`}
          tone="emerald"
        />
        <Kpi
          label="Frozen model version"
          value={model.model_version}
          detail={new Date(model.generated_at).toLocaleString()}
          tone="amber"
        />
      </div>

      <div className="sticky top-[108px] z-20 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/10 bg-slate-950/95 p-2 backdrop-blur-xl sm:static sm:gap-2">
        {[
          ["player", "Player Forecast", "One player across every week"],
          ["board", "Weekly Board", "Rank the complete slate"],
          ["model", "Model & Accuracy", "Method and measured results"],
        ].map(([key, label, detail]) => (
          <button
            type="button"
            key={key}
            onClick={() => setView(key)}
            className={`min-w-0 rounded-xl px-2 py-2.5 text-center transition sm:px-4 sm:text-left ${view === key ? "bg-cyan-300/12 text-cyan-100 ring-1 ring-cyan-300/15" : "text-white/42 hover:bg-white/[0.04]"}`}
          >
            <span className="block text-xs font-black">{label}</span>
            <span className="mt-0.5 hidden text-[9px] text-white/28 sm:block">
              {detail}
            </span>
          </button>
        ))}
      </div>

      {view === "player" && selected ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-wider text-cyan-100/45">
                    {selected.forecast.completed
                      ? "Final performance"
                      : "Selected projection"}
                  </div>
                  <h3 className="mt-1 text-2xl font-black">{selected.name}</h3>
                  <p className="mt-1 text-xs text-white/35">
                    {selected.team} · {selected.position} ·{" "}
                    {selected.forecast.home ? "vs" : "at"}{" "}
                    {selected.forecast.opponent}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-black text-emerald-100">
                    {selected.projection.toFixed(1)}
                  </div>
                  <div className="text-[9px] font-black uppercase tracking-wider text-white/30">
                    Week {week} {lens === "safe_expected" ? "safe / expected " : "risky "}{scoringLabel}{" "}
                    {selected.forecast.completed ? "actual" : "points"}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/15 p-2">
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    moveSelectedWeek(-1);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      moveSelectedWeek(-1);
                    }
                  }}
                  disabled={selectedWeekIndex <= 0}
                  className="grid h-11 w-11 touch-manipulation place-items-center rounded-xl bg-white/[0.05] text-lg font-black text-white/70 disabled:opacity-25"
                  aria-label="Previous active week"
                >
                  ‹
                </button>
                <div className="min-w-0 text-center">
                  <div className="text-[9px] font-black uppercase tracking-[.16em] text-cyan-100/45">
                    Selected player timeline
                  </div>
                  <div className="mt-0.5 truncate text-sm font-black">
                    Week {week} · {selected.forecast.home ? "vs" : "at"} {selected.forecast.opponent}
                  </div>
                </div>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    moveSelectedWeek(1);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      moveSelectedWeek(1);
                    }
                  }}
                  disabled={selectedWeekIndex < 0 || selectedWeekIndex >= seasonSeries.length - 1}
                  className="grid h-11 w-11 touch-manipulation place-items-center rounded-xl bg-white/[0.05] text-lg font-black text-white/70 disabled:opacity-25"
                  aria-label="Next active week"
                >
                  ›
                </button>
              </div>
              <div className="mt-2 flex snap-x gap-1.5 overflow-x-auto pb-1 sm:hidden">
                {seasonSeries.map((row) => (
                  <button
                    type="button"
                    key={row.week}
                    onPointerUp={() => {
                      selectWeek(row.week);
                    }}
                    className={`min-w-[58px] touch-manipulation snap-start rounded-xl px-2 py-2 text-center ${row.week === week ? "bg-amber-300/15 text-amber-100 ring-1 ring-amber-300/20" : "bg-white/[0.035] text-white/40"}`}
                  >
                    <span className="block text-[9px] font-black">W{row.week}</span>
                    <span className="mt-0.5 block truncate text-[8px]">{row.opponent}</span>
                  </button>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                <Kpi
                  label="Neutral week"
                  value={selected.baseline.toFixed(1)}
                  detail="Season model ÷ active weeks"
                />
                <Kpi
                  label="Weekly outcome"
                  value={outcomeProfile.label || "Balanced range"}
                  detail={`${(number(outcomeProfile.boom_probability) * 100).toFixed(0)}% boom · ${(number(outcomeProfile.bust_probability) * 100).toFixed(0)}% bust`}
                  tone={
                    outcomeProfile.label === "Boom spot"
                      ? "emerald"
                      : outcomeProfile.label === "Bust risk"
                        ? "rose"
                        : "amber"
                  }
                />
                <Kpi
                  label={
                    selected.forecast.completed
                      ? "Week status"
                      : "Matchup change"
                  }
                  value={
                    selected.forecast.completed
                      ? "Final"
                      : `${selected.change >= 0 ? "+" : ""}${selected.change.toFixed(1)}`
                  }
                  detail={
                    selected.forecast.completed
                      ? "Saved actual result"
                      : `${matchupChange >= 0 ? "+" : ""}${matchupChange.toFixed(1)}% from neutral`
                  }
                  tone={selected.change >= 0 ? "emerald" : "rose"}
                />
                <Kpi
                  label="Confidence"
                  value={`${selected.confidence}%`}
                  detail={`${selected.stat_prior?.sources?.length || 0} stat-line sources`}
                  tone="violet"
                />
                <Kpi
                  label="Vs Arsenal consensus"
                  value={
                    anchorAvailable
                      ? `${anchorVariance >= 0 ? "+" : ""}${anchorVariance.toFixed(1)}`
                      : "—"
                  }
                  detail={
                    anchorAvailable
                      ? `Season points · ${number(selected?.season?.consensus_anchor_sources)} format-capable sources`
                      : "No format-capable consensus anchor"
                  }
                  tone={
                    anchorAvailable && Math.abs(anchorVariance) < 8
                      ? "emerald"
                      : "amber"
                  }
                />
              </div>
              <div className="mt-5 max-w-full overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
                <div
                  className="flex h-[170px] min-w-[560px] items-end gap-1.5 border-b border-white/10 pb-2 sm:h-[190px] sm:min-w-[680px]"
                >
                  {seasonSeries.map((row) => {
                    const active = row.week === week;
                    return (
                      <button
                        type="button"
                        key={row.week}
                        onPointerUp={() => {
                          selectWeek(row.week);
                        }}
                        className="flex min-w-0 touch-manipulation flex-1 flex-col items-center justify-end gap-1"
                        title={`Week ${row.week} ${row.opponent}: ${row.projection.toFixed(1)}`}
                      >
                        <div
                          className={`w-full rounded-t ${active ? "bg-amber-300" : row.completed ? "bg-slate-500/60" : "bg-gradient-to-t from-cyan-400/55 to-violet-300/70"}`}
                          style={{
                            height: `${Math.max(4, (row.projection / maxProjection) * 145)}px`,
                          }}
                        />
                        <span
                          className={`text-[8px] ${active ? "font-black text-amber-100" : "text-white/25"}`}
                        >
                          {row.week}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="p-5 sm:p-6">
              <h3 className="text-lg font-black">Why the model landed here</h3>
              <div className="mt-4 space-y-3">
                {customScoringCoverage ? (
                  <div className="rounded-2xl border border-emerald-300/12 bg-emerald-300/[0.04] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                      <span className="text-emerald-100/65">{scoringLabel}</span>
                      <b>{customScoringCoverage.percentage}% rule coverage</b>
                    </div>
                    <p className="mt-2 text-[10px] leading-5 text-white/38">
                      {customScoringCoverage.supported.length} of {customScoringCoverage.active} active scoring rules can be calculated from this projected stat line.
                      {customScoringCoverage.unsupported.length
                        ? ` Not projected for this player: ${customScoringCoverage.unsupported.join(", ")}. Those rules are disclosed and excluded rather than guessed.`
                        : " Every active rule used by this player is represented."}
                    </p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">Boom / bust range</span>
                    <b>
                      {number(outcomeProfile.floor).toFixed(1)}–
                      {number(outcomeProfile.ceiling).toFixed(1)}
                    </b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    Calibrated from{" "}
                    {number(
                      outcomeProfile.calibration_sample || outcomeProfile.sample,
                    ).toLocaleString()} leakage-safe historical player-games.
                    The median is {number(outcomeProfile.median).toFixed(1)} and
                    the middle 50% range is{" "}
                    {number(outcomeProfile.p25).toFixed(1)}–
                    {number(outcomeProfile.p75).toFixed(1)}.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">Validated weekly signal</span>
                    <b
                      className={
                        number(learnedAdjustment.factor) >= 1
                          ? "text-emerald-100"
                          : "text-rose-100"
                      }
                    >
                      {number(learnedAdjustment.factor) >= 1 ? "+" : ""}
                      {((number(learnedAdjustment.factor) - 1) * 100).toFixed(1)}%
                    </b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    {number(selected?.learned_role?.available_features)} of{" "}
                    {number(selected?.learned_role?.feature_count)} trained inputs are
                    available. This {selected.position} layer lowered untouched
                    2025 holdout MAE from{" "}
                    {number(learnedHoldout?.baseline_mae).toFixed(2)} to{" "}
                    {number(learnedHoldout?.trained_mae).toFixed(2)}. Missing
                    inputs remain neutral instead of being invented.
                  </p>
                </div>
                {opportunity ? (
                  <div className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                      <span className="text-amber-100/65">Projected opportunity</span>
                      <b>{(number(opportunity.reliability) * 100).toFixed(0)}% role confidence</b>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Kpi label="Team plays" value={number(opportunity.team_plays).toFixed(1)} detail={`${(number(opportunity.team_neutral_pass_rate) * 100).toFixed(0)}% neutral pass rate`} tone="amber" />
                      {number(opportunity.projected_pass_attempts) > 0 ? (
                        <Kpi label="Pass attempts" value={number(opportunity.projected_pass_attempts).toFixed(1)} detail="Volume before efficiency" tone="cyan" />
                      ) : null}
                      {number(opportunity.projected_targets) > 0 ? (
                        <Kpi label="Targets" value={number(opportunity.projected_targets).toFixed(1)} detail={`${(number(opportunity.target_share) * 100).toFixed(1)}% team target share`} tone="cyan" />
                      ) : null}
                      {number(opportunity.projected_carries) > 0 ? (
                        <Kpi label="Carries" value={number(opportunity.projected_carries).toFixed(1)} detail={number(opportunity.carry_share) > 0 ? `${(number(opportunity.carry_share) * 100).toFixed(1)}% team carry share` : "Designed and scramble volume"} tone="emerald" />
                      ) : null}
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-white/35">
                      This is the workload layer, before yards, touchdowns, and fantasy scoring are applied. It blends the external stat prior with recency-weighted role evidence.
                    </p>
                  </div>
                ) : null}
                {simulation ? (
                  <div className="rounded-2xl border border-violet-300/10 bg-violet-300/[0.035] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                      <span className="text-violet-100/65">Correlated game simulation</span>
                      <b>500 outcomes</b>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      {[
                        ["P10", simulation.p10, "Floor outcome"],
                        ["Median", simulation.median, "Most typical"],
                        ["P90", simulation.p90, "Ceiling outcome"],
                      ].map(([label, value, detail]) => (
                        <div key={label} className="min-w-0 rounded-xl border border-white/[0.06] bg-black/15 p-3">
                          <div className="text-[8px] font-black uppercase tracking-wider text-white/30">{label}</div>
                          <div className="mt-1 text-lg font-black text-violet-100 sm:text-xl">{number(value).toFixed(1)}</div>
                          <div className="mt-1 hidden text-[9px] text-white/28 sm:block">{detail}</div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-white/35">
                      Team outcomes move together, so a strong or weak offensive game affects correlated players. The simulation describes uncertainty; it does not replace the validated expected projection.
                    </p>
                  </div>
                ) : null}
                {availability ? (
                  <div className="rounded-2xl border border-rose-300/10 bg-rose-300/[0.035] p-4">
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="text-rose-100/65">Availability and vacated work</span>
                      <b>{availability.status || "Role change"}</b>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-white/35">
                      Player availability factor: {(number(availability.player_factor) * 100).toFixed(0)}%.
                      {number(availability.vacated_group_share) > 0
                        ? ` ${(number(availability.vacated_group_share) * 100).toFixed(1)}% of the position group's recent opportunity is currently vacated; redistribution is capped to avoid overreacting.`
                        : " No teammate opportunity is being redistributed."}
                    </p>
                  </div>
                ) : null}
                {market ? (
                  <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.035] p-4">
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="text-emerald-100/65">Pregame market context</span>
                      <b>{number(market.implied_points).toFixed(1)} implied team points</b>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-white/35">
                      Spread {number(market.spread) > 0 ? "+" : ""}{number(market.spread).toFixed(1)} and total {number(market.total).toFixed(1)}. Market inputs appear only when a saved pregame line is available.
                    </p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.035] p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-cyan-100/60">Pass rush versus protection</span>
                    <b
                      className={
                        number(advancedSignals.pressure_mismatch) <= 0
                          ? "text-emerald-100"
                          : "text-amber-100"
                      }
                    >
                      {number(advancedSignals.pressure_mismatch) >= 0 ? "+" : ""}
                      {(number(advancedSignals.pressure_mismatch) * 100).toFixed(1)} pts
                    </b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/35">
                    This offense&apos;s weighted pressure rate is{" "}
                    {(number(advancedSignals.protection_pressure_rate) * 100).toFixed(1)}%
                    versus a {(number(advancedSignals.opponent_pressure_rate) * 100).toFixed(1)}%
                    opponent pressure rate. Blitz tendency is{" "}
                    {(number(advancedSignals.opponent_blitz_rate) * 100).toFixed(1)}%.
                    {enabledAdvancedFeatures.length
                      ? ` ${enabledAdvancedFeatures.length} advanced inputs cleared this position's holdout gate.`
                      : " This context is monitored, but remains neutral until it clears this position's holdout gate."}
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-300/10 bg-violet-300/[0.035] p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-violet-100/60">Coverage & line continuity</span>
                    <b>{(number(advancedSignals.advanced_reliability) * 100).toFixed(0)}% evidence</b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/35">
                    Opponent coverage: {(number(advancedSignals.opponent_man_rate) * 100).toFixed(0)}%
                    man / {(number(advancedSignals.opponent_zone_rate) * 100).toFixed(0)}% zone.
                    The offense returns an estimated{" "}
                    {(number(advancedSignals.ol_continuity) * 100).toFixed(0)}% of its
                    recent primary line combination.
                  </p>
                </div>
                <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.035] p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-emerald-100/60">Efficiency matchup</span>
                    <b
                      className={
                        number(advancedSignals.epa_matchup) >= 0
                          ? "text-emerald-100"
                          : "text-amber-100"
                      }
                    >
                      {number(advancedSignals.epa_matchup) >= 0 ? "+" : ""}
                      {number(advancedSignals.epa_matchup).toFixed(2)} EPA
                    </b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/35">
                    The offense has produced {number(advancedSignals.offense_epa_per_play).toFixed(2)}
                    {" "}EPA per play with a {(number(advancedSignals.offense_success_rate) * 100).toFixed(0)}%
                    {" "}success rate. This opponent has allowed {number(advancedSignals.opponent_epa_per_play_allowed).toFixed(2)}
                    {" "}EPA per play and a {(number(advancedSignals.opponent_success_rate_allowed) * 100).toFixed(0)}%
                    {" "}success rate. Pass tendency, red-zone usage, and opponent allowances are
                    tested in the leakage-safe model; they remain neutral unless they improve an untouched holdout.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">Kickoff weather</span>
                    <b>{weather ? "Included" : "Pending"}</b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    {weather
                      ? `${number(weather.temperature).toFixed(0)}°F · ${number(weather.windSpeed).toFixed(0)} mph wind · ${number(weather.precipitationProbability).toFixed(0)}% precipitation. Outdoor weather is included in the Risky path.`
                      : "A real kickoff forecast is added inside the 16-day weather window. No invented long-range weather adjustment is applied."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">Opponent adjustment</span>
                    <b>
                      {matchupChange >= 0 ? "+" : ""}
                      {matchupChange.toFixed(1)}%
                    </b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    Built from position-specific attempts, targets, yards,
                    touchdowns, turnover rates, and a bounded personal
                    opponent-history signal—not one points-allowed multiplier.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">Defensive evidence</span>
                    <b>{number(selected.forecast.defense_sample)} team-games</b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    Recent seasons receive more weight, while every field is
                    shrunk toward league average based on sample size.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">
                      Personal opponent history
                    </span>
                    <b>{number(personalHistory.games)} meetings</b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    {number(personalHistory.games) >= 2
                      ? `${number(personalHistory.split_average).toFixed(1)} PPR average versus this opponent, compared with a ${number(personalHistory.player_baseline).toFixed(1)} personal baseline. Its sample-weighted influence is capped at ±6%.`
                      : "Fewer than two recent meetings, so no player-specific head-to-head adjustment is applied."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">
                      Historical player blend
                    </span>
                    <b>{regressionBlend.toFixed(1)}%</b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    Uses {number(selected.regression?.history_games)} observed
                    games. Volume can move at most 6%; efficiency at most 5%.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">Workload prior</span>
                    <b>{roleFactor.toFixed(2)}×</b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    {independentSignalWeight.toFixed(0)}% of this role decision
                    remains with the independent stat model. Arsenal consensus
                    is a bounded workload prior—not a forced answer.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-xl font-black">Projected stat DNA</h3>
                <p className="mt-1 text-xs text-white/38">
                  The exact inputs that create the point projection.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(selected.stat_prior?.sources || []).map((source) => (
                  <span
                    key={source}
                    className="rounded-full bg-cyan-300/10 px-3 py-1 text-[9px] font-black text-cyan-100"
                  >
                    {source}
                  </span>
                ))}
                {!selected.stat_prior?.sources?.length ? (
                  <span className="rounded-full bg-amber-300/10 px-3 py-1 text-[9px] font-black text-amber-100">
                    Bounded fallback
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {statRows.map(([label, key]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-white/[0.07] bg-black/15 p-4"
                >
                  <div className="text-[9px] font-black uppercase tracking-wider text-white/30">
                    {label}
                  </div>
                  <div className="mt-1 text-2xl font-black text-cyan-100">
                    {formatStat(key, weeklyStats[key])}
                  </div>
                  <div className="mt-1 text-[10px] text-white/32">
                    Week {week}{" "}
                    {selected.forecast.completed ? "actual" : "forecast"} ·{" "}
                    {formatStat(key, seasonStats[key])} season outlook
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {view === "board" ? (
      <Card className="overflow-hidden">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-xl font-black">
                Week {week} projection board
              </h3>
              <p className="mt-1 text-xs text-white/35">
                Select a player to audit the full stat line and every
                adjustment.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search player…"
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              />
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"
              >
                <option value="projection">Sort: projection</option>
                <option value="matchup">Sort: matchup boost</option>
                <option value="confidence">Sort: confidence</option>
                <option value="disagreement">Sort: disagreement</option>
              </select>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/45">
                {rows.length} active
              </div>
            </div>
          </div>
        </div>

        <div className="divide-y divide-white/[0.06] md:hidden">
          {rows.slice(0, visibleCount).map((player) => (
            <button
              type="button"
              key={player.name}
              onClick={() => {
                setSelectedName(player.name);
                setView("player");
              }}
              className="w-full p-4 text-left hover:bg-white/[0.03]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <b className="block truncate">{player.name}</b>
                  <small className="text-white/30">
                    {player.team} · {player.position} ·{" "}
                    {player.forecast.home ? "vs" : "at"}{" "}
                    {player.forecast.opponent}
                  </small>
                </div>
                <b className="shrink-0 text-xl text-emerald-100">
                  {player.projection.toFixed(1)}
                </b>
              </div>
              <div className="mt-2 text-[10px] text-white/38">
                {weeklyLine(player.position, player.forecast.stat_line)}
              </div>
              <div className="mt-2 flex gap-3 text-[9px] text-white/28">
                <span>{player.confidence}% confidence</span>
                <span
                  className={
                    player.change >= 0
                      ? "text-emerald-200/70"
                      : "text-rose-200/70"
                  }
                >
                  {player.change >= 0 ? "+" : ""}
                  {player.change.toFixed(1)} vs neutral
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-white/[0.035] text-[9px] uppercase tracking-wider text-white/35">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th>Matchup</th>
                <th>Projection</th>
                <th>Projected stat line</th>
                <th>Vs neutral</th>
                <th>Defense sample</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.slice(0, visibleCount).map((player) => (
                <tr
                  key={player.name}
                  onClick={() => {
                    setSelectedName(player.name);
                    setView("player");
                  }}
                  className={`cursor-pointer hover:bg-white/[0.035] ${selected?.name === player.name ? "bg-cyan-300/[0.04]" : ""}`}
                >
                  <td className="px-4 py-3">
                    <b>{player.name}</b>
                    <small className="block text-white/28">
                      {player.team} · {player.position}
                    </small>
                  </td>
                  <td>
                    {player.forecast.home ? "vs" : "at"}{" "}
                    {player.forecast.opponent}
                  </td>
                  <td className="font-black text-emerald-100">
                    {player.projection.toFixed(1)}
                  </td>
                  <td className="text-white/48">
                    {weeklyLine(player.position, player.forecast.stat_line)}
                  </td>
                  <td
                    className={
                      player.change >= 0 ? "text-emerald-200" : "text-rose-200"
                    }
                  >
                    {player.change >= 0 ? "+" : ""}
                    {player.change.toFixed(1)}
                  </td>
                  <td>{number(player.forecast.defense_sample)}</td>
                  <td>{player.confidence}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > visibleCount ? (
          <div className="border-t border-white/10 p-4 text-center">
            <button
              type="button"
              onClick={() => setVisibleCount((current) => current + 40)}
              className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-5 py-2.5 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/10"
            >
              Show 40 more · {rows.length - visibleCount} remaining
            </button>
          </div>
        ) : null}
      </Card>
      ) : null}

      {view === "model" ? (
      <Card className="p-5 sm:p-6">
        <div className="rounded-3xl border border-cyan-300/10 bg-gradient-to-br from-cyan-300/[0.06] via-violet-300/[0.035] to-transparent p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[.18em] text-cyan-100/55">
                Holdout-validated intelligence
              </div>
              <h3 className="mt-1 text-xl font-black">Built to earn every adjustment</h3>
              <p className="mt-2 max-w-3xl text-[10px] leading-5 text-white/40">
                The role model trains on 2023–2024, selects regularization and
                shrinkage against untouched 2025 games, then refits for 2026.
                A position is automatically disabled unless it improves the
                holdout baseline. Future information is never used.
              </p>
            </div>
            <span className="w-fit rounded-full border border-emerald-300/15 bg-emerald-300/[0.08] px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-100">
              {model.trained_calibration?.version || "Calibration unavailable"}
            </span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {Object.entries(model.trained_calibration?.positions || {}).map(
              ([positionName, result]) => (
                <div
                  key={positionName}
                  className="rounded-2xl border border-white/[0.07] bg-slate-950/55 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-sm">{positionName}</b>
                    <span className="text-[9px] font-black text-emerald-100">
                      {number(result.holdout_mae_improvement).toFixed(3)} better
                    </span>
                  </div>
                  <div className="mt-2 text-lg font-black text-white">
                    {number(result.holdout_baseline_mae).toFixed(2)} →{" "}
                    {number(result.holdout_trained_mae).toFixed(2)}
                  </div>
                  <div className="mt-1 text-[9px] text-white/28">
                    MAE · {number(result.validation_sample).toLocaleString()} held-out games
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer list-none text-lg font-black">
            How {model.model_version} works
          </summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(model.methodology || {}).map(([key, value]) => (
              <div
                key={key}
                className="rounded-2xl border border-white/[0.06] bg-black/15 p-4"
              >
                <div className="text-[9px] font-black uppercase tracking-wider text-violet-100/55">
                  {key.replaceAll("_", " ")}
                </div>
                <p className="mt-2 text-[10px] leading-5 text-white/38">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </details>
        <div className="mt-4 rounded-2xl border border-emerald-300/10 bg-emerald-300/[0.035] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <b className="text-sm text-emerald-100">Accuracy contract</b>
              <div className="mt-1 text-[9px] text-white/30">
                Exact build {model.model_build_id || model.model_version}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={accuracyCohort}
                onChange={(event) => setAccuracyCohort(event.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-[10px]"
              >
                <option value="projected_5_plus">5+ point projections</option>
                <option value="projected_10_plus">10+ point projections</option>
                <option value="top_100_projected">Weekly top 100</option>
                <option value="all_matched">All active matches</option>
              </select>
              <span className="rounded-full bg-black/20 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-white/45">
                {accuracyMetrics?.sample
                  ? `Scored through Week ${accuracy.last_scored_week}`
                  : "Awaiting this model's results"}
              </span>
            </div>
          </div>
          {scoring === "league" ? (
            <p className="mt-3 text-[10px] leading-5 text-white/38">
              This view is calculated live from {selectedScoringLeague?.name || "the selected league"}&apos;s rules. The frozen accuracy ledger remains separated by PPR, Half PPR, and Standard until league-scoring snapshots have enough completed games for an honest comparison.
            </p>
          ) : accuracyMetrics?.sample ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi
                  label="MAE"
                  value={number(accuracyMetrics.mae).toFixed(2)}
                  detail="Lower is better"
                  tone="emerald"
                />
                <Kpi
                  label="RMSE"
                  value={number(accuracyMetrics.rmse).toFixed(2)}
                  detail="Penalizes large misses"
                  tone="amber"
                />
                <Kpi
                  label="Bias"
                  value={number(accuracyMetrics.bias).toFixed(2)}
                  detail="Positive means too high"
                  tone="violet"
                />
                <Kpi
                  label="Rank correlation"
                  value={
                    accuracyMetrics.rank_correlation == null
                      ? "—"
                      : number(accuracyMetrics.rank_correlation).toFixed(2)
                  }
                  detail={`${number(accuracyMetrics.sample)} active-game matches`}
                />
              </div>
              <p className="mt-3 text-[10px] leading-5 text-white/35">
                Accuracy is conditional on an active, matched player-game.
                Coverage also records{" "}
                {number(
                  modelAccuracy?.coverage?.projected_without_active_result,
                )}{" "}
                projected appearances without an active result, including{" "}
                {number(
                  modelAccuracy?.coverage?.known_projected_dnp_or_inactive,
                )}{" "}
                known DNP/inactive outcomes, so absences cannot silently improve
                the headline score.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[10px] leading-5 text-white/38">
              No {model.season} game is graded before it is played. The daily
              updater freezes a compact pre-kickoff snapshot, records actual
              active-game results afterward, and then calculates MAE, RMSE,
              bias, rank correlation, and position-level accuracy. Model
              versions remain separate, so an update can never rewrite its own
              history.
            </p>
          )}
        </div>
      </Card>
      ) : null}
    </div>
  );
}
