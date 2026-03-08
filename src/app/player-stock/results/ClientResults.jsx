"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

const Navbar = dynamic(() => import("../../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(
  () => import("../../../components/BackgroundParticles"),
  { ssr: false }
);

import LoadingScreen from "../../../components/LoadingScreen";
import SourceSelector from "../../../components/SourceSelector";
import { useSleeper } from "../../../context/SleeperContext";
import AvatarImage from "../../../components/AvatarImage";
import LeagueFormatBadge from "../../../components/LeagueFormatBadge";
import { classifyLeagueFormat } from "../../../lib/leagueFormat";

const safeNum = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  if (typeof v === "string") {
    const cleaned = v.replace(/[$,%\s]/g, "").replace(/,/g, "");
    const x = Number(cleaned);
    return Number.isFinite(x) ? x : 0;
  }

  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const formatDraftSlot = (pickNo, teams) => {
  const pick = safeNum(pickNo);
  const totalTeams = Math.max(0, Math.floor(safeNum(teams)));
  if (!pick) return "—";
  if (!totalTeams) return String(pick);

  const round = Math.floor((pick - 1) / totalTeams) + 1;
  const slot = ((pick - 1) % totalTeams) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
};

const formatAverageDraftPosition = (avgPickNo, avgTeams) => {
  const pick = safeNum(avgPickNo);
  if (!pick) return "—";

  const rounded = pick >= 100 ? pick.toFixed(0) : pick.toFixed(1);
  const slot = formatDraftSlot(Math.round(pick), avgTeams);
  return slot !== "—" ? `${slot} (${rounded})` : rounded;
};

const buildDraftInfo = (pick, draftMeta = {}) => {
  const pickNo = safeNum(pick?.pick_no);
  const teams = Math.max(
    0,
    Math.floor(
      safeNum(
        draftMeta?.teams ??
          draftMeta?.settings?.teams ??
          draftMeta?.total_rosters
      )
    )
  );
  const rounds = safeNum(
    draftMeta?.settings?.rounds ??
      draftMeta?.rounds ??
      draftMeta?.settings?.draft_rounds ??
      draftMeta?.draft_rounds
  );

  return {
    draftId: pick?.draft_id
      ? String(pick.draft_id)
      : draftMeta?.draft_id
      ? String(draftMeta.draft_id)
      : "",
    pickNo,
    draftSlot: formatDraftSlot(pickNo, teams),
    round: teams && pickNo ? Math.floor((pickNo - 1) / teams) + 1 : 0,
    slot: teams && pickNo ? ((pickNo - 1) % teams) + 1 : 0,
    teams,
    rounds,
    season: String(draftMeta?.season || ""),
    draftType: String(draftMeta?.type || ""),
    label: pickNo ? `${formatDraftSlot(pickNo, teams)}${teams ? ` (pick ${pickNo})` : ""}` : "—",
  };
};

const isAdpEligibleDraftInfo = (draftInfo, currentSeason) => {
  const pickNo = safeNum(draftInfo?.pickNo);
  if (!pickNo) return false;

  const season = String(draftInfo?.season || "").trim();
  if (!season || season !== String(currentSeason || "").trim()) return false;

  const rounds = safeNum(draftInfo?.rounds);
  if (rounds > 0 && rounds < 7) return false;

  return true;
};

const compareDraftPosition = (a, b, dir = 1) => {
  const av = safeNum(a);
  const bv = safeNum(b);
  const aMissing = !av;
  const bMissing = !bv;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return (av - bv) * dir;
};

const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatarUrl = (avatarId) =>
  avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : DEFAULT_LEAGUE_IMG;

const TRENDING_LIMIT = 50;
const DYNASTY_LINEAGE_LIMIT = 12;
const SCAN_CONCURRENCY = 4;

const BALLSVILLE_CANDIDATE_BASES = [
  (typeof process !== "undefined" && process?.env?.NEXT_PUBLIC_BALLSVILLE_BASE_URL) || "",
  "https://www.theballsvillegame.com",
  "https://theballsvillegame.com",
  "https://preview.theballsvillegame.com",
].filter(Boolean);
const BALLSVILLE_FETCH_CONCURRENCY = 3;

const cleanText = (v) => String(v ?? "").trim();
const slugText = (v) =>
  cleanText(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizePlayerName = (name) =>
  cleanText(name)
    .replace(/(jr\.?|sr\.?|ii|iii|iv|v)/gi, "")
    .replace(/[.'’-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const buildPlayerLookupKeys = (name, position = "") => {
  const nm = normalizePlayerName(name);
  const pos = cleanText(position).toUpperCase();
  if (!nm) return [];
  return pos ? [`${nm}|||${pos}`, nm] : [nm];
};

const classifyBallsvilleMode = (row = {}) => {
  const slug = slugText(row?.modeSlug || row?.slug || row?.id || row?.name);
  const title = cleanText(row?.title || row?.name || "").toLowerCase();
  const subtitle = cleanText(row?.subtitle || row?.blurb || "").toLowerCase();
  const hay = `${slug} ${title} ${subtitle}`;
  const isDynasty = /dynasty/.test(hay);
  const isStartup = /startup/.test(hay);
  return {
    key: isDynasty ? "dynasty" : "redraft",
    startupLike: isDynasty && isStartup,
  };
};

const normalizeBallsvilleModesPayload = (payload, fallbackSeason) => {
  const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const modeSlug = slugText(row?.modeSlug || row?.slug || row?.id || row?.name);
      const title = cleanText(row?.title || row?.name || modeSlug);
      if (!modeSlug || !title) return null;
      const season = cleanText(row?.year || row?.season || fallbackSeason);
      return {
        modeSlug,
        title,
        subtitle: cleanText(row?.subtitle || row?.blurb || ""),
        season,
        ...classifyBallsvilleMode(row),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
};

const getBallsvilleJsonUrl = (baseUrl, key) => {
  const base = cleanText(baseUrl).replace(/\/$/, "");
  const normalizedKey = String(key || "").replace(/^\/+/, "");
  return base ? `${base}/r2/${normalizedKey}` : "";
};

const extractBallsvilleLeagueRows = (raw) => {
  const perLeague = raw?.perLeague || {};
  return [
    ...(Array.isArray(perLeague?.sideA) ? perLeague.sideA : []),
    ...(Array.isArray(perLeague?.sideB) ? perLeague.sideB : []),
    ...(Array.isArray(raw?.leagues) ? raw.leagues : []),
  ];
};

const aggregateBallsvilleModeJson = (raw) => {
  const leagueRows = extractBallsvilleLeagueRows(raw);
  const byLeaguePlayer = new Map();

  for (const league of leagueRows) {
    const leagueId = cleanText(league?.leagueId || league?.id || league?.name || Math.random());
    const playersMap = league?.players && typeof league.players === "object" ? league.players : {};
    const seen = new Set();

    for (const [rawKey, player] of Object.entries(playersMap)) {
      const obj = player && typeof player === "object" ? player : {};
      const [nameFromKey = "", posFromKey = ""] = String(rawKey).split("|||");
      const name = cleanText(obj?.name || nameFromKey);
      const position = cleanText(obj?.position || posFromKey).toUpperCase();
      const overallPick = safeNum(obj?.modeOverallPick ?? obj?.avgOverallPick ?? obj?.adp ?? obj?.avgPick);
      if (!name || !overallPick) continue;

      const dedupeKey = `${normalizePlayerName(name)}|||${position}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!byLeaguePlayer.has(dedupeKey)) {
        byLeaguePlayer.set(dedupeKey, {
          name,
          position,
          sumPick: 0,
          sampleCount: 0,
          leagueIds: new Set(),
        });
      }
      const entry = byLeaguePlayer.get(dedupeKey);
      if (entry.leagueIds.has(leagueId)) continue;
      entry.leagueIds.add(leagueId);
      entry.sumPick += overallPick;
      entry.sampleCount += 1;
    }
  }

  if (byLeaguePlayer.size === 0 && raw?.players && typeof raw.players === "object") {
    for (const [rawKey, player] of Object.entries(raw.players)) {
      const obj = player && typeof player === "object" ? player : {};
      const [nameFromKey = "", posFromKey = ""] = String(rawKey).split("|||");
      const name = cleanText(obj?.name || nameFromKey);
      const position = cleanText(obj?.position || posFromKey).toUpperCase();
      const overallPick = safeNum(obj?.avgOverallPick ?? obj?.modeOverallPick ?? obj?.adp ?? obj?.avgPick);
      const sampleCount = safeNum(obj?.count || obj?.leagueCount || 0) || 1;
      if (!name || !overallPick) continue;
      byLeaguePlayer.set(`${normalizePlayerName(name)}|||${position}`, {
        name,
        position,
        sumPick: overallPick * sampleCount,
        sampleCount,
        leagueIds: new Set(),
      });
    }
  }

  return byLeaguePlayer;
};

const mergeBallsvilleModeMaps = (maps) => {
  const out = new Map();
  for (const modeMap of maps) {
    for (const [key, entry] of modeMap.entries()) {
      if (!out.has(key)) {
        out.set(key, {
          name: entry.name,
          position: entry.position,
          sumPick: 0,
          sampleCount: 0,
        });
      }
      const dest = out.get(key);
      dest.sumPick += safeNum(entry?.sumPick);
      dest.sampleCount += safeNum(entry?.sampleCount);
    }
  }
  return new Map(
    Array.from(out.entries()).map(([key, entry]) => [
      key,
      {
        ...entry,
        avgOverallPick: entry.sampleCount > 0 ? entry.sumPick / entry.sampleCount : 0,
      },
    ])
  );
};

const resolveBallsvilleAdp = (map, playerName, playerPosition, fallbackName = "") => {
  if (!(map instanceof Map) || map.size === 0) return null;
  const keys = [
    ...buildPlayerLookupKeys(playerName, playerPosition),
    ...buildPlayerLookupKeys(fallbackName, playerPosition),
  ];
  for (const key of keys) {
    const hit = map.get(key);
    if (hit && safeNum(hit?.avgOverallPick) > 0) return hit;
  }
  return null;
};


export default function ClientResults({ initialSearchParams = {} }) {
  const {
    username,
    year,
    players,
    format,
    qbType,
    setFormat,
    setQbType,
    selectedSource,
    sourceKey,
    setSourceKey,
    metricType,
    getPlayerValueForSelectedSource,
  } = useSleeper();

  const effectiveSourceKey = sourceKey ?? selectedSource ?? "";
  const setEffectiveSourceKey = setSourceKey ?? (() => {});

  const getParam = (k) => {
    const v = initialSearchParams?.[k];
    return Array.isArray(v) ? v[0] : v ?? null;
  };
  const paramsKey = JSON.stringify({ year: getParam("year"), force: getParam("force") });

  const [loading, setLoading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState("Preparing scan…");
  const [error, setError] = useState("");

  const mt = String(metricType || "").toLowerCase();
  const isProj =
    mt === "projection" ||
    mt === "projections" ||
    mt === "proj" ||
    mt.includes("proj");

  const valueOrProjLabel = isProj ? "Proj (avg)" : "Value";
  const valueOrProjSortKey = isProj ? "proj" : "value";

  const [query, setQuery] = useState("");
  const [highlightStarters, setHighlightStarters] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [leagueCount, setLeagueCount] = useState(0);
  const [scanLeagues, setScanLeagues] = useState([]);
  const [rows, setRows] = useState([]);

  const [openPid, setOpenPid] = useState(null);
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [showVisibleLeaguesModal, setShowVisibleLeaguesModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  const [sortKey, setSortKey] = useState("count"); // name | count | adp | ballsvilleRedraftAdp | ballsvilleDynastyAdp | value | proj
  const [sortDir, setSortDir] = useState("desc");

  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const guardKey = username ? `ps:guard:${username}` : null;
  const [maxExposurePct, setMaxExposurePct] = useState(() => {
    if (typeof window === "undefined" || !guardKey) return 35;
    const raw = localStorage.getItem(guardKey);
    return raw ? Number(raw) : 35;
  });
  const initialExposureRef = useRef(maxExposurePct);
  useEffect(() => {
    if (guardKey) localStorage.setItem(guardKey, String(maxExposurePct));
  }, [guardKey, maxExposurePct]);

  const [trendingHours, setTrendingHours] = useState(24);
  const [trendingMode, setTrendingMode] = useState("all");
  const [trendingAddMap, setTrendingAddMap] = useState(() => new Map());
  const [trendingDropMap, setTrendingDropMap] = useState(() => new Map());

  const [includeDrafting, setIncludeDrafting] = useState(true);
  const [showRedraft, setShowRedraft] = useState(true);
  const [showKeeper, setShowKeeper] = useState(true);
  const [showDynasty, setShowDynasty] = useState(true);
  const [showBestBallFormat, setShowBestBallFormat] = useState(true);

  const [manualLeagueSelect, setManualLeagueSelect] = useState(false);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState(() => new Set());

  const [forceScanNonce, setForceScanNonce] = useState(0);

  const [ballsvilleBaseUrl, setBallsvilleBaseUrl] = useState("");
  const [ballsvilleModes, setBallsvilleModes] = useState([]);
  const [ballsvilleModesLoading, setBallsvilleModesLoading] = useState(false);
  const [ballsvilleModesError, setBallsvilleModesError] = useState("");
  const [selectedBallsvilleRedraftModes, setSelectedBallsvilleRedraftModes] = useState(() => new Set());
  const [selectedBallsvilleDynastyModes, setSelectedBallsvilleDynastyModes] = useState(() => new Set());
  const [ballsvilleRedraftAdpMap, setBallsvilleRedraftAdpMap] = useState(() => new Map());
  const [ballsvilleDynastyAdpMap, setBallsvilleDynastyAdpMap] = useState(() => new Map());
  const [ballsvilleAdpLoading, setBallsvilleAdpLoading] = useState(false);
  const [ballsvilleAdpError, setBallsvilleAdpError] = useState("");

  useEffect(() => {
    const key = `ps:trending:add:${trendingHours}:L${TRENDING_LIMIT}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      setTrendingAddMap(new Map(Object.entries(JSON.parse(cached))));
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=${trendingHours}&limit=${TRENDING_LIMIT}`
        );
        const arr = await res.json();
        const m = new Map(
          (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []).map((it) => [
            String(it.player_id),
            it.count || 0,
          ])
        );
        sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
        setTrendingAddMap(m);
      } catch {
        setTrendingAddMap(new Map());
      }
    })();
  }, [trendingHours]);

  useEffect(() => {
    const key = `ps:trending:drop:${trendingHours}:L${TRENDING_LIMIT}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      setTrendingDropMap(new Map(Object.entries(JSON.parse(cached))));
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=${trendingHours}&limit=${TRENDING_LIMIT}`
        );
        const arr = await res.json();
        const m = new Map(
          (Array.isArray(arr) ? arr.slice(0, TRENDING_LIMIT) : []).map((it) => [
            String(it.player_id),
            it.count || 0,
          ])
        );
        sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(m)));
        setTrendingDropMap(m);
      } catch {
        setTrendingDropMap(new Map());
      }
    })();
  }, [trendingHours]);

  useEffect(() => {
    let cancelled = false;
    const targetSeason = String(getParam("year") || year || new Date().getFullYear());

    async function loadBallsvilleModes() {
      setBallsvilleModesLoading(true);
      setBallsvilleModesError("");

      for (const base of BALLSVILLE_CANDIDATE_BASES) {
        try {
          const url = getBallsvilleJsonUrl(base, `data/draft-compare/modes_${targetSeason}.json`);
          if (!url) continue;
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const json = await res.json();
          const rows = normalizeBallsvilleModesPayload(json, targetSeason);
          if (!rows.length) continue;
          if (cancelled) return;
          setBallsvilleBaseUrl(base);
          setBallsvilleModes(rows);
          return;
        } catch {}
      }

      if (!cancelled) {
        setBallsvilleBaseUrl("");
        setBallsvilleModes([]);
        setBallsvilleModesError("Ballsville ADP modes could not be loaded.");
      }
    }

    loadBallsvilleModes().finally(() => {
      if (!cancelled) setBallsvilleModesLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [year, paramsKey]);

  useEffect(() => {
    if (!ballsvilleModes.length) return;

    setSelectedBallsvilleRedraftModes((prev) => {
      if (prev.size > 0) return prev;
      const defaults = ballsvilleModes
        .filter((row) => row.key === "redraft")
        .map((row) => row.modeSlug);
      return new Set(defaults);
    });

    setSelectedBallsvilleDynastyModes((prev) => {
      if (prev.size > 0) return prev;
      const startupDefaults = ballsvilleModes
        .filter((row) => row.key === "dynasty" && row.startupLike)
        .map((row) => row.modeSlug);
      const fallback = ballsvilleModes
        .filter((row) => row.key === "dynasty")
        .map((row) => row.modeSlug);
      return new Set(startupDefaults.length ? startupDefaults : fallback);
    });
  }, [ballsvilleModes]);

  useEffect(() => {
    let cancelled = false;
    const targetSeason = String(getParam("year") || year || new Date().getFullYear());

    async function fetchModeAggregate(modeSlugs) {
      const slugs = Array.from(modeSlugs || []).filter(Boolean);
      if (!ballsvilleBaseUrl || !slugs.length) return new Map();

      let cursor = 0;
      const maps = [];
      const workers = Array.from({ length: Math.min(BALLSVILLE_FETCH_CONCURRENCY, slugs.length) }, async () => {
        while (!cancelled) {
          const index = cursor++;
          if (index >= slugs.length) break;
          const slug = slugs[index];
          try {
            const url = getBallsvilleJsonUrl(ballsvilleBaseUrl, `data/draft-compare/drafts_${targetSeason}_${slug}.json`);
            if (!url) continue;
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) continue;
            const json = await res.json();
          } catch {}
        }
      });
      return maps;
    }

    async function loadBallsvilleAdp() {
      if (!ballsvilleBaseUrl || !ballsvilleModes.length) {
        setBallsvilleRedraftAdpMap(new Map());
        setBallsvilleDynastyAdpMap(new Map());
        return;
      }
      setBallsvilleAdpLoading(true);
      setBallsvilleAdpError("");
      try {
        const fetchCombined = async (modeSlugs) => {
          const slugs = Array.from(modeSlugs || []).filter(Boolean);
          if (!slugs.length) return new Map();
          let cursor = 0;
          const maps = [];
          const workers = Array.from({ length: Math.min(BALLSVILLE_FETCH_CONCURRENCY, slugs.length) }, async () => {
            while (!cancelled) {
              const index = cursor;
              cursor += 1;
              if (index >= slugs.length) break;
              const slug = slugs[index];
              try {
                const url = getBallsvilleJsonUrl(ballsvilleBaseUrl, `data/draft-compare/drafts_${targetSeason}_${slug}.json`);
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) continue;
                const json = await res.json();
                maps.push(aggregateBallsvilleModeJson(json));
              } catch {}
            }
          });
          await Promise.all(workers);
          return mergeBallsvilleModeMaps(maps);
        };

        const [redraftMap, dynastyMap] = await Promise.all([
          fetchCombined(selectedBallsvilleRedraftModes),
          fetchCombined(selectedBallsvilleDynastyModes),
        ]);
        if (cancelled) return;
        setBallsvilleRedraftAdpMap(redraftMap);
        setBallsvilleDynastyAdpMap(dynastyMap);
      } catch (e) {
        if (!cancelled) {
          setBallsvilleAdpError(e?.message || "Ballsville ADP could not be loaded.");
          setBallsvilleRedraftAdpMap(new Map());
          setBallsvilleDynastyAdpMap(new Map());
        }
      } finally {
        if (!cancelled) setBallsvilleAdpLoading(false);
      }
    }

    loadBallsvilleAdp();
    return () => {
      cancelled = true;
    };
  }, [ballsvilleBaseUrl, ballsvilleModes, selectedBallsvilleRedraftModes, selectedBallsvilleDynastyModes, year, paramsKey]);

  const getMetricRaw = (p) => safeNum(getPlayerValueForSelectedSource?.(p));

  const withLocalPlayerData = (row) => {
    const p = players?.[row.player_id];
    const resolvedName =
      row.name ||
      p?.full_name ||
      `${p?.first_name || ""} ${p?.last_name || ""}`.trim() ||
      "Unknown";
    const resolvedPos = (row.position || p?.position || "").toUpperCase();
    const resolvedTeam = (row.team || p?.team || "").toUpperCase();
    const ballsvilleRedraft = resolveBallsvilleAdp(
      ballsvilleRedraftAdpMap,
      resolvedName,
      resolvedPos,
      p?.full_name
    );
    const ballsvilleDynasty = resolveBallsvilleAdp(
      ballsvilleDynastyAdpMap,
      resolvedName,
      resolvedPos,
      p?.full_name
    );

    const base = {
      ...row,
      _name: resolvedName,
      _pos: resolvedPos,
      _team: resolvedTeam,
      _ballsvilleRedraftAdp: safeNum(ballsvilleRedraft?.avgOverallPick),
      _ballsvilleDynastyAdp: safeNum(ballsvilleDynasty?.avgOverallPick),
    };

    const raw = p ? getMetricRaw(p) : 0;

    if (isProj) {
      base._projAvg = raw;
      base._projSeason = 0;
      base._value = 0;
    } else {
      base._value = raw;
      base._projSeason = 0;
      base._projAvg = 0;
    }

    return base;
  };

  const isDraftLike = (status) => {
    const s = String(status || "").toLowerCase();
    return s.includes("pre_draft") || s.includes("drafting") || s === "draft";
  };

  const isActivelyDrafting = (status) => {
    const s = String(status || "").toLowerCase();
    return s.includes("drafting") || s === "drafting";
  };

  useEffect(() => {
    if (!username) return;

    const yr = getParam("year") || String(year || new Date().getFullYear());
    const forceParam = getParam("force") === "1";
    const force = forceParam || forceScanNonce > 0;

    const cacheKey = `ps:${username}:${yr}:ALL`;
    let cancel = false;

    (async () => {
      try {
        setError("");
        setLoading(true);
        setProgressPct(3);
        setProgressText("Looking up user…");

        const cached = !force ? sessionStorage.getItem(cacheKey) : null;
        if (cached) {
          const { rows: cachedRows, leagueCount: cachedLeagues, leagues: cachedList, ts } =
            JSON.parse(cached);

          if (!cancel) {
            setRows(cachedRows || []);
            setLeagueCount(cachedLeagues ?? 0);
            setScanLeagues(cachedList || []);
            setLastUpdated(ts ? new Date(ts) : new Date());

            setSelectedLeagueIds((prev) => {
              if (prev && prev.size > 0) return prev;
              return new Set((cachedList || []).map((l) => String(l.id)));
            });

            setProgressPct(100);
            setProgressText("Loaded from cache");
            setLoading(false);
          }
          return;
        }

        const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
        if (!userRes.ok) throw new Error("User not found");
        const user = await userRes.json();
        const userId = user.user_id;

        const ownerAliases = new Set(
          [
            userId,
            user?.user_id,
            user?.username,
            user?.display_name,
            user?.metadata?.team_name,
            user?.metadata?.nickname,
          ]
            .map((v) => String(v || "").trim())
            .filter(Boolean)
        );

        setProgressText("Fetching leagues…");
        setProgressPct(8);

        const leaguesRes = await fetch(
          `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${yr}`
        );
        const leagues = await leaguesRes.json();

        if (cancel) return;

        if (!Array.isArray(leagues) || leagues.length === 0) {
          setRows([]);
          setLeagueCount(0);
          setScanLeagues([]);
          setProgressPct(100);
          setProgressText("No leagues found.");
          setLoading(false);
          return;
        }

        const playerCounts = {};
        const playerLeagues = {};
        const includedLeagues = [];
        let processedLeagueCount = 0;

        const fetchJson = async (url) => {
          const r = await fetch(url);
          if (!r.ok) return null;
          try {
            return await r.json();
          } catch {
            return null;
          }
        };

        const leagueMap = new Map(
          (Array.isArray(leagues) ? leagues : []).map((lg) => [String(lg?.league_id || ""), lg])
        );
        const leagueDataCache = new Map();
        const rostersCache = new Map();
        const draftListCache = new Map();
        const draftPicksCache = new Map();
        const ownerIdSetCache = new Map();

        const getLeagueById = async (leagueId) => {
          const key = String(leagueId || "");
          if (!key) return null;
          if (leagueDataCache.has(key)) return leagueDataCache.get(key);

          const known = leagueMap.get(key);
          if (known) {
            leagueDataCache.set(key, known);
            return known;
          }

          const leagueObj = await fetchJson(`https://api.sleeper.app/v1/league/${key}`);
          const normalized = leagueObj && typeof leagueObj === "object" ? leagueObj : null;
          leagueDataCache.set(key, normalized);
          return normalized;
        };

        const getRostersForLeague = async (leagueId) => {
          const key = String(leagueId || "");
          if (!key) return [];
          if (rostersCache.has(key)) return rostersCache.get(key);

          const rosters = await fetchJson(`https://api.sleeper.app/v1/league/${key}/rosters`);
          const arr = Array.isArray(rosters) ? rosters : [];
          rostersCache.set(key, arr);
          return arr;
        };

        const getDraftsForLeague = async (leagueId, fallbackDraftId = null) => {
          const key = String(leagueId);
          if (draftListCache.has(key)) return draftListCache.get(key);

          let drafts = await fetchJson(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
          drafts = Array.isArray(drafts) ? drafts : [];

          if (
            fallbackDraftId &&
            !drafts.some((d) => String(d?.draft_id || "") === String(fallbackDraftId))
          ) {
            const single = await fetchJson(`https://api.sleeper.app/v1/draft/${fallbackDraftId}`);
            if (single?.draft_id) drafts.unshift(single);
          }

          draftListCache.set(key, drafts);
          return drafts;
        };

        const getPicksForDraft = async (draftId) => {
          const key = String(draftId || "");
          if (!key) return [];
          if (draftPicksCache.has(key)) return draftPicksCache.get(key);

          const picks = await fetchJson(`https://api.sleeper.app/v1/draft/${key}/picks`);
          const arr = Array.isArray(picks) ? picks : [];
          draftPicksCache.set(key, arr);
          return arr;
        };

        const sortDraftsChronologically = (drafts) => {
          const list = Array.isArray(drafts) ? [...drafts] : [];
          list.sort((a, b) => {
            const aSeason = safeNum(a?.season);
            const bSeason = safeNum(b?.season);
            if (aSeason !== bSeason) return aSeason - bSeason;

            const aStart = safeNum(a?.start_time ?? a?.created ?? a?.created_at);
            const bStart = safeNum(b?.start_time ?? b?.created ?? b?.created_at);
            if (aStart !== bStart) return aStart - bStart;

            return String(a?.draft_id || "").localeCompare(String(b?.draft_id || ""));
          });
          return list;
        };

        const getDynastyLineageLeagueIds = async (leagueObj) => {
          const out = [];
          const seen = new Set();
          let current = leagueObj;

          for (let i = 0; i < DYNASTY_LINEAGE_LIMIT; i++) {
            const currentId = String(current?.league_id || "");
            if (!currentId || seen.has(currentId)) break;

            out.push(currentId);
            seen.add(currentId);

            const prevId = String(current?.previous_league_id || "");
            if (!prevId || seen.has(prevId)) break;

            current = await getLeagueById(prevId);
            if (!current) break;
          }

          return out;
        };

        const getOwnerIdsForLeague = async (leagueId, currentUserId) => {
          const key = `${leagueId}:${currentUserId}`;
          if (ownerIdSetCache.has(key)) return ownerIdSetCache.get(key);

          const rosters = await getRostersForLeague(leagueId);
          const ids = new Set([String(currentUserId)]);

          for (const roster of rosters) {
            const ownerId = String(roster?.owner_id || "").trim();
            const coOwners = Array.isArray(roster?.co_owners) ? roster.co_owners : [];
            const rosterId = String(roster?.roster_id || "").trim();

            if (ownerId && ownerId === String(currentUserId)) {
              ids.add(ownerId);
              if (rosterId) ids.add(rosterId);
              for (const co of coOwners) {
                const coId = String(co || "").trim();
                if (coId) ids.add(coId);
              }
            } else if (coOwners.some((co) => String(co || "").trim() === String(currentUserId))) {
              if (ownerId) ids.add(ownerId);
              if (rosterId) ids.add(rosterId);
              for (const co of coOwners) {
                const coId = String(co || "").trim();
                if (coId) ids.add(coId);
              }
            }
          }

          ownerIdSetCache.set(key, ids);
          return ids;
        };

        const pickBelongsToManager = (pick, ownerIdSet) => {
          const candidates = [
            pick?.picked_by,
            pick?.owner_id,
            pick?.user_id,
            pick?.roster_id,
            pick?.metadata?.picked_by,
            pick?.metadata?.owner_id,
            pick?.metadata?.username,
            pick?.metadata?.display_name,
            pick?.metadata?.team_name,
          ]
            .map((v) => String(v || "").trim())
            .filter(Boolean);

          return candidates.some((value) => ownerIdSet.has(value) || ownerAliases.has(value));
        };

        const getMyDraftInfoForLeaguePlayers = async (
          leagueObj,
          currentUserId,
          playerIds,
          fallbackDraftId = null,
          includeAllDrafts = false
        ) => {
          const wanted = new Set((Array.isArray(playerIds) ? playerIds : []).map(String).filter(Boolean));
          const out = {};
          if (wanted.size === 0) return out;

          let drafts = [];
          let ownerIdSet = new Set([String(currentUserId)]);

          if (includeAllDrafts) {
            const lineageIds = await getDynastyLineageLeagueIds(leagueObj);
            for (const lineageLeagueId of lineageIds) {
              const lineageLeague = await getLeagueById(lineageLeagueId);
              if (!lineageLeague) continue;

              const lineageDrafts = await getDraftsForLeague(
                lineageLeagueId,
                lineageLeague?.draft_id || null
              );
              drafts.push(
                ...lineageDrafts.map((draft) => ({
                  ...draft,
                  __leagueId: String(lineageLeagueId),
                }))
              );

              const lineageOwnerIds = await getOwnerIdsForLeague(lineageLeagueId, currentUserId);
              lineageOwnerIds.forEach((id) => ownerIdSet.add(id));
            }
            drafts = sortDraftsChronologically(drafts);
          } else {
            const singleLeagueId = String(leagueObj?.league_id || "");
            const singleDrafts = await getDraftsForLeague(singleLeagueId, fallbackDraftId);
            drafts =
              Array.isArray(singleDrafts) && singleDrafts.length > 0
                ? [{ ...singleDrafts[0], __leagueId: singleLeagueId }]
                : [];

            ownerIdSet = await getOwnerIdsForLeague(singleLeagueId, currentUserId);
            ownerIdSet.add(String(currentUserId));
          }

          for (const draft of drafts) {
            if (wanted.size === Object.keys(out).length) break;

            const picks = await getPicksForDraft(draft?.draft_id);
            if (!Array.isArray(picks) || picks.length === 0) continue;

            for (const pick of picks) {
              const pid = pick?.player_id != null ? String(pick.player_id) : "";
              if (!pid || !wanted.has(pid) || out[pid]) continue;
              if (!pickBelongsToManager(pick, ownerIdSet)) continue;

              out[pid] = buildDraftInfo(pick, draft);
            }
          }

          return out;
        };

        const getMostRecentDraftForLeague = async (leagueId, fallbackDraftId) => {
          if (fallbackDraftId) {
            const drafts = await getDraftsForLeague(leagueId, fallbackDraftId);
            const found = Array.isArray(drafts)
              ? drafts.find((d) => String(d?.draft_id || "") === String(fallbackDraftId))
              : null;
            return found || { draft_id: String(fallbackDraftId) };
          }

          const drafts = await getDraftsForLeague(leagueId, null);
          if (Array.isArray(drafts) && drafts.length > 0) return drafts[0];
          return null;
        };

        const getMyDraftPickedPlayerIds = async (leagueObj, currentUserId, fallbackDraftId) => {
          const recentDraft = await getMostRecentDraftForLeague(
            leagueObj?.league_id,
            fallbackDraftId
          );
          const draftId = recentDraft?.draft_id ? String(recentDraft.draft_id) : null;
          if (!draftId) return { playerIds: [], draftInfoByPid: {} };

          const ownerIdSet = await getOwnerIdsForLeague(leagueObj?.league_id, currentUserId);
          ownerIdSet.add(String(currentUserId));

          const picks = await getPicksForDraft(draftId);
          if (!Array.isArray(picks) || picks.length === 0) {
            return { playerIds: [], draftInfoByPid: {} };
          }

          const mine = [];
          const draftInfoByPid = {};
          for (const pick of picks) {
            if (!pickBelongsToManager(pick, ownerIdSet)) continue;

            const pid = pick?.player_id != null ? String(pick.player_id) : "";
            if (pid) {
              mine.push(pid);
              if (!draftInfoByPid[pid]) draftInfoByPid[pid] = buildDraftInfo(pick, recentDraft);
            }
          }
          return { playerIds: mine, draftInfoByPid };
        };

        const processLeague = async (lg) => {
          if (cancel) return;

          const draftingNow = isActivelyDrafting(lg.status);
          const leagueDrafts = await getDraftsForLeague(lg.league_id, lg.draft_id || null);
          const leagueFormat = classifyLeagueFormat(lg, leagueDrafts);
          const leagueInfo = {
            id: lg.league_id,
            name: lg.name,
            avatar: lg.avatar || null,
            roster_positions: lg.roster_positions || [],
            status: lg.status || "",
            isBestBall: lg?.settings?.best_ball === 1,
            format: leagueFormat,
            hasRoster: false,
          };

          let rosterPlayers = [];
          let startersSet = new Set();
          let draftPlayers = [];
          let draftInfoByPid = {};

          if (draftingNow) {
            const draftResult = await getMyDraftPickedPlayerIds(
              lg,
              userId,
              lg.draft_id || null
            );
            draftPlayers = draftResult.playerIds || [];
            draftInfoByPid = draftResult.draftInfoByPid || {};

            if (draftPlayers.length === 0) return;
          } else {
            const rosters = await getRostersForLeague(lg.league_id);

            const mineRoster = Array.isArray(rosters)
              ? rosters.find(
                  (r) =>
                    String(r?.owner_id) === String(userId) ||
                    (Array.isArray(r?.co_owners) &&
                      r.co_owners.some((co) => String(co) === String(userId)))
                )
              : null;

            rosterPlayers = Array.isArray(mineRoster?.players) ? mineRoster.players.map(String) : [];
            startersSet = new Set(Array.isArray(mineRoster?.starters) ? mineRoster.starters.map(String) : []);
            leagueInfo.hasRoster = rosterPlayers.length > 0;

            if (leagueFormat.key === "keeper" && isDraftLike(lg.status)) {
              rosterPlayers = [];
              startersSet = new Set();
            }

            if (rosterPlayers.length > 0) {
              draftInfoByPid = await getMyDraftInfoForLeaguePlayers(
                lg,
                userId,
                rosterPlayers,
                lg.draft_id || null,
                leagueFormat.key === "dynasty"
              );
            }
          }

          const mergedPids = new Set([...rosterPlayers, ...draftPlayers]);
          if (mergedPids.size === 0) return;

          includedLeagues.push(leagueInfo);

          for (const pid of mergedPids) {
            playerCounts[pid] = (playerCounts[pid] || 0) + 1;

            if (!playerLeagues[pid]) playerLeagues[pid] = [];
            const draftInfo = draftInfoByPid[pid] || null;
            playerLeagues[pid].push({
              id: leagueInfo.id,
              name: leagueInfo.name,
              avatar: leagueInfo.avatar,
              status: leagueInfo.status,
              isBestBall: leagueInfo.isBestBall,
              format: leagueInfo.format,
              hasRoster: leagueInfo.hasRoster,
              isStarter: startersSet.has(pid),
              draftLabel: draftInfo?.label || "—",
              draftPickNo: draftInfo?.pickNo || 0,
              draftSlot: draftInfo?.draftSlot || "",
              draftRound: draftInfo?.round || 0,
              draftTeams: draftInfo?.teams || 0,
              draftRounds: draftInfo?.rounds || 0,
              draftSeason: draftInfo?.season || "",
              adpEligible: isAdpEligibleDraftInfo(draftInfo, yr),
              draftedByManager: !!draftInfo,
            });
          }
        };

        let cursor = 0;
        const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, leagues.length) }, async () => {
          while (!cancel) {
            const index = cursor++;
            if (index >= leagues.length) break;

            const lg = leagues[index];
            processedLeagueCount += 1;
            setProgressText(`Scanning leagues… (${processedLeagueCount}/${leagues.length})`);
            setProgressPct(Math.round((processedLeagueCount / leagues.length) * 100 * 0.92) + 8);

            await processLeague(lg);
          }
        });

        await Promise.all(workers);

        if (includedLeagues.length === 0) {
          setRows([]);
          setLeagueCount(0);
          setScanLeagues([]);
          setLastUpdated(new Date());
          setProgressPct(100);
          setProgressText("No leagues found for this user.");
          setLoading(false);
          return;
        }

        const built = Object.entries(playerCounts)
          .map(([pid, count]) => {
            const base = players?.[pid] || {};
            const team = String(base.team || "").toUpperCase();
            const pos = String(base.position || "").toUpperCase();

            const name =
              base.full_name ||
              `${base.first_name || ""} ${base.last_name || ""}`.trim() ||
              (team && team.length <= 4 ? team : "") ||
              String(pid);

            const leaguesForPlayer = playerLeagues[pid] || [];
            const draftedEntries = leaguesForPlayer.filter((lg) => lg?.adpEligible && safeNum(lg?.draftPickNo) > 0);
            const avgDraftPickNo = draftedEntries.length
              ? draftedEntries.reduce((sum, lg) => sum + safeNum(lg.draftPickNo), 0) / draftedEntries.length
              : 0;
            const avgDraftTeams = draftedEntries.length
              ? Math.round(
                  draftedEntries.reduce((sum, lg) => sum + safeNum(lg.draftTeams), 0) / draftedEntries.length
                )
              : 0;

            return {
              player_id: String(pid),
              name,
              team,
              position: pos,
              count,
              leagues: leaguesForPlayer,
              draftedCount: draftedEntries.length,
              avgDraftPickNo,
              avgDraftTeams,
            };
          })
          .sort((a, b) => b.count - a.count);

        if (cancel) return;

        const payload = {
          rows: built,
          leagueCount: includedLeagues.length,
          leagues: includedLeagues,
          ts: Date.now(),
        };
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));

        setRows(built);
        setLeagueCount(includedLeagues.length);
        setScanLeagues(includedLeagues);

        setSelectedLeagueIds((prev) => {
          if (prev && prev.size > 0) return prev;
          return new Set(includedLeagues.map((l) => String(l.id)));
        });

        setLastUpdated(new Date());
        setProgressPct(100);
        setProgressText("Done!");
      } catch (e) {
        setError(e?.message || "Scan failed");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [username, year, paramsKey, forceScanNonce]);

  const enriched = useMemo(
    () => rows.map(withLocalPlayerData),
    [rows, players, isProj, metricType, effectiveSourceKey, ballsvilleRedraftAdpMap, ballsvilleDynastyAdpMap]
  );

  const visibleLeagueIds = useMemo(() => {
    if (!scanLeagues || scanLeagues.length === 0) return new Set();
    const arr = scanLeagues
      .filter((lg) => {
        const formatKey = String(lg?.format?.key || "redraft").toLowerCase();

        if (formatKey === "bestball" && !showBestBallFormat) return false;
        if (formatKey === "dynasty" && !showDynasty) return false;
        if (formatKey === "keeper" && !showKeeper) return false;
        if (formatKey === "redraft" && !showRedraft) return false;

        if (!includeDrafting && isDraftLike(lg.status) && !lg.hasRoster) return false;

        return true;
      })
      .map((lg) => String(lg.id));
    return new Set(arr);
  }, [scanLeagues, includeDrafting, showRedraft, showKeeper, showDynasty, showBestBallFormat]);

  const activeLeagueIds = useMemo(() => {
    if (!manualLeagueSelect) return visibleLeagueIds;
    const out = new Set();
    for (const id of selectedLeagueIds) {
      if (visibleLeagueIds.has(String(id))) out.add(String(id));
    }
    return out;
  }, [manualLeagueSelect, selectedLeagueIds, visibleLeagueIds]);

  const visibleLeagueCount = activeLeagueIds.size || 0;

  const projectedRows = useMemo(() => {
    if (!activeLeagueIds) return enriched;
    return enriched
      .map((row) => {
        const leagues = (row.leagues || []).filter((lg) =>
          activeLeagueIds.has(String(lg.id))
        );
        const draftedEntries = leagues.filter((lg) => lg?.adpEligible && safeNum(lg?.draftPickNo) > 0);
        const avgDraftPickNo = draftedEntries.length
          ? draftedEntries.reduce((sum, lg) => sum + safeNum(lg.draftPickNo), 0) / draftedEntries.length
          : 0;
        const avgDraftTeams = draftedEntries.length
          ? Math.round(
              draftedEntries.reduce((sum, lg) => sum + safeNum(lg.draftTeams), 0) / draftedEntries.length
            )
          : 0;
        return {
          ...row,
          leagues,
          count: leagues.length,
          draftedCount: draftedEntries.length,
          avgDraftPickNo,
          avgDraftTeams,
        };
      })
      .filter((r) => r.count > 0);
  }, [enriched, activeLeagueIds]);

  const starterPidSet = useMemo(() => {
    const s = new Set();
    projectedRows.forEach((r) => {
      if (r.leagues?.some((lg) => lg.isStarter)) s.add(r.player_id);
    });
    return s;
  }, [projectedRows]);

  const filteredRows = useMemo(() => {
    let list = projectedRows;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (r) =>
          r._name.toLowerCase().includes(q) ||
          r._team.toLowerCase().includes(q) ||
          r._pos.toLowerCase().includes(q)
      );
    }
    if (trendingMode === "adds") list = list.filter((r) => trendingAddMap.has(r.player_id));
    else if (trendingMode === "drops") list = list.filter((r) => trendingDropMap.has(r.player_id));
    return list;
  }, [projectedRows, query, trendingMode, trendingAddMap, trendingDropMap]);

  const toggleSort = (key) => {
    setCurrentPage(1);
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "team" || key === "pos" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key) =>
    sortKey !== key ? <span className="opacity-40">↕</span> : sortDir === "asc" ? <span>▲</span> : <span>▼</span>;

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;

    const getMetricVal = (r) => (isProj ? (r._projAvg || 0) : (r._value || 0));

    if (trendingMode !== "all") {
      const getTrend = (r) =>
        trendingMode === "adds"
          ? (trendingAddMap.get(r.player_id) || 0)
          : (trendingDropMap.get(r.player_id) || 0);

      return [...filteredRows].sort((a, b) => {
        const tDiff = getTrend(b) - getTrend(a);
        if (tDiff !== 0) return tDiff;
        if (sortKey === "name") return a._name.localeCompare(b._name) * dir;
        if (sortKey === "team") return a._team.localeCompare(b._team) * dir;
        if (sortKey === "pos") return a._pos.localeCompare(b._pos) * dir;
        if (sortKey === "value" || sortKey === "proj") return (getMetricVal(a) - getMetricVal(b)) * dir;
        if (sortKey === "adp") return compareDraftPosition(a.avgDraftPickNo, b.avgDraftPickNo, dir);
        if (sortKey === "ballsvilleRedraftAdp") return compareDraftPosition(a._ballsvilleRedraftAdp, b._ballsvilleRedraftAdp, dir);
        if (sortKey === "ballsvilleDynastyAdp") return compareDraftPosition(a._ballsvilleDynastyAdp, b._ballsvilleDynastyAdp, dir);
        return ((a.count || 0) - (b.count || 0)) * dir;
      });
    }

    return [...filteredRows].sort((a, b) => {
      if (sortKey === "name") return a._name.localeCompare(b._name) * dir;
      if (sortKey === "team") return a._team.localeCompare(b._team) * dir;
      if (sortKey === "pos") return a._pos.localeCompare(b._pos) * dir;
      if (sortKey === "value" || sortKey === "proj") {
        const av = isProj ? (a._projAvg || 0) : (a._value || 0);
        const bv = isProj ? (b._projAvg || 0) : (b._value || 0);
        return (av - bv) * dir;
      }
      if (sortKey === "adp") return compareDraftPosition(a.avgDraftPickNo, b.avgDraftPickNo, dir);
      if (sortKey === "ballsvilleRedraftAdp") return compareDraftPosition(a._ballsvilleRedraftAdp, b._ballsvilleRedraftAdp, dir);
      if (sortKey === "ballsvilleDynastyAdp") return compareDraftPosition(a._ballsvilleDynastyAdp, b._ballsvilleDynastyAdp, dir);
      return ((a.count || 0) - (b.count || 0)) * dir;
    });
  }, [filteredRows, sortKey, sortDir, trendingMode, trendingAddMap, trendingDropMap, isProj]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  const resetFilters = () => {
    setIncludeDrafting(true);
    setShowRedraft(true);
    setShowKeeper(true);
    setShowDynasty(true);
    setShowBestBallFormat(true);
    setHighlightStarters(false);
    setQuery("");
    setMaxExposurePct(initialExposureRef.current ?? 25);
    setTrendingMode("all");
    setTrendingHours(24);
  };

  const doRefresh = () => {
    const yr = getParam("year") || String(year || new Date().getFullYear());
    const cacheKey = `ps:${username}:${yr}:ALL`;
    try {
      sessionStorage.removeItem(cacheKey);
    } catch {}
    setForceScanNonce((n) => n + 1);
  };

  const toggleLeagueSelected = (id) => {
    const sid = String(id);
    setSelectedLeagueIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedLeagueIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleLeagueIds) next.add(String(id));
      return next;
    });
  };

  const clearAllVisible = () => {
    setSelectedLeagueIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleLeagueIds) next.delete(String(id));
      return next;
    });
  };

  const ballsvilleRedraftModes = useMemo(
    () => ballsvilleModes.filter((row) => row.key === "redraft"),
    [ballsvilleModes]
  );
  const ballsvilleDynastyModes = useMemo(
    () => ballsvilleModes.filter((row) => row.key === "dynasty"),
    [ballsvilleModes]
  );

  const toggleBallsvilleMode = (bucket, slug) => {
    const setter = bucket === "dynasty" ? setSelectedBallsvilleDynastyModes : setSelectedBallsvilleRedraftModes;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const setAllBallsvilleModes = (bucket, enabled) => {
    const source = bucket === "dynasty" ? ballsvilleDynastyModes : ballsvilleRedraftModes;
    const setter = bucket === "dynasty" ? setSelectedBallsvilleDynastyModes : setSelectedBallsvilleRedraftModes;
    setter(enabled ? new Set(source.map((row) => row.modeSlug)) : new Set());
  };

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Player Stock" />
      {loading && <LoadingScreen progress={progressPct} text={progressText} />}

      <div className="max-w-6xl mx-auto px-4 pt-20">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the{" "}
            <a href="/" className="text-blue-400 underline">
              homepage
            </a>{" "}
            to use this tool.
          </div>
        ) : (
          <div className="mb-4">
            <div className="bg-gray-900 rounded-lg border border-white/10 p-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Search name/team/pos"
                      className="bg-gray-800 border border-white/10 rounded px-3 py-1.5 text-sm w-full md:w-64"
                    />

                    <SourceSelector
                      value={effectiveSourceKey}
                      onChange={setEffectiveSourceKey}
                      mode={format}
                      qbType={qbType}
                      onModeChange={setFormat}
                      onQbTypeChange={setQbType}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="relative rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                      onClick={() => setShowFiltersModal(true)}
                      title="Filters & options"
                    >
                      Filters
                    </button>

                    <div className="text-sm text-gray-400">
                      {leagueCount > 0 && (
                        <span>
                          Scanned{" "}
                          <button
                            type="button"
                            className="underline decoration-dotted hover:text-white"
                            onClick={() => setShowLeaguesModal(true)}
                            title="All leagues included in this scan"
                          >
                            <span className="text-white font-semibold">{leagueCount}</span>
                          </button>{" "}
                          leagues
                        </span>
                      )}
                      {visibleLeagueCount > 0 && (
                        <span className="ml-2">
                          • Showing{" "}
                          <button
                            type="button"
                            className="underline decoration-dotted hover:text-white"
                            onClick={() => setShowVisibleLeaguesModal(true)}
                            title="Leagues currently visible by filters/selection"
                          >
                            <span className="text-white font-semibold">{visibleLeagueCount}</span>
                          </button>
                        </span>
                      )}
                      {lastUpdated && (
                        <span className="ml-3 text-xs text-gray-500" suppressHydrationWarning>
                          Last scan: {lastUpdated.toLocaleTimeString()}
                        </span>
                      )}
                      <button
                        className="ml-3 text-xs rounded px-2 py-0.5 border border-white/20 hover:bg-white/10"
                        onClick={doRefresh}
                        title="Rescan now (ignores cache)"
                      >
                        Refresh
                      </button>
                      {ballsvilleAdpLoading ? <span className="ml-3 text-xs text-gray-500">Loading Ballsville ADP…</span> : null}
                      {ballsvilleBaseUrl ? <span className="ml-3 text-xs text-gray-500">BS: {cleanText(ballsvilleBaseUrl).replace(/^https?:\/\//, "")}</span> : null}
                      {error && <span className="text-red-400 ml-3">{error}</span>}
                      {ballsvilleModesError ? <span className="text-amber-400 ml-3">{ballsvilleModesError}</span> : null}
                      {ballsvilleAdpError ? <span className="text-amber-400 ml-3">{ballsvilleAdpError}</span> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="text-center text-gray-400 py-10">
                {loading ? "Working…" : trendingMode !== "all" ? "No matching trending players." : "No players found."}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg shadow ring-1 ring-white/10 mt-3">
                <table className="min-w-full bg-gray-900">
                  <thead className="bg-gray-800/60">
                    <tr>
                      <th className="text-left px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("name")}>
                        Player <span className="ml-1 inline-block">{sortIndicator("name")}</span>
                      </th>
                      <th className="text-right px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("count")}>
                        Leagues <span className="ml-1 inline-block">{sortIndicator("count")}</span>
                      </th>
                      <th className="text-right px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("adp")}>
                        ADP <span className="ml-1 inline-block">{sortIndicator("adp")}</span>
                      </th>
                      <th className="text-right px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("ballsvilleRedraftAdp")}>
                        BS Redraft <span className="ml-1 inline-block">{sortIndicator("ballsvilleRedraftAdp")}</span>
                      </th>
                      <th className="text-right px-4 py-2 cursor-pointer select-none" onClick={() => toggleSort("ballsvilleDynastyAdp")}>
                        BS Dynasty <span className="ml-1 inline-block">{sortIndicator("ballsvilleDynastyAdp")}</span>
                      </th>
                      <th
                        className="text-right px-4 py-2 cursor-pointer select-none"
                        onClick={() => toggleSort(valueOrProjSortKey)}
                      >
                        {valueOrProjLabel} <span className="ml-1 inline-block">{sortIndicator(valueOrProjSortKey)}</span>
                      </th>
                      <th className="text-left px-4 py-2 hidden md:table-cell">Teams</th>
                    </tr>
                  </thead>

                  <tbody>
                    {pageRows.map((r) => {
                      const exposure = visibleLeagueCount ? Math.round((r.count / visibleLeagueCount) * 100) : 0;
                      const overCap = exposure > maxExposurePct;
                      const isStarterSomewhere = starterPidSet.has(r.player_id);
                      const addCount = trendingAddMap.get(r.player_id);
                      const dropCount = trendingDropMap.get(r.player_id);

                      const metricVal = isProj ? (r._projAvg || 0) : (r._value || 0);
                      const avgDraftLabel = formatAverageDraftPosition(r.avgDraftPickNo, r.avgDraftTeams);
                      const ballsvilleRedraftLabel = formatAverageDraftPosition(r._ballsvilleRedraftAdp, 12);
                      const ballsvilleDynastyLabel = formatAverageDraftPosition(r._ballsvilleDynastyAdp, 12);

                      const titleBits = [];
                      if (overCap) titleBits.push(`Exposure ${exposure}% exceeds ${maxExposurePct}%`);
                      if (addCount) titleBits.push(`Trending adds: ${addCount}`);
                      if (dropCount) titleBits.push(`Trending drops: ${dropCount}`);

                      return (
                        <tr
                          key={r.player_id}
                          className="border-b border-white/5 hover:bg-white/5"
                          title={titleBits.join(" • ")}
                        >
                          <td className="px-4 py-2 text-left">
                            <button className="text-left w-full" onClick={() => setOpenPid(r.player_id)}>
                              <div className="flex items-center gap-1">
                                <AvatarImage
                                  name={r._name}
                                  width={28}
                                  height={28}
                                  className="w-7 h-7 rounded-full border object-cover bg-gray-800"
                                />
                                <span
                                  className={
                                    overCap
                                      ? "text-red-400 font-semibold"
                                      : highlightStarters && isStarterSomewhere
                                      ? "text-blue-400 font-semibold"
                                      : ""
                                  }
                                >
                                  {r._name}
                                </span>

                                {addCount ? (
                                  <span
                                    className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-gray-800/70"
                                    title={`Trending adds: ${addCount}`}
                                  >
                                    🔥 {addCount}
                                  </span>
                                ) : null}

                                {dropCount ? (
                                  <span
                                    className="ml-1 text-[11px] px-1.5 py-0.5 rounded border border-white/10 bg-gray-800/70"
                                    title={`Trending drops: ${dropCount}`}
                                  >
                                    🧊 {dropCount}
                                  </span>
                                ) : null}
                              </div>

                              <div className="text-xs text-gray-400 ml-10">
                                {r._pos || "—"} • {r._team || "FA"}
                                {visibleLeagueCount ? ` • ${exposure}% exp.` : ""}
                              </div>
                            </button>
                          </td>

                          <td className="px-4 py-2 text-right">{r.count}</td>
                          <td className="px-4 py-2 text-right">{avgDraftLabel}</td>
                          <td className="px-4 py-2 text-right">{ballsvilleRedraftLabel}</td>
                          <td className="px-4 py-2 text-right">{ballsvilleDynastyLabel}</td>
                          <td className="px-4 py-2 text-right">{Math.round(metricVal)}</td>

                          <td className="px-4 py-2 hidden md:table-cell">
                            <div className="flex -space-x-2">
                              {(r.leagues || []).slice(0, 7).map((lg) => (
                                <img
                                  key={lg.id}
                                  src={leagueAvatarUrl(lg.avatar)}
                                  alt=""
                                  className={`w-6 h-6 rounded ring-1 ring-black object-cover ${
                                    highlightStarters && lg.isStarter ? "ring-blue-500" : ""
                                  }`}
                                  onError={(e) => {
                                    e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                                  }}
                                  title={`${lg.name}${lg.isStarter ? " • starter" : ""}`}
                                />
                              ))}
                              {(r.leagues || []).length > 7 ? (
                                <span className="text-xs text-gray-400 pl-2">+{(r.leagues || []).length - 7}</span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  className="rounded px-2 py-1 border border-white/20 disabled:opacity-30"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  ◀
                </button>
                <span className="text-sm text-gray-400">
                  Page <span className="text-white">{currentPage}</span> / {totalPages}
                </span>
                <button
                  className="rounded px-2 py-1 border border-white/20 disabled:opacity-30"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  ▶
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {showFiltersModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowFiltersModal(false)}
        >
          <div
            className="w-full max-w-xl max-h-[80vh] overflow-y-auto bg-gray-900 rounded-xl shadow-xl p-4 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="text-lg font-bold">Filters & Options</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowFiltersModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="text-sm text-gray-400">Search</div>
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search name/team/pos"
                  className="w-full bg-gray-800 border border-white/10 rounded px-3 py-2 text-sm"
                />

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={highlightStarters}
                    onChange={() => setHighlightStarters((v) => !v)}
                  />
                  Highlight starters
                </label>

                <div className="mt-2">
                  <div className="text-sm text-gray-400 mb-1">Max Exposure %</div>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={maxExposurePct}
                    onChange={(e) => setMaxExposurePct(Number(e.target.value || 0))}
                    className="w-28 bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                    title="Rows over this % (count / visible leagues) are flagged"
                  />
                </div>

                <div className="mt-3">
                  <div className="text-sm text-gray-400 mb-2">Metric & Source</div>
                  <SourceSelector
                    value={effectiveSourceKey}
                    onChange={setEffectiveSourceKey}
                    mode={format}
                    qbType={qbType}
                    onModeChange={setFormat}
                    onQbTypeChange={setQbType}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm text-gray-400">League filters (display only)</div>
                <label className="flex items-center justify-between">
                  <span>Include drafting leagues</span>
                  <input
                    type="checkbox"
                    checked={includeDrafting}
                    onChange={() => {
                      setIncludeDrafting((v) => !v);
                      setCurrentPage(1);
                    }}
                  />
                </label>
                <div className="pt-2 border-t border-white/10">
                  <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Formats</div>
                  <label className="flex items-center justify-between">
                    <span>Redraft</span>
                    <input
                      type="checkbox"
                      checked={showRedraft}
                      onChange={() => {
                        setShowRedraft((v) => !v);
                        setCurrentPage(1);
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Keeper</span>
                    <input
                      type="checkbox"
                      checked={showKeeper}
                      onChange={() => {
                        setShowKeeper((v) => !v);
                        setCurrentPage(1);
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Dynasty</span>
                    <input
                      type="checkbox"
                      checked={showDynasty}
                      onChange={() => {
                        setShowDynasty((v) => !v);
                        setCurrentPage(1);
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Best Ball</span>
                    <input
                      type="checkbox"
                      checked={showBestBallFormat}
                      onChange={() => {
                        setShowBestBallFormat((v) => !v);
                        setCurrentPage(1);
                      }}
                    />
                  </label>
                </div>

                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="text-sm text-gray-400 mb-2">Trending players</div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="trending-mode"
                        value="all"
                        checked={trendingMode === "all"}
                        onChange={() => setTrendingMode("all")}
                      />
                      All players
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="trending-mode"
                        value="adds"
                        checked={trendingMode === "adds"}
                        onChange={() => setTrendingMode("adds")}
                      />
                      Only trending adds
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="trending-mode"
                        value="drops"
                        checked={trendingMode === "drops"}
                        onChange={() => setTrendingMode("drops")}
                      />
                      Only trending drops
                    </label>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-sm text-gray-400">Lookback</span>
                    <select
                      value={trendingHours}
                      onChange={(e) => setTrendingHours(Number(e.target.value))}
                      className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-sm"
                      title="How far back to consider for trending adds/drops"
                    >
                      <option value={6}>6h</option>
                      <option value={12}>12h</option>
                      <option value={24}>24h</option>
                      <option value={48}>48h</option>
                      <option value={72}>72h</option>
                      <option value={168}>7d</option>
                    </select>
                    <span className="text-xs text-gray-500">Sleeper top 50 per window</span>
                  </div>
                </div>

                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-gray-400">Ballsville ADP modes</div>
                    {ballsvilleModesLoading ? <span className="text-[11px] text-gray-500">Loading…</span> : null}
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500">
                    Redraft combines all selected Ballsville redraft / keeper / best ball mode JSONs. Dynasty uses selected startup JSONs.
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3">
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                        <span>Ballsville Redraft Pool</span>
                        <button type="button" className="rounded px-2 py-0.5 border border-white/20 hover:bg-white/10" onClick={() => setAllBallsvilleModes("redraft", true)}>All</button>
                        <button type="button" className="rounded px-2 py-0.5 border border-white/20 hover:bg-white/10" onClick={() => setAllBallsvilleModes("redraft", false)}>None</button>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                        {ballsvilleRedraftModes.map((mode) => (
                          <label key={`bs-redraft-${mode.modeSlug}`} className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-gray-800/60 border border-white/10">
                            <input
                              type="checkbox"
                              checked={selectedBallsvilleRedraftModes.has(mode.modeSlug)}
                              onChange={() => toggleBallsvilleMode("redraft", mode.modeSlug)}
                            />
                            <span className="truncate">{mode.title}</span>
                          </label>
                        ))}
                        {!ballsvilleRedraftModes.length ? <div className="text-xs text-gray-500">No redraft Ballsville modes found.</div> : null}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                        <span>Ballsville Dynasty Startup Pool</span>
                        <button type="button" className="rounded px-2 py-0.5 border border-white/20 hover:bg-white/10" onClick={() => setAllBallsvilleModes("dynasty", true)}>All</button>
                        <button type="button" className="rounded px-2 py-0.5 border border-white/20 hover:bg-white/10" onClick={() => setAllBallsvilleModes("dynasty", false)}>None</button>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                        {ballsvilleDynastyModes.map((mode) => (
                          <label key={`bs-dynasty-${mode.modeSlug}`} className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-gray-800/60 border border-white/10">
                            <input
                              type="checkbox"
                              checked={selectedBallsvilleDynastyModes.has(mode.modeSlug)}
                              onChange={() => toggleBallsvilleMode("dynasty", mode.modeSlug)}
                            />
                            <span className="truncate">{mode.title}</span>
                            {mode.startupLike ? <span className="ml-auto text-[10px] text-gray-500">startup</span> : null}
                          </label>
                        ))}
                        {!ballsvilleDynastyModes.length ? <div className="text-xs text-gray-500">No dynasty Ballsville modes found.</div> : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-white/10 pt-3">
                  <label className="flex items-center justify-between">
                    <span className="text-sm">Manually select leagues</span>
                    <input
                      type="checkbox"
                      checked={manualLeagueSelect}
                      onChange={() => setManualLeagueSelect((v) => !v)}
                    />
                  </label>

                  {manualLeagueSelect && (
                    <>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                          onClick={selectAllVisible}
                        >
                          Select all visible
                        </button>
                        <button
                          type="button"
                          className="text-xs rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                          onClick={clearAllVisible}
                        >
                          Clear
                        </button>
                        <span className="ml-auto text-xs text-gray-500">
                          {visibleLeagueCount} showing
                        </span>
                      </div>

                      <div className="mt-2 max-h-52 overflow-y-auto pr-1 space-y-1">
                        {scanLeagues
                          .filter((lg) => visibleLeagueIds.has(String(lg.id)))
                          .slice()
                          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                          .map((lg) => {
                            const id = String(lg.id);
                            const checked = selectedLeagueIds.has(id);
                            return (
                              <label
                                key={id}
                                className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-gray-800/60 border border-white/10"
                                title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}${
                                  lg.hasRoster ? " • rosters" : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleLeagueSelected(id)}
                                />
                                <img
                                  src={leagueAvatarUrl(lg.avatar)}
                                  alt=""
                                  className="w-5 h-5 rounded object-cover bg-gray-700"
                                  onError={(e) => {
                                    e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                                  }}
                                />
                                <span className="truncate">{lg.name}</span>
                                <span className="ml-auto text-[10px] text-gray-400">
                                  <LeagueFormatBadge
                                    format={lg.format}
                                    compact
                                    title={lg.format?.reasons?.join(" • ") || lg.format?.label || "League format"}
                                  />
                                  {lg.hasRoster ? " • roster" : ""}
                                </span>
                              </label>
                            );
                          })}
                      </div>

                      <div className="mt-2 text-xs text-gray-500">
                        Selection stacks on top of Drafting / Format filters.
                      </div>
                    </>
                  )}
                </div>

                <div className="pt-3">
                  <button
                    type="button"
                    className="text-sm rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                    onClick={doRefresh}
                    title="Rescan now (ignores cache)"
                  >
                    Refresh scan
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                className="text-sm rounded px-3 py-1 border border-white/20 hover:bg-white/10"
                onClick={resetFilters}
                title="Reset to defaults"
              >
                Reset
              </button>
              <button
                type="button"
                className="text-sm rounded px-3 py-1 border border-blue-500 text-blue-300 hover:bg-blue-500/10"
                onClick={() => setShowFiltersModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaguesModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowLeaguesModal(false)}
        >
          <div
            className="w-full max-w-xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="text-xl font-bold">Leagues in this scan</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowLeaguesModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 flex flex-col gap-2">
              {scanLeagues
                .slice()
                .sort((a, b) => {
                  const av = activeLeagueIds.has(String(a.id)) ? 1 : 0;
                  const bv = activeLeagueIds.has(String(b.id)) ? 1 : 0;
                  if (av !== bv) return bv - av;
                  return (a.name || "").localeCompare(b.name || "");
                })
                .map((lg) => (
                  <div
                    key={lg.id}
                    className={`flex items-center gap-3 text-sm px-2 py-1 rounded border ${
                      activeLeagueIds.has(String(lg.id))
                        ? "bg-gray-800 border-white/10"
                        : "bg-gray-800/40 border-white/5 opacity-70"
                    }`}
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}${
                      lg.hasRoster ? " • rosters" : ""
                    }`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar)}
                      alt=""
                      className="w-5 h-5 rounded object-cover bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <span className="truncate">{lg.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
                      <LeagueFormatBadge
                        format={lg.format}
                        compact
                        title={lg.format?.reasons?.join(" • ") || lg.format?.label || "League format"}
                      />
                      {lg.hasRoster ? <span>• roster</span> : null}
                      {lg.status ? <span>• {lg.status}</span> : null}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {showVisibleLeaguesModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowVisibleLeaguesModal(false)}
        >
          <div
            className="w-full max-w-xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="text-xl font-bold">Leagues being shown</div>
              <button
                className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                onClick={() => setShowVisibleLeaguesModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto pr-1 flex flex-col gap-2">
              {scanLeagues
                .filter((lg) => activeLeagueIds.has(String(lg.id)))
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((lg) => (
                  <div
                    key={lg.id}
                    className="flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10"
                    title={`${lg.name}${lg.isBestBall ? " • Best Ball" : ""}${lg.status ? ` • ${lg.status}` : ""}${
                      lg.hasRoster ? " • rosters" : ""
                    }`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar)}
                      alt=""
                      className="w-5 h-5 rounded object-cover bg-gray-700"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <span className="truncate">{lg.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
                      <LeagueFormatBadge
                        format={lg.format}
                        compact
                        title={lg.format?.reasons?.join(" • ") || lg.format?.label || "League format"}
                      />
                      {lg.hasRoster ? <span>• roster</span> : null}
                      {lg.status ? <span>• {lg.status}</span> : null}
                    </span>
                  </div>
                ))}
              {visibleLeagueCount === 0 && (
                <div className="text-sm text-gray-400">No leagues match the current filters/selection.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {openPid &&
        (() => {
          const openRow = projectedRows.find((r) => r.player_id === openPid) || null;
          if (!openRow) return null;

          const visibleLeaguesForRow = (openRow.leagues || []).filter((lg) =>
            activeLeagueIds.has(String(lg.id))
          );

          const metricVal = isProj ? Math.round(openRow._projAvg || 0) : Math.round(openRow._value || 0);
          const avgDraftLabel = formatAverageDraftPosition(openRow.avgDraftPickNo, openRow.avgDraftTeams);

          return (
            <div
              className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
              onClick={() => setOpenPid(null)}
            >
              <div
                className="w-full max-w-xl bg-gray-900 rounded-xl shadow-xl p-5 border border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <AvatarImage
                      name={openRow._name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-full border object-cover bg-gray-800"
                    />
                    <div>
                      <div className="text-xl font-bold">{openRow._name}</div>
                      <div className="text-xs text-gray-400">
                        {openRow._pos || "—"} • {openRow._team || "FA"}
                      </div>
                    </div>
                  </div>
                  <button
                    className="rounded px-2 py-1 border border-white/20 hover:bg-white/10"
                    onClick={() => setOpenPid(null)}
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="bg-gray-800/60 rounded p-3">
                    <div className="text-xs text-gray-400">Leagues Rostered (visible)</div>
                    <div className="text-2xl font-bold">{visibleLeaguesForRow.length}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded p-3">
                    <div className="text-xs text-gray-400">Avg Draft Position</div>
                    <div className="text-2xl font-bold">{avgDraftLabel}</div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {openRow.draftedCount || 0} drafted league{openRow.draftedCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="bg-gray-800/60 rounded p-3">
                    <div className="text-xs text-gray-400">Ballsville Redraft</div>
                    <div className="text-2xl font-bold">{formatAverageDraftPosition(openRow._ballsvilleRedraftAdp, 12)}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded p-3">
                    <div className="text-xs text-gray-400">Ballsville Dynasty</div>
                    <div className="text-2xl font-bold">{formatAverageDraftPosition(openRow._ballsvilleDynastyAdp, 12)}</div>
                  </div>
                  <div className="bg-gray-800/60 rounded p-3">
                    <div className="text-xs text-gray-400">{valueOrProjLabel}</div>
                    <div className="text-2xl font-bold">{metricVal}</div>
                  </div>
                </div>

                {visibleLeaguesForRow.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs text-gray-400 mb-2">Leagues (• indicates starter)</div>
                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                      {visibleLeaguesForRow.map((lg) => (
                        <div
                          key={lg.id}
                          className={`flex items-center gap-3 text-sm px-2 py-1 rounded bg-gray-800 border border-white/10 ${
                            lg.isStarter ? "ring-1 ring-blue-500" : ""
                          }`}
                          title={lg.name}
                        >
                          <img
                            src={leagueAvatarUrl(lg.avatar)}
                            alt=""
                            className="w-5 h-5 rounded object-cover bg-gray-700 self-start"
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{lg.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                              <LeagueFormatBadge
                                format={lg.format}
                                compact
                                title={lg.format?.reasons?.join(" • ") || lg.format?.label || "League format"}
                              />
                              <span>Drafted: {lg.draftedByManager ? lg.draftLabel : "Not drafted by this manager"}</span>
                              {lg.draftSeason ? <span>• {lg.draftSeason}</span> : null}
                            </div>
                          </div>
                          {lg.isStarter ? <span className="ml-auto text-[10px] text-blue-300">• starter</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </>
  );
}
