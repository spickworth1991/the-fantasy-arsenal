"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

const Navbar = dynamic(() => import("../../components/Navbar"), { ssr: false });
const BackgroundParticles = dynamic(
  () => import("../../components/BackgroundParticles"),
  { ssr: false }
);

import LoadingScreen from "../../components/LoadingScreen";
import AvatarImage from "../../components/AvatarImage";
import SourceSelector from "../../components/SourceSelector";
import { useSleeper } from "../../context/SleeperContext";
import { getTeamByeWeek } from "../../utils/nflByeWeeks";

// League avatars (Sleeper)
const DEFAULT_LEAGUE_IMG = "/avatars/league-default.webp";
const leagueAvatarUrl = (avatarId) =>
  avatarId
    ? `https://sleepercdn.com/avatars/thumbs/${avatarId}`
    : DEFAULT_LEAGUE_IMG;
const sleeperLeagueUrl = (leagueId) => `https://sleeper.com/leagues/${leagueId}`;

// ===== UI class helpers (pure styling, no logic changes) =====
const SECTION_SHELL =
  "rounded-3xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/45 backdrop-blur p-4 md:p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_30px_90px_-70px_rgba(0,0,0,0.9)]";
const CARD_ROW =
  "relative flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-white/8 to-white/4 hover:from-white/12 hover:to-white/6 transition p-3 shadow-[0_10px_40px_-35px_rgba(0,0,0,0.85)] hover:shadow-[0_18px_55px_-35px_rgba(0,0,0,0.95)] hover:-translate-y-[1px]";
const SUBCARD =
  "rounded-2xl border border-white/10 bg-gradient-to-b from-white/7 to-white/4 shadow-[0_10px_40px_-35px_rgba(0,0,0,0.85)]";
const PILL =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-black/20 text-[11px] text-white/70";
const SOFT_BTN =
  "text-xs rounded-xl px-3 py-2 border border-white/15 bg-white/5 hover:bg-white/10 transition";

function severityMeta(n) {
  const v = Number(n || 0);
  if (v >= 3)
    return {
      ring: "ring-1 ring-red-400/20",
      dot: "bg-red-400",
      badge: "border-red-400/20 bg-red-500/10 text-red-200",
      label: "HIGH",
    };
  if (v === 2)
    return {
      ring: "ring-1 ring-amber-400/20",
      dot: "bg-amber-400",
      badge: "border-amber-400/25 bg-amber-500/10 text-amber-200",
      label: "MED",
    };
  return {
    ring: "ring-1 ring-emerald-400/15",
    dot: "bg-emerald-400",
    badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
    label: "LOW",
  };
}

function extractRosterIds(rosters) {
  const ids = new Set();
  if (!Array.isArray(rosters)) return ids;
  for (const r of rosters) {
    const buckets = [
      Array.isArray(r?.players) ? r.players : [],
      Array.isArray(r?.starters) ? r.starters : [],
      Array.isArray(r?.reserve) ? r.reserve : [],
      Array.isArray(r?.taxi) ? r.taxi : [],
    ];
    for (const arr of buckets) {
      for (const id of arr) if (id != null) ids.add(String(id));
    }
  }
  return ids;
}

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

function isInjuredOrLimited(p) {
  const injury = String(p?.injury_status || "").toLowerCase();
  const status = String(p?.status || "").toLowerCase();
  const pr = String(p?.practice_participation || "").toLowerCase();

  if (!p) return false;
  if (injury && injury !== "" && injury !== "null") return true;
  if (
    ["out", "ir", "pup", "doubtful", "questionable"].some((x) =>
      injury.includes(x)
    )
  )
    return true;
  if (
    ["inactive", "injured_reserve", "physically_unable_to_perform"].some((x) =>
      status.includes(x)
    )
  )
    return true;
  if (pr && pr !== "" && pr !== "full") return true;
  return false;
}

function timeAgo(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return `${s}s ago`;
}

