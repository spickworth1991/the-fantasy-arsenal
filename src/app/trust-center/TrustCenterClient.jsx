"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import { useSleeper } from "../../context/SleeperContext";

const season = new Date().getFullYear();
const SOURCES = [
  {
    key: "arsenal-model",
    freshnessKey: "arsenal_model_proj",
    label: "The Fantasy Arsenal Projections",
    kind: "Projection",
    derived: true,
    file: `/projections_thefantasyarsenal_model_${season}.json`,
  },
  {
    key: "arsenal-average",
    freshnessKey: "arsenal_proj",
    label: "Average of All Projections",
    kind: "Projection",
    derived: true,
    file: `/projections_thefantasyarsenal_${season}.json`,
  },
  {
    key: "stickypicky",
    freshnessKey: "sp",
    label: "The Fantasy Arsenal Values",
    kind: "Value",
    file: "/stickypicky_cache.json",
  },
  {
    key: "ffa",
    freshnessKey: "proj",
    label: "Fantasy Football Analytics",
    kind: "Projection",
    file: `/projections_${season}.json`,
  },
  {
    key: "espn",
    freshnessKey: "espn_proj",
    label: "ESPN",
    kind: "Projection",
    file: `/projections_espn_${season}.json`,
  },
  {
    key: "cbs",
    freshnessKey: "cbs_proj",
    label: "CBS",
    kind: "Projection",
    file: `/projections_cbs_${season}.json`,
  },
  {
    key: "sleeper",
    freshnessKey: "sleeper_proj",
    label: "Sleeper",
    kind: "Projection",
    file: `/projections_sleeper_${season}.json`,
  },
  {
    key: "fantasysharks",
    freshnessKey: "fantasysharks_proj",
    label: "FantasySharks",
    kind: "Projection",
    file: `/projections_fantasysharks_${season}.json`,
  },
  {
    key: "draftsharks",
    freshnessKey: "draftsharks_proj",
    label: "DraftSharks",
    kind: "Projection",
    file: `/projections_draftsharks_${season}.json`,
  },
  {
    key: "fantasypros-projections",
    freshnessKey: "fantasypros_proj",
    label: "FantasyPros Projections",
    kind: "Projection",
    file: `/projections_fantasypros_${season}.json`,
  },
  {
    key: "fantasycalc",
    freshnessKey: "fc",
    label: "FantasyCalc",
    kind: "Value",
    file: "/fantasycalc_cache.json",
  },
  {
    key: "dynastyprocess",
    freshnessKey: "dp",
    label: "DynastyProcess",
    kind: "Value",
    file: "/dynastyprocess_cache.json",
  },
  {
    key: "ktc",
    freshnessKey: "ktc",
    label: "KeepTradeCut",
    kind: "Value",
    file: "/ktc_cache.json",
  },
  {
    key: "fantasynav",
    freshnessKey: "fn",
    label: "Fantasy Navigator",
    kind: "Value",
    file: "/fantasynav_cache.json",
  },
  {
    key: "fantasypros",
    freshnessKey: "fp",
    label: "FantasyPros Trade Values",
    kind: "Value",
    file: "/fantasypros_cache.json",
  },
  {
    key: "fantasypros-ecr",
    freshnessKey: "fantasypros_ecr",
    label: "FantasyPros ECR Rank Score",
    kind: "Value",
    file: "/fantasypros_ecr_cache.json",
  },
  {
    key: "idynastyp",
    freshnessKey: "idp",
    label: "IDynastyP",
    kind: "Value",
    file: "/idynastyp_cache.json",
  },
  {
    key: "idpshow",
    freshnessKey: "idpshow",
    label: "IDP Show",
    kind: "Value",
    file: "/idpshow_cache.json",
  },
];
const SOURCE_METHODS = {
  ffa: {
    origin: "Imported projection dataset",
    method: "Season projection rows are matched to Arsenal player identities and retained in fantasy-point units.",
    use: "Season outlooks and cross-source projection comparisons.",
    limits: "Coverage and scoring fields depend on the supplied projection file.",
  },
  espn: {
    origin: "ESPN public projection data",
    method: "Season projections are collected, normalized by player identity, and retained as projected fantasy points.",
    use: "Redraft outlooks, player comparisons, and projection consensus.",
    limits: "A publisher projection is an estimate and may change without notice.",
  },
  cbs: {
    origin: "CBS public projection data",
    method: "Season projections are collected and normalized without converting them into trade values.",
    use: "Redraft outlooks and projection consensus.",
    limits: "Only successfully matched, positive player projections enter coverage.",
  },
  sleeper: {
    origin: "Sleeper projection feed",
    method: "Sleeper player projections are matched to the shared player index with separate Standard, Half PPR, and PPR totals.",
    use: "Lineup and weekly context; lower-priority input in Arsenal consensus where coverage is inconsistent.",
    limits: "Sleeper coverage and scoring assumptions can differ from other season sources.",
  },
  fantasysharks: {
    origin: "FantasySharks published projection file",
    method: "The latest validated season file is normalized into player projection rows.",
    use: "Independent projection comparison and consensus.",
    limits: "Automated retrieval can be blocked; a failed run preserves the last valid file and reports it as stale.",
  },
  draftsharks: {
    origin: "DraftSharks public season rankings",
    method: "Four distinct published boards are collected: Standard, Half PPR, PPR, and TE Premium. Available analysis links remain attached as source context.",
    use: "Season projections, comparisons, and player research.",
    limits: "Availability and coverage are controlled by the publisher’s public response.",
  },
  "fantasypros-projections": {
    origin: "Official FantasyPros API",
    method: "Projected player statistics are scored into Standard, Half PPR, and PPR fantasy-point totals.",
    use: "Scoring-specific season projections across Arsenal tools.",
    limits: "These are projections—not ECR ranks or trade values—and accuracy can only be graded against finalized results.",
  },
  "arsenal-model": {
    origin: "The Fantasy Arsenal stat projection model",
    method: "Safe/Expected weekly outcomes combine prior production, role and usage, schedule, matchup, team environment, health, weather when available, and an external-only projection anchor. Weekly outputs are summed into Standard, Half PPR, and PPR season totals.",
    use: "The official Arsenal projection for weekly decisions and season outlooks, with confidence and matchup-aware weekly rows.",
    limits: "Age and experience are evidence—not automatic point penalties—because publishers already price them into forecasts. The result still inherits uncertainty and missing-player risk from its inputs.",
  },
  "arsenal-average": {
    origin: "Calculated average of all projection sources",
    method: "Independent publisher projections and the Arsenal Safe/Expected model are blended with source weights, scoring-format support, duplicate-source protection, and outlier trimming.",
    use: "A broad all-source season projection that reduces dependence on any single forecast.",
    limits: "This derived ensemble is excluded from independent-source disagreement calculations so it cannot compare against itself.",
  },
  fantasycalc: {
    origin: "FantasyCalc published market data",
    method: "The first-party API supplies 36 distinct boards: dynasty/redraft, 1QB/Superflex, Standard/Half/PPR, and no TEP/TE+/TE++. The exact selected board is retained; PPR/no-TEP remains the backward-compatible default.",
    use: "Trade-market comparison and roster valuation.",
    limits: "Values represent a market estimate, not expected fantasy points.",
  },
  dynastyprocess: {
    origin: "DynastyProcess published data",
    method: "Published 1QB and Superflex dynasty values are matched to Arsenal player identities.",
    use: "Dynasty trade-market and portfolio comparisons.",
    limits: "Dynasty-only; it should not be treated as a redraft projection.",
  },
  ktc: {
    origin: "KeepTradeCut public market rankings",
    method: "Public 1QB and Superflex dynasty market values are captured and normalized by player identity.",
    use: "Crowd-market dynasty valuation and disagreement analysis.",
    limits: "Crowd sentiment can move quickly and is not a projection of points.",
  },
  fantasynav: {
    origin: "Fantasy Navigator public data response",
    method: "The newest row per player and format is retained, then shared name, zero-value, and position corrections are applied.",
    use: "Dynasty and redraft market comparisons.",
    limits: "Historical duplicate snapshots and publisher anomalies are excluded from the active board.",
  },
  fantasypros: {
    origin: "Official FantasyPros Dynasty Trade Value Chart CSV",
    method: "FantasyPros’ published Trade Value, Superflex Value, and TE Premium Value numbers are preserved; Arsenal multiplies them by 100 only for display-scale compatibility.",
    use: "Official published dynasty trade values and package comparison.",
    limits: "Dynasty-only, monthly-chart data; the original number remains available as source_value.",
  },
  "fantasypros-ecr": {
    origin: "Official FantasyPros consensus-rankings API",
    method: "The actual ECR order is preserved, then rank 1 through the last ranked player is mapped to an Arsenal 10,000–100 display score.",
    use: "Rank-based player ordering across dynasty/redraft, 1QB/Superflex, and supported redraft scoring boards.",
    limits: "Ordinal and directional—not an official FantasyPros trade value and not reliably additive in packages.",
  },
  idynastyp: {
    origin: "IDynastyP published IDP values",
    method: "The first-party feed's four explicit columns are preserved: 1QB, 1QB TEP, Superflex, and Superflex TEP.",
    use: "IDP dynasty roster and trade evaluation.",
    limits: "Designed for IDP formats; offensive-only leagues should use an offensive value source.",
  },
  idpshow: {
    origin: "The IDP Show published values",
    method: "Published IDP rows are normalized and matched to the shared player index.",
    use: "Independent IDP dynasty valuation.",
    limits: "Coverage and formats follow the current published source data.",
  },
  stickypicky: {
    origin: "Arsenal calculated value consensus",
    method: "Multiple eligible market sources are converted to comparable rank percentiles, blended with source weighting and anomaly controls, then returned on a shared scale.",
    use: "A scale-neutral consensus when publishers use incompatible raw value ranges.",
    limits: "It is an Arsenal estimate, not a separately published market; confidence depends on input coverage and agreement.",
  },
};
const num = (value) => Number(value || 0);
const rowsOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.players) ? data.players : Array.isArray(data?.data) ? data.data : Object.values(data?.by_id || {}));
const dateOf = (data) => data?.updated || data?.updated_at || data?.generated_at || data?.source_date || null;
const playerName = (row) =>
  String(row?.name || row?.player?.name || row?.player_name || row?.full_name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const pointsOf = (row) => num(row?.points ?? row?.points_ppr ?? row?.projection ?? row?.projected_points ?? row?.pts ?? row?.value);
const sourcePopulation = (data) => {
  const identities = new Set();
  const add = (row, fallbackName = "") => {
    if (!row || typeof row !== "object") return;
    const identity = String(row.player_id || row.sleeper_id || row.player?.sleeperId || row.name || row.full_name || row.player_name || row.player?.name || fallbackName || "").trim().toLowerCase();
    if (identity) identities.add(identity);
  };
  rowsOf(data).forEach((row) => add(row));
  Object.entries(data || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((row) => add(row));
    else if (value && typeof value === "object" && !["formats", "metadata"].includes(key)) add(value, key);
  });
  Object.values(data?.formats || {}).forEach((rows) => (Array.isArray(rows) ? rows.forEach((row) => add(row)) : null));
  return identities.size;
};
async function fetchJsonWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
async function fetchPublicAsset(path) {
  const cleanPath = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  const candidates = [cleanPath, `https://thefantasyarsenal.com${cleanPath}`];
  let lastError = null;
  for (const url of [...new Set(candidates)]) {
    try {
      return await fetchJsonWithTimeout(url, { cache: "no-store" });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to load ${cleanPath}`);
}
const FORMAT_KEYS = {
  dynasty_sf: "Dynasty_SF",
  dynasty_1qb: "Dynasty_1QB",
  redraft_sf: "Redraft_SF",
  redraft_1qb: "Redraft_1QB",
};
function normalizeValueRows(source, data, format, scoring = "ppr") {
  const sf = format.endsWith("_sf");
  const dynasty = format.startsWith("dynasty");
  const list = (rows, value = (row) => row?.value) =>
    (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        name: row?.name || row?.player?.name || "",
        position: row?.position || row?.pos || row?.player?.position || "",
        team: row?.team || row?.player?.maybeTeam || "",
        value: num(value(row)),
        trend: num(row?.trend30Day),
        sourceDate: row?.source_date || null,
      }))
      .filter((row) => row.name && row.value > 0);
  if (source.key === "fantasycalc") return list(data?.[FORMAT_KEYS[format]]);
  if (source.key === "dynastyprocess") {
    if (!dynasty) return [];
    return Object.entries(data || {})
      .filter(([, row]) => row && typeof row === "object")
      .map(([name, row]) => ({
        name,
        position: row.pos || "",
        team: row.team || "",
        value: num(sf ? row.superflex : row.one_qb),
      }))
      .filter((row) => row.value > 0);
  }
  if (source.key === "ktc") return dynasty ? list(data?.[sf ? "Superflex" : "OneQB"]) : [];
  if (source.key === "fantasynav") return list(data?.[FORMAT_KEYS[format]]);
  if (source.key === "fantasypros") return dynasty ? list(data?.[FORMAT_KEYS[format]]) : [];
  if (source.key === "fantasypros-ecr") return list(data?.formats?.[dynasty ? FORMAT_KEYS[format] : `${FORMAT_KEYS[format]}_${String(scoring).toUpperCase()}`]);
  if (source.key === "idynastyp") {
    if (!dynasty) return [];
    return list(Array.isArray(data) ? data : [], (row) => (sf ? row.superflex : row.one_qb));
  }
  if (source.key === "idpshow" || source.key === "stickypicky") return list(data?.[FORMAT_KEYS[format]]);
  return [];
}
function latestSourceDate(rows) {
  const dates = rows
    .map((row) => row.sourceDate)
    .filter(Boolean)
    .sort();
  return dates.at(-1) || null;
}
const age = (date) => {
  const ms = Date.now() - new Date(date).getTime();
  if (!date || !Number.isFinite(ms)) return "Unknown";
  const hours = Math.max(0, ms / 36e5);
  return hours < 1 ? "Under 1 hour" : hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`;
};
const freshness = (date) => {
  const days = (Date.now() - new Date(date).getTime()) / 864e5;
  return !date ? "unknown" : days <= 2 ? "fresh" : days <= 8 ? "watch" : "stale";
};
const tone = {
  fresh: "text-emerald-100 bg-emerald-300/[0.07] border-emerald-300/15",
  watch: "text-amber-100 bg-amber-300/[0.07] border-amber-300/15",
  stale: "text-rose-100 bg-rose-300/[0.07] border-rose-300/15",
  unknown: "text-white/50 bg-white/[0.04] border-white/10",
};
const rankMap = (rows, key) => new Map([...rows].sort((a, b) => num(key(b)) - num(key(a))).map((row, index) => [row.name, index + 1]));
function rankCorrelation(pairs) {
  if (pairs.length < 3) return null;
  const projected = rankMap(pairs, (row) => row.projected);
  const actual = rankMap(pairs, (row) => row.actual);
  const n = pairs.length;
  const sum = pairs.reduce((total, row) => total + Math.pow(num(projected.get(row.name)) - num(actual.get(row.name)), 2), 0);
  return 1 - (6 * sum) / (n * (n * n - 1));
}
function scoreWithLeagueSettings(stats, scoring) {
  return Object.entries(scoring || {}).reduce((total, [key, multiplier]) => total + num(stats?.[key]) * num(multiplier), 0);
}
function isPprComparable(scoring) {
  const rec = num(scoring?.rec);
  const unusual = Object.entries(scoring || {}).some(([key, value]) => num(value) !== 0 && /bonus|fd|fum_ret|kr_|pr_|idp|tackle|sack|def_|fgm_/i.test(key));
  return Math.abs(rec - 1) < 0.01 && !unusual;
}

function Panel({ children, className = "" }) {
  return <section className={`rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}>{children}</section>;
}
function ledgerMetric(label, value, detail) {
  if (typeof window === "undefined" || !["Resolved recommendations", "Observed benefit", "Selection bias"].includes(label)) return { value, detail };
  let actions = {};
  try {
    actions = JSON.parse(localStorage.getItem("tfa:intelligence-actions") || "{}");
  } catch {}
  const rows = Object.values(actions || {});
  const completed = rows.filter((row) => row.status === "completed");
  const resolved = completed.filter((row) => ["helped", "did-not-help"].includes(row.outcome));
  const helped = resolved.filter((row) => row.outcome === "helped").length;
  const dismissed = rows.filter((row) => row.status === "dismissed").length;
  if (label === "Resolved recommendations")
    return {
      value: resolved.length,
      detail: `${completed.length - resolved.length} completed decisions still await outcome feedback`,
    };
  if (label === "Observed benefit")
    return {
      value: resolved.length ? `${Math.round((helped / resolved.length) * 100)}%` : "—",
      detail: resolved.length ? `${helped} of ${resolved.length} outcomes marked helpful` : "Mark completed decisions helpful or not helpful",
    };
  return {
    value: dismissed,
    detail: `Dismissed advice stays separate from ${resolved.length} rated outcome${resolved.length === 1 ? "" : "s"}`,
  };
}
function Metric({ label, value, detail }) {
  const display = ledgerMetric(label, value, detail);
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="text-[9px] font-bold uppercase tracking-[.16em] text-white/30">{label}</div>
      <div className="mt-1 text-2xl font-black">{display.value}</div>
      <div className="mt-1 text-[10px] leading-4 text-white/35">{display.detail}</div>
    </div>
  );
}
function Type({ children, type }) {
  const styles = type === "Fact" ? "bg-emerald-300/10 text-emerald-100" : type === "Estimate" ? "bg-cyan-300/10 text-cyan-100" : "bg-violet-300/10 text-violet-100";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${styles}`}>{children || type}</span>;
}
function SourceLedger({ records }) {
  return (
    <div className="mt-4 space-y-4">
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black">Source methodology library</h2>
              <Type type="Fact" />
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">Coverage, freshness, and methodology live together here. A source can contain players while not publishing the selected league format; that is labeled unavailable instead of incorrectly reporting zero players.</p>
          </div>
          <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] px-4 py-3 text-xs text-cyan-100">{records.length} monitored sources</div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {[
            ["Published value", "A publisher supplies a numeric market value."],
            ["Rank-derived score", "A published order is mapped to a display score."],
            ["Projection", "Expected fantasy points, never a trade value."],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-2xl border border-white/[0.07] bg-black/15 p-4">
              <div className="text-xs font-black">{title}</div>
              <p className="mt-1 text-[10px] leading-4 text-white/35">{detail}</p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {records.map((source) => {
          const method = SOURCE_METHODS[source.key] || {};
          return (
            <Panel key={source.key} className="overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-white/28">{source.kind} source</div>
                    <h3 className="mt-1 text-lg font-black">{source.label}</h3>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${tone[freshness(source.updated)]}`}>{freshness(source.updated)}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Metric label={source.supported ? "Selected board" : "Players stored"} value={(source.supported ? source.coverage : source.filePopulation).toLocaleString()} detail={source.supported ? `${source.filePopulation.toLocaleString()} unique players stored across the file` : "Selected format is not published by this source"} />
                  <Metric label="Age" value={age(source.updated)} detail={source.updated ? new Date(source.updated).toLocaleString() : "No timestamp"} />
                </div>
              </div>
              <details className="group border-t border-white/[0.07] bg-black/15" open={source.key === "fantasypros" || source.key === "fantasypros-ecr"}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-xs font-black text-cyan-100">
                  How this source works <span className="text-lg font-light transition group-open:rotate-45">+</span>
                </summary>
                <div className="space-y-3 border-t border-white/[0.05] px-5 pb-5 pt-4">
                  {[
                    ["Data origin", method.origin],
                    ["Arsenal handling", method.method],
                    ["Best use", method.use],
                    ["Important limit", method.limits],
                  ].map(([label, detail]) => (
                    <div key={label}>
                      <div className="text-[8px] font-black uppercase tracking-[.16em] text-white/25">{label}</div>
                      <p className="mt-1 text-[10px] leading-4 text-white/45">{detail || "Methodology is being documented."}</p>
                    </div>
                  ))}
                </div>
              </details>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
function ValueIntelligence({ metrics, records, valueFormat, valueScoring }) {
  const valueSources = records.filter((source) => source.kind === "Value");
  const ecr = records.find((source) => source.key === "fantasypros-ecr");
  const ecrKey = valueFormat.startsWith("dynasty") ? FORMAT_KEYS[valueFormat] : `${FORMAT_KEYS[valueFormat]}_${String(valueScoring).toUpperCase()}`;
  const expertMeta = ecr?.data?.experts_by_format?.[ecrKey] || {};
  const experts = Object.entries(expertMeta.names || {})
    .map(([id, name]) => ({ id, name, twitter: expertMeta.twitter?.[id] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (valueFormat.startsWith("dynasty")) valueScoring = "scoring-neutral";
  return (
    <div className="mt-4 space-y-4">
      {/* <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black">Value-market audit</h2>
              <Type type="Fact" />
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">Values are trade-market estimates, not fantasy-point predictions. They are audited through freshness, coverage, source agreement, movement, and independent-source support—not by pretending weekly points determine dynasty value.</p>
          </div>
          <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] px-4 py-3 text-xs text-cyan-100">
            {valueFormat.replace("_", " · ").toUpperCase()} · {valueScoring.toUpperCase()}
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {valueSources.map((source) => (
            <div key={source.key} className="rounded-2xl border border-white/[0.07] bg-black/15 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-black">{source.label}</div>
                  <div className="mt-1 text-[9px] text-white/28">{source.supported ? "Selected board available" : `Not published for this format · ${source.filePopulation.toLocaleString()} stored players`}</div>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[8px] font-bold ${tone[freshness(source.updated)]}`}>{freshness(source.updated)}</span>
              </div>
              <div className="mt-4 text-2xl font-black">{source.supported ? source.coverage.toLocaleString() : "—"}</div>
              <div className="text-[9px] uppercase tracking-wider text-white/28">{source.supported ? "players on selected board" : `${source.filePopulation.toLocaleString()} players stored · format unavailable`}</div>
              {source.sourceDataDate ? <div className="mt-3 text-[9px] text-amber-100/55">Publisher date {source.sourceDataDate}</div> : null}
            </div>
          ))}
        </div>
      </Panel> */}
      <Panel className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-black">What FantasyPros ECR means</h2>
          <Type type="Estimate" />
        </div>
        <p className="mt-3 text-sm leading-6 text-white/48">
          ECR is the actual numerical order created from participating experts’ rankings. The Arsenal preserves FantasyPros’ published rank, range, average, standard deviation, and contributor count. For compatibility with value-sorted tools, rank 1 maps to 10,000 and the bottom ranked player maps to 100 within that exact board. That display score is <b className="text-white/75">not a FantasyPros trade value</b> and package totals should be treated as directional—not additive market prices.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Selected experts" value={expertMeta.total || experts.length || "—"} detail={`${expertMeta.ranking_type || "ECR"} · ${expertMeta.position === "OP" ? "Superflex" : "1QB"}`} />
          <Metric label="Scoring board" value={expertMeta.scoring || valueScoring.toUpperCase()} detail="Separate official consensus" />
          <Metric label="Last published" value={expertMeta.last_updated || "—"} detail="FantasyPros timestamp" />
        </div>
        <details className="mt-4 rounded-2xl border border-white/[0.07] bg-black/15 p-4">
          <summary className="cursor-pointer text-sm font-black">See the experts in this consensus ({experts.length})</summary>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {experts.map((expert) => (
              <div key={expert.id} className="rounded-xl bg-white/[0.035] p-3">
                <div className="text-xs font-bold">{expert.name}</div>
                {expert.twitter ? <div className="mt-1 text-[9px] text-cyan-100/50">@{String(expert.twitter).replace(/^@/, "")}</div> : null}
              </div>
            ))}
          </div>
        </details>
      </Panel>
      <SourceLedger records={records} />
    </div>
  );
}
function TrendIntelligence({ archive, metrics }) {
  const [moverSource, setMoverSource] = useState("all");
  const [moverSearch, setMoverSearch] = useState("");
  const days = [...(archive?.archives || [])].slice(0, 14).reverse();
  const maxFiles = Math.max(1, ...days.map((row) => num(row.files)));
  const moverSources = metrics.values.filter((source) => source.rows.some((row) => num(row.trend) !== 0));
  const movers = moverSources
    .filter((source) => moverSource === "all" || source.key === moverSource)
    .flatMap((source) => source.rows.filter((row) => num(row.trend) !== 0).map((row) => ({ ...row, source: source.label })))
    .filter((row) => !moverSearch || String(row.name || "").toLowerCase().includes(moverSearch.toLowerCase()))
    .sort((a, b) => Math.abs(num(b.trend)) - Math.abs(num(a.trend)))
    .slice(0, 25);
  const maxMove = Math.max(1, ...movers.map((row) => Math.abs(num(row.trend))));
  const partialDays = days.filter((row) => row.partial_update).length;
  return (
    <div className="mt-4 space-y-4">
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black">Archive and market trends</h2>
              <Type type="Fact" />
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">Daily archives show whether the data pipeline stayed complete. Player movement appears only when a publisher provides a dated trend field; the center does not manufacture movement from two unrelated source scales.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Archive days" value={days.length} detail="Latest retained window" />
            <Metric label="Partial runs" value={partialDays} detail="A stale source was preserved" />
          </div>
        </div>
        {days.length ? (
          <div className="mt-6 overflow-x-auto">
            <div className="flex min-w-[440px] items-end gap-2 border-b border-white/10 pb-2" style={{ height: 180 }}>
              {days.map((row) => (
                <div key={row.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${row.date}: ${row.files} files${row.partial_update ? " · partial update" : ""}`}>
                  <span className="text-[8px] text-white/30">{row.files}</span>
                  <div
                    className={`w-full rounded-t ${row.partial_update ? "bg-amber-300/55" : "bg-emerald-300/60"}`}
                    style={{
                      height: `${Math.max(8, (num(row.files) / maxFiles) * 115)}px`,
                    }}
                  />
                  <span className="rotate-[-35deg] whitespace-nowrap text-[8px] text-white/25">{row.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-[9px] text-white/35">
              <span>
                <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-300/60" />
                Complete
              </span>
              <span>
                <i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-300/55" />
                Partial / preserved stale input
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-xl bg-white/[0.03] p-4 text-sm text-white/38">No dated archives are available yet.</div>
        )}
      </Panel>
      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Panel className="overflow-hidden">
          <div className="border-b border-white/10 p-5">
            <h3 className="text-lg font-black">Top 25 market movers</h3>
            <p className="mt-1 text-xs text-white/38">Rotate through publishers or view every available movement feed together. Movement is source-supplied and remains on that publisher&apos;s scale.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <select value={moverSource} onChange={(event) => setMoverSource(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"><option value="all">All sources</option>{moverSources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select>
              <input value={moverSearch} onChange={(event) => setMoverSearch(event.target.value)} placeholder="Search a player…" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs" />
            </div>
          </div>
          <div className="divide-y divide-white/[0.055]">
            {movers.map((row, index) => (
              <div key={`${row.source}-${row.name}-${index}`} className="grid grid-cols-[30px_minmax(120px,.7fr)_minmax(160px,1fr)_64px] items-center gap-3 px-4 py-2.5">
                <span className="text-[10px] font-black text-white/25">#{index + 1}</span><div className="min-w-0"><div className="truncate text-xs font-bold">{row.name}</div><div className="truncate text-[8px] text-white/28">{row.source}</div></div>
                <div className="flex h-3 items-center"><div className={`h-2 rounded-full ${num(row.trend) > 0 ? "bg-gradient-to-r from-emerald-500/60 to-emerald-300" : "bg-gradient-to-r from-rose-500/60 to-rose-300"}`} style={{width:`${Math.max(3, Math.abs(num(row.trend)) / maxMove * 100)}%`}} /></div>
                <b className={`text-right text-sm ${num(row.trend) > 0 ? "text-emerald-100" : "text-rose-100"}`}>{num(row.trend) > 0 ? "+" : ""}{num(row.trend).toFixed(0)}</b>
              </div>
            ))}
            {!movers.length ? <div className="p-6 text-sm text-white/38">No matching player movement is published for this source and format.</div> : null}
          </div>
        </Panel>
        <Panel className="p-5">
          <h3 className="text-lg font-black">How value scales are compared</h3>
          <p className="mt-3 text-xs leading-5 text-white/42">
            Raw trade values are <b className="text-white/75">not</b> compared directly. Every source is first converted to a 0–100 market percentile within the selected format. Disagreement therefore means sources rank a player in materially different parts of their markets—not that one publisher happens to use 10,000 while another uses 100.
          </p>
          <div className="mt-4 rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.045] p-4 text-xs leading-5 text-cyan-100/65">Projection totals remain in fantasy points because they share a meaningful unit. Value rankings use percentiles because publisher scales do not.</div>
        </Panel>
      </div>
    </div>
  );
}
function ScaleDifferencePanel({ rows = [] }) {
  const [search, setSearch] = useState("");
  const [minimumSources, setMinimumSources] = useState(3);
  const [visible, setVisible] = useState(12);
  const filteredRows = rows.filter((row) => (!search || String(row.displayName || row.name).toLowerCase().includes(search.toLowerCase())) && num(row.sources) >= minimumSources);
  const maxSpread = Math.max(1, ...filteredRows.map((row) => num(row.spread)));
  return (
    <Panel className="mt-4 overflow-hidden">
      <div className="border-b border-white/10 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-black">Greatest cross-source differences</h2>
          <Type type="Estimate" />
        </div>
        <p className="mt-2 text-xs leading-5 text-white/42">Players are ranked by the range of their normalized market percentiles. Expand a row to see which sources are highest and lowest while retaining each publisher’s original raw value.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_190px]"><input value={search} onChange={(event) => { setSearch(event.target.value); setVisible(12); }} placeholder="Search disagreement by player…" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs" /><select value={minimumSources} onChange={(event) => setMinimumSources(num(event.target.value))} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs"><option value="3">3+ sources</option><option value="4">4+ sources</option><option value="5">5+ sources</option></select></div>
      </div>
      <div className="grid gap-px bg-white/[0.05] md:grid-cols-2">
        {filteredRows.slice(0, visible).map((row, index) => (
          <details key={row.name} className="group min-w-0 bg-slate-950/90 p-4">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <span className="text-xs font-black text-white/25">#{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{row.displayName}</div>
                <div className="text-[9px] text-white/30">
                  {row.sources} sources · percentile range {row.low.toFixed(0)}–{row.high.toFixed(0)}
                </div>
              </div>
              <b className="text-lg text-amber-100">{row.spread.toFixed(0)}%</b>
            </summary>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.055]"><div className="h-full rounded-full bg-gradient-to-r from-amber-400/60 to-rose-300" style={{width:`${Math.max(3, num(row.spread) / maxSpread * 100)}%`}} /></div>
            <div className="mt-3 space-y-1.5">
              {row.leaders.map((entry) => (
                <div key={entry.source} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-white/55">{entry.source}</span>
                  <span className="shrink-0">
                    <b>{entry.comparable.toFixed(0)}th</b> <small className="text-white/28">raw {Math.round(entry.raw).toLocaleString()}</small>
                  </span>
                </div>
              ))}
            </div>
          </details>
        ))}
        {!filteredRows.length ? <div className="p-6 text-sm text-white/38">No players match these disagreement filters.</div> : null}
      </div>
      {visible < filteredRows.length ? <button type="button" onClick={() => setVisible((count) => count + 12)} className="m-4 w-[calc(100%-2rem)] rounded-xl border border-white/10 bg-white/[0.035] py-3 text-xs font-black text-cyan-100">Show 12 more disagreements</button> : null}
    </Panel>
  );
}
function LeagueAccuracySummary({ accuracy, leagues, leagueId, onLeagueChange, onRetry }) {
  return (
    <div className="mt-4 space-y-4">
      <Panel className="p-5 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black">League scoring accuracy</h2>
              <Type type="Fact" />
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">Choose one of your leagues. The center follows its Sleeper history back to 2025, rebuilds actual player scoring from that season’s scoring settings, and then measures how useful each projection ranking was for that specific league.</p>
          </div>
          <label>
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">League</span>
            <select value={leagueId} onChange={(event) => onLeagueChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm">
              <option value="">Generic PPR</option>
              {leagues.map((league) => (
                <option key={league.league_id} value={league.league_id}>
                  {league.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {accuracy.status === "loading" ? (
          <div className="mt-5 rounded-2xl bg-cyan-300/[0.05] p-4 text-sm text-cyan-100">Following league history and rebuilding 2025 scoring…</div>
        ) : accuracy.status === "unavailable" ? (
          <div className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.05] p-4">
            <div className="text-sm font-bold text-rose-100">Accuracy data could not be completed</div>
            <p className="mt-1 text-xs text-rose-100/55">{accuracy.message || "Sleeper scoring or the historical projection files were unavailable."}</p>
            <button type="button" onClick={onRetry} className="mt-3 rounded-xl bg-rose-300/10 px-4 py-2 text-xs font-black text-rose-100">
              Try again
            </button>
          </div>
        ) : accuracy.status === "ready" ? (
          <>
            {accuracy.fallbackMessage ? <div className="mt-5 rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.04] p-4 text-xs leading-5 text-cyan-100/60">{accuracy.fallbackMessage}</div> : null}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label="Scoring profile" value={accuracy.leagueName} detail={`${accuracy.leagueSeason} league settings`} />
              <Metric label="Completed weeks" value={accuracy.completedWeeks || 18} detail={accuracy.partial ? "Partial Sleeper response" : "Final scoring loaded"} />
              <Metric label="Snapshot" value="Preseason 2025" detail="Pinned, immutable Git evidence" />
            </div>
            <div className="mt-4 rounded-2xl border border-emerald-300/12 bg-emerald-300/[0.04] p-4 text-xs leading-5 text-emerald-100/65">
              <b>Frozen preseason evidence:</b> FFA, ESPN, and CBS load from the repository commit captured August 31â€“September 2, 2025, before regular-season results. Arsenal 2025 consensus is recalculated only from those frozen inputs and is labeled derived. Commit <span className="font-mono">{accuracy.snapshotCommit?.slice(0, 8) || "unavailable"}</span>.
            </div>
          </>
        ) : null}
      </Panel>
      {accuracy.status === "ready" ? (
        <Panel className="overflow-hidden">
          <div className="border-b border-white/10 p-5">
            <h3 className="text-xl font-black">Source performance in {accuracy.leagueName}</h3>
            <p className="mt-1 text-xs leading-5 text-white/38">Rank correlation ranges from −1 to 1; higher means projected ordering better matched final ordering. Top-50 hit rate is the percentage of projected top-50 players who actually finished top 50 under this league’s scoring.</p>
          </div>
          <div className="grid gap-px bg-white/[0.06] md:grid-cols-3">
            {accuracy.rows.map((row) => (
              <div key={row.source} className="bg-slate-950/90 p-5">
                <div className="font-black">{row.source}</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Metric label="Rank correlation" value={row.correlation == null ? "—" : row.correlation.toFixed(3)} detail={`${row.sample} matched players`} />
                  <Metric label="Top-50 hit" value={row.top50 == null ? "—" : `${row.top50.toFixed(0)}%`} detail="League scoring finishers" />
                </div>
                <div className="mt-3 rounded-xl bg-white/[0.025] p-3 text-[10px] leading-4 text-white/35">{accuracy.comparable ? `Point MAE is also comparable because this league is close to standard PPR: ${row.mae?.toFixed(1) || "—"} points.` : "Exact point MAE is withheld because the stored projections are generic PPR totals without full projected stat lines. Ranking metrics remain valid for this custom scoring profile."}</div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function HistoricalModelValidation({ calibration }) {
  const positions = Object.entries(calibration?.by_position || {});
  if (!positions.length) return null;
  return (
    <Panel className="mt-4 overflow-hidden">
      <div className="border-b border-white/10 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-black">Arsenal model · untouched 2025 holdout</h2>
          <Type type="Fact" />
        </div>
        <p className="mt-2 max-w-4xl text-xs leading-5 text-white/42">This is the leakage-safe test used to tune the current model: train on 2023, tune architecture on 2024, evaluate once on untouched 2025 games, then refit the accepted architecture for 2026. It is model validation, not a claim that the repository stored public pre-kickoff 2025 forecasts.</p>
      </div>
      <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-4">
        {positions.map(([position, row]) => (
          <div key={position} className="bg-slate-950/90 p-5">
            <div className="flex items-center justify-between">
              <b className="text-lg">{position}</b>
              <span className={`rounded-full px-2 py-1 text-[8px] font-black ${row.promotion?.promoted ? "bg-emerald-300/10 text-emerald-100" : "bg-cyan-300/10 text-cyan-100"}`}>{row.promotion?.promoted ? "CHALLENGER PROMOTED" : "INCUMBENT RETAINED"}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric label="2025 sample" value={num(row.validation_sample).toLocaleString()} detail="Player-games" />
              <Metric label="Holdout MAE" value={num(row.holdout_trained?.mae).toFixed(3)} detail={`Baseline ${num(row.holdout_baseline?.mae).toFixed(3)}`} />
              <Metric label="Holdout RMSE" value={num(row.holdout_trained?.rmse).toFixed(3)} detail={`Baseline ${num(row.holdout_baseline?.rmse).toFixed(3)}`} />
              <Metric label="Rank correlation" value={num(row.holdout_trained?.rank_correlation).toFixed(3)} detail="Higher is better" />
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-4 text-[10px] text-white/35">
        Artifact: {calibration.version || "version unavailable"} · generated {calibration.generated_at ? new Date(calibration.generated_at).toLocaleString() : "date unavailable"} · no future games: {calibration.validation?.no_future_games ? "verified" : "not verified"}
      </div>
    </Panel>
  );
}

function ModelTransparency({ evidence, metrics }) {
  const calibration = evidence?.calibration;
  const audit = evidence?.audit;
  const forecastAccuracy = evidence?.accuracy;
  const positions = Object.entries(calibration?.by_position || {});
  const outcome = forecastAccuracy?.outcome_calibration;
  return (
    <div className="mt-4 space-y-4">
      <Panel className="overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black">Arsenal model evidence</h2>
              <Type type="Fact" />
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-white/42">This is the proof behind the weekly stat model: exact training populations, pre-2025 tuning, untouched 2025 holdout performance, immutable inputs, probability calibration, and release warnings. A challenger ships only after beating the incumbent on both MAE and RMSE and passing the live adjustment-distribution gate.</p>
          </div>
          <span className={`w-fit rounded-full border px-3 py-1.5 text-[9px] font-black uppercase tracking-wider ${audit?.status === "pass" ? tone.fresh : audit?.status === "warn" ? tone.watch : tone.stale}`}>{audit?.status || "unavailable"} pipeline</span>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {positions.map(([position, row]) => (
            <div key={position} className="rounded-2xl border border-white/[0.07] bg-black/15 p-4">
              <div className="flex items-center justify-between gap-2">
                <b>{position}</b>
                <span className="text-[9px] font-black text-emerald-100">-{num(row.holdout_mae_improvement).toFixed(3)} MAE</span>
              </div>
              <div className="mt-2 text-xl font-black">
                {num(row.holdout_baseline?.mae).toFixed(2)} &rarr; {num(row.holdout_trained?.mae).toFixed(2)}
              </div>
              <div className="mt-1 text-[9px] text-white/28">{num(row.validation_sample).toLocaleString()} untouched 2025 games</div>
              <div className="mt-2 text-[8px] font-black uppercase tracking-wider text-cyan-100/45">{row.promotion?.promoted ? "Challenger promoted" : "Validated incumbent retained"}</div>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-black">What the model actually knows</h3>
            <Type type="Estimate" />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ["Role and usage", "Recent form, snap share, snap trend, opportunity share and trend."],
              ["Scoring opportunity", "Red-zone share and receiving air-yard share when captured."],
              ["Game environment", "Team play pace, home/away, opponent field-level tendencies and real weather inside its forecast window."],
              ["Reliability controls", "Position-specific regularization, missing-value neutrality, bounded application strength and empirical residual ranges."],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-2xl border border-white/[0.06] bg-black/15 p-4">
                <b className="text-sm">{title}</b>
                <p className="mt-1 text-[10px] leading-4 text-white/38">{detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-amber-300/12 bg-amber-300/[0.04] p-4 text-[10px] leading-5 text-amber-100/60">
            <b>Not yet claimed:</b> archived historical betting lines, defensive injury units, route participation, pressure rate and receiver alignment are not silently estimated. Their adapters can join only after a lawful, timestamped provider is configured.
          </div>
        </Panel>
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-black">Probability scorecard</h3>
            <Type type="Fact" />
          </div>
          {outcome?.sample ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric label="Boom Brier" value={num(outcome.boom_brier).toFixed(3)} detail="Lower is better" />
              <Metric label="Bust Brier" value={num(outcome.bust_brier).toFixed(3)} detail="Lower is better" />
              <Metric label="Range coverage" value={`${(num(outcome.floor_ceiling_coverage) * 100).toFixed(0)}%`} detail={`${num(outcome.interval_sample)} final games`} />
              <Metric label="Calibration sample" value={num(outcome.sample).toLocaleString()} detail="Frozen forecasts" />
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.04] p-4 text-xs leading-5 text-cyan-100/55">The probability framework is calibrated on 2023–2025 history. Live Brier scores and interval coverage begin only after 2026 pre-kickoff snapshots have final results.</div>
          )}
        </Panel>
      </div>
      <Panel className="p-5">
        <details>
          <summary className="cursor-pointer text-lg font-black">Pipeline checks and current warnings</summary>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(audit?.checks || []).map((check) => (
              <div key={check.key} className="rounded-2xl border border-white/[0.07] bg-black/15 p-4">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-xs">{String(check.key).replaceAll("_", " ")}</b>
                  <span className={`rounded-full border px-2 py-1 text-[8px] font-black ${check.status === "pass" ? tone.fresh : check.status === "warn" ? tone.watch : tone.stale}`}>{check.status}</span>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-white/38">{check.message}</p>
              </div>
            ))}
          </div>
        </details>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-xl font-black">Projection disagreement</h2>
          <p className="mt-2 text-xs text-white/38">Largest ranges among players covered by at least three projection sources.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {metrics.disagreements.slice(0, 10).map((row) => (
              <div key={row.name} className="rounded-xl bg-violet-300/[0.04] p-3">
                <div className="truncate text-xs font-bold">{row.displayName || row.name || "Unknown player"}</div>
                <div className="mt-1 text-lg font-black text-violet-100">{row.spread.toFixed(0)}%</div>
                <div className="text-[9px] text-white/28">source range / mean</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-xl font-black">Value disagreement</h2>
          <p className="mt-2 text-xs text-white/38">Largest normalized market ranges for the selected value format.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {metrics.valueDisagreements.slice(0, 10).map((row) => (
              <div key={row.name} className="rounded-xl bg-amber-300/[0.04] p-3">
                <div className="truncate text-xs font-bold">{row.displayName || row.name || "Unknown player"}</div>
                <div className="mt-1 text-lg font-black text-amber-100">{row.spread.toFixed(0)}%</div>
                <div className="text-[9px] text-white/28">percentile range / mean</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function TrustCenterClient() {
  const { players, leagues = [] } = useSleeper();
  const [records, setRecords] = useState([]);
  const [archive, setArchive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [valueFormat, setValueFormat] = useState("dynasty_sf");
  const [valueScoring, setValueScoring] = useState("ppr");
  const [accuracy, setAccuracy] = useState({ status: "idle", rows: [] });
  const [accuracyLeagueId, setAccuracyLeagueId] = useState("");
  const [accuracyRun, setAccuracyRun] = useState(0);
  const [modelEvidence, setModelEvidence] = useState({
    calibration: null,
    audit: null,
    accuracy: null,
  });
  useEffect(() => {
    let live = true;
    (async () => {
      const [sourceRows, index, freshnessLedger, calibration, projectionAudit, projectionAccuracy] = await Promise.all([
        Promise.all(
          SOURCES.map(async (source) => {
            try {
              const data = await fetchPublicAsset(source.file);
              const rows = source.kind === "Value" ? normalizeValueRows(source, data, valueFormat, valueScoring) : rowsOf(data);
              return {
                ...source,
                data,
                rows,
                updated: dateOf(data),
                coverage: rows.filter((row) => pointsOf(row) > 0).length,
                filePopulation: sourcePopulation(data),
                status: "available",
                supported: source.kind !== "Value" || rows.length > 0,
                sourceDataDate: latestSourceDate(rows),
              };
            } catch {
              return {
                ...source,
                rows: [],
                updated: null,
                coverage: 0,
                filePopulation: 0,
                status: "unavailable",
                supported: false,
              };
            }
          }),
        ),
        fetch("/archive/index.json", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/source-freshness.json", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/stats/projections/model-calibration.json", {
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/stats/projections/${season}/audit.json`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/stats/projections/${season}/accuracy.json`, {
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (live) {
        setRecords(
          sourceRows.map((source) => {
            const ledger = freshnessLedger?.sources?.[source.freshnessKey];
            return {
              ...source,
              updated: source.updated || ledger?.last_success_at || index?.updated_at || null,
              updateStatus: ledger?.status || "unknown",
              lastAttempt: ledger?.last_attempt_at || null,
              lastError: ledger?.last_error || "",
            };
          }),
        );
        setArchive(index);
        setModelEvidence({
          calibration,
          audit: projectionAudit,
          accuracy: projectionAccuracy,
        });
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [valueFormat, valueScoring]);

  const metrics = useMemo(() => {
    const projections = records.filter((row) => row.kind === "Projection" && row.coverage);
    const values = records.filter((row) => row.kind === "Value" && row.coverage);
    const fresh = records.filter((row) => freshness(row.updated) === "fresh").length;
    const disagreement = (sources, { rankNormalize = false } = {}) => {
      const maps = sources.map((source) => {
        const usable = source.rows.filter((row) => pointsOf(row) > 0 && playerName(row)).sort((a, b) => pointsOf(b) - pointsOf(a));
        const denominator = Math.max(1, usable.length - 1);
        return new Map(
          usable.map((row, index) => [
            playerName(row),
            {
              raw: pointsOf(row),
              comparable: rankNormalize ? ((usable.length - index - 1) / denominator) * 100 : pointsOf(row),
              source: source.label,
            },
          ]),
        );
      });
      const displayNames = new Map(sources.flatMap((source) => source.rows.map((row) => [playerName(row), row.name || row.player?.name || "Unknown player"])));
      const common = [...new Set(maps.flatMap((map) => [...map.keys()]))]
        .map((name) => ({
          name,
          entries: maps.map((map) => map.get(name)).filter(Boolean),
        }))
        .filter((row) => row.entries.length >= 3);
      return common
        .map((row) => {
          const comparable = row.entries.map((entry) => entry.comparable);
          const high = Math.max(...comparable),
            low = Math.min(...comparable),
            mean = comparable.reduce((a, b) => a + b, 0) / comparable.length;
          return {
            ...row,
            values: comparable,
            displayName: displayNames.get(row.name) || row.name,
            spread: mean ? ((high - low) / mean) * 100 : 0,
            high,
            low,
            sources: row.entries.length,
            unit: rankNormalize ? "market percentile" : "projected points",
            leaders: [...row.entries].sort((a, b) => b.comparable - a.comparable),
          };
        })
        .sort((a, b) => b.spread - a.spread);
    };
    const disagreements = disagreement(projections.filter((source) => !source.derived));
    const valueDisagreements = disagreement(values, { rankNormalize: true });
    return {
      projections,
      values,
      fresh,
      disagreements,
      valueDisagreements,
      medianSpread: disagreements.length ? disagreements[Math.floor(disagreements.length / 2)].spread : 0,
      valueMedianSpread: valueDisagreements.length ? valueDisagreements[Math.floor(valueDisagreements.length / 2)].spread : 0,
      archives: archive?.archives?.length || 0,
    };
  }, [archive, records]);
  useEffect(() => {
    if (tab !== "accuracy" || !Object.keys(players || {}).length) return;
    let live = true;
    setAccuracy({ status: "loading", rows: [] });
    (async () => {
      try {
        const accuracySeason = season - 1;
        let league = leagues.find((row) => String(row.league_id) === String(accuracyLeagueId)) || null;
        while (league && num(league.season) > accuracySeason && league.previous_league_id) {
          league = await fetchJsonWithTimeout(`https://api.sleeper.app/v1/league/${league.previous_league_id}`, { cache: "force-cache" }, 10000).catch(() => null);
        }
        const requestedLeagueMissingHistory = !!accuracyLeagueId && (!league || num(league.season) !== accuracySeason);
        if (requestedLeagueMissingHistory) league = null;
        const [statsResult, snapshotResult] = await Promise.all([
          fetchJsonWithTimeout(`/api/trust-center/stats?season=${accuracySeason}`, { cache: "force-cache" }, 20000),
          fetchJsonWithTimeout(`/api/trust-center/historical-projections?season=${accuracySeason}`, { cache: "force-cache" }, 20000),
        ]);
        const frozenSources = (snapshotResult?.sources || []).filter((source) => source.available && source.data);
        const totals = new Map(Object.entries(statsResult?.totals || {}).map(([id, stats]) => [String(id), stats]));
        const scoring = league?.scoring_settings || {
          pass_yd: 0.04,
          pass_td: 4,
          pass_int: -2,
          rush_yd: 0.1,
          rush_td: 6,
          rec: 1,
          rec_yd: 0.1,
          rec_td: 6,
          fum_lost: -2,
        };
        const pprScoring = {
          pass_yd: 0.04,
          pass_td: 4,
          pass_int: -2,
          rush_yd: 0.1,
          rush_td: 6,
          rec: 1,
          rec_yd: 0.1,
          rec_td: 6,
          fum_lost: -2,
        };
        const comparable = isPprComparable(scoring);
        const actualByName = new Map(
          Object.entries(players || {})
            .map(([id, player]) => [playerName(player), scoreWithLeagueSettings(totals.get(String(id)), scoring)])
            .filter(([, points]) => points > 0),
        );
        const pprByName = new Map(
          Object.entries(players || {})
            .map(([id, player]) => [playerName(player), scoreWithLeagueSettings(totals.get(String(id)), pprScoring)])
            .filter(([, points]) => points > 0),
        );
        const sourcePlayerRows = frozenSources.map((source) => ({ ...source, rows: rowsOf(source.data) }));
        const consensusPlayers = new Map();
        sourcePlayerRows.forEach((source) => source.rows.forEach((row) => {
          const name = playerName(row);
          const projected = pointsOf(row);
          if (!name || projected <= 0) return;
          const values = consensusPlayers.get(name) || [];
          values.push(projected);
          consensusPlayers.set(name, values);
        }));
        const comparisonSources = [
          ...sourcePlayerRows,
          {
            label: "Arsenal 2025 consensus",
            derived: true,
            data: { updated: frozenSources.map((source) => dateOf(source.data)).filter(Boolean).sort().at(-1) },
            rows: [...consensusPlayers].filter(([, values]) => values.length >= 2).map(([name, values]) => ({ name, points: values.reduce((sum, value) => sum + value, 0) / values.length })),
          },
        ];
        const rows = comparisonSources
          .map((source) => {
            const data = source.data;
            const pairs = rowsOf(data)
              .concat(source.derived ? source.rows : [])
              .map((row) => ({
                name: playerName(row),
                projected: pointsOf(row),
                actual: num(actualByName.get(playerName(row))),
              }))
              .filter((row) => row.name && row.actual > 0 && row.projected > 0);
            const actualTop = new Set(
              [...pairs]
                .sort((a, b) => b.actual - a.actual)
                .slice(0, 50)
                .map((row) => row.name),
            );
            const projectedTop = [...pairs].sort((a, b) => b.projected - a.projected).slice(0, 50);
            const top50 = projectedTop.length ? (projectedTop.filter((row) => actualTop.has(row.name)).length / projectedTop.length) * 100 : null;
            const errors = pairs.map((row) => Math.abs(row.projected - num(pprByName.get(row.name)))).filter((value) => Number.isFinite(value));
            return {
              source: source.label,
              derived: !!source.derived,
              sample: pairs.length,
              mae: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
              correlation: rankCorrelation(pairs),
              top50,
              updated: dateOf(data),
            };
          })
          .filter((row) => row.sample);
        if (live)
          setAccuracy({
            status: rows.length ? "ready" : "unavailable",
            rows,
            season: accuracySeason,
            leagueName: league?.name || "Generic PPR",
            leagueSeason: league?.season || accuracySeason,
            comparable,
            retrospective: true,
            snapshotCommit: snapshotResult?.commit || "",
            completedWeeks: statsResult?.completedWeeks || 0,
            partial: !!statsResult?.partial,
            fallbackMessage: requestedLeagueMissingHistory ? "The selected league has no linked 2025 Sleeper season, so publisher comparisons below use generic PPR scoring. The Arsenal model holdout remains league-independent." : "",
          });
      } catch (error) {
        if (live)
          setAccuracy({
            status: "unavailable",
            rows: [],
            message: error?.name === "AbortError" ? "Scoring requests timed out. Try again." : error?.message || "Accuracy data could not be loaded.",
          });
      }
    })();
    return () => {
      live = false;
    };
  }, [accuracyLeagueId, accuracyRun, leagues, players, tab]);
  const tabs = [
    ["overview", "Trust overview"],
    ["values", "Sources & values"],
    ["trends", "Trends"],
    ["accuracy", "Projection accuracy"],
    ["models", "Model transparency"],
  ];

  return (
    <main className="min-h-screen text-white">
      <BackgroundParticles />
      <Navbar pageTitle="Trust & Accuracy Center" />
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-20">
        <header className="overflow-hidden rounded-[34px] border border-emerald-300/15 bg-[radial-gradient(circle_at_88%_0%,rgba(16,185,129,.2),transparent_38%),radial-gradient(circle_at_5%_100%,rgba(34,211,238,.14),transparent_34%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-5 sm:p-8">
          <div className="text-[10px] font-bold uppercase tracking-[.28em] text-emerald-200/60">Evidence before confidence</div>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">Trust & Accuracy Center</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/48">See exactly when data changed, how much sources cover and disagree, which claims are observed facts, and where the Arsenal is estimating or simulating. Missing evidence is shown as missing—never converted into a made-up score.</p>
        </header>
        {loading ? (
          <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.05] p-4 text-sm text-cyan-100">Auditing sources and archive coverage…</div>
        ) : (
          <>
            {tab === "values" || tab === "trends" ? (
              <Panel className="mt-5 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-cyan-200/45">Value audit format</div>
                    <p className="mt-1 text-xs text-white/38">Value coverage and disagreement change by league format. FantasyPros ECR has scoring-specific redraft rankings; its dynasty rankings are scoring-neutral.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={valueFormat}
                      onChange={(event) => {
                        setLoading(true);
                        setValueFormat(event.target.value);
                      }}
                      className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"
                    >
                      <option value="dynasty_sf">Dynasty · Superflex</option>
                      <option value="dynasty_1qb">Dynasty · 1QB</option>
                      <option value="redraft_sf">Redraft · Superflex</option>
                      <option value="redraft_1qb">Redraft · 1QB</option>
                    </select>
                    {valueFormat.startsWith("redraft") ? (
                      <select
                        value={valueScoring}
                        onChange={(event) => {
                          setLoading(true);
                          setValueScoring(event.target.value);
                        }}
                        className="rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm"
                      >
                        <option value="std">Standard</option>
                        <option value="half">Half PPR</option>
                        <option value="ppr">Full PPR</option>
                      </select>
                    ) : (
                      <div className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white/45">Scoring-neutral ECR</div>
                    )}
                  </div>
                </div>
              </Panel>
            ) : null}
            {tab === "overview" ? (
              <section className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Sources online" value={`${records.filter((r) => r.status === "available").length}/${records.length}`} detail="Readable source files" />
                <Metric label="Fresh sources" value={metrics.fresh} detail="Updated in 48 hours" />
                <Metric label="Projection coverage" value={metrics.projections.reduce((sum, r) => sum + r.coverage, 0).toLocaleString()} detail="Total source-player rows" />
                <Metric label="Projection disagreement" value={`${metrics.medianSpread.toFixed(1)}%`} detail="Median source range" />
                <Metric label="Audit snapshots" value={metrics.archives} detail="Daily immutable archives" />
              </section>
            ) : null}
            <Panel className="sticky top-14 z-30 mt-4 overflow-x-auto rounded-2xl bg-slate-950/95 p-2 backdrop-blur">
              <div className="flex w-max gap-1">
                {tabs.map(([key, label]) => (
                  <button key={key} onClick={() => setTab(key)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${tab === key ? "bg-emerald-300/10 text-emerald-100" : "text-white/40"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Panel>
            {tab === "values" ? <ValueIntelligence metrics={metrics} records={records} valueFormat={valueFormat} valueScoring={valueScoring} /> : null}
            {tab === "trends" ? (
              <>
                <TrendIntelligence archive={archive} metrics={metrics} />
                <ScaleDifferencePanel rows={metrics.valueDisagreements} />
              </>
            ) : null}
            {tab === "accuracy" ? (
              <>
                <HistoricalModelValidation calibration={modelEvidence.calibration} />
                <LeagueAccuracySummary accuracy={accuracy} leagues={leagues} leagueId={accuracyLeagueId} onLeagueChange={(value) => setAccuracyLeagueId(value)} onRetry={() => setAccuracyRun((value) => value + 1)} />
              </>
            ) : null}
            {tab === "overview" ? (
              <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-black">Freshness monitor</h2>
                      <p className="mt-1 text-[10px] text-white/32">Last success is when Arsenal retrieved the file. Source date is when the publisher says its underlying ranking changed.</p>
                    </div>
                    <Type type="Fact" />
                  </div>
                  <div className="mt-4 space-y-2">
                    {records.map((source) => (
                      <div key={source.key} className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                        <div className="grid grid-cols-[minmax(0,1fr)_80px_90px] items-center gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold">{source.label}</div>
                            <div className="mt-0.5 text-[9px] text-white/28">
                              {source.kind} · {source.coverage.toLocaleString()} covered
                            </div>
                          </div>
                          <span className={`rounded-full border px-2 py-1 text-center text-[9px] font-bold ${tone[freshness(source.updated)]}`}>{freshness(source.updated)}</span>
                          <time className="text-right text-[9px] text-white/35">{source.updated ? new Date(source.updated).toLocaleDateString() : "Unavailable"}</time>
                        </div>
                        {source.sourceDataDate ? <div className="mt-2 text-[9px] text-amber-100/55">Publisher data date: {source.sourceDataDate}</div> : null}
                        {source.lastError ? <div className="mt-2 text-[9px] text-rose-100/60">Last attempt failed: {source.lastError}</div> : null}
                      </div>
                    ))}
                  </div>
                </Panel>
                <div className="space-y-4">
                  <Panel className="p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-black">What changed?</h2>
                      <Type type="Fact" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/42">{archive?.archives?.[0]?.partial_update ? `The latest daily update was partial. Stale inputs: ${(archive.archives[0].stale_sources || []).join(", ") || "not specified"}. Existing files were preserved rather than replaced with incomplete data.` : "The latest archived run completed without a source being marked stale."}</p>
                    <div className="mt-4 rounded-2xl bg-white/[0.03] p-4 text-xs text-white/45">
                      Latest archive: <b className="text-white/75">{archive?.archives?.[0]?.date || "Not available"}</b> · {archive?.archives?.[0]?.files || 0} compressed snapshots
                    </div>
                  </Panel>
                  <Panel className="p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-black">How to read disagreement</h2>
                      <Type type="Estimate" />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-white/42">A 30% value range means the highest and lowest normalized source values differ by 30% of their average. It signals market uncertainty, format differences, or a fast-moving player—not automatically a bad source.</p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {["Coverage", "Agreement", "Freshness", "Context"].map((item) => (
                        <div key={item} className="rounded-xl bg-cyan-300/[0.04] p-3 text-xs font-bold text-cyan-100">
                          {item}
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              </div>
            ) : null}
            {false && tab === "accuracy" ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-black">Weekly projection accuracy</h2>
                    <Type type="Fact" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/45">
                    Daily dated projection archives began on <b className="text-white/75">{archive?.archives?.at(-1)?.date || "the first successful archive run"}</b>. Weekly accuracy becomes eligible only when a forecast was frozen before kickoff and actual fantasy scoring is final.
                  </p>
                  <div className="mt-4 rounded-2xl border border-amber-300/12 bg-amber-300/[0.05] p-4">
                    <div className="font-bold text-amber-100">Awaiting comparable {season} completed weeks</div>
                    <div className="mt-1 text-xs leading-5 text-amber-100/55">Season-long projections are not mislabeled as weekly forecasts. Sleeper weekly rows can be scored after games; other sources require matching weekly snapshots before they receive weekly rankings.</div>
                  </div>
                </Panel>
                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-black">Prior-season scoring check</h2>
                    <Type type="Fact" />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/42">Where a dated season projection file exists, it is compared with final PPR scoring from Sleeper. MAE is season points missed per matched player; lower is better.</p>
                  <div className="mt-4 space-y-2">
                    {accuracy.status === "loading" ? (
                      <div className="text-sm text-cyan-100">Matching projections to final scoring…</div>
                    ) : (
                      accuracy.rows.map((row) => (
                        <div key={row.source} className="grid grid-cols-[minmax(0,1fr)_70px_70px] items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                          <div>
                            <b className="text-sm">{row.source}</b>
                            <div className="text-[9px] text-white/28">
                              {row.sample} matched players · {accuracy.season}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-black">{row.mae.toFixed(1)}</div>
                            <div className="text-[8px] text-white/28">MAE</div>
                          </div>
                          <div className="text-right text-[9px] text-white/35">{row.updated ? new Date(row.updated).toLocaleDateString() : "Snapshot"}</div>
                        </div>
                      ))
                    )}
                    {accuracy.status === "unavailable" ? <div className="rounded-xl bg-white/[0.03] p-3 text-xs text-white/40">No comparable prior-season files and finalized scoring could be matched.</div> : null}
                  </div>
                </Panel>
                <Panel className="p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-black">Metrics reported as evidence grows</h2>
                    <Type type="Estimate" />
                  </div>
                  <div className="mt-4 space-y-2">
                    {[
                      ["MAE", "Average absolute points missed"],
                      ["RMSE", "Extra penalty for large misses"],
                      ["Rank correlation", "How well a source ordered players"],
                      ["Hit rate", "Players correctly placed within tolerance"],
                      ["Coverage", "Eligible players actually projected"],
                    ].map(([name, detail]) => (
                      <div key={name} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                        <b className="text-sm">{name}</b>
                        <p className="mt-1 text-[10px] text-white/35">{detail}</p>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel className="p-5">
                  <h2 className="text-xl font-black">Recommendation performance ledger</h2>
                  <p className="mt-2 text-xs leading-5 text-white/42">Saved and completed Arsenal Intelligence decisions will form the recommendation ledger. Lineup recommendations can be judged by points gained versus the alternative; waiver and trade decisions require longer outcome windows and stay open until that window closes.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                    <Metric label="Resolved recommendations" value="0" detail="Tracking begins with opted-in outcomes" />
                    <Metric label="Observed benefit" value="—" detail="Not enough resolved decisions" />
                    <Metric label="Selection bias" value="Disclosed" detail="Dismissed advice is tracked separately" />
                  </div>
                </Panel>
              </div>
            ) : null}
            {tab === "models" ? <ModelTransparency evidence={modelEvidence} metrics={metrics} /> : null}
          </>
        )}
      </div>
    </main>
  );
}
