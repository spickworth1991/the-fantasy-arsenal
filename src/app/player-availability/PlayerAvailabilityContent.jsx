"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

const Navbar = dynamic(() => import("../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(() => import("../../components/BackgroundParticles"), { ssr: false });

import LoadingScreen from "../../components/LoadingScreen";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";
import { toSlug } from "../../utils/slugify";

/** Helpers for league avatars (matches Player Stock) */
const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatarUrl = (avatarId) => (avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : DEFAULT_LEAGUE_IMG);
const sleeperLeagueUrl = (leagueId) => `https://sleeper.com/leagues/${leagueId}`;

// Player avatar helpers (no /api route required)
const DEFAULT_PLAYER_IMG = "/avatars/default.webp";
const playerAvatarUrl = (playerId) =>
  playerId ? `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` : DEFAULT_PLAYER_IMG;


function cleanNorm(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Robustly extract all player IDs from a Sleeper league rosters array */
function extractRosterIds(rosters) {
  const ids = new Set();
  if (!Array.isArray(rosters)) return ids;
  for (const r of rosters) {
    const buckets = [
      Array.isArray(r?.players) ? r.players : [],
      Array.isArray(r?.starters) ? r.starters : [],
      Array.isArray(r?.reserve) ? r.reserve : [], // IR
      Array.isArray(r?.taxi) ? r.taxi : [],
    ];
    for (const arr of buckets) {
      for (const id of arr) if (id != null) ids.add(String(id));
    }
  }
  return ids;
}

/** One-input inline name picker with disambiguation */
function NameSelect({ nameIndex, onPick, placeholder = "Search a player (e.g., Josh Allen)", className = "" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  const norm = (s = "") => cleanNorm(s);

  const suggestions = useMemo(() => {
    const nq = norm(q);
    if (!nq) return [];
    const exact = nameIndex.get(nq) || [];
    if (exact.length) return exact.slice(0, 10);

    const out = [];
    const seen = new Set();
    for (const [key, vals] of nameIndex.entries()) {
      if (key.startsWith(nq) || key.includes(nq)) {
        for (const v of vals) {
          if (!seen.has(v.id)) {
            seen.add(v.id);
            out.push(v);
            if (out.length >= 10) break;
          }
        }
      }
      if (out.length >= 10) break;
    }
    return out;
  }, [q, nameIndex]);

  useEffect(() => {
    const onClickAway = (e) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", onClickAway);
    return () => document.removeEventListener("click", onClickAway);
  }, []);

  const choose = (cand) => {
    onPick?.(cand);
    setQ("");
    setOpen(false);
    setHighlight(0);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        className="w-full bg-gray-900/70 border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 placeholder:text-white/40"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) setOpen(true);
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (suggestions[highlight]) choose(suggestions[highlight]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-gray-950 border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] max-h-72 overflow-auto">
          {suggestions.map((s, idx) => (
            <button
              key={`${s.id}-${idx}`}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => choose(s)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${idx === highlight ? "bg-white/5" : ""}`}
            >
              <div className="flex justify-between">
                <span className="text-white">{s.name}</span>
                <span className="text-white/55">
                  {s.pos}
                  {s.team ? ` • ${s.team}` : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================
// Projections (MATCH Trade Analyzer JSONs)
// =====================
const PROJ_JSON_URL = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL = "/projections_cbs_2025.json";

function normNameForMap(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeTeamAbbr(x) {
  const s = String(x || "").toUpperCase().trim();
  const map = { JAX: "JAC", LA: "LAR", STL: "LAR", SD: "LAC", OAK: "LV", WFT: "WAS", WSH: "WAS" };
  return map[s] || s;
}
function normalizePos(x) {
  const p = String(x || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return p;
}
function buildProjectionMapFromJSON(json) {
  const rows = Array.isArray(json) ? json : json?.rows || [];
  const byId = Object.create(null);
  const byName = Object.create(null);
  const byNameTeam = Object.create(null);
  const byNamePos = Object.create(null);

  rows.forEach((r) => {
    const pid = r.player_id != null ? String(r.player_id) : "";
    const name = r.name || r.player || r.full_name || "";
    const seasonPts = Number(r.points ?? r.pts ?? r.total ?? r.projection ?? 0) || 0;

    const rawTeam = r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team;
    const team = normalizeTeamAbbr(rawTeam);
    const rawPos = r.pos ?? r.position ?? r.player_position;
    const pos = normalizePos(rawPos);

    if (pid) byId[pid] = seasonPts;
    if (name) {
      const nn = normNameForMap(name);
      byName[nn] = seasonPts;
      byName[name.toLowerCase().replace(/\s+/g, "")] = seasonPts;
      if (team) byNameTeam[`${nn}|${team}`] = seasonPts;
      if (pos) byNamePos[`${nn}|${pos}`] = seasonPts;
    }
  });

  return { byId, byName, byNameTeam, byNamePos };
}
async function fetchProjectionMap(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return buildProjectionMapFromJSON(json);
  } catch {
    return null;
  }
}
function getSeasonPointsForPlayer(map, p) {
  if (!map || !p) return 0;

  const hit = map.byId?.[String(p.player_id)];
  if (hit != null) return hit;

  const nn = normNameForMap(p.full_name || p.search_full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim());
  const team = normalizeTeamAbbr(p.team);
  const pos = normalizePos(p.position);

  if (nn && team && map.byNameTeam?.[`${nn}|${team}`] != null) return map.byNameTeam[`${nn}|${team}`];
  if (nn && pos && map.byNamePos?.[`${nn}|${pos}`] !=null) return map.byNamePos[`${nn}|${pos}`];
  if (nn && map.byName?.[nn] != null) return map.byName[nn];

  const k2 = (p.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return k2 && map.byName?.[k2] != null ? map.byName[k2] : 0;
}

// =====================
// Values (MATCH Trade Analyzer player fields / JSON pipeline)
// =====================
const VALUE_SOURCES = {
  FantasyCalc: { label: "FantasyCalc", supports: { dynasty: true, redraft: true, qbToggle: true } },
  DynastyProcess: { label: "DynastyProcess", supports: { dynasty: true, redraft: false, qbToggle: true } },
  KeepTradeCut: { label: "KeepTradeCut", supports: { dynasty: true, redraft: false, qbToggle: true } },
  FantasyNavigator: { label: "FantasyNavigator", supports: { dynasty: true, redraft: true, qbToggle: true } },
  IDynastyP: { label: "IDynastyP", supports: { dynasty: true, redraft: false, qbToggle: true } },
  TheFantasyArsenal: { label: "TheFantasyArsenal", supports: { dynasty: true, redraft: true, qbToggle: true } },
};

function makeGetPlayerValue(valueSource, format, qbType) {
  return (p) => {
    if (!p) return 0;
    const fmt = (format || "dynasty").toLowerCase(); // dynasty | redraft
    const qb = (qbType || "sf").toLowerCase(); // sf | 1qb

    if (valueSource === "FantasyCalc") {
      if (fmt === "dynasty") return qb === "sf" ? Number(p.fc_values?.dynasty_sf || 0) : Number(p.fc_values?.dynasty_1qb || 0);
      return qb === "sf" ? Number(p.fc_values?.redraft_sf || 0) : Number(p.fc_values?.redraft_1qb || 0);
    }
    if (valueSource === "DynastyProcess") return qb === "sf" ? Number(p.dp_values?.superflex || 0) : Number(p.dp_values?.one_qb || 0);
    if (valueSource === "KeepTradeCut") return qb === "sf" ? Number(p.ktc_values?.superflex || 0) : Number(p.ktc_values?.one_qb || 0);
    if (valueSource === "FantasyNavigator") {
      if (fmt === "dynasty") return qb === "sf" ? Number(p.fn_values?.dynasty_sf || 0) : Number(p.fn_values?.dynasty_1qb || 0);
      return qb === "sf" ? Number(p.fn_values?.redraft_sf || 0) : Number(p.fn_values?.redraft_1qb || 0);
    }
    if (valueSource === "IDynastyP") return qb === "sf" ? Number(p.idp_values?.superflex || 0) : Number(p.idp_values?.one_qb || 0);
    if (valueSource === "TheFantasyArsenal") {
      if (fmt === "dynasty") return qb === "sf" ? Number(p.sp_values?.dynasty_sf || 0) : Number(p.sp_values?.dynasty_1qb || 0);
      return qb === "sf" ? Number(p.sp_values?.redraft_sf || 0) : Number(p.sp_values?.redraft_1qb || 0);
    }
    return 0;
  };
}

// =====================
// Premium UI helpers
// =====================
function Segmented({ value, onChange, options = [], className = "" }) {
  return (
    <div className={`inline-flex rounded-xl border border-white/10 bg-black/20 p-1 backdrop-blur ${className}`}>
      {options.map((opt) => {
        const active = String(value) === String(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange?.(opt.value)}
            className={[
              "px-3 py-2 text-xs md:text-sm rounded-lg transition whitespace-nowrap",
              active ? "bg-cyan-500/20 text-cyan-100 border border-cyan-400/30" : "text-white/70 hover:text-white hover:bg-white/5",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function StatPill({ label, value, onClick, title }) {
  const clickable = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        "flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm",
        clickable ? "hover:bg-white/10 cursor-pointer" : "cursor-default",
      ].join(" ")}
    >
      <span className="text-white/65">{label}</span>
      <span className="text-white font-semibold">{value}</span>
    </button>
  );
}

function PlayerOpenLeaguesModal({ open, onClose, player, leagues = [] }) {
  if (!open) return null;
  const title = player?.name ? player.name : "Player";
  const sub = leagues.length ? `${leagues.length} league(s) open` : "No open leagues";

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-gray-950 rounded-3xl shadow-[0_30px_120px_rgba(0,0,0,0.65)] p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
             <AvatarImage
                src={player?.id ? playerAvatarUrl(String(player.id)) : DEFAULT_PLAYER_IMG}
                fallbackSrc={DEFAULT_PLAYER_IMG}
                alt={title}
                className="w-10 h-10 rounded-full"
              />

              <div className="min-w-0">
                <div className="text-xl font-bold text-white truncate">{title}</div>
                <div className="text-sm text-white/60 truncate">
                  {player?.pos ? player.pos : "—"}
                  {player?.team ? ` • ${player.team}` : ""}
                  <span className="mx-2 text-white/25">•</span>
                  <span className="text-white/70">{sub}</span>
                </div>
              </div>
            </div>
          </div>
          <button className="rounded-xl px-3 py-2 border border-white/15 hover:bg-white/10 text-white/80" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[65vh] overflow-auto pr-1 space-y-2">
          {leagues.length === 0 ? (
            <div className="text-white/70 text-sm py-6">No leagues available for this player with your current filters.</div>
          ) : (
            leagues
              .slice()
              .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
              .map((lg) => (
                <a
                  key={lg.id}
                  href={sleeperLeagueUrl(lg.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
                  title="Opens Sleeper web (desktop)"
                >
                  <img
                    src={leagueAvatarUrl(lg.avatar || undefined)}
                    alt=""
                    className="w-9 h-9 rounded-xl object-cover bg-gray-700"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{lg.name}</div>
                    <div className="text-xs text-white/60 truncate">
                      {lg.isBestBall ? "Best Ball" : "Standard"}
                      {lg.status ? ` • ${lg.status}` : ""}
                    </div>
                  </div>
                  <div className="ml-auto text-xs text-cyan-300">Open →</div>
                </a>
              ))
          )}
        </div>

        <div className="mt-4 text-[11px] text-white/45">
          Trending data is provided by Sleeper. Availability is based on your scanned leagues + current filters.
        </div>
      </div>
    </div>
  );
}

// =====================
// Page
// =====================
export default function PlayerAvailabilityContent() {
  const { username, players, year, format, qbType } = useSleeper();

// local overrides (so you can toggle without mutating global context)
const [mode, setMode] = useState((format || "dynasty").toLowerCase()); // dynasty | redraft
const [qb, setQb] = useState((qbType || "sf").toLowerCase()); // sf | 1qb

// keep local defaults in sync if the context changes (login, league change, etc.)
useEffect(() => {
  setMode((format || "dynasty").toLowerCase());
}, [format]);

useEffect(() => {
  setQb((qbType || "sf").toLowerCase());
}, [qbType]);


  // Page init loading + Scan loading
  const [initLoading, setInitLoading] = useState(true);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanProgressPct, setScanProgressPct] = useState(0);
  const [scanProgressText, setScanProgressText] = useState("Preparing…");
  const [error, setError] = useState("");

  // Filters (match Player Stock style)
  const [onlyBestBall, setOnlyBestBall] = useState(false);
  const [excludeBestBall, setExcludeBestBall] = useState(false);
  const [includeDrafting, setIncludeDrafting] = useState(true);

  // Players & results for your manual selections
  const [selectedPlayers, setSelectedPlayers] = useState([]); // [{ id, name, pos, team }]
  const [results, setResults] = useState({}); // { [playerId]: { availableLeagues } }

  // Scan state
  const [scanLeagues, setScanLeagues] = useState([]); // [{id,name,avatar,isBestBall,status,roster_positions}]
  const [leagueCount, setLeagueCount] = useState(0);
  const [scanningError, setScanningError] = useState("");
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [showVisibleLeaguesModal, setShowVisibleLeaguesModal] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Per-league roster sets
  const rosterSetsRef = useRef(new Map());

  // Cache key (per user + season)
  const yrStr = String(year || new Date().getFullYear());
  const cacheKey = username ? `pa:${username}:${yrStr}:SCAN` : null;

  // Values + Projections sources (match Trade Analyzer)
  const [sourceKey, setSourceKey] = useState("val:fantasycalc"); // e.g., "val:fantasycalc" | "proj:sleeper"
  const activeSource = useMemo(
    () => DEFAULT_SOURCES.find((s) => s.key === sourceKey) || DEFAULT_SOURCES[0],
    [sourceKey]
  );

  // Keep existing downstream logic (valueSource + projSource) but drive them from ONE selector.
  const [valueSource, setValueSource] = useState("FantasyCalc");
  const [projSource, setProjSource] = useState("CSV"); // CSV | ESPN | CBS
  const [projectionMaps, setProjectionMaps] = useState({ CSV: null, ESPN: null, CBS: null });

  // Drive legacy source state from the single selector
  useEffect(() => {
    if (activeSource.type === "projection") {
      const map = {
        "proj:ffa": "CSV",
        "proj:espn": "ESPN",
        "proj:cbs": "CBS",
      };
      setProjSource(map[activeSource.key] || "CSV");
    } else {
      // For values, our internal key is lowercased, but downstream logic uses the display label.
      setValueSource(activeSource.label);
    }
  }, [activeSource]);

  // Best Available controls
  const bestMetric = activeSource.type === "projection" ? "projection" : "value"; // derived
  const [bestPos, setBestPos] = useState("ALL");
  const [bestSort, setBestSort] = useState("metric"); // metric | availability | position | name
  const [bestLimit, setBestLimit] = useState(25);
  const [bestMinOpenPct, setBestMinOpenPct] = useState(0);
  const [minOpenSlots, setMinOpenSlots] = useState(1);


  // Filters modal (desktop + mobile)
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Trending
  const [trendHours, setTrendHours] = useState(24);
  const [trendLimit, setTrendLimit] = useState(12);
  const [trendingAdds, setTrendingAdds] = useState([]); // [{id,name,pos,team,count,proj,value,openPct,openCount}]
  const [trendingDrops, setTrendingDrops] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(false);

  // Modal for "open leagues"
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPlayer, setModalPlayer] = useState(null);
  const [modalLeagues, setModalLeagues] = useState([]);

  // ---------- Name index ----------
  const playersMap = useMemo(() => players || {}, [players]);

  const nameIndex = useMemo(() => {
    const idx = new Map();
    for (const [rawId, p] of Object.entries(playersMap)) {
      const id = String(p.player_id ?? rawId);
      const full = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
      if (!full) continue;
      const pos = (p.position || "").toUpperCase();
      const team = (p.team || "").toUpperCase();

      const variants = new Set([full]);
      if (p.first_name && p.last_name) {
        variants.add(`${p.first_name} ${p.last_name}`);
        variants.add(`${p.last_name}, ${p.first_name}`);
      }
      if (Array.isArray(p.aliases)) p.aliases.forEach((n) => n && variants.add(n));

      variants.forEach((n) => {
        const key = cleanNorm(n);
        if (!key) return;
        if (!idx.has(key)) idx.set(key, []);
        const arr = idx.get(key);
        if (!arr.some((x) => x.id === id)) arr.push({ id, name: full, pos, team });
      });
    }
    return idx;
  }, [playersMap]);

  // ---------- Initial guard ----------
  useEffect(() => {
    setError("");
    setInitLoading(true);
    if (!username) {
      setError("Please log in on the Home page first.");
      setInitLoading(false);
      return;
    }
    if (!playersMap || Object.keys(playersMap).length === 0) {
      setError("Player database not loaded yet. Please wait a moment or re-login.");
      setInitLoading(false);
      return;
    }
    setInitLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, playersMap]);

  // ---------- Load ALL projection maps once ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const [csv, espn, cbs] = await Promise.all([fetchProjectionMap(PROJ_JSON_URL), fetchProjectionMap(PROJ_ESPN_JSON_URL), fetchProjectionMap(PROJ_CBS_JSON_URL)]);
      if (!alive) return;
      setProjectionMaps({ CSV: csv, ESPN: espn, CBS: cbs });

      if (projSource === "CBS" && !cbs) setProjSource(espn ? "ESPN" : "CSV");
      if (projSource === "ESPN" && !espn) setProjSource(csv ? "CSV" : "CBS");
      if (projSource === "CSV" && !csv) setProjSource(espn ? "ESPN" : "CBS");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeProjMap = useMemo(() => {
    return projSource === "ESPN" ? projectionMaps.ESPN : projSource === "CBS" ? projectionMaps.CBS : projectionMaps.CSV;
  }, [projSource, projectionMaps]);

  // ---------- Scan leagues with cache ----------
  useEffect(() => {
    let cancelled = false;

    const hydrateFromCache = () => {
      if (!cacheKey) return false;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return false;
        const { leagues: cachedLeagues, rosterSets: cachedSets, ts } = JSON.parse(raw) || {};
        if (!Array.isArray(cachedLeagues) || !cachedSets) return false;

        const m = new Map();
        for (const [lid, idsArr] of Object.entries(cachedSets)) {
          if (Array.isArray(idsArr) && idsArr.length > 0) m.set(String(lid), new Set(idsArr.map(String)));
        }

        const kept = (cachedLeagues || []).filter((lg) => m.get(String(lg.id))?.size > 0);
        if (kept.length === 0) return false;

        rosterSetsRef.current = m;
        setScanLeagues(kept);
        setLeagueCount(kept.length);
        setLastUpdated(ts ? new Date(ts) : null);
        return true;
      } catch {
        return false;
      }
    };

    const saveToCache = (leaguesKept, setsMap) => {
      if (!cacheKey) return;
      try {
        const obj = {};
        setsMap.forEach((set, lid) => (obj[String(lid)] = Array.from(set)));
        const payload = { leagues: leaguesKept, rosterSets: obj, ts: Date.now() };
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));
      } catch {}
    };

    const run = async () => {
      if (!username) return;
      if (hydrateFromCache()) return;

      try {
        setScanningError("");
        setScanLoading(true);
        setScanProgressPct(5);
        setScanProgressText("Looking up user…");

        const uRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
        if (!uRes.ok) throw new Error("User not found");
        const user = await uRes.json();

        setScanProgressText("Fetching leagues…");
        setScanProgressPct(12);
        const lRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yrStr}`);
        const leagues = (await lRes.json()) || [];
        if (cancelled) return;

        const kept = [];
        const setsMap = new Map();

        for (let i = 0; i < leagues.length; i++) {
          const lg = leagues[i];
          try {
            setScanProgressText(`Scanning leagues… (${i + 1}/${leagues.length})`);
            setScanProgressPct(12 + Math.round(((i + 1) / Math.max(leagues.length, 1)) * 88));

            const rRes = await fetch(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`);
            const rosters = rRes.ok ? await rRes.json() : [];
            if (!Array.isArray(rosters) || rosters.length === 0) continue;

            const mine = rosters.find((r) => r && String(r.owner_id) === String(user.user_id));
            if (!mine || !Array.isArray(mine.players) || mine.players.length === 0) continue;

            const set = extractRosterIds(rosters);
            if (set.size === 0) continue;

            const lid = String(lg.league_id);
            setsMap.set(lid, set);

            kept.push({
              id: lid,
              name: lg.name || "Unnamed League",
              avatar: lg.avatar || null,
              isBestBall: lg?.settings?.best_ball === 1,
              status: lg?.status || "",
              roster_positions: Array.isArray(lg?.roster_positions) ? lg.roster_positions : [],
            });
          } catch {}
          if (cancelled) return;
        }

        if (!cancelled) {
          rosterSetsRef.current = setsMap;
          setScanLeagues(kept);
          setLeagueCount(kept.length);
          setLastUpdated(new Date());
          saveToCache(kept, setsMap);
        }
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setScanningError("Failed to scan leagues.");
        }
      } finally {
        if (!cancelled) {
          setScanProgressText("Done!");
          setScanProgressPct(100);
          setTimeout(() => setScanLoading(false), 90);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, yrStr, cacheKey]);

  // ---------- Visible leagues (filters) ----------
  const visibleLeagueIds = useMemo(() => {
    if (!scanLeagues || scanLeagues.length === 0) return new Set();
    const arr = scanLeagues
      .filter((lg) => {
        if (onlyBestBall && !lg.isBestBall) return false;
        if (excludeBestBall && lg.isBestBall) return false;
        if (!includeDrafting && lg.status === "drafting") return false;
        return true;
      })
      .map((lg) => lg.id);
    return new Set(arr);
  }, [scanLeagues, onlyBestBall, excludeBestBall, includeDrafting]);

  const visibleLeagueCount = visibleLeagueIds.size || 0;
  const visibleLeaguesList = useMemo(() => scanLeagues.filter((lg) => visibleLeagueIds.has(lg.id)), [scanLeagues, visibleLeagueIds]);

  // ---------- Included leagues for "Best Available" list ----------
  const includeKey = cacheKey ? `availabilityIncludedLeagues:${cacheKey}` : null;
  const [showIncludedLeaguesModal, setShowIncludedLeaguesModal] = useState(false);

  const [includedLeagueIds, setIncludedLeagueIds] = useState(() => {
    if (!includeKey) return new Set();
    try {
      const raw = sessionStorage.getItem(includeKey);
      const arr = raw ? JSON.parse(raw) : null;
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!scanLeagues || scanLeagues.length === 0) return;
    setIncludedLeagueIds((prev) => {
      const vis = visibleLeagueIds;
      if (!prev || prev.size === 0) return new Set([...vis]);

      const next = new Set([...prev].filter((id) => vis.has(id)));
      if (next.size === 0) for (const id of vis) next.add(id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLeagueCount]);

  useEffect(() => {
    if (!includeKey) return;
    try {
      sessionStorage.setItem(includeKey, JSON.stringify([...includedLeagueIds]));
    } catch {}
  }, [includeKey, includedLeagueIds]);

  const includedLeaguesList = useMemo(() => visibleLeaguesList.filter((lg) => includedLeagueIds.has(lg.id)), [visibleLeaguesList, includedLeagueIds]);

  // ---------- Restore last player selection ----------
  useEffect(() => {
    const saved = sessionStorage.getItem("availabilitySelectedPlayers");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) setSelectedPlayers(parsed);
      } catch {}
    }
  }, []);

  // ---------- Actions ----------
  const computeAnchorRef = useRef(null);

  const addResolved = (t, { scrollToMatrix = false } = {}) => {
    if (!t || !t.id || !t.name) return;
    setSelectedPlayers((prev) => {
      if (prev.find((p) => p.id === t.id)) return prev;
      const next = [...prev, t];
      sessionStorage.setItem("availabilitySelectedPlayers", JSON.stringify(next));
      return next;
    });
    setTimeout(() => computeAvailability([t], { merge: true }), 0);
    if (scrollToMatrix) {
      setTimeout(() => computeAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const removeSelected = (playerId) => {
    setSelectedPlayers((prev) => {
      const next = prev.filter((p) => p.id !== playerId);
      sessionStorage.setItem("availabilitySelectedPlayers", JSON.stringify(next));
      return next;
    });
    setResults((prev) => {
      const copy = { ...prev };
      delete copy[playerId];
      return copy;
    });
  };

  const clearAll = () => {
    setSelectedPlayers([]);
    setResults({});
    sessionStorage.removeItem("availabilitySelectedPlayers");
  };

  const refreshScan = () => {
    try {
      if (cacheKey) sessionStorage.removeItem(cacheKey);
    } catch {}
    setResults({});

    (async () => {
      setScanLoading(true);
      setScanProgressPct(0);
      setScanProgressText("Refreshing leagues…");
      try {
        const uRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
        if (!uRes.ok) throw new Error("User not found");
        const user = await uRes.json();

        setScanProgressText("Fetching leagues…");
        setScanProgressPct(10);
        const lRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yrStr}`);
        const leagues = (await lRes.json()) || [];

        const kept = [];
        const setsMap = new Map();
        for (let i = 0; i < leagues.length; i++) {
          const lg = leagues[i];
          setScanProgressText(`Scanning leagues… (${i + 1}/${leagues.length})`);
          setScanProgressPct(10 + Math.round(((i + 1) / Math.max(leagues.length, 1)) * 88));

          try {
            const rRes = await fetch(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`);
            const rosters = rRes.ok ? await rRes.json() : [];
            if (!Array.isArray(rosters) || rosters.length === 0) continue;

            const mine = rosters.find((r) => r && String(r.owner_id) === String(user.user_id));
            if (!mine || !Array.isArray(mine.players) || mine.players.length === 0) continue;

            const set = extractRosterIds(rosters);
            if (set.size === 0) continue;

            const lid = String(lg.league_id);
            setsMap.set(lid, set);

            kept.push({
              id: lid,
              name: lg.name || "Unnamed League",
              avatar: lg.avatar || null,
              isBestBall: lg?.settings?.best_ball === 1,
              status: lg?.status || "",
              roster_positions: Array.isArray(lg?.roster_positions) ? lg.roster_positions : [],
            });
          } catch {}
        }

        rosterSetsRef.current = setsMap;
        setScanLeagues(kept);
        setLeagueCount(kept.length);
        setLastUpdated(new Date());

        try {
          const obj = {};
          setsMap.forEach((set, lid) => (obj[String(lid)] = Array.from(set)));
          sessionStorage.setItem(cacheKey, JSON.stringify({ leagues: kept, rosterSets: obj, ts: Date.now() }));
        } catch {}

        setScanProgressText("Done!");
        setScanProgressPct(100);
      } catch (e) {
        console.error(e);
        setScanningError("Failed to refresh leagues.");
      } finally {
        setTimeout(() => setScanLoading(false), 90);
        if (selectedPlayers.length) computeAvailability(selectedPlayers, { merge: false });
      }
    })();
  };

  // ---------- Compute availability over *visible* leagues only (NO rostered output) ----------
  async function computeAvailability(playersToCheck = selectedPlayers, { merge = false } = {}) {
    const list = Array.isArray(playersToCheck) && playersToCheck.length ? playersToCheck : selectedPlayers;
    if (!list || list.length === 0) return;

    const out = {};
    for (const p of list) {
      const availableLeagues = [];
      for (const lg of visibleLeaguesList) {
        const set = rosterSetsRef.current.get(lg.id);
        if (!set || set.size === 0) continue;
        if (!set.has(String(p.id))) availableLeagues.push(lg);
      }
      out[p.id] = { availableLeagues };
    }
    setResults((prev) => (merge ? { ...prev, ...out } : out));
  }

  useEffect(() => {
    if (!selectedPlayers.length) return;
    if (scanLoading) return;
    computeAvailability(selectedPlayers, { merge: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLeagueCount, scanLoading]);

  const anySelected = selectedPlayers.length > 0;

  // ---------- Best Available Players ----------
  const playerList = useMemo(() => Object.values(playersMap || {}), [playersMap]);
  const getPlayerValue = useMemo(() => makeGetPlayerValue(valueSource, mode, qb), [valueSource, mode, qb]);


  const bestAvailablePlayers = useMemo(() => {
    const leagues = includedLeaguesList;
    if (!leagues.length) return [];

    // make sure we have rosters for at least 1 league
    let haveAnyRoster = false;
    for (const lg of leagues) {
      const set = rosterSetsRef.current.get(lg.id);
      if (set && set.size) {
        haveAnyRoster = true;
        break;
      }
    }
    if (!haveAnyRoster) return [];

    const posFilter = bestPos === "ALL" ? null : bestPos;
    const includedCount = leagues.length;

    const metricFor = (p) => {
      if (!p || p.player_id == null) return 0;
      if (bestMetric === "projection") return getSeasonPointsForPlayer(activeProjMap, p);
      if (bestMetric === "value") return getPlayerValue(p);
      return 0;
    };

    const ranked = playerList
      .filter((p) => {
        if (!p || p.player_id == null) return false;
        const pos = String(p.position || "").toUpperCase();
        if (posFilter && pos !== posFilter) return false;
        return true;
      })
      .map((p) => ({ p, score: metricFor(p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const candidateCount = Math.max(bestLimit * 6, 450);
    const candidates = ranked.slice(0, candidateCount);
    const out = [];

    for (const { p, score } of candidates) {
      const pid = String(p.player_id);
      const availableLeagues = [];

      for (const lg of leagues) {
        const set = rosterSetsRef.current.get(lg.id);
        if (!set || set.size === 0) continue;
        if (!set.has(pid)) availableLeagues.push(lg);
      }

      if (availableLeagues.length === 0) continue;
      if (availableLeagues.length < minOpenSlots) continue;


      const openPct = includedCount ? Math.round((availableLeagues.length / includedCount) * 100) : 0;
      if (openPct < bestMinOpenPct) continue;

      const pos = String(p.position || "").toUpperCase();
      const team = String(p.team || "").toUpperCase();
      const fullName = p.full_name || p.search_full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();

      const proj = getSeasonPointsForPlayer(activeProjMap, p);
      const value = getPlayerValue(p);

      out.push({
        id: pid,
        name: fullName,
        pos,
        team,
        proj,
        value,
        score,
        openPct,
        openCount: availableLeagues.length,
        availableLeagues,
      });

      if (out.length >= bestLimit) break;
    }

    if (bestSort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (bestSort === "position") {
      const order = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6 };
      out.sort((a, b) => {
        const oa = order[a.pos] || 99;
        const ob = order[b.pos] || 99;
        if (oa !== ob) return oa - ob;
        const ma = bestMetric === "value" ? a.value : a.proj;
        const mb = bestMetric === "value" ? b.value : b.proj;
        return mb - ma;
      });
    } else if (bestSort === "availability") {
      out.sort((a, b) => {
        if (b.openPct !== a.openPct) return b.openPct - a.openPct;
        const ma = bestMetric === "value" ? a.value : a.proj;
        const mb = bestMetric === "value" ? b.value : b.proj;
        return mb - ma;
      });
    } else {
      out.sort((a, b) => {
        const ma = bestMetric === "value" ? a.value : a.proj;
        const mb = bestMetric === "value" ? b.value : b.proj;
        return mb - ma;
      });
    }

    return out;
    }, [
    includedLeaguesList,
    playerList,
    bestMetric,
    bestPos,
    bestSort,
    bestLimit,
    bestMinOpenPct,
    minOpenSlots,
    activeProjMap,
    getPlayerValue,
  ]);


  // ---------- Row click → open leagues modal ----------
  const openPlayerModal = (player, openLeagues) => {
    setModalPlayer(player);
    setModalLeagues(openLeagues || []);
    setModalOpen(true);
  };

  // ---------- Trending (Sleeper Hot/Cold) ----------
  useEffect(() => {
    let alive = true;

    const buildTrendRows = (trendList, includedLeagues) => {
      const includedCount = includedLeagues.length || 0;
      const getOpenCount = (pid) => {
        let open = 0;
        for (const lg of includedLeagues) {
          const set = rosterSetsRef.current.get(lg.id);
          if (!set || set.size === 0) continue;
          if (!set.has(String(pid))) open++;
        }
        return open;
      };

      const out = [];
      for (const t of trendList || []) {
        const pid = String(t?.player_id || "");
        if (!pid) continue;
        const p = playersMap?.[pid];
        if (!p) continue;

        const name = p.full_name || p.search_full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
        const pos = String(p.position || "").toUpperCase();
        const team = String(p.team || "").toUpperCase();

        const proj = getSeasonPointsForPlayer(activeProjMap, p);
        const value = getPlayerValue(p);

        const openCount = includedCount ? getOpenCount(pid) : 0;
        const openPct = includedCount ? Math.round((openCount / includedCount) * 100) : 0;

        out.push({
          id: pid,
          name,
          pos,
          team,
          count: Number(t?.count || 0) || 0,
          proj,
          value,
          openCount,
          openPct,
        });
      }

      // sort by Sleeper count desc
      out.sort((a, b) => (b.count || 0) - (a.count || 0));
      return out.slice(0, trendLimit);
    };

    const run = async () => {
      if (!username) return;
      if (!Object.keys(playersMap || {}).length) return;
      if (!includedLeaguesList.length) return;

      setTrendingLoading(true);
      try {
        const qs = `lookback_hours=${encodeURIComponent(trendHours)}&limit=${encodeURIComponent(Math.max(trendLimit * 3, 30))}`;
        const [addsRes, dropsRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/players/nfl/trending/add?${qs}`),
          fetch(`https://api.sleeper.app/v1/players/nfl/trending/drop?${qs}`),
        ]);

        const adds = addsRes.ok ? await addsRes.json() : [];
        const drops = dropsRes.ok ? await dropsRes.json() : [];

        if (!alive) return;

        setTrendingAdds(buildTrendRows(adds, includedLeaguesList));
        setTrendingDrops(buildTrendRows(drops, includedLeaguesList));
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setTrendingAdds([]);
        setTrendingDrops([]);
      } finally {
        if (!alive) return;
        setTrendingLoading(false);
      }
    };

    // only after scan loaded (rosterSets exist)
    if (!scanLoading && leagueCount > 0) run();

    return () => {
      alive = false;
    };
  }, [username, playersMap, includedLeaguesList, scanLoading, leagueCount, trendHours, trendLimit, activeProjMap, getPlayerValue]);

  // ---------- Availability Matrix league ordering ----------
  const leaguesAvailableSorted = useMemo(() => {
    if (!anySelected) return [];

    const scored = [];
    for (const lg of visibleLeaguesList) {
      let availableCount = 0;
      for (const p of selectedPlayers) {
        const isAvailableHere = results[p.id]?.availableLeagues?.some((L) => L.id === lg.id);
        if (isAvailableHere) availableCount++;
      }
      if (availableCount > 0) scored.push({ lg, availableCount });
    }

    scored.sort((a, b) => {
      if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
      return (a.lg.name || "").localeCompare(b.lg.name || "");
    });

    return scored.map((s) => s.lg);
  }, [anySelected, visibleLeaguesList, selectedPlayers, results]);

  // ---------- Render ----------
  const showLoadingScreen = initLoading || scanLoading;

  return (
    <main className="min-h-screen text-white">
      <Navbar pageTitle="Player Availability" />
      <BackgroundParticles />

      {showLoadingScreen ? (
        <LoadingScreen progress={scanLoading ? scanProgressPct : undefined} text={scanLoading ? scanProgressText : undefined} />
      ) : (
        <div className="max-w-6xl mx-auto px-4 pb-12 pt-20">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight">Player Availability</h1>
            <p className="text-white/70 mt-1">
              Note - currently working on this, so could see some bugs. See which players are available in your Sleeper leagues based on your scan and filters. 
            </p>
          </div>

          {/* Scan summary */}
          <div className="rounded-3xl border border-white/10 bg-gray-900/60 backdrop-blur p-4 md:p-5 mb-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <StatPill label="Scanned" value={leagueCount} onClick={() => setShowLeaguesModal(true)} title="All leagues included in this scan" />
              <StatPill label="Showing" value={visibleLeagueCount} onClick={() => setShowVisibleLeaguesModal(true)} title="Leagues currently visible by filters" />
              <StatPill
                label="Best Available"
                value={includedLeaguesList.length}
                onClick={() => setShowIncludedLeaguesModal(true)}
                title="Choose which visible leagues are included in Best Available"
              />

              {lastUpdated && (
                <div className="ml-1 text-xs text-white/45" suppressHydrationWarning>
                  Last scan: {lastUpdated.toLocaleTimeString()}
                </div>
              )}

              <div className="ml-auto flex items-center gap-2">
                {scanningError ? <span className="text-sm text-red-400">{scanningError}</span> : null}
                <button
                  className="text-xs rounded-xl px-3 py-2 border border-white/15 bg-white/5 hover:bg-white/10"
                  onClick={refreshScan}
                  title="Rescan now"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-white/75">
                <input
                  type="checkbox"
                  className="accent-cyan-400"
                  checked={onlyBestBall}
                  onChange={() => setOnlyBestBall((v) => (excludeBestBall ? true : !v))}
                />
                Only Best Ball
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-white/75">
                <input
                  type="checkbox"
                  className="accent-cyan-400"
                  checked={excludeBestBall}
                  onChange={() => setExcludeBestBall((v) => (onlyBestBall ? true : !v))}
                />
                Exclude Best Ball
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-white/75">
                <input type="checkbox" className="accent-cyan-400" checked={includeDrafting} onChange={() => setIncludeDrafting((v) => !v)} />
                Include drafting
              </label>
            </div>
          </div>

          {!username ? (
            <p className="text-red-400">Please log in on the Home page.</p>
          ) : Object.keys(playersMap).length === 0 ? (
            <p className="text-red-400">Player database not ready yet. One moment…</p>
          ) : leagueCount === 0 ? (
            <p className="text-red-400">No leagues matched the scan rules for your account.</p>
          ) : (
            <>
              {/* Premium Controls */}
              <div className="rounded-3xl border border-white/10 bg-gray-900/60 backdrop-blur p-4 md:p-5 mb-6">
                <div className="grid lg:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-white/70 mb-2">Search & Add Player (manual)</div>
                    <NameSelect nameIndex={nameIndex} onPick={(p) => addResolved(p, { scrollToMatrix: true })} />
                    {selectedPlayers.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedPlayers.map((p) => (
                          <span key={p.id} className="inline-flex items-center gap-2 text-sm bg-white/5 border border-white/10 rounded-full px-3 py-1">
                            {p.name}
                            <span className="text-white/50">
                              ({p.pos}
                              {p.team ? ` • ${p.team}` : ""})
                            </span>
                            <button className="ml-1 text-red-300 hover:text-red-200" onClick={() => removeSelected(p.id)} title="Remove">
                              ×
                            </button>
                          </span>
                        ))}
                        <button onClick={clearAll} className="text-xs underline text-white/60 hover:text-white ml-1">
                          Clear all
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-white/50 mt-3">No players added yet.</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => computeAvailability(selectedPlayers, { merge: false })}
                        className="px-4 py-2 rounded-2xl bg-cyan-500 hover:bg-cyan-600 transition font-semibold disabled:opacity-40 disabled:hover:bg-cyan-500"
                        disabled={!anySelected}
                        title={anySelected ? "Re-check all" : "Add a player first"}
                      >
                        Check
                      </button>

                      <button
                        onClick={refreshScan}
                        className="px-4 py-2 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition"
                        title="Rescan all leagues"
                      >
                        Refresh rosters
                      </button>

                      <div className="ml-auto text-xs text-white/60">
                        Selected: <span className="text-white font-semibold">{selectedPlayers.length}</span> • Visible leagues:{" "}
                        <span className="text-white font-semibold">{visibleLeagueCount}</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs text-white/60 mb-2">Best Available ranking</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative z-[1000] flex flex-wrap items-center gap-2 w-full">
                          <div className="relative z-[80] min-w-[240px]">
                            <SourceSelector
  sources={DEFAULT_SOURCES}
  value={sourceKey}
  onChange={setSourceKey}
  className="w-full"
  mode={mode}
  qbType={qb}
  onModeChange={setMode}
  onQbTypeChange={setQb}
/>

                          </div>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs"
                            onClick={() => setFiltersOpen(true)}
                          >
                            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-white/10">⚙</span>
                            Filters
                            {(bestPos !== "ALL" || bestSort !== "metric" || minOpenSlots !== 1 || bestLimit !== 25 || bestMinOpenPct !== 0) ? (
                              <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full bg-white/10 border border-white/10">Active</span>
                            ) : null}
                          </button>

                          <button
                            type="button"
                            className="px-3 py-2 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs"
                            onClick={() => setShowIncludedLeaguesModal(true)}
                          >
                            Included Leagues ({includedLeaguesList.length})
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-white/45">
                        Best Available uses <span className="text-white/70 font-semibold">{includedLeaguesList.length}</span> league(s). Click a player row to see open leagues.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Availability Matrix */}
              {anySelected && (
                <div ref={computeAnchorRef} className="rounded-3xl border border-white/10 bg-gray-900/60 backdrop-blur p-4 md:p-5 mb-6">
                  <h3 className="text-lg font-semibold mb-3">Availability by League</h3>
                  {leaguesAvailableSorted.length === 0 ? (
                    <p className="text-white/60">No leagues where any selected player is available with these filters.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-1">
                        <thead>
                          <tr>
                            <th className="text-left text-sm text-white/70 font-medium px-3 py-2 sticky left-0 bg-gray-950/70 backdrop-blur z-10">League</th>
                            {selectedPlayers.map((p) => (
                              <th key={p.id} className="text-sm text-white/70 font-medium px-3 py-2 whitespace-nowrap">
                                {p.name}
                              </th>
                            ))}
                            <th className="text-sm text-white/70 font-medium px-3 py-2">Open</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaguesAvailableSorted.map((lg) => (
                            <tr key={lg.id} className="bg-white/5 hover:bg-white/10">
                              <td className="px-3 py-2 sticky left-0 bg-gray-950/65 backdrop-blur z-10">
                                <div className="flex items-center gap-2">
                                  <img
                                    src={leagueAvatarUrl(lg.avatar || undefined)}
                                    alt=""
                                    className="w-7 h-7 rounded-xl object-cover bg-gray-700"
                                    onError={(e) => {
                                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                                    }}
                                  />
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-white truncate">{lg.name}</span>
                                    <span className="text-xs text-white/60">
                                      {lg.isBestBall ? "Best Ball" : "Standard"}
                                      {lg.status ? ` • ${lg.status}` : ""}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {selectedPlayers.map((p) => {
                                const available = results[p.id]?.availableLeagues?.some((L) => L.id === lg.id);
                                const cell = available ? "✅" : "—";
                                return (
                                  <td key={`${lg.id}-${p.id}`} className="px-3 py-2 text-center text-lg">
                                    {cell}
                                  </td>
                                );
                              })}

                              <td className="px-3 py-2 text-center">
                                <a href={sleeperLeagueUrl(lg.id)} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                                  Open
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 text-xs text-white/60 flex items-center gap-4">
                    <span>Legend:</span>
                    <span>✅ Available</span>
                    <span>— Not available</span>
                  </div>
                </div>
              )}

              {/* Best Available + Trending (desktop: hot | best | cold) */}
              <div className="relative  grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
                {/* HOT */}
                <div className="relative z lg:col-span-3 rounded-3xl border border-white/10 bg-gray-900/60 backdrop-blur p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-white">🔥 Hot Adds</div>
                      <div className="text-xs text-white/50">Sleeper add trends • click a row for open leagues</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={String(trendHours)}
                        onChange={(e) => setTrendHours(Number(e.target.value) || 24)}
                        className="bg-gray-950 border border-white/10 rounded-xl px-2 py-2 text-xs text-white/80"
                        title="Lookback"
                      >
                        <option value="6">6h</option>
                        <option value="12">12h</option>
                        <option value="24">24h</option>
                        <option value="48">48h</option>
                        <option value="72">72h</option>
                      </select>
                      <select
                        value={String(trendLimit)}
                        onChange={(e) => setTrendLimit(Number(e.target.value) || 12)}
                        className="bg-gray-950 border border-white/10 rounded-xl px-2 py-2 text-xs text-white/80"
                        title="Show"
                      >
                        <option value="8">8</option>
                        <option value="12">12</option>
                        <option value="20">20</option>
                      </select>
                    </div>
                  </div>

                  {trendingLoading ? (
                    <div className="mt-4 text-sm text-white/60">Loading…</div>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      {trendingAdds.length === 0 ? (
                        <div className="text-sm text-white/60">No results.</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-white/60 border-b border-white/10">
                              <th className="py-2 pr-2">Player</th>
                              <th className="py-2 pr-2">Cnt</th>
                              <th className="py-2 pr-2">Open%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trendingAdds.map((r) => (
                              <tr
                                key={`add-${r.id}`}
                                className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                                onClick={() => {
                                  const openLeagues = includedLeaguesList.filter((lg) => {
                                    const set = rosterSetsRef.current.get(lg.id);
                                    if (!set || !set.size) return false;
                                    return !set.has(String(r.id));
                                  });
                                  openPlayerModal({ id: r.id, name: r.name, pos: r.pos, team: r.team }, openLeagues);
                                }}
                              >
                                <td className="py-2 pr-2">
                                  <div className="flex items-center gap-2">
                                    <AvatarImage
                                      src={playerAvatarUrl(String(r.id))}
                                      fallbackSrc={DEFAULT_PLAYER_IMG}
                                      alt={r.name}
                                      className="w-7 h-7 rounded-full"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-white font-semibold truncate">{r.name}</div>
                                      <div className="text-[11px] text-white/55">
                                        {r.pos}
                                        {r.team ? ` • ${r.team}` : ""}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2 pr-2 text-white/80 tabular-nums">{r.count}</td>
                                <td className="py-2 pr-2 text-white/80 tabular-nums">{includedLeaguesList.length ? `${r.openPct}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>

                {/* BEST */}
                <div className="relative lg:col-span-6 rounded-3xl border border-white/10 bg-gray-900/60 backdrop-blur p-4 md:p-6">
                  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Best Available Players</h2>
                      <div className="text-sm text-white/70 mt-1">Click a row to see open leagues.</div>
                      <div className="text-xs text-white/50 mt-1">Scanning {includedLeaguesList.length} league(s) in this list.</div>
                    </div>
                    <button
                      className="text-xs rounded-xl px-3 py-2 border border-white/15 bg-white/5 hover:bg-white/10"
                      onClick={refreshScan}
                      title="Rescan rosters (affects open%)"
                    >
                      Sync
                    </button>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    {bestAvailablePlayers.length === 0 ? (
                      <div className="text-white/70 text-sm">No players found (try loosening filters, changing position, or switching source).</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-white/70 border-b border-white/10">
                            <th className="py-2 pr-2">Player</th>
                            <th className="py-2 pr-2">Pos</th>
                            <th className="py-2 pr-2">Team</th>
                            <th className="py-2 pr-2">{bestMetric === "projection" ? "Proj" : "Value"}</th>
                            <th className="py-2 pr-2">Open</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bestAvailablePlayers.map((row) => {
                            const openLabel = includedLeaguesList.length ? `${row.openCount}/${includedLeaguesList.length} (${row.openPct}%)` : `${row.openCount}`;
                            const metricVal = bestMetric === "projection" ? row.proj : row.value;
                            return (
                              <tr
                                key={row.id}
                                className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                                onClick={() => openPlayerModal({ id: row.id, name: row.name, pos: row.pos, team: row.team }, row.availableLeagues)}
                                title="Click to view open leagues"
                              >
                                <td className="py-2 pr-2">
                                  <div className="flex items-center gap-2">
                                    <AvatarImage
                                      src={playerAvatarUrl(String(row.id))}
                                      fallbackSrc={DEFAULT_PLAYER_IMG}
                                      alt={row.name}
                                      className="w-8 h-8 rounded-full"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-white font-semibold truncate">{row.name}</div>
                                      <div className="text-xs text-white/60 truncate">Click to view open leagues</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2 pr-2 text-white/80">{row.pos}</td>
                                <td className="py-2 pr-2 text-white/80">{row.team || "—"}</td>
                                <td className="py-2 pr-2 text-white/80">{metricVal > 0 ? metricVal.toFixed(1) : "–"}</td>
                                <td className="py-2 pr-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-24 h-2 rounded-full bg-white/10 overflow-hidden">
                                      <div className="h-full bg-cyan-400/70" style={{ width: `${row.openPct}%` }} />
                                    </div>
                                    <span className="text-white/80 tabular-nums">{openLabel}</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* COLD */}
                <div className="relative lg:col-span-3 rounded-3xl border border-white/10 bg-gray-900/60 backdrop-blur p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-white">❄️ Cold Drops</div>
                      <div className="text-xs text-white/50">Sleeper drop trends • click a row for open leagues</div>
                    </div>
                    <div className="text-xs text-white/50">{trendHours}h</div>
                  </div>

                  {trendingLoading ? (
                    <div className="mt-4 text-sm text-white/60">Loading…</div>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      {trendingDrops.length === 0 ? (
                        <div className="text-sm text-white/60">No results.</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-white/60 border-b border-white/10">
                              <th className="py-2 pr-2">Player</th>
                              <th className="py-2 pr-2">Cnt</th>
                              <th className="py-2 pr-2">Open%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trendingDrops.map((r) => (
                              <tr
                                key={`drop-${r.id}`}
                                className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                                onClick={() => {
                                  const openLeagues = includedLeaguesList.filter((lg) => {
                                    const set = rosterSetsRef.current.get(lg.id);
                                    if (!set || !set.size) return false;
                                    return !set.has(String(r.id));
                                  });
                                  openPlayerModal({ id: r.id, name: r.name, pos: r.pos, team: r.team }, openLeagues);
                                }}
                              >
                                <td className="py-2 pr-2">
                                  <div className="flex items-center gap-2">
                                    <AvatarImage
                                      src={playerAvatarUrl(String(r.id))}
                                      fallbackSrc={DEFAULT_PLAYER_IMG}
                                      alt={r.name}
                                      className="w-7 h-7 rounded-full"
                                    />
                                    <div className="min-w-0">
                                      <div className="text-white font-semibold truncate">{r.name}</div>
                                      <div className="text-[11px] text-white/55">
                                        {r.pos}
                                        {r.team ? ` • ${r.team}` : ""}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2 pr-2 text-white/80 tabular-nums">{r.count}</td>
                                <td className="py-2 pr-2 text-white/80 tabular-nums">{includedLeaguesList.length ? `${r.openPct}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              </div>

              
            </>
          )}
        </div>
      )}

      {/* Filters modal */}
      {filtersOpen && (
        <div
          className="fixed inset-0 z-[75] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setFiltersOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-gray-950 rounded-3xl shadow-xl p-5 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xl font-bold">Filters</div>
                <div className="text-sm text-white/70">Applies to the Best Available list.</div>
              </div>
              <button
                className="rounded-xl px-3 py-2 border border-white/15 hover:bg-white/10"
                onClick={() => setFiltersOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <div className="mb-1 text-white/70">Position</div>
                  <select
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-3 py-2"
                    value={bestPos}
                    onChange={(e) => setBestPos(e.target.value)}
                  >
                    <option value="ALL">All</option>
                    <option value="QB">QB</option>
                    <option value="RB">RB</option>
                    <option value="WR">WR</option>
                    <option value="TE">TE</option>
                    <option value="K">K</option>
                    <option value="DST">DST</option>
                  </select>
                </label>

                <label className="text-sm">
                  <div className="mb-1 text-white/70">Sort</div>
                  <select
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-3 py-2"
                    value={bestSort}
                    onChange={(e) => setBestSort(e.target.value)}
                  >
                    <option value="metric">Metric</option>
                    <option value="availability">Availability</option>
                    <option value="position">Position</option>
                    <option value="name">Name</option>
                  </select>

                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <div className="mb-1 text-white/70">Min open slots</div>
                  <select
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-3 py-2"
                    value={minOpenSlots}
                    onChange={(e) => setMinOpenSlots(parseInt(e.target.value, 10))}
                  >
                    <option value={1}>1+</option>
                    <option value={2}>2+</option>
                    <option value={3}>3+</option>
                    <option value={4}>4+</option>
                    <option value={5}>5+</option>
                    <option value={6}>6+</option>
                  </select>
                </label>

                <label className="text-sm">
                  <div className="mb-1 text-white/70">Show</div>
                  <select
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-3 py-2"
                    value={bestLimit}
                    onChange={(e) => setBestLimit(parseInt(e.target.value, 10))}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={75}>75</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
                onClick={() => {
                  setBestPos("ALL");
                  setBestSort("metric");
                  setMinOpenSlots(1);
                  setBestLimit(25);

                }}
              >
                Clear all
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
                onClick={() => setFiltersOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player Open Leagues Modal */}
      <PlayerOpenLeaguesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        player={modalPlayer}
        leagues={modalLeagues}
      />

      {/* Included leagues modal */}
      {showIncludedLeaguesModal && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowIncludedLeaguesModal(false)}>
          <div className="w-full max-w-xl bg-gray-950 rounded-3xl shadow-xl p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xl font-bold">Included Leagues</div>
                <div className="text-sm text-white/70">This only affects the Best Available list (scan filters still apply).</div>
              </div>
              <button className="rounded-xl px-3 py-2 border border-white/15 hover:bg-white/10" onClick={() => setShowIncludedLeaguesModal(false)}>
                ✕
              </button>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
                onClick={() => setIncludedLeagueIds(new Set(visibleLeaguesList.map((l) => l.id)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
                onClick={() => setIncludedLeagueIds(new Set())}
              >
                Clear
              </button>
              <div className="ml-auto text-sm text-white/70">
                {includedLeagueIds.size} / {visibleLeaguesList.length} selected
              </div>
            </div>

            <div className="max-h-[60vh] overflow-auto space-y-2 pr-1">
              {visibleLeaguesList.map((lg) => {
                const checked = includedLeagueIds.has(lg.id);
                return (
                  <label key={lg.id} className="flex items-center gap-3 p-3 rounded-2xl border border-white/10 hover:bg-white/5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setIncludedLeagueIds((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(lg.id);
                          else next.delete(lg.id);
                          return next;
                        });
                      }}
                    />
                    <img
                      src={leagueAvatarUrl(lg.avatar || undefined)}
                      alt=""
                      className="w-9 h-9 rounded-xl object-cover bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">{lg.name}</div>
                      <div className="text-xs text-white/60 truncate">
                        {lg.isBestBall ? "Best Ball" : "Standard"}
                        {lg.status ? ` • ${lg.status}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
                onClick={() => setShowIncludedLeaguesModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scanned leagues modal */}
      {showLeaguesModal && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowLeaguesModal(false)}>
          <div className="w-full max-w-xl bg-gray-950 rounded-3xl shadow-xl p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div className="text-xl font-bold">Leagues in this scan</div>
              <button className="rounded-xl px-3 py-2 border border-white/15 hover:bg-white/10" onClick={() => setShowLeaguesModal(false)}>
                ✕
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 flex flex-col gap-2">
              {scanLeagues
                .slice()
                .sort((a, b) => {
                  const av = visibleLeagueIds.has(a.id) ? 1 : 0;
                  const bv = visibleLeagueIds.has(b.id) ? 1 : 0;
                  if (av !== bv) return bv - av;
                  return (a.name || "").localeCompare(b.name || "");
                })
                .map((lg) => (
                  <div
                    key={lg.id}
                    className={`flex items-center gap-3 text-sm px-3 py-2 rounded-2xl border ${
                      visibleLeagueIds.has(lg.id) ? "bg-white/5 border-white/10" : "bg-white/3 border-white/5 opacity-70"
                    }`}
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar || undefined)}
                      alt=""
                      className="w-8 h-8 rounded-xl object-cover bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <span className="truncate">{lg.name}</span>
                    <span className="ml-auto text-[10px] text-white/50">
                      {lg.isBestBall ? "BB" : "STD"}
                      {lg.status ? ` • ${lg.status}` : ""}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Visible leagues modal */}
      {showVisibleLeaguesModal && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowVisibleLeaguesModal(false)}>
          <div className="w-full max-w-xl bg-gray-950 rounded-3xl shadow-xl p-5 border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div className="text-xl font-bold">Leagues being shown</div>
              <button className="rounded-xl px-3 py-2 border border-white/15 hover:bg-white/10" onClick={() => setShowVisibleLeaguesModal(false)}>
                ✕
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 flex flex-col gap-2">
              {visibleLeaguesList
                .slice()
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((lg) => (
                  <div
                    key={lg.id}
                    className="flex items-center gap-3 text-sm px-3 py-2 rounded-2xl bg-white/5 border border-white/10"
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar || undefined)}
                      alt=""
                      className="w-8 h-8 rounded-xl object-cover bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <span className="truncate">{lg.name}</span>
                    <span className="ml-auto text-[10px] text-white/50">
                      {lg.isBestBall ? "BB" : "STD"}
                      {lg.status ? ` • ${lg.status}` : ""}
                    </span>
                  </div>
                ))}
              {visibleLeagueCount === 0 && <div className="text-sm text-white/60">No leagues match the current filters.</div>}
            </div>
          </div>
        </div>
      )}

      {error ? <div className="sr-only">{error}</div> : null}
    </main>
  );
}