// ===== Lineup requirement parsing + viability =====
function buildSlotCounts(rosterPositions = []) {
  // roster_positions examples: ["QB","RB","RB","WR","WR","TE","FLEX","SUPER_FLEX","BN",...]
  const counts = {};
  for (const rp of rosterPositions || []) {
    const k = String(rp || "").toUpperCase();
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function eligibleForSlot(slotType, pos) {
  const s = String(slotType || "").toUpperCase();
  const p = String(pos || "").toUpperCase();

  if (!p) return false;

  // Base positions
  if (s === "QB" || s === "RB" || s === "WR" || s === "TE" || s === "K")
    return p === s;

  // Defense may be "DEF" or "DST" in datasets
  if (s === "DEF" || s === "DST") return p === "DEF" || p === "DST";

  // Flex buckets
  if (s === "FLEX") return p === "RB" || p === "WR" || p === "TE";
  if (s === "WRRB_FLEX") return p === "WR" || p === "RB";
  if (s === "REC_FLEX") return p === "WR" || p === "TE";
  if (s === "RBTE_FLEX") return p === "RB" || p === "TE";

  // Superflex / OP (QB + flex)
  if (s === "SUPER_FLEX" || s === "SF" || s === "OP")
    return p === "QB" || p === "RB" || p === "WR" || p === "TE";

  // IDP etc (ignore for now; treat as not blocking)
  return false;
}

function getPrimaryPos(p) {
  // Sleeper DEF teams often have position "DEF" but sometimes "DST"
  const pos = String(p?.position || "").toUpperCase();
  if (pos === "DST") return "DEF";
  return pos;
}

function getByeWeekForPlayer(p, yearNum) {
  const team = normalizeTeamAbbr(p?.team);
  const w =
    Number(
      p?.bye_week ??
        p?.bye_week_num ??
        p?.bye_week_number ??
        p?.bye_week_id ??
        p?.bye_week
    ) ||
    Number(p?.bye) ||
    getTeamByeWeek(team, yearNum) ||
    0;
  return w;
}

function summarizeShortfall(shortfall) {
  const parts = Object.entries(shortfall || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!parts.length) return "";
  return parts.map(([k, v]) => `${k}:${v}`).join("  ");
}

function dayKeyFromTs(ts) {
  const d = new Date(Number(ts || 0));
  if (!Number.isFinite(d.getTime())) return "unknown";
  // local day bucket (premium UX: matches user's day)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function bundleNonTradesInRow(items = []) {
  // Items should already be sorted newest -> oldest
  const out = [];
  for (const tx of items) {
    const t = String(tx?.type || "");
    const isNonTrade = t === "waiver" || t === "free_agent";
    if (!isNonTrade) {
      out.push(tx);
      continue;
    }

    const ts = Number(tx?.status_updated || tx?.created || 0);
    const keyDay = dayKeyFromTs(ts);
    const lid = String(tx?._league?.id || "");

    const prev = out[out.length - 1];
    const prevIsBundle = !!prev?._bundle;
    const prevIsNonTrade =
      prevIsBundle ||
      String(prev?.type || "") === "waiver" ||
      String(prev?.type || "") === "free_agent";

    const prevLeagueId = String(prev?._league?.id || "");
    const prevTs = Number(prev?._tsMax || prev?.status_updated || prev?.created || 0);
    const prevDay = dayKeyFromTs(prevTs);

    // Only bundle if it’s literally “in a row” (adjacent) AND same league AND same day
    if (prevIsNonTrade && prevLeagueId === lid && prevDay === keyDay) {
      if (prevIsBundle) {
        prev._items.push(tx);
        prev._tsMax = Math.max(Number(prev._tsMax || 0), ts);
        // keep a representative week (most recent)
        prev._week = prev._week ?? tx?._week;
      } else {
        // convert prev single tx into a bundle
        out[out.length - 1] = {
          _bundle: true,
          _items: [prev, tx],
          _tsMax: Math.max(prevTs, ts),
          _league: prev?._league,
          _week: prev?._week ?? tx?._week,
          // pseudo type for UI
          type: "waiver_bundle",
          status: "complete",
        };
      }
    } else {
      out.push(tx);
    }
  }
  return out;
}

  function rosterPosSet(rosterPositions = []) {
    return new Set((rosterPositions || []).map((x) => String(x || "").toUpperCase()));
  }

  // Map granular IDP positions -> Sleeper buckets used in roster_positions
  function normalizeIdpPosForLeague(pos) {
    const p = String(pos || "").toUpperCase().trim();
    if (!p) return "";

    // DB family
    if (["CB", "S", "FS", "SS", "DB"].includes(p)) return "DB";

    // DL/EDGE family (this is your DE fix)
    if (["DL", "DE", "DT", "ED", "EDGE"].includes(p)) return "DL";

    // LB family
    if (["LB", "ILB", "MLB", "OLB"].includes(p)) return "LB";

    // Some feeds just say IDP
    if (p === "IDP") return "IDP";

    return p;
  }

  function leagueAllowsPosition(lg, pos) {
    // normalize FIRST so DE/DT/EDGE/CB/S work
    const p = normalizeIdpPosForLeague(pos);
    const set = rosterPosSet(lg?.roster_positions);

    // Normal offense + kicker
    if (["QB", "RB", "WR", "TE", "K"].includes(p)) return true;

    // Team defense (DST/DEF)
    if (p === "DEF" || p === "DST") return set.has("DEF") || set.has("DST");

    // IDP buckets (Sleeper roster_positions commonly include DL/LB/DB, plus IDP/IDP_FLEX)
    if (p === "DL" || p === "LB" || p === "DB") {
      return set.has(p) || set.has("IDP") || set.has("IDP_FLEX");
    }

    // If a league only uses IDP/IDP_FLEX and a feed says "IDP"
    if (p === "IDP") return set.has("IDP") || set.has("IDP_FLEX");

    // Unknown positions: don't block (your current behavior)
    return true;
  }



export default function LeagueHubContent() {
  const {
    username,
    players,
    year,
    format,
    qbType,
    // ✅ unified metric controls (handled by SleeperContext + SourceSelector)
    sourceKey,
    setSourceKey,
    metricType,
    projectionSource,
    getPlayerValue: getPlayerValue,
    getProjection,
    projectionIndexes,
  } = useSleeper();
  const yrStr = String(year || new Date().getFullYear());

  // local mode/qb (don’t mutate global context)
  const [mode, setMode] = useState((format || "dynasty").toLowerCase());
  const [qb, setQb] = useState((qbType || "sf").toLowerCase());
  useEffect(() => setMode((format || "dynasty").toLowerCase()), [format]);
  useEffect(() => setQb((qbType || "sf").toLowerCase()), [qbType]);

  const playersMap = useMemo(() => players || {}, [players]);
  const playerList = useMemo(() => Object.values(playersMap || {}), [playersMap]);

  // loading
  const [initLoading, setInitLoading] = useState(true);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanProgressPct, setScanProgressPct] = useState(0);
  const [scanProgressText, setScanProgressText] = useState("Preparing…");
  const [error, setError] = useState("");
  const [selectedTx, setSelectedTx] = useState(null);


  // scan filters
  const [onlyBestBall, setOnlyBestBall] = useState(false);
  const [excludeBestBall, setExcludeBestBall] = useState(false);
  const [includeDrafting, setIncludeDrafting] = useState(true);

  const [scanLeagues, setScanLeagues] = useState([]); // [{id,name,avatar,isBestBall,status,roster_positions}]
  const [leagueCount, setLeagueCount] = useState(0);
  const [scanningError, setScanningError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  // maps populated by scan
  const rosterSetsRef = useRef(new Map()); // leagueId -> Set(all rostered players)
  const myRosterRef = useRef(new Map()); // leagueId -> Set(my roster players)
  const rosterOwnersRef = useRef(new Map()); // leagueId -> Map(roster_id -> owner_id)
  const leagueUsersRef = useRef(new Map());  // leagueId -> Map(user_id -> display_name)

  // cache per user+season
  const cacheKey = username ? `lh:${username}:${yrStr}:SCAN` : null;

  // Source selector is owned by SleeperContext.
  // League Hub only consumes `sourceKey` + `metricType` and uses the unified getters.
  const bestMetric = metricType === "projection" ? "projection" : "value";

  // Best available filters
  const [bestPos, setBestPos] = useState("ALL");
  const [bestLimit, setBestLimit] = useState(20);
  const [minOpenSlots, setMinOpenSlots] = useState(1);

  // Waiver tracker
  const [txType, setTxType] = useState("both");
  const [txLimit, setTxLimit] = useState(10);
  const [txLoading, setTxLoading] = useState(false);
  const [transactions, setTransactions] = useState([]); // merged
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [selectedFA, setSelectedFA] = useState(null);
    // League selection (exclude leagues you don't want to consider)
  const [showLeaguesModal, setShowLeaguesModal] = useState(false);
  const [excludedLeagueIds, setExcludedLeagueIds] = useState(() => new Set());

  const excludedKey = cacheKey ? `${cacheKey}:EXCLUDED` : null;

  // hydrate excluded list
  useEffect(() => {
    if (!excludedKey) return;
    try {
      const raw = sessionStorage.getItem(excludedKey);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setExcludedLeagueIds(new Set(arr.map(String)));
    } catch {}
  }, [excludedKey]);

  // persist excluded list
  useEffect(() => {
    if (!excludedKey) return;
    try {
      sessionStorage.setItem(excludedKey, JSON.stringify(Array.from(excludedLeagueIds)));
    } catch {}
  }, [excludedKey, excludedLeagueIds]);

  const [selectedManagerLeague, setSelectedManagerLeague] = useState(null);
  const [selectedInjuryPlayer, setSelectedInjuryPlayer] = useState(null);

  const projectionsReady =
    !!projectionIndexes?.FFA || !!projectionIndexes?.ESPN || !!projectionIndexes?.CBS;


  // ---------- Guards ----------
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

  // ---------- Scan leagues with cache ----------
  useEffect(() => {
    let cancelled = false;

    const hydrateFromCache = () => {
      if (!cacheKey) return false;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return false;
        const {
          leagues: cachedLeagues,
          rosterSets,
          myRosters,
          rosterOwners,
          leagueUsers,
          ts,
        } = JSON.parse(raw) || {};

        if (!Array.isArray(cachedLeagues) || !rosterSets || !myRosters) return false;

        const allMap = new Map();
        const mineMap = new Map();
        for (const [lid, idsArr] of Object.entries(rosterSets)) {
          if (Array.isArray(idsArr) && idsArr.length > 0)
            allMap.set(String(lid), new Set(idsArr.map(String)));
        }
        for (const [lid, idsArr] of Object.entries(myRosters)) {
          if (Array.isArray(idsArr) && idsArr.length > 0)
            mineMap.set(String(lid), new Set(idsArr.map(String)));
        }

        const ownersMap = new Map();
        const usersMap = new Map();

        if (rosterOwners && typeof rosterOwners === "object") {
          for (const [lid, pairs] of Object.entries(rosterOwners)) {
            const m = new Map();
            if (pairs && typeof pairs === "object") {
              for (const [rid, uid] of Object.entries(pairs)) {
                if (rid != null && uid != null) m.set(String(rid), String(uid));
              }
            }
            if (m.size) ownersMap.set(String(lid), m);
          }
        }

        if (leagueUsers && typeof leagueUsers === "object") {
          for (const [lid, pairs] of Object.entries(leagueUsers)) {
            const m = new Map();
            if (pairs && typeof pairs === "object") {
              for (const [uid, name] of Object.entries(pairs)) {
                if (uid != null && name != null) m.set(String(uid), String(name));
              }
            }
            if (m.size) usersMap.set(String(lid), m);
          }
        }

        rosterOwnersRef.current = ownersMap;
        leagueUsersRef.current = usersMap;

        const kept = (cachedLeagues || []).filter(
          (lg) => allMap.get(String(lg.id))?.size > 0
        );
        if (!kept.length) return false;

        rosterSetsRef.current = allMap;
        myRosterRef.current = mineMap;
        setScanLeagues(kept);
        setLeagueCount(kept.length);
        setLastUpdated(ts ? new Date(ts) : null);
        return true;
      } catch {
        return false;
      }
    };

    

    const saveToCache = (leaguesKept, allMap, mineMap) => {
      if (!cacheKey) return;
      try {
        const rosterSets = {};
        allMap.forEach((set, lid) => (rosterSets[String(lid)] = Array.from(set)));
        const myRosters = {};
        mineMap.forEach((set, lid) => (myRosters[String(lid)] = Array.from(set)));
        const rosterOwnersObj = {};
        rosterOwnersRef.current.forEach((m, lid) => {
          const o = {};
          m.forEach((uid, rid) => (o[String(rid)] = String(uid)));
          rosterOwnersObj[String(lid)] = o;
        });

        const leagueUsersObj = {};
        leagueUsersRef.current.forEach((m, lid) => {
          const o = {};
          m.forEach((name, uid) => (o[String(uid)] = String(name)));
          leagueUsersObj[String(lid)] = o;
        });

        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            leagues: leaguesKept,
            rosterSets,
            myRosters,
            rosterOwners: rosterOwnersObj,
            leagueUsers: leagueUsersObj,
            ts: Date.now(),
          })
        );
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
        const lRes = await fetch(
          `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${yrStr}`
        );
        const leagues = (await lRes.json()) || [];
        if (cancelled) return;

        const kept = [];
        const allMap = new Map();
        const mineMap = new Map();

        for (let i = 0; i < leagues.length; i++) {
          const lg = leagues[i];
          try {
            setScanProgressText(`Scanning leagues… (${i + 1}/${leagues.length})`);
            setScanProgressPct(12 + Math.round(((i + 1) / Math.max(leagues.length, 1)) * 88));

            const rRes = await fetch(
              `https://api.sleeper.app/v1/league/${lg.league_id}/rosters`
            );
            const rosters = rRes.ok ? await rRes.json() : [];
            if (!Array.isArray(rosters) || rosters.length === 0) continue;

            // roster_id -> owner_id
            const ridToUid = new Map();
            for (const r of rosters) {
              if (r?.roster_id != null && r?.owner_id != null) {
                ridToUid.set(String(r.roster_id), String(r.owner_id));
              }
            }

            // user_id -> display_name
            let uidToName = new Map();
            try {
              const u2Res = await fetch(`https://api.sleeper.app/v1/league/${lg.league_id}/users`);
              const users = u2Res.ok ? await u2Res.json() : [];
              if (Array.isArray(users)) {
                uidToName = new Map(
                  users
                    .filter((u) => u?.user_id)
                    .map((u) => [
                      String(u.user_id),
                      String(u.display_name || u.metadata?.team_name || u.username || "Manager"),
                    ])
                );
              }
            } catch {}

            const mine = rosters.find(
              (r) => r && String(r.owner_id) === String(user.user_id)
            );
            if (!mine || !Array.isArray(mine.players) || mine.players.length === 0) continue;

            const all = extractRosterIds(rosters);
            if (all.size === 0) continue;

            const lid = String(lg.league_id);
            allMap.set(lid, all);
            mineMap.set(lid, new Set(mine.players.map(String)));
            rosterOwnersRef.current.set(lid, ridToUid);
            leagueUsersRef.current.set(lid, uidToName);

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
          rosterSetsRef.current = allMap;
          myRosterRef.current = mineMap;
          setScanLeagues(kept);
          setLeagueCount(kept.length);
          setLastUpdated(new Date());
          saveToCache(kept, allMap, mineMap);
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
  }, [username, yrStr, cacheKey]);

    const visibleLeaguesList = useMemo(() => {
    return (scanLeagues || []).filter((lg) => {
      const id = String(lg?.id || "");
      if (excludedLeagueIds.has(id)) return false;

      if (onlyBestBall && !lg.isBestBall) return false;
      if (excludeBestBall && lg.isBestBall) return false;
      if (!includeDrafting && lg.status === "drafting") return false;

      return true;
    });
  }, [scanLeagues, onlyBestBall, excludeBestBall, includeDrafting, excludedLeagueIds]);

  // ---------- Compute: Best Free Agents ----------
  // Values + projections are resolved by SleeperContext based on `sourceKey`.
  const getValueForPlayer = useMemo(() => {
    return (p) => getPlayerValue(p, { format: mode, qbType: qb, sourceKey });
  }, [getPlayerValue, mode, qb, sourceKey]);


  const bestFreeAgents = useMemo(() => {
    const leagues = visibleLeaguesList;
    if (!leagues.length) return [];

    const posFilter = bestPos === "ALL" ? null : bestPos;

    const metricFor = (p) => {
      if (!p || p.player_id == null) return 0;
      if (bestMetric === "projection") return getProjection(p, projectionSource);
      return getValueForPlayer(p);
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

    const candidateCount = Math.max(bestLimit * 8, 600);
    const candidates = ranked.slice(0, candidateCount);
    const out = [];

    for (const { p, score } of candidates) {
      const pid = String(p.player_id);
      const openLeagues = [];

      const playerPos = getPrimaryPos(p); // "DEF" for DST, etc.

      for (const lg of leagues) {
        // ✅ If the league cannot roster/start this position, it is NOT "available" there.
        if (!leagueAllowsPosition(lg, playerPos)) continue;

        const set = rosterSetsRef.current.get(lg.id);
        if (!set || !set.size) continue;

        if (!set.has(pid)) openLeagues.push(lg);
      }


      if (openLeagues.length === 0) continue;
      if (openLeagues.length < minOpenSlots) continue;

      const name =
        p.full_name ||
        p.search_full_name ||
        `${p.first_name || ""} ${p.last_name || ""}`.trim();
      const pos = String(p.position || "").toUpperCase();
      const team = String(p.team || "").toUpperCase();

      const proj = getProjection(p, projectionSource);
      const val = getValueForPlayer(p);
      out.push({
        id: pid,
        name,
        pos,
        team,
        score,
        proj,
        value: val,
        openCount: openLeagues.length,
        openLeagues,
      });

      if (out.length >= bestLimit) break;
    }

    return out;
  }, [
    visibleLeaguesList,
    playerList,
    bestMetric,
    bestPos,
    bestLimit,
    minOpenSlots,
    getValueForPlayer,
    getProjection,
    projectionSource,
  ]);

  // ---------- Injury report (clickable -> leagues modal) ----------
  const injuryRows = useMemo(() => {
    const leagues = visibleLeaguesList;
    if (!leagues.length) return [];

    const map = new Map(); // pid -> {id,name,pos,team,value,proj,leagues:Set}
    for (const lg of leagues) {
      const mine = myRosterRef.current.get(lg.id);
      if (!mine || !mine.size) continue;

      for (const pid of mine) {
        const p = playersMap?.[pid];
        if (!p) continue;
        if (!isInjuredOrLimited(p)) continue;

        const name =
          p.full_name ||
          p.search_full_name ||
          `${p.first_name || ""} ${p.last_name || ""}`.trim();
        const pos = String(p.position || "").toUpperCase();
        const team = String(p.team || "").toUpperCase();

        const value = getValueForPlayer(p);
        const proj = getProjection(p, projectionSource);
        const injuryTag = String(
          p.injury_status || p.status || p.practice_participation || ""
        ).trim();
        const body = String(p.injury_body_part || "").trim();
        const notes = String(p.injury_notes || "").trim();
        const prac = String(p.practice_description || p.practice_participation || "").trim();
        const injury = [injuryTag, body, notes].filter(Boolean).join(" • ") || "Injury";
        const detail = [prac].filter(Boolean).join(" ");

        if (!map.has(pid)) {
          map.set(pid, {
            id: pid,
            name,
            pos,
            team,
            value,
            proj,
            injury,
            detail,
            leagues: new Set([lg.id]),
          });
        } else {
          map.get(pid).leagues.add(lg.id);
        }
      }
    }

    const out = Array.from(map.values()).map((r) => ({
      ...r,
      leagues: Array.from(r.leagues),
    }));

    const metric = (row) => (bestMetric === "projection" ? row.proj : row.value);
    out.sort((a, b) => (metric(b) || 0) - (metric(a) || 0) || a.name.localeCompare(b.name));

    return out.slice(0, 40);
  }, [visibleLeaguesList, playersMap, getValueForPlayer, getProjection, projectionSource, bestMetric]);

  // Build: player -> leagues map (for injury modal)
  const playerLeaguesMap = useMemo(() => {
    const map = new Map(); // pid -> [{id,name,avatar}, ...]
    for (const lg of visibleLeaguesList) {
      const mine = myRosterRef.current.get(lg.id);
      if (!mine || !mine.size) continue;
      for (const pid of mine) {
        if (!map.has(pid)) map.set(pid, []);
        map.get(pid).push({ id: lg.id, name: lg.name, avatar: lg.avatar });
      }
    }
    return map;
  }, [visibleLeaguesList]);

  // ---------- Injury/Bye Week Manager (real lineup viability) ----------
  const managerIssues = useMemo(() => {
    const leagues = visibleLeaguesList;
    if (!leagues.length) return [];

    const yearNum = Number(yrStr) || new Date().getFullYear();
    const weeks = Array.from({ length: 18 }, (_, i) => i + 1);

    const out = [];

    for (const lg of leagues) {
      const mine = myRosterRef.current.get(lg.id);
      if (!mine || !mine.size) continue;

      const slotCounts = buildSlotCounts(lg.roster_positions || []);

      // starters only (ignore BN/IR/TAXI)
      const starterSlots = Object.entries(slotCounts).filter(([k]) => {
        const kk = String(k).toUpperCase();
        return !["BN", "IR", "TAXI"].includes(kk);
      });

      if (!starterSlots.length) continue;

      const rosterPlayers = Array.from(mine)
        .map((pid) => {
          const p = playersMap?.[pid];
          if (!p) return null;
          const pos = posLabel(getPrimaryPos(p));
          const bye = getByeWeekForPlayer(p, yearNum);
          const inj = isInjuredOrLimited(p);
          const name =
            p.full_name ||
            p.search_full_name ||
            `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
            `Player #${pid}`;
          const team = normalizeTeamAbbr(p?.team);
          return { pid: String(pid), name, pos, team, bye, injured: inj };
        })
        .filter(Boolean);

      const availableInWeek = (rp, week) => {
        if (!rp) return false;
        if (rp.injured) return false;
        if (rp.bye && Number(rp.bye) === Number(week)) return false;
        return true;
      };

      const issues = [];

      for (const week of weeks) {
        const avail = rosterPlayers.filter((rp) => availableInWeek(rp, week));

        const availCounts = avail.reduce((acc, rp) => {
          const k = rp.pos || "—";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});

        // Precompute who is OUT by reason (for premium explanations)
        const outByeByPos = {};
        const outInjByPos = {};
        const outByePlayersByPos = {};
        const outInjPlayersByPos = {};

        for (const rp of rosterPlayers) {
          const p = rp.pos || "—";
          if (rp.bye && Number(rp.bye) === Number(week)) {
            outByeByPos[p] = (outByeByPos[p] || 0) + 1;
            (outByePlayersByPos[p] ||= []).push(rp);
          }
          if (rp.injured) {
            outInjByPos[p] = (outInjByPos[p] || 0) + 1;
            (outInjPlayersByPos[p] ||= []).push(rp);
          }
        }

        // fill starters greedily (your original approach)
        const used = new Set();

        const takeFrom = (eligibleFn, need) => {
          let taken = 0;
          for (const rp of avail) {
            if (taken >= need) break;
            if (used.has(rp.pid)) continue;
            if (!eligibleFn(rp)) continue;
            used.add(rp.pid);
            taken++;
          }
          return taken;
        };

        const shortfall = {};

        // fixed slots first
        const fixedTypes = ["QB", "RB", "WR", "TE", "K", "DEF", "DST"];
        for (const t of fixedTypes) {
          const need = Number(slotCounts[t] || 0);
          if (!need) continue;
          const got = takeFrom((rp) => eligibleForSlot(t, rp.pos), need);
          if (got < need) shortfall[t === "DST" ? "DEF" : t] = need - got;
        }

        // flex-like slots next
        const flexTypes = [
          "FLEX",
          "WRRB_FLEX",
          "REC_FLEX",
          "RBTE_FLEX",
          "SUPER_FLEX",
          "OP",
          "SF",
        ];
        for (const t of flexTypes) {
          const need = Number(slotCounts[t] || 0);
          if (!need) continue;
          const got = takeFrom((rp) => eligibleForSlot(t, rp.pos), need);
          if (got < need) shortfall[t] = need - got;
        }

        const totalMissing = Object.values(shortfall).reduce((a, b) => a + b, 0);
        if (totalMissing <= 0) continue;

        // Build conflict explainer per short slot type
        const conflicts = Object.entries(shortfall)
          .filter(([, v]) => v > 0)
          .map(([slot, missing]) => {
            const eligible = eligiblePositionsForSlot(slot);
            const byeOut = eligible.reduce((acc, pos) => acc + (outByeByPos[pos] || 0), 0);
            const injOut = eligible.reduce((acc, pos) => acc + (outInjByPos[pos] || 0), 0);

            const byePlayers = eligible
              .flatMap((pos) => outByePlayersByPos[pos] || [])
              .slice(0, 8);
            const injPlayers = eligible
              .flatMap((pos) => outInjPlayersByPos[pos] || [])
              .slice(0, 8);

            const slotLabel = slot === "DST" ? "DEF" : slot;

            return {
              slot: slotLabel,
              missing,
              eligible,
              byeOut,
              injOut,
              byePlayers,
              injPlayers,
              text: `${slotLabel} short ${missing} (${byeOut} on bye, ${injOut} injured)`,
            };
          })
          .sort((a, b) => b.missing - a.missing || (b.byeOut + b.injOut) - (a.byeOut + a.injOut));

        const byeOutAll = rosterPlayers.filter((rp) => rp.bye === week);
        const injOutAll = rosterPlayers.filter((rp) => rp.injured);

        issues.push({
          week,
          totalMissing,
          shortfall,
          shortfallText: summarizeShortfall(shortfall),
          conflicts,
          // keep your existing context
          availCounts,
          byeCount: byeOutAll.length,
          injCount: injOutAll.length,
          byePlayers: byeOutAll,
          injPlayers: injOutAll,
          byePreview: byeOutAll
            .slice(0, 10)
            .map((rp) => `${rp.name} (${rp.pos}${rp.team ? ` • ${rp.team}` : ""})`),
          injPreview: injOutAll
            .slice(0, 10)
            .map((rp) => `${rp.name} (${rp.pos}${rp.team ? ` • ${rp.team}` : ""})`),
        });
      }

      if (!issues.length) continue;

      issues.sort((a, b) => b.totalMissing - a.totalMissing || a.week - b.week);

      out.push({
        league: lg,
        slotCounts,
        issues,
        worst: issues[0],
      });
    }

    out.sort((a, b) => (b.worst?.totalMissing || 0) - (a.worst?.totalMissing || 0));
    return out.slice(0, 60);
  }, [visibleLeaguesList, playersMap, yrStr]);

  // ---------- Waiver tracker (recent transactions across visible leagues) ----------
    useEffect(() => {
      let alive = true;

      const run = async () => {
        if (!username) return;
        if (!visibleLeaguesList.length) return;
        if (scanLoading) return;

        setTxLoading(true);

        try {
          const stRes = await fetch("https://api.sleeper.app/v1/state/nfl");
          const state = stRes.ok ? await stRes.json() : null;

          const stateSeason = String(state?.season || "");
          const selectedSeason = String(yrStr || "");
          const stateWeek = Number(state?.week ?? state?.leg ?? 0) || 0;

                // ---------- Weeks to scan (robust across Super Bowl / rollover) ----------
          const weeksToTry = [];

          // Always include offseason/early buckets
          weeksToTry.push(0, 1, 2, 3);

          // Always include late-season buckets (where “latest” often lives right after SB)
          for (let wk = 18; wk >= 12; wk--) weeksToTry.push(wk);

          // If state gives us an in-season week, also scan back from there
          if (stateWeek > 0) {
            for (let i = 0; i < 10; i++) {
              const wk = stateWeek - i;
              if (wk >= 1) weeksToTry.push(wk);
            }
          }

          // De-dupe + cap (keep request volume sane)
          const uniqWeeks = Array.from(new Set(weeksToTry))
            .filter((w) => w >= 0)
            .slice(0, 14);



      const leagueJobs = visibleLeaguesList.map(async (lg) => {
        const items = [];

        for (const wk of uniqWeeks) {
          try {
            const res = await fetch(
              `https://api.sleeper.app/v1/league/${lg.id}/transactions/${wk}`
            );
            if (!res.ok) continue;

            const txs = (await res.json()) || [];
            if (!Array.isArray(txs) || txs.length === 0) continue;

            for (const tx of txs) {
              if (!tx) continue;

              // sometimes sleeper returns tx without timestamps; keep them out
              if (!tx.created && !tx.status_updated) continue;

              const t = String(tx.type || "");
              if (t !== "waiver" && t !== "free_agent" && t !== "trade") continue;

              const status = String(tx.status || "").toLowerCase();

              // ✅ Waivers/FA: only completed
              if ((t === "waiver" || t === "free_agent") && status !== "complete") continue;

              // ✅ Trades: pending + complete
              if (t === "trade" && !["pending", "complete"].includes(status)) continue;

              items.push({
                ...tx,
                _league: { id: lg.id, name: lg.name, avatar: lg.avatar },
                _week: wk,
              });
            }
          } catch {}

          // cap per-league work
          if (items.length >= Math.max(txLimit * 3, 40)) break;
        }

        return items;
      });

      const all = (await Promise.all(leagueJobs)).flat();

      all.sort((a, b) => {
        const ta = Number(a.status_updated || a.created || 0);
        const tb = Number(b.status_updated || b.created || 0);
        return tb - ta;
      });

      const filtered = all.filter((tx) => {
        const t = String(tx?.type || "");
        if (txType === "trade") return t === "trade";
        if (txType === "waiver") return t === "waiver" || t === "free_agent";
        return t === "trade" || t === "waiver" || t === "free_agent";
      });

      // Bundle non-trades that are adjacent, same league, same day (premium feed)
      const bundled = bundleNonTradesInRow(filtered);

      // Keep the “limit” applied to visible rows (bundles count as one row)
      const merged = bundled.slice(0, txLimit);

      if (!alive) return;
      setTransactions(merged);
    } catch (e) {
      console.error(e);
      if (!alive) return;
      setTransactions([]);
    } finally {
      if (!alive) return;
      setTxLoading(false);
    }
  };

  run();
  return () => {
    alive = false;
  };
}, [username, visibleLeaguesList, scanLoading, txLimit, txType, yrStr]);


  const showLoadingScreen = initLoading || scanLoading || txLoading;

  // ---------- Formatting helpers ----------
  const labelForId = (id) => {
    const key = String(id);
    const p = playersMap?.[key];

    if (p?.full_name) return p.full_name;
    if (p?.search_full_name) return p.search_full_name;

    const pos = String(p?.position || "").toUpperCase();
    if (pos === "DEF" && p?.team) return `${normalizeTeamAbbr(p.team)} D/ST`;

    if (key.length <= 4 && key.toUpperCase() === key && /^[A-Z]+$/.test(key))
      return `${normalizeTeamAbbr(key)} D/ST`;

    if (/^\d+$/.test(key)) return `Player #${key}`;
    return key || "Unknown";
  };

  const getManagerNameByRoster = (leagueId, rosterId) => {
    const lid = String(leagueId || "");
    const rid = String(rosterId || "");
    const ridToUid = rosterOwnersRef.current.get(lid);
    const uid = ridToUid?.get(rid);
    const uidToName = leagueUsersRef.current.get(lid);
    return uid ? (uidToName?.get(String(uid)) || `User ${uid}`) : `Roster ${rid}`;
  };

  const getWinnerRosterIdFromAdds = (addsObj) => {
    // adds is { player_id: roster_id, ... }
    if (!addsObj || typeof addsObj !== "object") return null;
    const vals = Object.values(addsObj).map(String).filter(Boolean);
    return vals.length ? vals[0] : null;
  };

  const getP = (id) => playersMap?.[String(id)];

  function eligiblePositionsForSlot(slotType) {
    const s = String(slotType || "").toUpperCase();

    if (["QB", "RB", "WR", "TE", "K"].includes(s)) return [s];
    if (s === "DEF" || s === "DST") return ["DEF"];

    if (s === "FLEX") return ["RB", "WR", "TE"];
    if (s === "WRRB_FLEX") return ["WR", "RB"];
    if (s === "REC_FLEX") return ["WR", "TE"];
    if (s === "RBTE_FLEX") return ["RB", "TE"];

    if (s === "SUPER_FLEX" || s === "SF" || s === "OP")
      return ["QB", "RB", "WR", "TE"];

    return [];
  }

  function posLabel(pos) {
    const p = String(pos || "").toUpperCase();
    return p === "DST" ? "DEF" : p;
  }


  // ===== Modals =====
  const TransactionDetailsModal = ({ tx, onClose }) => {
    if (!tx) return null;

    // If it’s a trade, reuse your existing TradeModal (no duplication)
    if (tx?.type === "trade") {
      return <TradeModal tx={tx} onClose={onClose} />;
    }

    const isBundle = !!tx?._bundle;
    const lid = String(tx?._league?.id || "");
    const leagueName = tx?._league?.name || "League";

    const items = isBundle ? (Array.isArray(tx._items) ? tx._items : []) : [tx];

    // newest -> oldest already, but make sure modal shows newest first
    const sorted = [...items].sort((a, b) => {
      const ta = Number(a?.status_updated || a?.created || 0);
      const tb = Number(b?.status_updated || b?.created || 0);
      return tb - ta;
    });

    const txTs = Number((isBundle ? tx?._tsMax : tx?.status_updated || tx?.created) || 0);
    const ago = txTs ? timeAgo(Date.now() - txTs) : "";

    const winnerName = (t) => {
      const rid = getWinnerRosterIdFromAdds(t?.adds);
      return rid ? getManagerNameByRoster(lid, rid) : null;
    };

    const fmtList = (ids = []) => {
      if (!ids.length) return "—";
      return ids
        .slice(0, 30)
        .map((pid) => labelForId(pid))
        .join(", ");
    };

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative w-full max-w-4xl max-h-[86vh] overflow-hidden rounded-3xl border border-white/10 bg-gray-950/90 backdrop-blur shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <img
                    src={leagueAvatarUrl(tx?._league?.avatar)}
                    alt=""
                    className="w-10 h-10 rounded-2xl object-cover bg-gray-700 border border-white/10"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate">
                      {leagueName}
                    </div>
                    <div className="text-xs text-white/55 mt-0.5 truncate">
                      {isBundle ? "Waiver bundle" : (tx?.type === "free_agent" ? "Free agent" : "Waiver")}{" "}
                      <span className="mx-2 text-white/20">•</span>
                      Week {tx?._week ?? "—"}
                      {ago ? (
                        <>
                          <span className="mx-2 text-white/20">•</span>
                          <span className="text-white/50">{ago}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 text-[11px] text-white/55">
                  {lid ? (
                    <a
                      href={sleeperLeagueUrl(lid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-300 hover:underline"
                    >
                      Open league in Sleeper →
                    </a>
                  ) : null}
                  {isBundle ? (
                    <span className="inline-flex px-2 py-1 rounded-full border border-white/10 bg-black/20">
                      {sorted.length} moves (same day)
                    </span>
                  ) : null}
                </div>
              </div>

              <button
                onClick={onClose}
                className="rounded-xl px-3 py-2 text-xs border border-white/15 bg-white/5 hover:bg-white/10"
              >
                Close
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-5 overflow-y-auto space-y-3">
            {sorted.map((t, idx) => {
              const adds = t?.adds ? Object.keys(t.adds).map(String) : [];
              const drops = t?.drops ? Object.keys(t.drops).map(String) : [];
              const w = winnerName(t);
              const ts = Number(t?.status_updated || t?.created || 0);
              const a = ts ? timeAgo(Date.now() - ts) : "";

              return (
                <div
                  key={`txd-${idx}-${ts || "x"}`}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-white/90">
                      Move #{sorted.length - idx}
                      <span className="text-white/35 font-normal text-xs"> • {a || "—"}</span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-white/55">
                      <span className="inline-flex px-2 py-1 rounded-full border border-white/10 bg-black/20 uppercase">
                        {String(t?.type || tx?.type || "waiver")}
                      </span>
                      <span className="inline-flex px-2 py-1 rounded-full border border-white/10 bg-black/20 uppercase">
                        {String(t?.status || tx?.status || "complete")}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 text-xs text-white/70">
                    {w ? (
                      <>
                        Winner: <span className="text-white font-semibold">{w}</span>
                      </>
                    ) : (
                      <span className="text-white/50">Winner: —</span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs font-semibold text-emerald-200">Adds</div>
                      <div className="mt-1 text-[11px] text-white/65 break-words">
                        {fmtList(adds)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs font-semibold text-red-200">Drops</div>
                      <div className="mt-1 text-[11px] text-white/65 break-words">
                        {fmtList(drops)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {!sorted.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                No transaction details found.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
    
  };

    const LeaguesModal = ({ onClose }) => {
    const [q, setQ] = useState("");

    const all = scanLeagues || [];

    const filtered = all.filter((lg) => {
      const t = `${lg.name || ""} ${lg.id || ""}`.toLowerCase();
      return t.includes(q.trim().toLowerCase());
    });

    const toggle = (id) => {
      const lid = String(id);
      setExcludedLeagueIds((prev) => {
        const next = new Set(prev);
        if (next.has(lid)) next.delete(lid);
        else next.add(lid);
        return next;
      });
    };

    const selectNone = () => setExcludedLeagueIds(new Set(all.map((x) => String(x.id))));
    const selectAll = () => setExcludedLeagueIds(new Set());

    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative w-full max-w-3xl max-h-[86vh] overflow-hidden rounded-3xl border border-white/10 bg-gray-950/90 backdrop-blur shadow-2xl flex flex-col">
          <div className="p-5 border-b border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold">Leagues scanned</div>
                <div className="text-xs text-white/55 mt-1">
                  Uncheck leagues you don’t want included anywhere (free agents, injuries, transactions, manager).
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl px-3 py-2 text-xs border border-white/15 bg-white/5 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search leagues…"
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/90 placeholder:text-white/35 outline-none focus:ring-2 focus:ring-cyan-400/30"
              />

              <div className="flex items-center gap-2">
                <button onClick={selectAll} className={SOFT_BTN} title="Include all leagues">
                  Include all
                </button>
                <button onClick={selectNone} className={SOFT_BTN} title="Exclude all leagues">
                  Exclude all
                </button>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-white/50">
              Included:{" "}
              <span className="text-white/80 font-semibold">
                {all.length - excludedLeagueIds.size}
              </span>{" "}
              • Excluded:{" "}
              <span className="text-white/80 font-semibold">{excludedLeagueIds.size}</span>
              <span className="mx-2 text-white/20">•</span>
              BestBall filter:{" "}
              <span className="text-white/75">
                {onlyBestBall ? "only" : excludeBestBall ? "excluded" : "none"}
              </span>
              <span className="mx-2 text-white/20">•</span>
              Drafting:{" "}
              <span className="text-white/75">{includeDrafting ? "included" : "hidden"}</span>
            </div>
          </div>

          <div className="p-5 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((lg) => {
                const id = String(lg.id);
                const excluded = excludedLeagueIds.has(id);

                return (
                  <button
                    key={id}
                    onClick={() => toggle(id)}
                    className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                      excluded
                        ? "border-white/10 bg-white/3 opacity-70 hover:opacity-100"
                        : "border-white/10 bg-white/6 hover:bg-white/10"
                    }`}
                  >
                    <img
                      src={leagueAvatarUrl(lg.avatar)}
                      alt=""
                      className="w-11 h-11 rounded-2xl object-cover bg-gray-700 border border-white/10"
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-semibold text-white truncate">{lg.name}</div>
                        {lg.isBestBall ? (
                          <span className="text-[11px] px-2 py-1 rounded-full border border-cyan-300/20 bg-cyan-500/10 text-cyan-200">
                            BEST BALL
                          </span>
                        ) : null}
                        {lg.status === "drafting" ? (
                          <span className="text-[11px] px-2 py-1 rounded-full border border-amber-300/25 bg-amber-500/10 text-amber-200">
                            DRAFTING
                          </span>
                        ) : null}
                        <span className="ml-auto text-[11px] text-white/60">
                          {excluded ? "EXCLUDED" : "INCLUDED"}
                        </span>
                      </div>

                      <div className="mt-1 text-[11px] text-white/45 truncate">
                        {id}
                      </div>

                      {!!lg.roster_positions?.length ? (
                        <div className="mt-2 text-[11px] text-white/55 truncate">
                          Slots:{" "}
                          <span className="text-white/70">
                            {Object.entries(buildSlotCounts(lg.roster_positions))
                              .filter(([k]) => !["BN", "IR", "TAXI"].includes(String(k).toUpperCase()))
                              .map(([k, v]) => `${k}:${v}`)
                              .join("  ")}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            {!filtered.length ? (
              <div className="mt-3 text-sm text-white/60">No leagues match that search.</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };



  const TradeModal = ({ tx, onClose }) => {
    if (!tx) return null;

    const lid = String(tx?._league?.id || "");

    // ✅ Single metric mode (controlled globally by SourceSelector via SleeperContext)
    const isProj = metricType === "projection";
    const metricLabel = isProj ? "PROJ" : "VAL";

    const metricForPlayer = (p) => {
      if (!p) return 0;
      return isProj ? (getProjection(p, projectionSource) || 0) : (getPlayerValue(p, { format: mode, qbType: qb, sourceKey }) || 0);
    };

    const fmt = (n) => Number(n || 0).toFixed(1);

    
    const rosterIds = Array.isArray(tx?.roster_ids) ? tx.roster_ids.map(String) : [];
    const adds = tx?.adds || {};
    const drops = tx?.drops || {};
    const picks = Array.isArray(tx?.draft_picks) ? tx.draft_picks : [];
    const faab = Array.isArray(tx?.waiver_budget) ? tx.waiver_budget : [];

    const getP = (id) => playersMap?.[String(id)];

    const managerNameForRid = (rid) => {
      if (!lid || !rid) return `Roster ${String(rid || "—")}`;
      // ✅ uses your scan-built refs (and cached hydration)
      return getManagerNameByRoster(lid, rid);
    };

    const side = (rid) => {
      const inAdds = Object.entries(adds)
        .filter(([, r]) => String(r) === String(rid))
        .map(([pid]) => pid);

      const inDrops = Object.entries(drops)
        .filter(([, r]) => String(r) === String(rid))
        .map(([pid]) => pid);

      const inPicks = picks.filter((pk) => String(pk?.owner_id) === String(rid));
      const outPicks = picks.filter((pk) => String(pk?.previous_owner_id) === String(rid));
      const inFaab = faab.filter((x) => String(x?.receiver) === String(rid));
      const outFaab = faab.filter((x) => String(x?.sender) === String(rid));

      const sumMetric = (ids) =>
        ids.reduce((acc, pid) => acc + metricForPlayer(getP(pid)), 0);

      return {
        rid: String(rid),
        manager: managerNameForRid(rid),
        inAdds: inAdds.map(String),
        inDrops: inDrops.map(String),
        inPicks,
        outPicks,
        inFaab,
        outFaab,
        incomingMetric: sumMetric(inAdds),
        outgoingMetric: sumMetric(inDrops),

      };
    };

    const sides = rosterIds.length ? rosterIds.map(side) : [side("1"), side("2")];

    const net = (s) => (s.incomingMetric || 0) - (s.outgoingMetric || 0);

    const pickLabel = (pk) => {
      const season = pk?.season ? String(pk.season) : "";
      const round = pk?.round != null ? `R${pk.round}` : "Pick";
      return season ? `${season} ${round}` : round;
    };

    const ts = Number(tx?.status_updated || tx?.created || 0);
    const ago = ts ? timeAgo(Date.now() - ts) : "";

    const titleLeft = sides?.[0]?.manager || "Manager A";
    const titleRight = sides?.[1]?.manager || "Manager B";

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative w-full max-w-5xl max-h-[86vh] overflow-hidden rounded-3xl border border-white/10 bg-gray-950/90 backdrop-blur shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <img
                    src={leagueAvatarUrl(tx?._league?.avatar)}
                    alt=""
                    className="w-10 h-10 rounded-2xl object-cover bg-gray-700 border border-white/10"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate">
                      {titleLeft} <span className="text-white/40">↔</span> {titleRight}
                    </div>
                    <div className="text-xs text-white/55 mt-0.5 truncate">
                      {tx?._league?.name || "League"}{" "}
                      <span className="mx-2 text-white/20">•</span>
                      Week {tx?._week ?? "—"}{" "}
                      <span className="mx-2 text-white/20">•</span>
                      <span className="text-white/70">
                        {String(tx?.status || "unknown").toUpperCase()}
                      </span>
                      {ago ? (
                        <>
                          <span className="mx-2 text-white/20">•</span>
                          <span className="text-white/50">{ago}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                className="rounded-xl px-3 py-2 text-xs border border-white/15 bg-white/5 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            {/* Source Bar (global) */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="text-[11px] text-white/55">
                  Trade metric:{" "}
                  <span className="text-white/80 font-semibold">{isProj ? "Projections" : "Values"}</span>
                  <span className="mx-2 text-white/20">•</span>
                  Uses the same Source Selector as the page
                </div>

                <div className="min-w-[240px]">
                  <SourceSelector
                    value={sourceKey}
                    onChange={setSourceKey}
                    className="w-full"
                    mode={mode}
                    qbType={qb}
                    onModeChange={setMode}
                    onQbTypeChange={setQb}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Body */}
          <div className="p-5 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sides.map((s) => {
                const n = net(s);

                return (
                  <div
                    key={s.rid}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white/95 truncate">
                          {s.manager}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/50">
                          <span className="inline-flex px-2 py-1 rounded-full border border-white/10 bg-black/20">
                            Roster {s.rid}
                          </span>
                          {lid ? (
                            <a
                              href={sleeperLeagueUrl(lid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-300 hover:underline"
                            >
                              Open league →
                            </a>
                          ) : null}
                        </div>
                      </div>

                      <div className="text-xs text-white/60 tabular-nums text-right">
                        <div>
                          Net {metricLabel}{" "}
                          <span className={net(s) >= 0 ? "text-emerald-300" : "text-red-300"}>
                            {net(s) >= 0 ? "+" : ""}
                            {fmt(net(s))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Incoming / Outgoing */}
                    <div className="mt-4 text-xs text-white/60">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-white/80">Incoming</div>
                        <div className="text-[11px] text-white/45 tabular-nums">
                          {metricLabel} {fmt(s.incomingMetric)}
                        </div>
                      </div>

                      {s.inAdds.length ? (
                        <ul className="mt-2 space-y-1">
                          {s.inAdds.map((pid) => (
                            <li key={`in-${s.rid}-${pid}`} className="flex justify-between gap-2">
                              <span className="truncate text-white/85">{labelForId(pid)}</span>
                              <span className="tabular-nums text-white/55 whitespace-nowrap">
                                {fmt(metricForPlayer(getP(pid)))}
                                <span className="ml-1 text-[10px] text-white/35">{metricLabel}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-2 text-white/40">—</div>
                      )}

                      {s.inPicks.length ? (
                        <div className="mt-3">
                          <div className="font-semibold text-white/70">Incoming Picks</div>
                          <div className="mt-1 text-white/55">{s.inPicks.map(pickLabel).join(", ")}</div>
                        </div>
                      ) : null}

                      {s.inFaab.length ? (
                        <div className="mt-2 text-white/55">
                          FAAB In: {s.inFaab.map((x) => x.amount).join(", ")}
                        </div>
                      ) : null}

                      <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                        <div className="font-semibold text-white/80">Outgoing</div>
                        <div className="text-[11px] text-white/45 tabular-nums">
                          {metricLabel} {fmt(s.outgoingMetric)}
                        </div>
                      </div>

                      {s.inDrops.length ? (
                        <ul className="mt-2 space-y-1">
                          {s.inDrops.map((pid) => (
                            <li key={`out-${s.rid}-${pid}`} className="flex justify-between gap-2">
                              <span className="truncate text-white/85">{labelForId(pid)}</span>
                              <span className="tabular-nums text-white/55 whitespace-nowrap">
                                {fmt(metricForPlayer(getP(pid)))}
                                <span className="ml-1 text-[10px] text-white/35">{metricLabel}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="mt-2 text-white/40">—</div>
                      )}


                      {s.outPicks.length ? (
                        <div className="mt-3">
                          <div className="font-semibold text-white/70">Outgoing Picks</div>
                          <div className="mt-1 text-white/55">{s.outPicks.map(pickLabel).join(", ")}</div>
                        </div>
                      ) : null}

                      {s.outFaab.length ? (
                        <div className="mt-2 text-white/55">
                          FAAB Out: {s.outFaab.map((x) => x.amount).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 text-[11px] text-white/45">
              Showing <span className="text-white/70 font-semibold">{isProj ? "Projections" : "Values"}</span>{" "}
              using <span className="text-white/70">{sourceKey}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };




  const FreeAgentModal = ({ row, onClose }) => {
    const [showAll, setShowAll] = useState(false);
    if (!row) return null;

    const list = showAll ? row.openLeagues : row.openLeagues.slice(0, 24);

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative w-full max-w-2xl max-h-[82vh] overflow-hidden rounded-3xl border border-white/10 bg-gray-950/90 backdrop-blur p-5 shadow-2xl flex flex-col">
          <div className="flex items-start justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <AvatarImage name={row.name} size={42} className="rounded-full" alt={row.name} />
              <div className="min-w-0">
                <div className="text-lg font-semibold truncate">{row.name}</div>
                <div className="text-xs text-white/55">
                  {row.pos} {row.team ? `• ${row.team}` : ""} • Open in {row.openCount} league
                  {row.openCount === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl px-3 py-2 text-xs border border-white/15 bg-white/5 hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 shrink-0">
            <div className="text-xs text-white/60">Available in these leagues:</div>
            {row.openLeagues.length > 24 ? (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-xs rounded-xl px-3 py-2 border border-white/15 bg-white/5 hover:bg-white/10"
              >
                {showAll ? "Show less" : `Show all (${row.openLeagues.length})`}
              </button>
            ) : null}
          </div>

          <div className="mt-3 overflow-y-auto pr-2 -mr-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {list.map((lg) => (
                <a
                  key={lg.id}
                  href={sleeperLeagueUrl(lg.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 p-3 transition"
                  title="Open league in Sleeper"
                >
                  <img
                    src={leagueAvatarUrl(lg.avatar)}
                    alt=""
                    className="w-10 h-10 rounded-2xl object-cover bg-gray-700"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{lg.name}</div>
                    <div className="text-[11px] text-white/55 truncate">{lg.id}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const InjuryPlayerModal = ({ row, onClose }) => {
    if (!row) return null;
    const leagues = playerLeaguesMap.get(String(row.id)) || [];
    const p = playersMap?.[String(row.id)];
    const bye = p ? getByeWeekForPlayer(p, Number(yrStr) || new Date().getFullYear()) : 0;

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative w-full max-w-2xl max-h-[82vh] overflow-hidden rounded-3xl border border-white/10 bg-gray-950/90 backdrop-blur p-5 shadow-2xl flex flex-col">
          <div className="flex items-start justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <AvatarImage name={row.name} size={42} className="rounded-full" alt={row.name} />
              <div className="min-w-0">
                <div className="text-lg font-semibold truncate">{row.name}</div>
                <div className="text-xs text-white/55">
                  {row.pos} {row.team ? `• ${row.team}` : ""}{" "}
                  {bye ? `• Bye W${bye}` : ""} • In {leagues.length} league{leagues.length === 1 ? "" : "s"}
                </div>
                <div className="text-[11px] text-white/45 mt-1 truncate">
                  {row.injury || "Injury"} {row.detail ? `• ${row.detail}` : ""}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl px-3 py-2 text-xs border border-white/15 bg-white/5 hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="mt-4 overflow-y-auto pr-2 -mr-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {leagues.map((lg) => (
                <a
                  key={lg.id}
                  href={sleeperLeagueUrl(lg.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 p-3 transition"
                >
                  <img
                    src={leagueAvatarUrl(lg.avatar)}
                    alt=""
                    className="w-10 h-10 rounded-2xl object-cover bg-gray-700"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{lg.name}</div>
                    <div className="text-[11px] text-white/55 truncate">{lg.id}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const ManagerModal = ({ item, onClose }) => {
    if (!item) return null;
    const lg = item.league;

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative flex flex-col w-full max-w-4xl max-h-[84vh] overflow-hidden rounded-3xl border border-white/10 bg-gray-950/90 backdrop-blur p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={leagueAvatarUrl(lg?.avatar)}
                alt=""
                className="w-12 h-12 rounded-2xl object-cover bg-gray-700"
                onError={(e) => {
                  e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                }}
              />
              <div className="min-w-0">
                <div className="text-lg font-semibold truncate">{lg?.name || "League"}</div>
                <div className="text-xs text-white/55">
                  Injury/Bye Week Manager • weeks you may not be able to set a legal lineup
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl px-3 py-2 text-xs border border-white/15 bg-white/5 hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="mt-4 text-xs text-white/60 shrink-0">
            Starter slots:{" "}
            <span className="text-white/80">
              {Object.entries(item.slotCounts || {})
                .filter(([k]) => !["BN", "IR", "TAXI"].includes(String(k).toUpperCase()))
                .map(([k, v]) => `${k}:${v}`)
                .join("  ")}
            </span>
          </div>

          <div className="mt-4 max-h-[66vh] overflow-y-auto pr-2 -mr-2 space-y-3">
            {item.issues.map((w) => (
              <div
                key={`mgr-${lg.id}-${w.week}`}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-white font-semibold">
                    Week {w.week}{" "}
                    <span className="text-white/40 text-xs font-normal">
                      • Missing {w.totalMissing}
                    </span>
                  </div>
                  <div className="text-xs text-white/60">
                    Shortfall:{" "}
                    <span className="text-white/80 tabular-nums">{w.shortfallText}</span>
                    <span className="mx-2 text-white/20">•</span>
                    Bye:{w.byeCount} • Inj:{w.injCount}
                  </div>
                </div>

                <div className="mt-2 text-xs text-white/55">
                  Available:{" "}
                  <span className="text-white/75">
                    {Object.entries(w.availCounts || {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, v]) => `${k}:${v}`)
                      .join("  ")}
                  </span>
                </div>

                {/* NEW: conflict breakdown */}
                {w.conflicts?.length ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white/90">Conflict breakdown</div>
                      <div className="text-[11px] text-white/50">
                        Missing {w.totalMissing} starter{w.totalMissing === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {w.conflicts.slice(0, 6).map((c) => (
                        <div
                          key={`${lg.id}-${w.week}-${c.slot}`}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5"
                        >
                          <span className="text-[11px] font-semibold text-white/90">
                            {c.slot} short {c.missing}
                          </span>
                          <span className="text-[11px] text-white/50">•</span>
                          <span className="text-[11px] text-white/70">{c.byeOut} bye</span>
                          <span className="text-[11px] text-white/50">+</span>
                          <span className="text-[11px] text-white/70">{c.injOut} injured</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="text-xs font-semibold text-white/70">Top bye contributors</div>
                        <div className="mt-1 text-[11px] text-white/55 space-y-1">
                          {w.conflicts?.[0]?.byePlayers?.length ? (
                            w.conflicts[0].byePlayers.slice(0, 8).map((rp) => (
                              <div key={`bye-${w.week}-${rp.pid}`} className="truncate">
                                {rp.name} ({rp.pos}{rp.team ? ` • ${rp.team}` : ""})
                              </div>
                            ))
                          ) : (
                            <div className="text-white/40">—</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="text-xs font-semibold text-white/70">Top injury contributors</div>
                        <div className="mt-1 text-[11px] text-white/55 space-y-1">
                          {w.conflicts?.[0]?.injPlayers?.length ? (
                            w.conflicts[0].injPlayers.slice(0, 8).map((rp) => (
                              <div key={`inj-${w.week}-${rp.pid}`} className="truncate">
                                {rp.name} ({rp.pos}{rp.team ? ` • ${rp.team}` : ""})
                              </div>
                            ))
                          ) : (
                            <div className="text-white/40">—</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 text-[11px] text-white/45">
                      Example: “RB short 1 (2 on bye, 1 injured)” means your available RB-eligible pool can’t satisfy starter requirements that week.
                    </div>
                  </div>
                ) : null}


                <div className="mt-3 flex items-center justify-between">
                  <a
                    href={sleeperLeagueUrl(lg.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-cyan-300 hover:underline"
                  >
                    Open league in Sleeper →
                  </a>
                  <div className="text-[11px] text-white/45">
                    This is a “starter-slot” check (BN depth doesn’t help if slots can’t be filled).
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };


  // ---------- UI helpers ----------
  const TxRow = ({ tx }) => {
    const isBundle = !!tx?._bundle;
    const isTrade = tx?.type === "trade";

    // For bundles, use the most recent timestamp in the bundle
    const ts = Number(isBundle ? tx?._tsMax : tx?.status_updated || tx?.created || 0);
    const ago = ts ? timeAgo(Date.now() - ts) : "";

    const lid = tx?._league?.id;

    const typeLabel = isTrade
      ? "Trade"
      : isBundle
      ? "Waivers"
      : tx?.type === "free_agent"
      ? "FA"
      : "Waiver";

    const typeMeta = isTrade
      ? { dot: "bg-cyan-300", pill: "border-cyan-300/20 bg-cyan-500/10 text-cyan-200" }
      : { dot: "bg-amber-300", pill: "border-amber-300/25 bg-amber-500/10 text-amber-200" };

    const bundleItems = isBundle ? (Array.isArray(tx._items) ? tx._items : []) : [tx];

    const allAdds = bundleItems.flatMap((t) => (t?.adds ? Object.keys(t.adds) : []));
    const allDrops = bundleItems.flatMap((t) => (t?.drops ? Object.keys(t.drops) : []));

    const fmtPlayers = (ids) => ids.slice(0, 4).map((id) => labelForId(id)).join(", ");

    let headerLine = "";
    if (isTrade) {
      const rids = Array.isArray(tx?.roster_ids) ? tx.roster_ids.map(String) : [];
      const a = rids[0] ? getManagerNameByRoster(lid, rids[0]) : "—";
      const b = rids[1] ? getManagerNameByRoster(lid, rids[1]) : "—";
      headerLine = `${a} ↔ ${b}`;
    } else if (isBundle) {
      const moveCount = bundleItems.length;
      headerLine = `${moveCount} moves • ${allAdds.length} add${allAdds.length === 1 ? "" : "s"} • ${
        allDrops.length
      } drop${allDrops.length === 1 ? "" : "s"}`;
    } else {
      const winnerRid = getWinnerRosterIdFromAdds(tx?.adds);
      headerLine = winnerRid ? `Winner: ${getManagerNameByRoster(lid, winnerRid)}` : "Transaction";
    }

    const statusText = String(tx?.status || "").toUpperCase() || "—";

    return (
      <div
        className={`${CARD_ROW} cursor-pointer`}
        onClick={() => setSelectedTx(tx)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setSelectedTx(tx);
        }}
      >
        <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${typeMeta.dot} opacity-70`} />

        <img
          src={leagueAvatarUrl(tx?._league?.avatar || undefined)}
          alt=""
          className="w-10 h-10 rounded-2xl object-cover bg-gray-700 border border-white/10"
          onError={(e) => {
            e.currentTarget.src = DEFAULT_LEAGUE_IMG;
          }}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-white font-semibold truncate">
              {tx?._league?.name || "League"}
            </div>

            <span className={`text-[11px] px-2 py-1 rounded-full border ${typeMeta.pill}`}>
              {typeLabel.toUpperCase()}
            </span>

            {isBundle ? (
              <span className="text-[11px] px-2 py-1 rounded-full border border-white/10 bg-black/20 text-white/70">
                SAME DAY
              </span>
            ) : null}

            <span className="text-white/25">•</span>
            <span className="text-[11px] text-white/60">W{tx?._week ?? "—"}</span>

            <span className="ml-auto text-xs text-white/50 whitespace-nowrap">{ago}</span>
          </div>

          <div className="mt-1 text-xs text-white/60 truncate">
            {headerLine}
            <span className="mx-2 text-white/20">•</span>
            <span className="text-white/55 text-[11px] uppercase">{statusText}</span>
          </div>

          <div className="mt-2 text-xs text-white/60">
            {allAdds.length ? (
              <span>
                <span className="text-emerald-300">+ </span>
                {fmtPlayers(allAdds)}
                {allAdds.length > 4 ? (
                  <span className="text-white/45"> +{allAdds.length - 4}</span>
                ) : null}
              </span>
            ) : null}

            {allAdds.length && allDrops.length ? <span className="mx-2 text-white/25">•</span> : null}

            {allDrops.length ? (
              <span>
                <span className="text-red-300">- </span>
                {fmtPlayers(allDrops)}
                {allDrops.length > 4 ? (
                  <span className="text-white/45"> +{allDrops.length - 4}</span>
                ) : null}
              </span>
            ) : null}

            {!allAdds.length && !allDrops.length ? (
              <span className="text-white/50">No player details</span>
            ) : null}
          </div>
        </div>
      </div>
    );
  };



  return (
    <main className="min-h-screen text-white">
      <Navbar pageTitle="League Hub" />
      <BackgroundParticles />

      {showLoadingScreen ? (
        <LoadingScreen
          progress={scanLoading ? scanProgressPct : undefined}
          text={scanLoading ? scanProgressText : undefined}
        />
      ) : (
        <div className="max-w-6xl mx-auto px-4 pb-12 pt-20">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight">League Hub</h1>
            <p className="text-white/70 mt-1">
              One page to manage multiple leagues: waivers, free agents, injuries, and lineup-risk weeks.
            </p>
          </div>

          {/* Scan summary */}
          <div className={`${SECTION_SHELL} mb-6`}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex w-2 h-2 rounded-full bg-cyan-300/80 shadow-[0_0_0_6px_rgba(34,211,238,0.12)]" />
                <div className="text-sm text-white/70">
                  Leagues scanned:{" "}
                  <span className="text-white font-semibold">{leagueCount}</span>
                </div>
              </div>

              {lastUpdated ? (
                <div className="text-xs text-white/45" suppressHydrationWarning>
                  Last scan: {lastUpdated.toLocaleTimeString()}
                </div>
              ) : null}
              {scanningError ? (
                <div className="text-sm text-red-400">{scanningError}</div>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                <div className="text-xs text-white/55 tabular-nums">
                  Visible: <span className="text-white/85 font-semibold">{visibleLeaguesList.length}</span>
                  <span className="text-white/25"> / </span>
                  Scanned: <span className="text-white/85 font-semibold">{scanLeagues.length}</span>
                </div>

                <button
                  className={SOFT_BTN}
                  onClick={() => setShowLeaguesModal(true)}
                  title="View scanned leagues"
                >
                  Leagues
                </button>

                <button
                  className={SOFT_BTN}
                  onClick={() => {
                    try {
                      if (cacheKey) sessionStorage.removeItem(cacheKey);
                    } catch {}
                    window.location.reload();
                  }}
                  title="Rescan"
                >
                  Refresh
                </button>
              </div>

            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-white/75">
                  <input
                    type="checkbox"
                    className="accent-cyan-400"
                    checked={onlyBestBall}
                    onChange={() => {
                      setOnlyBestBall((prev) => {
                        const next = !prev;
                        if (next) setExcludeBestBall(false); // ✅ force mutual exclusion
                        return next;
                      });
                    }}
                    disabled={excludeBestBall} // ✅ optional: prevents clicking when the other is on
                  />
                  Only Best Ball
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-sm text-white/75">
                  <input
                    type="checkbox"
                    className="accent-cyan-400"
                    checked={excludeBestBall}
                    onChange={() => {
                      setExcludeBestBall((prev) => {
                        const next = !prev;
                        if (next) setOnlyBestBall(false); // ✅ force mutual exclusion
                        return next;
                      });
                    }}
                    disabled={onlyBestBall} // ✅ optional: prevents clicking when the other is on
                  />
                  Exclude Best Ball
                </label>

              {/* <label className="flex items-center gap-2 cursor-pointer text-sm text-white/75">
                <input
                  type="checkbox"
                  className="accent-cyan-400"
                  checked={includeDrafting}
                  onChange={() => setIncludeDrafting((v) => !v)}
                />
                Include drafting
              </label> */}

              <div className="ml-auto flex items-center gap-2">
                <div className="relative min-w-[240px]">
                  <SourceSelector
                    value={sourceKey}
                    onChange={setSourceKey}
                    className="w-full"
                    mode={mode}
                    qbType={qb}
                    onModeChange={setMode}
                    onQbTypeChange={setQb}
                  />
                </div>
              </div>
            </div>

            {!projectionsReady && bestMetric === "projection" ? (
              <div className="mt-3 text-[11px] text-white/45">
                Projections are still loading for some sources — if values look empty, give it a second or switch sources.
              </div>
            ) : null}
          </div>

          {!username ? (
            <p className="text-red-400">Please log in on the Home page.</p>
          ) : Object.keys(playersMap).length === 0 ? (
            <p className="text-red-400">Player database not ready yet. One moment…</p>
          ) : leagueCount === 0 ? (
            <p className="text-red-400">No leagues matched the scan rules for your account.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Waiver / Trade Tracker */}
              <section className={`lg:col-span-5 ${SECTION_SHELL}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex w-2 h-2 rounded-full bg-white/60" />
                      <div className="text-lg font-semibold">Waiver / Trade Tracker</div>
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                      Recent waivers, free agents, and trades across your leagues (trades are clickable).
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-2xl border border-white/10 bg-black/20 p-1">
                      {[
                        { k: "waiver", label: "Waiver" },
                        { k: "trade", label: "Trade" },
                        { k: "both", label: "Both" },
                      ].map((opt) => (
                        <button
                          key={opt.k}
                          type="button"
                          onClick={() => setTxType(opt.k)}
                          className={`px-2.5 py-1.5 text-[11px] rounded-xl transition ${
                            txType === opt.k
                              ? "bg-white/10 text-white shadow-[0_10px_30px_-25px_rgba(255,255,255,0.25)]"
                              : "text-white/60 hover:text-white hover:bg-white/5"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <select
                      value={String(txLimit)}
                      onChange={(e) => setTxLimit(Number(e.target.value) || 10)}
                      className="bg-gray-950 border border-white/10 rounded-2xl px-2 py-2 text-xs text-white/80"
                      title="Show"
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {txLoading ? (
                    <div className={`${SUBCARD} p-4 text-sm text-white/60`}>Loading…</div>
                  ) : transactions.length === 0 ? (
                    <div className={`${SUBCARD} p-4 text-sm text-white/60`}>
                      {txType === "trade"
                        ? "No recent trades found."
                        : txType === "waiver"
                        ? "No recent waivers found."
                        : "No recent waivers/trades found."}
                    </div>
                  ) : (
                    transactions.map((tx) => (
                      <TxRow
                        key={String(tx.transaction_id || tx.created || Math.random())}
                        tx={tx}
                      />
                    ))
                  )}
                </div>
              </section>

              {/* Top Free Agents */}
              <section className={`lg:col-span-7 ${SECTION_SHELL}`}>
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex w-2 h-2 rounded-full bg-emerald-300/80 shadow-[0_0_0_6px_rgba(16,185,129,0.12)]" />
                      <div className="text-lg font-semibold">Top Free Agents</div>
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                      Ranked by {bestMetric === "projection" ? "season projection" : "value"}. Click a player to see leagues.
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="bg-gray-950 border border-white/10 rounded-2xl px-2 py-2 text-xs text-white/80"
                      value={bestPos}
                      onChange={(e) => setBestPos(e.target.value)}
                      title="Position"
                    >
                      <option value="ALL">All</option>
                      <option value="QB">QB</option>
                      <option value="RB">RB</option>
                      <option value="WR">WR</option>
                      <option value="TE">TE</option>
                      <option value="K">K</option>
                      <option value="DST">DST</option>
                    </select>
                    <select
                      className="bg-gray-950 border border-white/10 rounded-2xl px-2 py-2 text-xs text-white/80"
                      value={String(minOpenSlots)}
                      onChange={(e) => setMinOpenSlots(parseInt(e.target.value, 10) || 1)}
                      title="Min open"
                    >
                      <option value="1">1+ open</option>
                      <option value="2">2+ open</option>
                      <option value="3">3+ open</option>
                      <option value="4">4+ open</option>
                      <option value="5">5+ open</option>
                    </select>
                    <select
                      className="bg-gray-950 border border-white/10 rounded-2xl px-2 py-2 text-xs text-white/80"
                      value={String(bestLimit)}
                      onChange={(e) => setBestLimit(parseInt(e.target.value, 10) || 25)}
                      title="Show"
                    >
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="75">75</option>
                      <option value="100">100</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  {bestFreeAgents.length === 0 ? (
                    <div className={`${SUBCARD} p-4 text-sm text-white/60`}>
                      No free agents found (try loosening filters or switching sources).
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-white/70 border-b border-white/10">
                          <th className="py-2 pr-2">Player</th>
                          <th className="py-2 pr-2">Pos</th>
                          <th className="py-2 pr-2">Team</th>
                          <th className="py-2 pr-2">
                            {bestMetric === "projection" ? "Proj" : "Value"}
                          </th>
                          <th className="py-2 pr-2">Open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bestFreeAgents.map((row) => {
                          const metricVal = bestMetric === "projection" ? row.proj : row.value;
                          const openLabel = `${row.openCount}/${visibleLeaguesList.length}`;
                          const previews = row.openLeagues.slice(0, 6);
                          return (
                            <tr
                              key={row.id}
                              className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                              onClick={() => setSelectedFA(row)}
                            >
                              <td className="py-2 pr-2">
                                <div className="flex items-center gap-2">
                                  <AvatarImage
                                    name={row.name}
                                    size={32}
                                    className="rounded-full"
                                    alt={row.name}
                                  />
                                  <div className="min-w-0">
                                    <div className="text-white font-semibold truncate">{row.name}</div>
                                    <div className="mt-1 flex items-center gap-2">
                                      <span className={PILL}>
                                        {row.pos}
                                        {row.team ? <span className="text-white/35">•</span> : null}
                                        {row.team ? row.team : null}
                                      </span>
                                      <span className="text-xs text-white/50 truncate">
                                        Open ({openLabel})
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 pr-2 text-white/80">{row.pos}</td>
                              <td className="py-2 pr-2 text-white/80">{row.team || "—"}</td>
                              <td className="py-2 pr-2 text-white/80 tabular-nums">
                                <span className="inline-flex items-center gap-2">
                                  <span className="text-white/80">
                                    {metricVal > 0 ? Number(metricVal).toFixed(1) : "–"}
                                  </span>
                                  <span className="text-[11px] text-white/45">
                                    {bestMetric === "projection" ? "proj" : "val"}
                                  </span>
                                </span>
                              </td>
                              <td className="py-2 pr-2">
                                <div className="flex items-center gap-1.5">
                                  {previews.map((lg) => (
                                    <img
                                      key={lg.id}
                                      src={leagueAvatarUrl(lg.avatar)}
                                      alt=""
                                      className="w-7 h-7 rounded-xl object-cover bg-gray-700 border border-white/10"
                                      onError={(e) => {
                                        e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                                      }}
                                    />
                                  ))}
                                  {row.openLeagues.length > previews.length ? (
                                    <span className="text-xs text-white/55 ml-1">
                                      +{row.openLeagues.length - previews.length}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              {/* Injury Report (click player => leagues) */}
              <section className={`lg:col-span-6 ${SECTION_SHELL}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex w-2 h-2 rounded-full bg-amber-300/80 shadow-[0_0_0_6px_rgba(251,191,36,0.12)]" />
                    <div className="text-lg font-semibold">Injury Report</div>
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    Players on your rosters with injury/practice flags — click to see leagues
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  {injuryRows.length === 0 ? (
                    <div className={`${SUBCARD} p-4 text-sm text-white/60`}>
                      No injured players found on your teams.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-white/70 border-b border-white/10">
                          <th className="py-2 pr-2">Player</th>
                          <th className="py-2 pr-2">Tag</th>
                          <th className="py-2 pr-2">Leagues</th>
                          <th className="py-2 pr-2">
                            {bestMetric === "projection" ? "Proj" : "Value"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {injuryRows.map((r) => {
                          const metricVal = bestMetric === "projection" ? r.proj : r.value;
                          return (
                            <tr
                              key={`inj-${r.id}`}
                              className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                              onClick={() => setSelectedInjuryPlayer(r)}
                            >
                              <td className="py-2 pr-2">
                                <div className="flex items-center gap-2">
                                  <AvatarImage name={r.name} size={30} className="rounded-full" alt={r.name} />
                                  <div className="min-w-0">
                                    <div className="text-white font-semibold truncate">{r.name}</div>
                                    <div className="mt-1 flex items-center gap-2">
                                      <span className={PILL}>
                                        {r.pos}
                                        {r.team ? <span className="text-white/35">•</span> : null}
                                        {r.team ? r.team : null}
                                      </span>
                                      <span className="text-[11px] text-white/45">
                                        Click for leagues
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 pr-2">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[11px] inline-flex w-fit px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/70">
                                    {r.injury || "Injury"}
                                  </span>
                                  {r.detail ? (
                                    <div className="text-[11px] text-white/45 truncate max-w-[240px]">
                                      {r.detail}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                              <td className="py-2 pr-2 text-white/80 tabular-nums">
                                <span className={PILL}>{r.leagues.length} leagues</span>
                              </td>
                              <td className="py-2 pr-2 text-white/80 tabular-nums">
                                {metricVal > 0 ? Number(metricVal).toFixed(1) : "–"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              {/* Injury/Bye Week Manager */}
              <section className={`lg:col-span-6 ${SECTION_SHELL}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex w-2 h-2 rounded-full bg-red-300/80 shadow-[0_0_0_6px_rgba(248,113,113,0.10)]" />
                      <div className="text-lg font-semibold">Injury / Bye Week Manager</div>
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                      Flags weeks where your available (non-bye, non-injured) players can’t fill starter slots.
                    </div>
                  </div>
                  <div className="text-[11px] text-white/45">
                    Uses league roster_positions starter requirements
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {managerIssues.length === 0 ? (
                    <div className={`${SUBCARD} p-4 text-sm text-white/60`}>
                      No lineup risk weeks detected (or roster slot data not available yet).
                    </div>
                  ) : (
                    managerIssues.map((item) => {
                      const lg = item.league;
                      const w = item.worst;
                      const sev = severityMeta(w?.totalMissing ?? 0);

                      return (
                        <button
                          key={`mgr-lg-${lg.id}`}
                          onClick={() => setSelectedManagerLeague(item)}
                          className={`${CARD_ROW} w-full text-left ${sev.ring}`}
                        >
                          {/* Severity accent */}
                          <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${sev.dot} opacity-80`} />

                          <img
                            src={leagueAvatarUrl(lg.avatar)}
                            alt=""
                            className="w-11 h-11 rounded-2xl object-cover bg-gray-700 border border-white/10"
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_LEAGUE_IMG;
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="text-white font-semibold truncate">{lg.name}</div>

                              <span className={`text-[11px] px-2 py-1 rounded-full border ${sev.badge}`}>
                                {sev.label}
                              </span>

                              <span className="text-white/20">•</span>
                              <span className="text-xs text-white/60 truncate">
                                {item.issues.length} risky week{item.issues.length === 1 ? "" : "s"}
                              </span>
                            </div>

                            {w ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={PILL}>
                                  Worst: W{w.week}
                                </span>
                                <span className={PILL}>
                                  Missing{" "}
                                  <span className="text-white/90 font-semibold tabular-nums">
                                    {w.totalMissing}
                                  </span>
                                </span>
                                {w.conflicts?.length ? (
                                  <span className={`${PILL} max-w-full truncate`}>
                                    {w.conflicts[0].text}
                                  </span>
                                ) : w.shortfallText ? (
                                  <span className={`${PILL} max-w-full truncate`}>
                                    {w.shortfallText}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <div className="text-xs text-white/55 mt-1">Click to view details</div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[11px] px-2 py-1 rounded-full border border-white/10 bg-black/20 text-white/70 tabular-nums">
                              Worst {w?.totalMissing ?? 0}
                            </span>
                            <span className="text-[11px] px-2 py-1 rounded-full border border-white/10 bg-black/20 text-white/70 tabular-nums">
                              Weeks {item.issues.length}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

     {selectedTx ? (
  <TransactionDetailsModal tx={selectedTx} onClose={() => setSelectedTx(null)} />
    ) : null}

      {selectedFA ? <FreeAgentModal row={selectedFA} onClose={() => setSelectedFA(null)} /> : null}
      {selectedInjuryPlayer ? (
        <InjuryPlayerModal row={selectedInjuryPlayer} onClose={() => setSelectedInjuryPlayer(null)} />
      ) : null}
      {selectedManagerLeague ? (
        <ManagerModal item={selectedManagerLeague} onClose={() => setSelectedManagerLeague(null)} />
      ) : null}
            {showLeaguesModal ? <LeaguesModal onClose={() => setShowLeaguesModal(false)} /> : null}


      {error ? <div className="sr-only">{error}</div> : null}
    </main>
  );
}