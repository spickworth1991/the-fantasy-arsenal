"use client";

import { createContext, useRef, useContext, useState, useEffect, useMemo } from "react";
import { get, set } from "idb-keyval";
import { makeGetPlayerValue } from "../lib/values";

const SleeperContext = createContext();
export const useSleeper = () => useContext(SleeperContext);

// ---- SSR-safe localStorage helpers (no-ops on server) ----
const isBrowser = typeof window !== "undefined";
const lsGet = (key, fallback = null) => {
  if (!isBrowser) return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const lsSet = (key, value) => {
  if (!isBrowser) return;
  try {
    if (value === undefined || value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {}
};
const lsClear = () => {
  if (!isBrowser) return;
  try {
    window.localStorage.clear();
  } catch {}
};

// ---- Normalization helpers ----
const normalizeName = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normPos = (pos) => String(pos || "").toUpperCase().trim();
const normTeam = (team) => String(team || "").toUpperCase().trim();

// IDP sources (IDynastyP / IDPShow) often use granular positions (CB, S, ED, EDGE, DE, DT)
// while Sleeper players frequently use grouped positions (DB / DL / LB).
// Normalize to a shared match key so name+position matching actually hits.
const normalizeIdpPosForMatch = (pos) => {
  const p = normPos(pos);
  if (!p) return "";
  // Defensive Back family
  if (["CB", "S", "FS", "SS", "DB"].includes(p)) return "DB";
  // Defensive Line / Edge family
  if (["DL", "DE", "DT", "ED", "EDGE"].includes(p)) return "DL";
  // Linebacker family
  if (["LB", "ILB", "MLB", "OLB"].includes(p)) return "LB";
  return p;
};

const keyName = (n) => normalizeName(n);

// Safe number (handles "123", null, etc)
// Safe number (handles "1,234", "$123", null, etc)
const safeNum = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  // strings like "1,234", "$1,234.5", " 123 "
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,%\s]/g, "").replace(/,/g, "");
    const x = Number(cleaned);
    return Number.isFinite(x) ? x : 0;
  }

  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};


// Formats that exist in FN/SP caches
const VALUE_KEYS = ["dynasty_sf", "dynasty_1qb", "redraft_sf", "redraft_1qb"];

// Sleeper positions you typically want values for.
const FANTASY_RELEVANT = new Set([
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
  "DL",
  "LB",
  "DB",
  "IDP",
  "DE",
  "DT",
  "EDGE",
  "CB",
  "S",
]);

function getSleeperFantasyPosSet(p) {
  const set = new Set();
  const fp = Array.isArray(p?.fantasy_positions) ? p.fantasy_positions : [];
  fp.forEach((x) => set.add(normPos(x)));
  const pos = normPos(p?.position);
  if (pos) set.add(pos);
  return set;
}

// Use a stable primary position so name-based matching can safely enforce pos compatibility.
function getPrimaryPos(p) {
  return normPos(p?.position) || "";
}

function isFantasyRelevantSleeperPlayer(p) {
  const set = getSleeperFantasyPosSet(p);
  for (const x of set) {
    if (FANTASY_RELEVANT.has(x)) return true;
  }
  return false;
}

