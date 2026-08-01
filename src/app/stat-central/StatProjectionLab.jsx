"use client";

import { useEffect, useMemo, useState } from "react";

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
      className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}
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
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="text-[9px] font-black uppercase tracking-[.16em] text-white/30">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-2xl font-black ${tones[tone] || tones.cyan}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] leading-4 text-white/35">{detail}</div>
    </div>
  );
}

function Filter({ label, value, onChange, children }) {
  return (
    <label className="min-w-0">
      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[.15em] text-white/30">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
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

export default function StatProjectionLab({ model }) {
  const [week, setWeek] = useState(() => recommendedWeek(model));
  const [scoring, setScoring] = useState("ppr");
  const [lens, setLens] = useState("expected");
  const [position, setPosition] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("projection");
  const [selectedName, setSelectedName] = useState("");
  const [visibleCount, setVisibleCount] = useState(40);
  const [accuracy, setAccuracy] = useState(null);
  const [accuracyCohort, setAccuracyCohort] = useState("projected_5_plus");
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
        .map((player) => {
          const forecast = player.weeks?.find((row) => row.week === week);
          const expectedProjection = number(forecast?.projections?.[scoring]);
          const projection = forecast?.completed
            ? expectedProjection
            : number(
                forecast?.projection_lenses?.[scoring]?.[lens] ??
                  expectedProjection,
              );
          const season = player.scoring?.[scoring] || {};
          const remainingGames = number(player.remaining_games) || 17;
          const baseline = forecast?.completed
            ? projection
            : number(season.remaining_points ?? season.season_points) /
              remainingGames;
          return {
            ...player,
            forecast,
            projection,
            baseline,
            change: projection - baseline,
            season,
          };
        })
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
    [lens, model, position, query, scoring, sort, team, week],
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
  const selected = rows.find((row) => row.name === selectedName) || rows[0];
  const seasonSeries = selected
    ? (selected.weeks || [])
        .filter((row) => !row.bye)
        .map((row) => ({
          ...row,
          projection: row.completed
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
    selected?.season?.consensus_anchor != null &&
    selected?.season?.variance_from_anchor != null;
  const anchorVariance = anchorAvailable
    ? number(selected?.season?.variance_from_anchor)
    : null;
  const personalHistory = selected?.forecast?.personal_history || {};
  const outcomeProfile = selected?.forecast?.outcome_profile || {};
  const modelAccuracy =
    lens === "expected"
      ? accuracy?.cumulative_by_model_version?.[
          model?.model_build_id || model?.model_version
        ]?.scoring?.[scoring] || null
      : accuracy?.cumulative_by_model_version?.[
          model?.model_build_id || model?.model_version
        ]?.projection_lenses?.[scoring]?.[lens] || null;
  const accuracyMetrics =
    lens !== "expected"
      ? modelAccuracy
      : modelAccuracy?.cohorts?.[accuracyCohort] ||
        (accuracyCohort === "all_matched" ? modelAccuracy : null);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-100/55">
              The Fantasy Arsenal · {model.model_version}
            </div>
            <h2 className="mt-1 text-2xl font-black">
              {model.season} Weekly Projection Lab
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">
              A stat line is built first from multiple projection sources,
              regressed with three years of observed player production,
              calibrated for expected role, and adjusted one field at a time for
              the opponent. Fantasy points are calculated last for PPR,
              Half-PPR, and Standard.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Filter
              label="Week"
              value={week}
              onChange={(value) => setWeek(number(value))}
            >
              {Array.from({ length: 18 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  Week {index + 1}
                </option>
              ))}
            </Filter>
            <Filter label="Scoring" value={scoring} onChange={setScoring}>
              <option value="ppr">PPR</option>
              <option value="half">Half PPR</option>
              <option value="std">Standard</option>
            </Filter>
            <Filter label="Projection lens" value={lens} onChange={setLens}>
              <option value="safe">Safe</option>
              <option value="expected">Expected</option>
              <option value="upside">Upside</option>
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
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          detail={`Week ${week} · ${rows.some((row) => row.forecast?.completed) ? "final results" : "forecast"} · ${scoring.toUpperCase()}`}
          tone="violet"
        />
        <Kpi
          label="Frozen model version"
          value={model.model_version}
          detail={new Date(model.generated_at).toLocaleString()}
          tone="amber"
        />
      </div>

      {selected ? (
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
                    Week {week} {lens === "expected" ? "" : `${lens} `}{scoring.toUpperCase()}{" "}
                    {selected.forecast.completed ? "actual" : "points"}
                  </div>
                </div>
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
              <div className="mt-5 overflow-x-auto">
                <div
                  className="flex min-w-[680px] items-end gap-1.5 border-b border-white/10 pb-2"
                  style={{ height: 190 }}
                >
                  {seasonSeries.map((row) => {
                    const active = row.week === week;
                    return (
                      <button
                        type="button"
                        key={row.week}
                        onClick={() => setWeek(row.week)}
                        className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
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
                <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="flex justify-between gap-4 text-xs">
                    <span className="text-white/40">Boom / bust range</span>
                    <b>
                      {number(outcomeProfile.floor).toFixed(1)}â€“
                      {number(outcomeProfile.ceiling).toFixed(1)}
                    </b>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/30">
                    Based on {number(outcomeProfile.sample)} prior active games
                    and this matchup. Safe and Upside are range lenses;
                    Expected remains the model&apos;s most likely point estimate.
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
              onClick={() => setSelectedName(player.name)}
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
                  onClick={() => setSelectedName(player.name)}
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

      <Card className="p-5 sm:p-6">
        <details>
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
          {accuracyMetrics?.sample ? (
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
    </div>
  );
}