// =====================
// Candidate-based matching (prevents name-only collisions)
// =====================
function createCandidateIndex4(seedByName) {
  // nameKey -> array of candidates: { pos, team, values: {dynasty_sf,...} }
  const byName =
    seedByName && typeof seedByName === "object"
      ? seedByName
      : Object.create(null);

  function addCandidate({ name, pos, team, values }) {
  const nn = keyName(name);
  if (!nn) return;

  const candPos = normPos(pos);
  const candTeam = normTeam(team);

  // Build the incoming values payload
  const incoming = {};
  VALUE_KEYS.forEach((k) => {
    incoming[k] = safeNum(values?.[k]);
  });

  // If this row doesn't actually contribute anything, skip
  const hasAny = VALUE_KEYS.some((k) => incoming[k] > 0);
  if (!hasAny) return;

  if (!byName[nn]) byName[nn] = [];

  // ✅ MERGE: if we already have this exact player candidate (same pos/team), update it
  const existing = byName[nn].find(
    (c) => c?.pos === candPos && c?.team === candTeam
  );

  if (existing) {
    VALUE_KEYS.forEach((k) => {
      if (incoming[k] > 0) existing.values[k] = incoming[k];
    });
    return;
  }

  // Otherwise create a new candidate
  byName[nn].push({
    pos: candPos,
    team: candTeam,
    values: incoming,
  });
}


  function pickBest(name, pos, team) {
    const nn = keyName(name);
    if (!nn) return null;

    const cands = byName[nn];
    if (!Array.isArray(cands) || cands.length === 0) return null;

    const pos0 = normPos(pos);
    const team0 = normTeam(team);

    // ✅ IMPORTANT: if Sleeper record has no position, DO NOT name-match.
    if (!pos0) return null;

    const anyCandHasPos = cands.some((c) => !!c.pos);
    const candidatesToScore = anyCandHasPos ? cands.filter((c) => c.pos === pos0) : cands;
    if (anyCandHasPos && candidatesToScore.length === 0) return null;

    let best = null;
    let bestScore = -1;

    for (const c of candidatesToScore) {
      const candPos = c.pos;
      const candTeam = c.team;

      if (candPos && pos0 && candPos !== pos0) continue;

      let score = 0;
      if (candPos && pos0 && candPos === pos0) score += 80;
      if (candTeam && team0 && candTeam === team0) score += 20;
      if (!candPos && candTeam && team0 && candTeam === team0) score += 10;

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return bestScore >= 0 ? best : null;
  }

  return { addCandidate, pickBest, raw: byName };
}

function createCandidateIndex2(seedByName) {
  // nameKey -> array of candidates: { pos, team, one_qb, superflex }
  const byName =
    seedByName && typeof seedByName === "object"
      ? seedByName
      : Object.create(null);

  function addCandidate({ name, pos, team, one_qb, superflex }) {
    const nn = keyName(name);
    if (!nn) return;

    const cand = {
      // ✅ normalize IDP positions to shared buckets (DB/DL/LB)
      pos: normalizeIdpPosForMatch(pos),
      team: normTeam(team),
      one_qb: safeNum(one_qb),
      superflex: safeNum(superflex),
    };

    if (!(cand.one_qb > 0 || cand.superflex > 0)) return;

    if (!byName[nn]) byName[nn] = [];

    // ✅ merge duplicates (same pos/team) instead of spamming entries
    const existing = byName[nn].find(
      (c) => c.pos === cand.pos && c.team === cand.team
    );
    if (existing) {
      if (cand.one_qb > 0) existing.one_qb = cand.one_qb;
      if (cand.superflex > 0) existing.superflex = cand.superflex;
      return;
    }

    byName[nn].push(cand);
  }

  function pickBest(name, pos, team) {
    const nn = keyName(name);
    if (!nn) return null;

    const cands = byName[nn];
    if (!Array.isArray(cands) || cands.length === 0) return null;

    // ✅ normalize lookup pos the same way as candidates
    const pos0 = normalizeIdpPosForMatch(pos);
    const team0 = normTeam(team);

    // keep your “no pos => no match”
    if (!pos0) return null;

    const anyCandHasPos = cands.some((c) => !!c.pos);
    const candidatesToScore = anyCandHasPos ? cands.filter((c) => c.pos === pos0) : cands;
    if (anyCandHasPos && candidatesToScore.length === 0) return null;

    let best = null;
    let bestScore = -1;

    for (const c of candidatesToScore) {
      if (c.pos && pos0 && c.pos !== pos0) continue;

      let score = 0;
      if (c.pos && pos0 && c.pos === pos0) score += 80;
      if (c.team && team0 && c.team === team0) score += 20;
      if (!c.pos && c.team && team0 && c.team === team0) score += 10;

      // small tie-break: higher SF then 1QB
      const tie = safeNum(c.superflex) * 1e6 + safeNum(c.one_qb);

      if (
        score > bestScore ||
        (score === bestScore &&
          tie > (safeNum(best?.superflex) * 1e6 + safeNum(best?.one_qb)))
      ) {
        bestScore = score;
        best = c;
      }
    }

    return bestScore >= 0 ? best : null;
  }

  return { addCandidate, pickBest, raw: byName };
}


// ========== IDPShow cache shape normalizer ==========
// Supports multiple cache shapes so the UI doesn't break if the updater changes:
// 1) Array of rows: [{ name, position/pos, team, one_qb, superflex }]
// 2) Wrapped array: { data: [...] } or { players: [...] }
// 3) Bucketed object: { Dynasty_SF:[{name,position,team,value}], ... }
function coerceIdpShowRows(idpShowData) {
  if (!idpShowData) return [];

  // (1) Already an array
  if (Array.isArray(idpShowData)) return idpShowData;

  // (2) Common wrappers
  const wrapped = idpShowData?.data || idpShowData?.players;
  if (Array.isArray(wrapped)) return wrapped;

  // (3) Bucketed (our updater output)
  const buckets = [
    "Dynasty_1QB",
    "Dynasty_SF",
    "Redraft_1QB",
    "Redraft_SF",
  ];
  const hasBucket = buckets.some((k) => Array.isArray(idpShowData?.[k]));
  if (hasBucket) {
    const map = new Map();
    const keyOf = (name, pos, team) => {
      const n = normalizeName(name);
      const p = String(pos || "").toUpperCase().trim();
      const t = String(team || "").toUpperCase().trim();
      return `${n}|${p}|${t}`;
    };
    const upsert = (row, which) => {
      const name = row?.name;
      if (!name) return;
      const position = (row?.position || row?.pos || "").toString().replace(/\d+$/, "").trim();
      const team = (row?.team || "").toString().trim();
      const k = keyOf(name, position, team);
      const existing = map.get(k) || {
        name,
        position,
        team,
        one_qb: 0,
        superflex: 0,
      };
      // preserve best display name
      if (!existing.name || String(existing.name).length < String(name).length) existing.name = name;
      if (!existing.position && position) existing.position = position;
      if (!existing.team && team) existing.team = team;

      const v = Number(row?.value) || 0;
      if (which === "1qb") existing.one_qb = v || existing.one_qb || 0;
      if (which === "sf") existing.superflex = v || existing.superflex || 0;
      map.set(k, existing);
    };

    (idpShowData.Dynasty_1QB || []).forEach((r) => upsert(r, "1qb"));
    (idpShowData.Redraft_1QB || []).forEach((r) => upsert(r, "1qb"));
    (idpShowData.Dynasty_SF || []).forEach((r) => upsert(r, "sf"));
    (idpShowData.Redraft_SF || []).forEach((r) => upsert(r, "sf"));

    return Array.from(map.values());
  }

  // (4) Raw Apps Script shape: { Sheet1:[{name,team,position,value_1qb,value_sf,...}], ... }
  const sheetEntries = Object.entries(idpShowData || {}).filter(([, v]) => Array.isArray(v));
  if (sheetEntries.length) {
    const out = [];
    for (const [, rows] of sheetEntries) {
      for (const r of rows) {
        const name = r?.name || r?.player || "";
        if (!name) continue;
        out.push({
          name,
          team: (r?.team || "").toString().trim(),
          position: (r?.position || r?.pos || "").toString().replace(/\d+$/, "").trim(),
          one_qb: Number(r?.value_1qb) || 0,
          superflex: Number(r?.value_sf) || 0,
        });
      }
    }
    return out;
  }

  return [];
}

// =====================
// Projections (candidate-based, matches value-style rules)
// =====================
const PROJ_JSON_URL = "/projections_2025.json";
const PROJ_ESPN_JSON_URL = "/projections_espn_2025.json";
const PROJ_CBS_JSON_URL = "/projections_cbs_2025.json";

function normalizeTeamAbbr(x) {
  const s = String(x || "").toUpperCase().trim();
  const map = {
    JAX: "JAC",
    LA: "LAR",
    STL: "LAR",
    SD: "LAC",
    OAK: "LV",
    WFT: "WAS",
    WSH: "WAS",
  };
  return map[s] || s;
}
function normalizePos(x) {
  const p = String(x || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "DEFENSE") return "DEF";
  if (p === "PK") return "K";
  return p;
}
function getSleeperTeamForProj(p) {
  return normalizeTeamAbbr(p?.team);
}

function getSleeperPosForProj(p) {
  // keep consistent with your value-matching: use stable `position`
  return normalizePos(getPrimaryPos(p));
}

/**
 * Projection candidate index:
 * - Key: normalized name
 * - Candidate: { pos, team, pts }
 * - pickBest requires Sleeper pos (no pos => null) like your value indexes
 */
function createProjectionIndex(seedByName) {
  const byName = (seedByName && typeof seedByName === "object") ? seedByName : Object.create(null);

  function add({ name, pos, team, pts }) {
    const nn = keyName(name);
    if (!nn) return;

    const cand = {
      pos: normalizePos(pos),
      team: normalizeTeamAbbr(team),
      pts: safeNum(pts),
    };
    if (!(cand.pts > 0)) return;

    if (!byName[nn]) byName[nn] = [];
    byName[nn].push(cand);
  }

  function pickBest({ name, pos, team }) {
    const nn = keyName(name);
    if (!nn) return null;

    const cands = byName[nn];
    if (!Array.isArray(cands) || cands.length === 0) return null;

    const pos0 = normalizePos(pos);
    const team0 = normalizeTeamAbbr(team);

    // ✅ match the “values” rule: no position => no name matching
    if (!pos0) return null;

    const anyCandHasPos = cands.some((c) => !!c.pos);
    const candidatesToScore = anyCandHasPos ? cands.filter((c) => c.pos === pos0) : cands;
    if (anyCandHasPos && candidatesToScore.length === 0) return null;

    let best = null;
    let bestScore = -1;

    for (const c of candidatesToScore) {
      if (c.pos && pos0 && c.pos !== pos0) continue;

      let score = 0;
      if (c.pos && pos0 && c.pos === pos0) score += 80;
      if (c.team && team0 && c.team === team0) score += 20;
      if (!c.pos && c.team && team0 && c.team === team0) score += 10;

      // tiny tie-breaker: higher projection wins when scores equal
      if (score > bestScore || (score === bestScore && (c.pts || 0) > (best?.pts || 0))) {
        bestScore = score;
        best = c;
      }
    }

    return bestScore >= 0 ? best : null;
  }

  return { add, pickBest, raw: byName };
}

function buildProjectionIndexFromJSON(json) {
  const rows = Array.isArray(json) ? json : json?.rows || [];
  const idx = createProjectionIndex();

  rows.forEach((r) => {
    const name = r.name || r.player || r.full_name || "";
    const pts = Number(r.points ?? r.pts ?? r.total ?? r.projection ?? 0) || 0;

    const rawTeam = r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team;
    const team = normalizeTeamAbbr(rawTeam);

    const rawPos = r.pos ?? r.position ?? r.player_position;
    const pos = normalizePos(rawPos);

    if (!name) return;
    idx.add({ name, pos, team, pts });
  });

  return idx;
}

async function fetchProjectionIndex(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return buildProjectionIndexFromJSON(json);
  } catch {
    return null;
  }
}

export const SleeperProvider = ({ children }) => {
  const [username, setUsername] = useState(() => lsGet("username", null));
  const [year, setYear] = useState(() => {
    const y = lsGet("year");
    return y != null && y !== "" ? Number(y) : new Date().getFullYear();
  });

  const [players, setPlayers] = useState({});
  const [leagues, setLeagues] = useState([]);

  // Global knobs used across tools (driven by SourceSelector)
  const [format, setFormat] = useState(() => lsGet("format", "dynasty"));
  const [qbType, setQbType] = useState(() => lsGet("qbType", "sf"));

  // Unified source key used by SourceSelector (can be either proj:* or val:*)
  const [sourceKey, setSourceKey] = useState(() => lsGet("sourceKey", "proj:ffa"));

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [activeLeague, setActiveLeague] = useState(() => lsGet("activeLeague", null));

  const preloadCalled = useRef(false);

  // Prevent infinite "auto-recover" loops if storage/IDB gets cleared.
  const recoveringRef = useRef(false);

  // ===== Projections state (in context) =====
  const [projectionIndexes, setProjectionIndexes] = useState({
    FFA: null,
    ESPN: null,
    CBS: null,
  });

  useEffect(() => {
    lsSet("username", username);
  }, [username]);
  useEffect(() => {
    lsSet("year", year);
  }, [year]);
  useEffect(() => {
    lsSet("format", format);
  }, [format]);
  useEffect(() => {
    lsSet("qbType", qbType);
  }, [qbType]);
  useEffect(() => {
    lsSet("sourceKey", sourceKey);
  }, [sourceKey]);
  useEffect(() => {
    if (activeLeague) lsSet("activeLeague", activeLeague);
    else lsSet("activeLeague", null);
  }, [activeLeague]);

  // ===== Unified source helpers (values + projections) =====
  const metricType = String(sourceKey || "").startsWith("proj:")
    ? "projection"
    : "value";

  // SourceSelector key -> internal values source name used by makeGetPlayerValue
  const valueSourceFromKey = (k) => {
    const map = {
      "val:fantasycalc": "FantasyCalc",
      "val:keeptradecut": "KeepTradeCut",
      "val:dynastyprocess": "DynastyProcess",
      "val:fantasynav": "FantasyNavigator",
      "val:idynastyp": "IDynastyP",
      "val:idpshow": "IDPShow",

    };
    return map[String(k || "")] || "FantasyCalc";
  };

  // SourceSelector key -> legacy projection code your getProjection() expects
  const projectionSourceFromKey = (k) => {
    const map = {
      // ✅ your /projections_2025.json is FFA
      "proj:ffa": "FFA",
      "proj:espn": "ESPN",
      "proj:cbs": "CBS",

      // ✅ backward-compat: if anything still sends proj:sleeper, treat it as FFA
      "proj:sleeper": "FFA",
    };
    return map[String(k || "")] || "FFA";
  };

  // When a projection key is selected, some pages still want a value getter.
  // Preserve LeagueHub's old behavior: values fall back to FantasyCalc unless
  // a value key is actively selected.
  const activeValueSource = metricType === "value" ? valueSourceFromKey(sourceKey) : "FantasyCalc";

  const projectionSource =
    metricType === "projection" ? projectionSourceFromKey(sourceKey) : "FFA";

  // Fast path: current global value getter (when a value key is selected)
  const getPlayerValueFn = useMemo(() => {
    return makeGetPlayerValue(
      activeValueSource,
      String(format || "dynasty").toLowerCase(),
      String(qbType || "sf").toLowerCase()
    );
  }, [activeValueSource, format, qbType]);

  // Universal helper: can be called with overrides (sourceKey/format/qbType)
  const getPlayerValue = (p, opts = null) => {
    const fmt = String(opts?.format || format || "dynasty").toLowerCase();
    const qb = String(opts?.qbType || qbType || "sf").toLowerCase();
    const srcKey = opts?.sourceKey ?? sourceKey;

    const mt = String(srcKey || "").startsWith("proj:") ? "projection" : "value";
    if (
      mt === "value" &&
      srcKey === sourceKey &&
      fmt === String(format || "dynasty").toLowerCase() &&
      qb === String(qbType || "sf").toLowerCase()
    ) {
      return getPlayerValueFn(p);
    }
    const src = mt === "value" ? valueSourceFromKey(srcKey) : "FantasyCalc";
    return makeGetPlayerValue(src, fmt, qb)(p);
  };

  useEffect(() => {
    if (username && !preloadCalled.current) {
      preloadCalled.current = true;
      preloadPlayers();
      preloadProjections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const updateProgress = (value) => setProgress((prev) => Math.min(value, 100));

  // Validate a username without mutating state first.
  const validateUsername = async (uname) => {
    if (!uname) return null;
    try {
      const res = await fetch(`https://api.sleeper.app/v1/user/${uname}`);
      if (!res.ok) return null;
      const user = await res.json();
      return user && user.user_id ? user : null;
    } catch {
      return null;
    }
  };

  const logout = () => {
    lsClear();
    setUsername(null);
    setLeagues([]);
    setPlayers({});
    setProjectionIndexes({ FFA: null, ESPN: null, CBS: null });
    setActiveLeague(null);
    preloadCalled.current = false;
  };

  // ===== Projections caching =====
  // ✅ Bump version + add validation so we do NOT get stuck with a null/empty cached payload.
  const PROJ_CACHE_KEY = "projIndex_v1.104";

  const preloadProjections = async () => {
    try {
      const hydrate = (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const idx = createProjectionIndex(raw);
        const size = raw ? Object.keys(raw).length : 0;
        return size > 0 ? idx : null;
      };

      const cached = await get(PROJ_CACHE_KEY);
      if (cached && typeof cached === "object") {
        const hasFFA = cached?.FFA && typeof cached.FFA === "object" && Object.keys(cached.FFA).length > 0;
        const hasESPN = cached?.ESPN && typeof cached.ESPN === "object" && Object.keys(cached.ESPN).length > 0;
        const hasCBS = cached?.CBS && typeof cached.CBS === "object" && Object.keys(cached.CBS).length > 0;

        // ✅ Only early-return if we actually have at least one non-empty index cached
        if (hasFFA || hasESPN || hasCBS) {
          setProjectionIndexes({
            FFA: hydrate(cached?.FFA) || null,
            ESPN: hydrate(cached?.ESPN) || null,
            CBS: hydrate(cached?.CBS) || null,
          });
          return;
        }
      }

      const [ffa, espn, cbs] = await Promise.all([
        fetchProjectionIndex(PROJ_JSON_URL),        // ✅ FFA
        fetchProjectionIndex(PROJ_ESPN_JSON_URL),
        fetchProjectionIndex(PROJ_CBS_JSON_URL),
      ]);

      const payloadRaw = {
        FFA: ffa?.raw || null,
        ESPN: espn?.raw || null,
        CBS: cbs?.raw || null,
      };

      await set(PROJ_CACHE_KEY, payloadRaw);

      setProjectionIndexes({
        FFA: hydrate(payloadRaw.FFA),
        ESPN: hydrate(payloadRaw.ESPN),
        CBS: hydrate(payloadRaw.CBS),
      });
    } catch (e) {
      console.error("❌ Projection preload error:", e);
      setProjectionIndexes({ FFA: null, ESPN: null, CBS: null });
    }
  };

  // Single helper: matches your value-style candidate rules (pos required; pos+team preferred)
  const getProjection = (p, source = "FFA") => {
    // Accept either legacy codes (FFA/ESPN/CBS) or SourceSelector keys (proj:ffa/proj:espn/proj:cbs)
    let src = String(source || "FFA");
    if (src.startsWith("proj:")) src = projectionSourceFromKey(src);

    if (src !== "FFA" && src !== "ESPN" && src !== "CBS") src = "FFA";
    if (!p) return 0;

    const idx =
      src === "ESPN"
        ? projectionIndexes.ESPN
        : src === "CBS"
        ? projectionIndexes.CBS
        : projectionIndexes.FFA;

    if (!idx) return 0;

    const fullName =
      p.full_name ||
      p.search_full_name ||
      `${p.first_name || ""} ${p.last_name || ""}`.trim();

    const pos = getSleeperPosForProj(p);
    const team = getSleeperTeamForProj(p);

    const best = idx.pickBest({ name: fullName, pos, team });
    return safeNum(best?.pts);
  };

  // Auto-recover if storage/IDB gets cleared while UI still has a username.
  useEffect(() => {
    const hasUsername = !!username;
    const missingPlayers = !players || Object.keys(players).length === 0;
    const missingLeagues = !Array.isArray(leagues) || leagues.length === 0;
    const missingProjs =
      !projectionIndexes?.FFA && !projectionIndexes?.ESPN && !projectionIndexes?.CBS;

    if (!hasUsername) return;
    if (loading) return;
    if (!(missingPlayers || missingLeagues || missingProjs)) return;
    if (recoveringRef.current) return;

    recoveringRef.current = true;

    (async () => {
      const user = await validateUsername(username);
      if (!user) {
        setError("Saved Sleeper username is invalid. Please log in again.");
        recoveringRef.current = false;
        logout();
        return;
      }

      try {
        const leaguesRes = await fetch(
          `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${year}`
        );
        const leaguesData = await leaguesRes.json();
        setLeagues(Array.isArray(leaguesData) ? leaguesData : []);

        if (missingPlayers) {
          preloadCalled.current = true;
          await preloadPlayers();
        }

        if (missingProjs) {
          await preloadProjections();
        }
      } catch (e) {
        console.error("❌ Auto-recover failed:", e);
      } finally {
        recoveringRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, year, players, leagues, loading, projectionIndexes]);

  const login = async (uname, yr) => {
    try {
      setLoading(true);
      setProgress(5);
      setError("");

      const user = await validateUsername(uname);
      if (!user) throw new Error("User not found");
      updateProgress(20);

      lsSet("username", uname);
      lsSet("year", yr);
      setUsername(uname);
      setYear(yr);

      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yr}`
      );
      const leaguesData = await leaguesRes.json();
      setLeagues(Array.isArray(leaguesData) ? leaguesData : []);
      updateProgress(50);

      if (!preloadCalled.current) {
        preloadCalled.current = true;
        await preloadPlayers();
      }

      await preloadProjections();
    } catch (err) {
      console.error("❌ Login error:", err);
      setError(err?.message || "Login failed");

      if (String(err?.message || "").toLowerCase().includes("user not found")) {
        lsSet("username", null);
        setUsername(null);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ Player DB caching and merging:
   * - FantasyCalc: match by Sleeper ID
   * - DP: requires stable position (no pos => 0)
   * - KTC: STRICT name+pos only (no name-only fallback)
   * - FN/SP: candidate-based; requires Sleeper pos (no pos => null)
   * - iDynastyP: candidate-based; requires Sleeper pos (no pos => null)
   */
  // ✅ Bump cache version so your fn_values aliases actually get written.
    const CACHE_KEY = "playerDB_v1.476";

  const preloadPlayers = async () => {
    try {
      setLoading(true);
      setProgress(60);
      setError("");

      const cachedPlayers = await get(CACHE_KEY);
      if (cachedPlayers && typeof cachedPlayers === "object") {
        console.log("✅ Loaded player DB from cache:", Object.keys(cachedPlayers).length);
        setPlayers(cachedPlayers);
        setProgress(100);
        return;
      }

      const playersRes = await fetch("https://api.sleeper.app/v1/players/nfl");
      const playersData = await playersRes.json();
      updateProgress(68);

      const [fcRes, dpRes, ktcRes, fnRes, idpRes, idpShowRes, spRes] = await Promise.all([
        fetch("/fantasycalc_cache.json"),
        fetch("/dynastyprocess_cache.json"),
        fetch("/ktc_cache.json"),
        fetch("/fantasynav_cache.json"),
        fetch("/idynastyp_cache.json"),
        fetch("/idpshow_cache.json"),
        fetch("/stickypicky_cache.json"),
      ]);

      const [fcData, dpData, ktcData, fnData, idpData, idpShowData, spData] = await Promise.all([
        fcRes.json(),
        dpRes.json(),
        ktcRes.json(),
        fnRes.json(),
        idpRes.json(),
        idpShowRes.json(),
        spRes.json(),
      ]);
      updateProgress(78);

      const mapBySleeperId = (arr) => {
        const map = {};
        (Array.isArray(arr) ? arr : []).forEach((item) => {
          const sleeperId = item?.player?.sleeperId;
          if (!sleeperId) return;
          map[String(sleeperId)] = safeNum(item?.value);
        });
        return map;
      };

      const dynastySFMap = mapBySleeperId(fcData?.Dynasty_SF);
      const dynasty1QBMap = mapBySleeperId(fcData?.Dynasty_1QB);
      const redraftSFMap = mapBySleeperId(fcData?.Redraft_SF);
      const redraft1QBMap = mapBySleeperId(fcData?.Redraft_1QB);

      const dpByName = {};
      const dpByNamePos = {};
      if (dpData && typeof dpData === "object") {
        Object.keys(dpData).forEach((name) => {
          const v = dpData[name];
          const nn = keyName(name);
          dpByName[nn] = v;
          const p = normPos(v?.pos);
          if (p) dpByNamePos[`${nn}|${p}`] = v;
        });
      }

      const ktcByNamePos = {};
      const ingestKTC = (arr, which) => {
        (Array.isArray(arr) ? arr : []).forEach((p) => {
          const n = keyName(p?.name);
          if (!n) return;

          const pos = normPos(p?.position || p?.pos);
          const value = safeNum(p?.value);
          if (!pos) return;

          const k = `${n}|${pos}`;
          if (!ktcByNamePos[k]) ktcByNamePos[k] = { one_qb: 0, superflex: 0 };
          if (which === "one_qb") ktcByNamePos[k].one_qb = value;
          if (which === "superflex") ktcByNamePos[k].superflex = value;
        });
      };
      ingestKTC(ktcData?.OneQB, "one_qb");
      ingestKTC(ktcData?.Superflex, "superflex");

      const fnIndex = createCandidateIndex4();
      const spIndex = createCandidateIndex4();

      const ingest4WayList = (data, index) => {
        const KEY_MAP = {
          Dynasty_SF: "dynasty_sf",
          Dynasty_1QB: "dynasty_1qb",
          Redraft_SF: "redraft_sf",
          Redraft_1QB: "redraft_1qb",
        };

        Object.keys(KEY_MAP).forEach((k) => {
          const outKey = KEY_MAP[k];
          (Array.isArray(data?.[k]) ? data[k] : []).forEach((row) => {
            const name = row?.name;
            if (!name) return;

            index.addCandidate({
              name,
              pos: row?.position || row?.pos,
              team: row?.team,
              values: { [outKey]: row?.value },
            });
          });
        });
      };

      ingest4WayList(fnData, fnIndex);
      ingest4WayList(spData, spIndex);

      const idpIndex = createCandidateIndex2();

      const idpRows = Array.isArray(idpData)
        ? idpData
        : Array.isArray(idpData?.players)
        ? idpData.players
        : Array.isArray(idpData?.data)
        ? idpData.data
        : [];

      idpRows.forEach((row) => {
        const name = row?.name || row?.player || row?.player_name || row?.full_name;
        if (!name) return;

        const pos = normalizeIdpPosForMatch(row?.position || row?.pos);
        const team = row?.team || row?.nfl_team;

        const oneQb =
          row?.one_qb ??
          row?.oneQB ??
          row?.oneqb ??
          row?.one_qb_rank ??
          row?.value_one_qb ??
          row?.value_1qb ??
          row?.one_qb_value;

        const sf =
          row?.superflex ??
          row?.sf ??
          row?.super_flex ??
          row?.superflex_rank ??
          row?.value_superflex ??
          row?.value_sf ??
          row?.sf_value;

        idpIndex.addCandidate({
          name,
          pos,
          team,
          one_qb: oneQb,
          superflex: sf,
        });
      });

      const idpShowIndex = createCandidateIndex2();

      const idpShowRows = coerceIdpShowRows(idpShowData);

      idpShowRows.forEach((row) => {
        const name = row?.name || row?.player || row?.player_name || row?.full_name;
        if (!name) return;

        const pos = normalizeIdpPosForMatch(row?.position || row?.pos);
        const team = row?.team || row?.nfl_team;

        const oneQb =
          row?.one_qb ??
          row?.oneQB ??
          row?.oneqb ??
          row?.value_one_qb ??
          row?.value_1qb ??
          row?.one_qb_value;

        const sf =
          row?.superflex ??
          row?.sf ??
          row?.super_flex ??
          row?.value_superflex ??
          row?.value_sf ??
          row?.sf_value;

        idpShowIndex.addCandidate({
          name,
          pos,
          team,
          one_qb: oneQb,
          superflex: sf,
        });
      });

      const getDPValues = (normName0, pos0) => {
        if (!pos0) return { one_qb: 0, superflex: 0 };
        const best = dpByNamePos[`${normName0}|${pos0}`] || dpByName[normName0] || null;
        const dpPos = normPos(best?.pos);
        if (dpPos && dpPos !== pos0) return { one_qb: 0, superflex: 0 };
        return { one_qb: safeNum(best?.one_qb), superflex: safeNum(best?.superflex) };
      };

      const getKTCValues = (normName0, pos0) => {
        if (!pos0) return { one_qb: 0, superflex: 0 };
        const best = ktcByNamePos[`${normName0}|${pos0}`] || null;
        return { one_qb: safeNum(best?.one_qb), superflex: safeNum(best?.superflex) };
      };

      const pickBest4WayValue = (index, fullName, pos0, team0, valueKey) => {
  if (!index || !index.raw) return 0;

  const nn = keyName(fullName);
  if (!nn) return 0;

  const cands = index.raw[nn];
  if (!Array.isArray(cands) || cands.length === 0) return 0;

  const pos = normPos(pos0);
  const team = normTeam(team0);

  // match your "no pos => no match" rule
  if (!pos) return 0;

  const anyCandHasPos = cands.some((c) => !!c?.pos);
  const candidatesToScore = anyCandHasPos ? cands.filter((c) => c?.pos === pos) : cands;
  if (anyCandHasPos && candidatesToScore.length === 0) return 0;

  let best = null;
  let bestScore = -1;

  for (const c of candidatesToScore) {
    const candPos = normPos(c?.pos);
    const candTeam = normTeam(c?.team);

    if (candPos && pos && candPos !== pos) continue;

    let score = 0;
    if (candPos && pos && candPos === pos) score += 80;
    if (candTeam && team && candTeam === team) score += 20;
    if (!candPos && candTeam && team && candTeam === team) score += 10;

    const v = safeNum(c?.values?.[valueKey]);

    // tie-break using the value for THIS key (this is the important part)
    if (score > bestScore || (score === bestScore && v > safeNum(best?.values?.[valueKey]))) {
      bestScore = score;
      best = c;
    }
  }

  return bestScore >= 0 ? safeNum(best?.values?.[valueKey]) : 0;
};

const get4WayFromIndex = (index, fullName, pos0, team0) => {
  const dynasty_sf = pickBest4WayValue(index, fullName, pos0, team0, "dynasty_sf");
  const dynasty_1qb = pickBest4WayValue(index, fullName, pos0, team0, "dynasty_1qb");
  const redraft_sf = pickBest4WayValue(index, fullName, pos0, team0, "redraft_sf");
  const redraft_1qb = pickBest4WayValue(index, fullName, pos0, team0, "redraft_1qb");

  const out = { dynasty_sf, dynasty_1qb, redraft_sf, redraft_1qb };

  // keep your casing aliases for any downstream code that expects 1QB
  return {
    ...out,
    dynasty_1QB: out.dynasty_1qb,
    redraft_1QB: out.redraft_1qb,
  };
};


      const getIDP2FromIndex = (index, fullName, pos0, team0) => {
        const cand = index.pickBest(fullName, pos0, team0);
        return {
          one_qb: safeNum(cand?.one_qb),
          superflex: safeNum(cand?.superflex),
        };
      };

      const finalPlayers = {};

      Object.keys(playersData || {}).forEach((id) => {
        const p = playersData[id];
        if (!p) return;

        const isActive = p?.active === true || p?.active === 1;
        const fullName = p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
        const nn = normalizeName(fullName);
        const pos = getPrimaryPos(p);
        const team = normTeam(p.team);

        const fc_values = {
          dynasty_sf: safeNum(dynastySFMap[id]),
          dynasty_1qb: safeNum(dynasty1QBMap[id]),
          redraft_sf: safeNum(redraftSFMap[id]),
          redraft_1qb: safeNum(redraft1QBMap[id]),
        };

        const fantasyRelevant = isFantasyRelevantSleeperPlayer(p);

        const dp_values = fantasyRelevant ? getDPValues(nn, pos) : { one_qb: 0, superflex: 0 };

        const ktc_values =
          fantasyRelevant && ["QB", "RB", "WR", "TE"].includes(pos)
            ? getKTCValues(nn, pos)
            : { one_qb: 0, superflex: 0 };

        const fn_values = fantasyRelevant
          ? get4WayFromIndex(fnIndex, fullName, pos, team)
          : { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0, dynasty_1QB: 0, redraft_1QB: 0 };

        const sp_values = fantasyRelevant
          ? get4WayFromIndex(spIndex, fullName, pos, team)
          : { dynasty_sf: 0, dynasty_1qb: 0, redraft_sf: 0, redraft_1qb: 0, dynasty_1QB: 0, redraft_1QB: 0 };

        const idp_values = fantasyRelevant
          ? getIDP2FromIndex(idpIndex, fullName, pos, team)
          : { one_qb: 0, superflex: 0 };

        const idpshow_values = fantasyRelevant
          ? getIDP2FromIndex(idpShowIndex, fullName, pos, team)
          : { one_qb: 0, superflex: 0 };

        const hasPos = !!pos;

        const hasAnySignal =
          Object.values(fc_values).some((v) => v > 0) ||
          Object.values(dp_values).some((v) => v > 0) ||
          Object.values(ktc_values).some((v) => v > 0) ||
          Object.values(fn_values).some((v) => v > 0) ||
          Object.values(sp_values).some((v) => v > 0) ||
          Object.values(idp_values).some((v) => v > 0) ||
          Object.values(idpshow_values).some((v) => v > 0);

        const keep = (hasAnySignal && hasPos) || (isActive && fantasyRelevant && hasPos);

        if (keep) {
          finalPlayers[id] = {
            ...p,
            position: pos,
            fc_values,
            dp_values,
            ktc_values,
            fn_values,
            sp_values,
            idp_values,
            idpshow_values,
          };
        }
      });

      updateProgress(95);

      await set(CACHE_KEY, finalPlayers);
      setPlayers(finalPlayers);
      setProgress(100);
    } catch (err) {
      console.error("❌ Player preload error:", err);
      setError("Failed to preload player database.");
    } finally {
      setLoading(false);
    }
  };

  /** ✅ Fetch rosters dynamically for one league */
  const fetchLeagueRosters = async (leagueId) => {
    try {
      setLoading(true);
      setProgress(10);

      const [rostersRes, usersRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
      ]);

      const rosters = await rostersRes.json();
      const users = await usersRes.json();

      const updatedLeagues = leagues.map((lg) =>
        lg.league_id === leagueId ? { ...lg, rosters, users } : lg
      );
      setLeagues(updatedLeagues);
      updateProgress(100);
    } catch (err) {
      console.error("❌ Roster fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  /** ✅ Silent roster fetch: no global overlay, returns data, still updates context leagues */
  const fetchLeagueRostersSilent = async (leagueId) => {
    try {
      const [rostersRes, usersRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
      ]);

      if (!rostersRes.ok) throw new Error(`Rosters fetch failed for ${leagueId}`);
      if (!usersRes.ok) throw new Error(`Users fetch failed for ${leagueId}`);

      const rosters = await rostersRes.json();
      const users = await usersRes.json();

      const updatedLeagues = leagues.map((lg) =>
        lg.league_id === leagueId ? { ...lg, rosters, users } : lg
      );
      setLeagues(updatedLeagues);

      return { rosters, users };
    } catch (err) {
      console.error("❌ Silent roster fetch error:", err);
      throw err;
    }
  };

  return (
  <SleeperContext.Provider
    value={{
      username,
      year,
      players,
      leagues,
      activeLeague,
      setActiveLeague,

      format,
      qbType,
      setFormat,
      setQbType,

      // ✅ unified source controls (values + projections)
      sourceKey,
      setSourceKey,
      metricType,
      projectionSource,

      // ✅ Back-compat aliases (older pages/components expect these)
      selectedSource: sourceKey,
      setSelectedSource: setSourceKey,

      // ✅ Value getter (works for val:* keys; safe fallback when proj:* selected)
      getPlayerValue,

      // ✅ Projections in context
      projectionIndexes,
      preloadProjections,
      getProjection,

      // ✅ Back-compat: single getter that returns the "active metric"
      // - if proj:* => returns projection points
      // - if val:*  => returns value number
      getPlayerValueForSelectedSource: (p, opts = null) => {
        const sk = opts?.sourceKey ?? sourceKey;
        if (String(sk || "").startsWith("proj:")) {
          // accept proj:* keys or legacy codes
          return getProjection(p, sk);
        }
        return getPlayerValue(p, { ...(opts || {}), sourceKey: sk });
      },

      login,
      logout,
      fetchLeagueRosters,
      fetchLeagueRostersSilent,

      loading,
      progress,
      error,
    }}
  >
    {children}
  </SleeperContext.Provider>
);
};
