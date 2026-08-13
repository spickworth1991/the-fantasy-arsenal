"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import { useArsenalAccount } from "../../context/ArsenalAccountContext";
import TradeSide from "../../components/TradeSide";
import SearchBox from "../../components/SearchBox";
import PlayerCard from "../../components/PlayerCard";
import TradeWorkspaceSuite from "./TradeWorkspaceSuite";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import SourceSelector, { DEFAULT_SOURCES } from "../../components/SourceSelector";
import { makeGetPlayerValue } from "../../lib/values";
import { parsePickLabel, roundToOrdinal } from "../../lib/picks";
import {
  metricModeFromSourceKey,
  projectionSourceFromKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";

import { PROJ_ARSENAL_JSON_URL, PROJ_ARSENAL_MODEL_JSON_URL, PROJ_CBS_JSON_URL, PROJ_DRAFTSHARKS_JSON_URL, PROJ_ESPN_JSON_URL, PROJ_FANTASYSHARKS_JSON_URL, PROJ_JSON_URL, PROJ_SLEEPER_JSON_URL } from "../../lib/projectionSeason";

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
    const team = normalizeTeamAbbr(r.team ?? r.nfl_team ?? r.team_abbr ?? r.team_code ?? r.pro_team);
    const pos = normalizePos(r.pos ?? r.position ?? r.player_position);

    if (pid) byId[pid] = seasonPts;
    if (!name) return;

    const nn = normNameForMap(name);
    byName[nn] = seasonPts;
    byName[name.toLowerCase().replace(/\s+/g, "")] = seasonPts;
    if (team) byNameTeam[`${nn}|${team}`] = seasonPts;
    if (pos) byNamePos[`${nn}|${pos}`] = seasonPts;
  });

  return { byId, byName, byNameTeam, byNamePos };
}

async function fetchProjectionMap(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return buildProjectionMapFromJSON(await res.json());
}

function getSeasonPointsForPlayer(map, p) {
  if (!map || !p) return 0;

  const hit = map.byId?.[String(p.player_id)];
  if (hit != null) return hit;

  const nn = normNameForMap(p.full_name || p.search_full_name || `${p.first_name || ""} ${p.last_name || ""}`);
  const team = normalizeTeamAbbr(p.team);
  const pos = normalizePos(p.position);

  if (nn && team && map.byNameTeam?.[`${nn}|${team}`] != null) return map.byNameTeam[`${nn}|${team}`];
  if (nn && pos && map.byNamePos?.[`${nn}|${pos}`] != null) return map.byNamePos[`${nn}|${pos}`];
  if (team || pos) return 0;
  if (nn && map.byName?.[nn] != null) return map.byName[nn];

  const compact = (p.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return compact && map.byName?.[compact] != null ? map.byName[compact] : 0;
}

function hasSeasonPointsForPlayer(map, p) {
  if (!map || !p) return false;
  if (Object.prototype.hasOwnProperty.call(map.byId || {}, String(p.player_id))) return true;
  const nn = normNameForMap(p.full_name || p.search_full_name || `${p.first_name || ""} ${p.last_name || ""}`);
  const team = normalizeTeamAbbr(p.team);
  const pos = normalizePos(p.position);
  if (nn && team && Object.prototype.hasOwnProperty.call(map.byNameTeam || {}, `${nn}|${team}`)) return true;
  if (nn && pos && Object.prototype.hasOwnProperty.call(map.byNamePos || {}, `${nn}|${pos}`)) return true;
  if (team || pos) return false;
  if (nn && Object.prototype.hasOwnProperty.call(map.byName || {}, nn)) return true;
  const compact = (p.search_full_name || "").toLowerCase().replace(/\s+/g, "");
  return Boolean(compact && Object.prototype.hasOwnProperty.call(map.byName || {}, compact));
}

export default function TradeAnalyzer() {
  const { isConnected, syncNow } = useArsenalAccount();
  const {
    username,
    leagues,
    players,
    setActiveLeague,
    fetchLeagueRostersSilent,
    format,
    qbType,
    setFormat,
    setQbType,
    sourceKey,
    setSourceKey,
    getProjection,
    hasProjection,
    getWeeklyProjection,
    projectionScoring,
  } = useSleeper();

  const metricMode = metricModeFromSourceKey(sourceKey);
  const projectionSource = projectionSourceFromKey(sourceKey);
  const valueSource = valueSourceFromKey(sourceKey);

  const [projMaps, setProjMaps] = useState({ CSV: null, ESPN: null, CBS: null, SLEEPER: null, FANTASYSHARKS: null, DRAFTSHARKS: null, ARSENAL: null, ARSENAL_MODEL: null });
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");
  const [sideA, setSideA] = useState([]);
  const [sideB, setSideB] = useState([]);
  const [recommendation, setRecommendation] = useState("");
  const [selectedOwnerA, setSelectedOwnerA] = useState("");
  const [selectedOwnerB, setSelectedOwnerB] = useState("");
  const [tradeTab, setTradeTab] = useState("analyzer");
  const [saveMessage, setSaveMessage] = useState("");
  const [offerBufferPct, setOfferBufferPct] = useState(0);
  const [leaguePickAssets, setLeaguePickAssets] = useState({});
  const [tradeLeagueId, setTradeLeagueId] = useState("");
  const routeHandoffApplied = useRef(false);

  useEffect(() => {
    const resetLeagueContext = () => {
      setTradeLeagueId("");
      setActiveLeague(null);
      setSideA([]);
      setSideB([]);
      setSelectedOwnerA("");
      setSelectedOwnerB("");
      setLeaguePickAssets({});
    };
    resetLeagueContext();
    window.addEventListener("pageshow", resetLeagueContext);
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (["analyzer", "finder", "block", "history", "market"].includes(requestedTab))
      setTradeTab(requestedTab);
    routeHandoffApplied.current = true;
    return () => window.removeEventListener("pageshow", resetLeagueContext);
  }, [setActiveLeague]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjError("");
      setProjLoading(true);
      try {
        const [csv, espn, cbs, sleeper, fantasySharks, draftSharks, arsenal, arsenalModel] = await Promise.allSettled([
          fetchProjectionMap(PROJ_JSON_URL),
          fetchProjectionMap(PROJ_ESPN_JSON_URL),
          fetchProjectionMap(PROJ_CBS_JSON_URL),
          fetchProjectionMap(PROJ_SLEEPER_JSON_URL),
          fetchProjectionMap(PROJ_FANTASYSHARKS_JSON_URL),
          fetchProjectionMap(PROJ_DRAFTSHARKS_JSON_URL),
          fetchProjectionMap(PROJ_ARSENAL_JSON_URL),
          fetchProjectionMap(PROJ_ARSENAL_MODEL_JSON_URL),
        ]);
        if (!mounted) return;

        const next = { CSV: null, ESPN: null, CBS: null, SLEEPER: null, FANTASYSHARKS: null, DRAFTSHARKS: null, ARSENAL: null, ARSENAL_MODEL: null };
        if (csv.status === "fulfilled") next.CSV = csv.value;
        if (espn.status === "fulfilled") next.ESPN = espn.value;
        if (cbs.status === "fulfilled") next.CBS = cbs.value;
        if (sleeper.status === "fulfilled") next.SLEEPER = sleeper.value;
        if (fantasySharks.status === "fulfilled") next.FANTASYSHARKS = fantasySharks.value;
        if (draftSharks.status === "fulfilled") next.DRAFTSHARKS = draftSharks.value;
        if (arsenal.status === "fulfilled") next.ARSENAL = arsenal.value;
        if (arsenalModel.status === "fulfilled") next.ARSENAL_MODEL = arsenalModel.value;
        setProjMaps(next);

        const fallbackKey = next.ARSENAL ? "proj:thefantasyarsenal" : next.FANTASYSHARKS ? "proj:fantasysharks" : next.DRAFTSHARKS ? "proj:draftsharks" : next.ESPN ? "proj:espn" : next.CBS ? "proj:cbs" : next.SLEEPER ? "proj:sleeper" : next.CSV ? "proj:ffa" : null;
        if (metricMode === "projections" && !fallbackKey) {
          setProjError("No projections found. Using values instead.");
          setSourceKey("val:thefantasyarsenal");
          return;
        }
        if (String(sourceKey || "").startsWith("proj:")) {
          if (projectionSource === "CBS" && !next.CBS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "ESPN" && !next.ESPN && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "CSV" && !next.CSV && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "SLEEPER" && !next.SLEEPER && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "FANTASYSHARKS" && !next.FANTASYSHARKS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "DRAFTSHARKS" && !next.DRAFTSHARKS && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "ARSENAL" && !next.ARSENAL && fallbackKey) setSourceKey(fallbackKey);
          if (projectionSource === "ARSENAL_MODEL" && !next.ARSENAL_MODEL && fallbackKey) setSourceKey(fallbackKey);
        }
      } catch {
        if (!mounted) return;
        setProjError("Projections unavailable. Using values.");
        setSourceKey("val:thefantasyarsenal");
      } finally {
        if (mounted) setProjLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeagueChange = async (leagueId) => {
    setTradeLeagueId(leagueId || "");
    setActiveLeague(leagueId || null);
    setSideA([]);
    setSideB([]);
    setSelectedOwnerA("");
    setSelectedOwnerB("");
    setLeaguePickAssets({});
    if (leagueId) {
      const loaded = await fetchLeagueRostersSilent(leagueId);
      const selectedLeague = {
        ...(leagues.find((item) => String(item.league_id) === String(leagueId)) || {}),
        ...(loaded || {}),
      };
      const [tradedPicks, drafts] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`)
          .then((response) => (response.ok ? response.json() : []))
          .catch(() => []),
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`)
          .then((response) => (response.ok ? response.json() : []))
          .catch(() => []),
      ]);
      const rosters = selectedLeague?.rosters || [];
      const season = Number(selectedLeague?.season || new Date().getFullYear());
      const completed = new Set(
        (drafts || [])
          .filter((draft) => String(draft.status) === "complete")
          .map((draft) => String(draft.season)),
      );
      const tradedOwner = new Map(
        (tradedPicks || []).map((pick) => [
          `${pick.season}-${pick.round}-${pick.roster_id}`,
          String(pick.owner_id),
        ]),
      );
      const genericPicks = Object.values(players || {}).filter(
        (player) => String(player?.position || "").toUpperCase() === "PICK",
      );
      const next = {};
      [season, season + 1, season + 2].forEach((pickSeason) => {
        if (completed.has(String(pickSeason))) return;
        const rounds = Math.max(1, Number(selectedLeague?.settings?.draft_rounds || 4));
        for (let round = 1; round <= rounds; round += 1) {
          const template = genericPicks.find((player) => {
            const meta = parsePickLabel(player.full_name);
            return meta?.year === pickSeason && meta?.round === round && meta.kind === "generic";
          });
          if (!template) continue;
          rosters.forEach((originalRoster) => {
            const key = `${pickSeason}-${round}-${originalRoster.roster_id}`;
            const ownerRosterId = tradedOwner.get(key) || String(originalRoster.roster_id);
            next[`LEAGUE_PICK_${key}`] = {
              ...template,
              player_id: `LEAGUE_PICK_${key}`,
              full_name: `${pickSeason} ${roundToOrdinal(round)} · original roster ${originalRoster.roster_id}`,
              league_pick_owner_roster_id: ownerRosterId,
            };
          });
        }
      });
      setLeaguePickAssets(next);
    }
  };

  const league = leagues.find(
    (lg) => String(lg.league_id) === String(tradeLeagueId),
  );
  const allOwners = league
    ? (league.rosters || []).map((roster) => ({
      user_id: roster.owner_id,
        roster_id: String(roster.roster_id),
        display_name: league.users?.find((u) => u.user_id === roster.owner_id)?.display_name || "Unknown",
        team_name: league.users?.find((u) => u.user_id === roster.owner_id)?.metadata?.team_name || null,
        players: roster.players || [],
      }))
    : [];

  const getSideTitle = (side) => {
    if (side === "A" && selectedOwnerA) {
      const owner = allOwners.find((o) => o.user_id === selectedOwnerA);
      return owner?.team_name || owner?.display_name || "Side A";
    }
    if (side === "B" && selectedOwnerB) {
      const owner = allOwners.find((o) => o.user_id === selectedOwnerB);
      return owner?.team_name || owner?.display_name || "Side B";
    }
    return side === "A" ? "Side A" : "Side B";
  };

  const getPlayerValue = useMemo(() => makeGetPlayerValue(valueSource, format, qbType, projectionScoring), [valueSource, format, qbType, projectionScoring]);

  const getMetric = useMemo(() => {
    if (metricMode === "projections") {
      if (["FANTASYPROS", "SLEEPER", "DRAFTSHARKS", "ARSENAL", "ARSENAL_MODEL"].includes(projectionSource)) return (p) => getProjection(p, projectionSource) || 0;
      const chosen =
        projectionSource === "ESPN" ? projMaps.ESPN : projectionSource === "CBS" ? projMaps.CBS : projectionSource === "SLEEPER" ? projMaps.SLEEPER : projectionSource === "FANTASYSHARKS" ? projMaps.FANTASYSHARKS : projectionSource === "DRAFTSHARKS" ? projMaps.DRAFTSHARKS : projectionSource === "ARSENAL_MODEL" ? projMaps.ARSENAL_MODEL : projectionSource === "ARSENAL" ? projMaps.ARSENAL : projMaps.CSV;
      if (chosen) return (p) => getSeasonPointsForPlayer(chosen, p) || 0;
      return () => 0;
    }
    return (p) => getPlayerValue(p) || 0;
  }, [metricMode, projectionSource, projMaps, getPlayerValue, getProjection]);

  const tradeValueA = sideA.reduce((sum, p) => sum + getMetric(p), 0);
  const tradeValueB = sideB.reduce((sum, p) => sum + getMetric(p), 0);
  const totalTradeValue = tradeValueA + tradeValueB;
  const sideAPercentage = totalTradeValue
    ? (tradeValueA / totalTradeValue) * 100
    : 50;
  const footballPosition = Math.max(3, Math.min(97, 100 - sideAPercentage));
  const favoredSide =
    !totalTradeValue || Math.abs(tradeValueA - tradeValueB) < 0.5
      ? "EVEN"
      : tradeValueA > tradeValueB
        ? "A"
        : "B";
  const favoredPercentage =
    favoredSide === "A"
      ? sideAPercentage
      : favoredSide === "B"
        ? 100 - sideAPercentage
        : 50;
  const selectedSourceLabel =
    DEFAULT_SOURCES.find((source) => source.key === sourceKey)?.label ||
    sourceKey ||
    "Selected source";
  const isPlayerRanked = (player) => {
    if (metricMode === "projections") {
      if (["FANTASYPROS", "SLEEPER", "DRAFTSHARKS", "ARSENAL", "ARSENAL_MODEL"].includes(projectionSource)) {
        return hasProjection?.(player, projectionSource) ?? getMetric(player) > 0;
      }
      const chosen = projectionSource === "ESPN" ? projMaps.ESPN : projectionSource === "CBS" ? projMaps.CBS : projectionSource === "FANTASYSHARKS" ? projMaps.FANTASYSHARKS : projMaps.CSV;
      return hasSeasonPointsForPlayer(chosen, player);
    }
    const formatKey = `${format === "dynasty" ? "dynasty" : "redraft"}_${qbType === "sf" ? "sf" : "1qb"}`;
    const scoring = String(projectionScoring || "ppr").toLowerCase();
    if (valueSource !== "FantasyCalc") {
      const sourcePresence = player?.source_presence?.[valueSource];
      let keys;
      if (["DynastyProcess", "KeepTradeCut", "IDPShow"].includes(valueSource)) keys = [qbType === "sf" ? "superflex" : "one_qb"];
      else if (valueSource === "IDynastyP") keys = scoring === "tep"
        ? [qbType === "sf" ? "superflex_tep" : "one_qb_tep", qbType === "sf" ? "superflex" : "one_qb"]
        : [qbType === "sf" ? "superflex" : "one_qb"];
      else if (valueSource === "FantasyProsECR") keys = [`${formatKey}_${["std", "half", "ppr"].includes(scoring) ? scoring : "ppr"}`];
      else if (valueSource === "FantasyPros") keys = format !== "dynasty" ? [] : scoring === "tep"
        ? [`${formatKey}_tep`, formatKey]
        : [formatKey];
      else keys = [formatKey];
      if (!sourcePresence) return getMetric(player) > 0;
      return keys.some((key) => sourcePresence[key]);
    }
    const base = formatKey;
    const profile = [
      "std", "half", "ppr", "std-tep", "half-tep", "ppr-tep",
      "std-tep-plus", "half-tep-plus", "ppr-tep-plus",
    ].includes(scoring) ? scoring : "ppr";
    const presence =
      player?.fc_presence?.[`${base}__${profile}`] ??
      player?.fc_presence?.[base];
    return presence == null ? getMetric(player) > 0 : Boolean(presence);
  };
  const playerGapEquivalent = useMemo(() => {
    const gap = Math.abs(tradeValueA - tradeValueB);
    if (!gap || !sideA.length || !sideB.length) return null;
    const candidates = Object.values(players || {})
      .filter((player) =>
        ["QB", "RB", "WR", "TE"].includes(
          String(player?.position || "").toUpperCase(),
        ),
      )
      .map((player) => ({ player, value: Number(getMetric(player) || 0) }))
      .filter((row) => row.value > 0)
      .sort((a, b) => Math.abs(a.value - gap) - Math.abs(b.value - gap));
    const closest = candidates[0];
    if (!closest || Math.abs(closest.value - gap) / gap > 0.18) return null;
    const name =
      closest.player.full_name ||
      closest.player.search_full_name ||
      "premium starter";
    const shortSide = tradeValueA < tradeValueB ? getSideTitle("A") : getSideTitle("B");
    const templates = [
      `${shortSide} is off by roughly one ${name}.`,
      `That gap is basically a whole ${name}.`,
      `${shortSide} needs about one ${name} to bring this back to midfield.`,
      `Think of the difference as one ${name}-sized asset.`,
      `The missing piece is approximately one ${name}.`,
    ];
    const seed = `${closest.player.player_id || name}:${Math.round(gap)}`;
    const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % templates.length;
    return { text: templates[index], name, value: closest.value };
  }, [getMetric, players, sideA.length, sideB.length, tradeValueA, tradeValueB]);
  const getWeeklyMetric = useMemo(() => {
    if (metricMode !== "projections") return (p) => Math.sqrt(Math.max(0, getMetric(p)));
    if (projectionSource === "ARSENAL_MODEL") return (p, currentWeek) => getWeeklyProjection?.(p, projectionSource, currentWeek) || 0;
    return (p) => getMetric(p) / 17;
  }, [getMetric, getWeeklyProjection, metricMode, projectionSource]);

  useEffect(() => {
    const diff = Math.abs(tradeValueA - tradeValueB);
    if (diff < 50) setRecommendation("Fair Trade");
    else if (tradeValueA > tradeValueB) setRecommendation("Side A Wins");
    else setRecommendation("Side B Wins");
  }, [tradeValueA, tradeValueB]);

  // Keep the current package available to league-aware tools. This is a local
  // handoff only; it never writes anything to Sleeper.
  useEffect(() => {
    if (!tradeLeagueId || (!sideA.length && !sideB.length)) return;
    const payload = {
      leagueId: String(tradeLeagueId),
      ownerA: String(selectedOwnerA || ""),
      ownerB: String(selectedOwnerB || ""),
      sideA: sideA.map((player) => String(player.player_id)),
      sideB: sideB.map((player) => String(player.player_id)),
      sourceKey,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(`tfa:trade-handoff:${tradeLeagueId}`, JSON.stringify(payload));
      localStorage.setItem("tfa:trade-handoff:latest", JSON.stringify(payload));
    } catch {}
  }, [tradeLeagueId, selectedOwnerA, selectedOwnerB, sideA, sideB, sourceKey]);

  const addPlayer = (side, player) => {
    if (!player) return;
    if ((side === "A" && sideA.includes(player)) || (side === "B" && sideB.includes(player))) return;
    const isDraftPick = String(player.position || "").toUpperCase() === "PICK";

    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);

    if (tradeLeagueId) {
      if (ownerA && ownerB) {
        const allowedOwner = side === "A" ? ownerB : ownerA;
        if (isDraftPick) {
          if (String(player.league_pick_owner_roster_id || "") !== allowedOwner.roster_id) return;
        } else if (!allowedOwner.players.includes(player.player_id)) return;
      } else if (ownerA && !ownerB) {
        const ownedByA = isDraftPick
          ? String(player.league_pick_owner_roster_id || "") === ownerA.roster_id
          : ownerA.players.includes(player.player_id);
        if ((side === "B" && !ownedByA) || (side === "A" && ownedByA)) return;
      } else if (ownerB && !ownerA) {
        const ownedByB = isDraftPick
          ? String(player.league_pick_owner_roster_id || "") === ownerB.roster_id
          : ownerB.players.includes(player.player_id);
        if ((side === "A" && !ownedByB) || (side === "B" && ownedByB)) return;
      }

      const playerOwner = !isDraftPick
        ? league?.rosters?.find((r) => r.players.includes(player.player_id))
        : null;
      if (playerOwner) {
        if (side === "B" && !selectedOwnerA) setSelectedOwnerA(playerOwner.owner_id);
        if (side === "A" && !selectedOwnerB) setSelectedOwnerB(playerOwner.owner_id);
      }
      if (isDraftPick) {
        const pickOwner = allOwners.find(
          (owner) => owner.roster_id === String(player.league_pick_owner_roster_id || ""),
        );
        if (pickOwner) {
          if (side === "B" && !selectedOwnerA) setSelectedOwnerA(pickOwner.user_id);
          if (side === "A" && !selectedOwnerB) setSelectedOwnerB(pickOwner.user_id);
        }
      }
    }

    if (side === "A") setSideA((prev) => [...prev, player]);
    else setSideB((prev) => [...prev, player]);
  };

  const removePlayer = (side, index) => {
    if (side === "A") setSideA((prev) => prev.filter((_, i) => i !== index));
    else setSideB((prev) => prev.filter((_, i) => i !== index));
  };

  const diff = tradeValueA - tradeValueB;
  const recSide = Math.abs(diff) >= 50 ? (diff > 0 ? "B" : "A") : null;

  let candidatePool = Object.values(players || {});
  if (tradeLeagueId) {
    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);
    if (ownerA && ownerB) {
      const source = recSide === "A" ? ownerB : ownerA;
      candidatePool = (source.players || []).map((pid) => players[pid]).filter(Boolean);
    } else if (ownerA || ownerB) {
      const exclude = new Set((ownerA || ownerB)?.players || []);
      candidatePool = candidatePool.filter((p) => !exclude.has(p.player_id));
    }
  }

  const targetValue = Math.abs(diff) * (1 + offerBufferPct / 100);
  const recommendedPlayers = recSide
    ? candidatePool
        .filter((p) => getMetric(p) > 0)
        .filter((p) => !sideA.includes(p) && !sideB.includes(p))
        .sort((a, b) => Math.abs(getMetric(a) - targetValue) - Math.abs(getMetric(b) - targetValue))
        .slice(0, 6)
    : [];

  const filteredPlayers = (side) => {
    if (!tradeLeagueId) return players;
    const picksFor = (owner) =>
      Object.entries(leaguePickAssets).filter(
        ([, pick]) =>
          !owner ||
          String(pick.league_pick_owner_roster_id) === String(owner.roster_id),
      );
    const withPicks = (map, owner) =>
      Object.fromEntries([...Object.entries(map), ...picksFor(owner)]);
    const ownerA = allOwners.find((o) => o.user_id === selectedOwnerA);
    const ownerB = allOwners.find((o) => o.user_id === selectedOwnerB);
    if (ownerA && ownerB) {
      const source = side === "A" ? ownerB : ownerA;
      return withPicks((source.players || []).reduce((map, pid) => {
        if (players[pid]) map[pid] = players[pid];
        return map;
      }, {}), source);
    }
    if (ownerA && !ownerB) {
      return side === "B"
        ? withPicks((ownerA.players || []).reduce((m, pid) => {
            if (players[pid]) m[pid] = players[pid];
            return m;
          }, {}), ownerA)
        : Object.fromEntries([...Object.entries(players).filter(([pid, player]) => !(ownerA.players || []).includes(pid) && String(player?.position || "").toUpperCase() !== "PICK"), ...picksFor(null)]);
    }
    if (ownerB && !ownerA) {
      return side === "A"
        ? withPicks((ownerB.players || []).reduce((m, pid) => {
            if (players[pid]) m[pid] = players[pid];
            return m;
          }, {}), ownerB)
        : Object.fromEntries([...Object.entries(players).filter(([pid, player]) => !(ownerB.players || []).includes(pid) && String(player?.position || "").toUpperCase() !== "PICK"), ...picksFor(null)]);
    }
    return Object.fromEntries([
      ...Object.entries(players || {}).filter(
        ([, player]) => String(player?.position || "").toUpperCase() !== "PICK",
      ),
      ...picksFor(null),
    ]);
  };

  const topRecommendations = Object.values(players || {})
    .filter((p) => getMetric(p) > 0)
    .sort((a, b) => getMetric(b) - getMetric(a))
    .slice(0, 10);
  const saveCurrentTrade = async () => {
    if (!isConnected) {
      setSaveMessage("Sign in to an Arsenal account to save trades across devices.");
      return;
    }
    if (!sideA.length && !sideB.length) {
      setSaveMessage("Add at least one asset before saving.");
      return;
    }
    const key = `tfa:trade-workspaces:${String(tradeLeagueId || "global")}`;
    let current = [];
    try { current = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
    const item = {
      id:crypto.randomUUID?.() || String(Date.now()),
      createdAt:Date.now(),
      ownerA:selectedOwnerA,
      ownerB:selectedOwnerB,
      sideA:sideA.map((player) => String(player.player_id)),
      sideB:sideB.map((player) => String(player.player_id)),
      valueA:tradeValueA,
      valueB:tradeValueB,
      sourceKey,
      outcome:"Open",
    };
    localStorage.setItem(key, JSON.stringify([item, ...current].slice(0, 30)));
    await syncNow({ quiet:true }).catch(() => {});
    setSaveMessage("Trade saved to your Arsenal account.");
  };

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Trade Analyzer" />
      <div className="max-w-6xl mx-auto px-4 pt-20 -mt-2">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the <a href="/" className="text-blue-400 underline">homepage</a> to use this tool.
          </div>
        ) : (
          <>
            <div className="mb-6 space-y-4">
              <details className="premium-disclosure">
                <summary>Model Settings <span className="ml-auto text-xs font-normal text-white/45">{metricMode === "projections" ? "Projections" : "Values"}</span></summary>
              <div className="mt-3 rounded-2xl bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-950 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/60">Trade Lens</div>
                <div className="mt-3">
                  <SourceSelector
                    sources={DEFAULT_SOURCES}
                    value={sourceKey}
                    onChange={setSourceKey}
                    className="w-full"
                    mode={format}
                    qbType={qbType}
                    onModeChange={setFormat}
                    onQbTypeChange={setQbType}
                    layout="inline"
                  />
                </div>
                <div className="mt-2 text-xs text-white/60">
                  {projError && metricMode === "projections"
                    ? projError
                    : projLoading && metricMode === "projections"
                    ? "Loading projection inputs..."
                    : metricMode === "projections"
                    ? "Comparing sides with season projection totals."
                    : "Comparing sides with the selected trade market."}
                </div>
                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-violet-300/15 bg-violet-300/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-black text-violet-100">
                      Negotiation cushion
                    </div>
                    <p className="mt-1 text-xs text-white/40">
                      Recommend an add that leaves the receiving side slightly ahead, creating room for a counter.
                    </p>
                  </div>
                  <select
                    value={offerBufferPct}
                    onChange={(event) => setOfferBufferPct(Number(event.target.value))}
                    className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm"
                  >
                    <option value="0">Exact balance</option>
                    <option value="3">3% cushion</option>
                    <option value="5">5% cushion</option>
                    <option value="10">10% cushion</option>
                  </select>
                </div>
              </div>
              </details>

              <div className="rounded-2xl border border-white/10 bg-gray-900 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">League Context</div>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs text-white/55">Choose a league for roster-aware trading</label>
                    <select
                      value={tradeLeagueId}
                      onChange={(e) => handleLeagueChange(e.target.value)}
                      data-account-persist="off"
                      aria-label="Trade Analyzer league"
                      className="w-full rounded-xl border border-white/10 bg-gray-800 px-3 py-2 text-white"
                    >
                      <option value="">Choose a League</option>
                      {leagues.map((lg) => (
                        <option key={lg.league_id} value={lg.league_id}>
                          {lg.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {tradeLeagueId ? (
                    <button
                      onClick={() => {
                        handleLeagueChange("");
                      }}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                    >
                      Clear League
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mb-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-2"><div className="flex w-max gap-1">{[["analyzer","Analyzer"],["finder","Partner Finder"],["block","Trade Block"],["history","Trade History"],["market","League Market"]].map(([key,label])=><button type="button" key={key} onClick={()=>setTradeTab(key)} className={`min-h-11 rounded-xl px-5 text-sm font-black ${tradeTab===key?"bg-cyan-300/10 text-cyan-100":"text-white/40"}`}>{label}</button>)}</div></div>

            <div className={tradeTab !== "analyzer" ? "block" : "hidden"}><TradeWorkspaceSuite
              league={league}
              players={players}
              getMetric={getMetric}
              getWeeklyMetric={getWeeklyMetric}
              metricMode={metricMode}
              username={username}
              sideA={sideA}
              sideB={sideB}
              selectedOwnerA={selectedOwnerA}
              selectedOwnerB={selectedOwnerB}
              onLoadPackage={(nextA, nextB, ownerA, ownerB) => {
                setSideA(nextA || []);
                setSideB(nextB || []);
                setSelectedOwnerA(ownerA || "");
                setSelectedOwnerB(ownerB || "");
                setTradeTab("analyzer");
              }}
              initialTab={tradeTab === "analyzer" ? "finder" : tradeTab}
              hideNavigation
            /></div>

            <div className={tradeTab === "analyzer" ? "block" : "hidden"}><div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-gray-900 p-4 md:grid-cols-3">
              <div className="rounded-xl bg-[#0f2134] px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-blue-200/60">Side A</div>
                <div className="mt-1 text-2xl font-semibold text-white">{Math.round(tradeValueA).toLocaleString()}</div>
              </div>
              <div className="rounded-xl bg-[#2b1518] px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-rose-200/60">Side B</div>
                <div className="mt-1 text-2xl font-semibold text-white">{Math.round(tradeValueB).toLocaleString()}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-white/45">Verdict</div>
                <div className="mt-1 text-lg font-semibold text-white">{recommendation}</div>
              </div>
            </div>
            <section className="relative mb-4 overflow-hidden rounded-3xl border border-cyan-300/15 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,.12),transparent_46%),linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.96))] p-4 shadow-[0_28px_80px_-55px_rgba(34,211,238,.85)] sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[.24em] text-cyan-200/55">
                    Trade balance meter
                  </div>
                  <div className="mt-1 text-xl font-black text-white">
                    {!totalTradeValue
                      ? "Add assets to compare the trade"
                      : favoredSide === "EVEN"
                        ? "Dead even · 50% / 50%"
                        : `${getSideTitle(favoredSide)} favored · ${favoredPercentage.toFixed(1)}%`}
                  </div>
                </div>
                <div className="text-[10px] text-white/38">
                  Based on {selectedSourceLabel}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between text-xs font-black uppercase tracking-[.14em]">
                <span className={favoredSide === "A" ? "text-cyan-100" : "text-white/45"}>
                  {getSideTitle("A")} · {sideAPercentage.toFixed(1)}%
                </span>
                <span className={favoredSide === "B" ? "text-rose-100" : "text-white/45"}>
                  {(100 - sideAPercentage).toFixed(1)}% · {getSideTitle("B")}
                </span>
              </div>

              <div className="relative mt-3 h-12 rounded-xl border-2 border-white/15 bg-slate-950 p-1 shadow-[inset_0_0_18px_rgba(0,0,0,.85)]">
                <div className="absolute inset-1 overflow-hidden rounded-lg">
                  <div className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(90deg,rgba(34,211,238,.78)_0,rgba(34,211,238,.78)_12px,rgba(8,47,73,.8)_12px,rgba(8,47,73,.8)_16px)] transition-[width] duration-500 ease-out" style={{ width: `${footballPosition}%` }} />
                  <div className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(90deg,rgba(76,29,149,.85)_0,rgba(76,29,149,.85)_12px,rgba(225,29,72,.7)_12px,rgba(225,29,72,.7)_16px)] transition-[width] duration-500 ease-out" style={{ width: `${100 - footballPosition}%` }} />
                  <div className="absolute inset-y-0 left-1/2 w-px bg-white/45" />
                </div>
                <div
                  className="absolute top-1/2 z-10 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-amber-200/40 bg-slate-950 text-[22px] shadow-[0_0_20px_rgba(251,191,36,.5)] transition-[left] duration-500 ease-out"
                  style={{ left: `${footballPosition}%` }}
                  aria-label={`Trade balance marker: ${favoredSide === "EVEN" ? "even" : `${getSideTitle(favoredSide)} favored`}`}
                >
                  🏈
                </div>
              </div>
              <div className="mt-2 text-center text-[10px] text-white/30">
                The football moves toward the side receiving more total value from the active source.
              </div>
              {playerGapEquivalent ? (
                <div className="mt-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.055] px-3 py-2.5 text-center text-xs font-bold text-amber-100/85 shadow-[inset_0_0_18px_rgba(251,191,36,.035)]">
                  🏟️ {playerGapEquivalent.text}
                </div>
              ) : null}
            </section>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={saveCurrentTrade} className="rounded-xl bg-cyan-300/10 px-4 py-2.5 text-xs font-black text-cyan-100">Save trade</button>
              <button type="button" onClick={() => window.print()} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-black text-white/65">Print / save PDF</button>
              {saveMessage ? <span className="text-xs text-white/45">{saveMessage}</span> : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                {tradeLeagueId ? (
                  <select
                    value={selectedOwnerA}
                    onChange={(e) => setSelectedOwnerA(e.target.value)}
                    data-account-persist="off"
                    aria-label="Trade Analyzer Side A owner"
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.user_id} value={owner.user_id}>
                        {owner.display_name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <TradeSide
                  title={getSideTitle("A")}
                  players={sideA}
                  onRemove={(i) => removePlayer("A", i)}
                  getPlayerValue={getMetric}
                  suggestedPlayers={recSide === "A" ? recommendedPlayers : []}
                  addPlayerToSide={(p) => addPlayer("A", p)}
                  searchBox={
                    <SearchBox
                      players={filteredPlayers("A")}
                      onSelect={(p) => addPlayer("A", p)}
                      getPlayerValue={getMetric}
                      isPlayerRanked={isPlayerRanked}
                      sourceLabel={selectedSourceLabel}
                    />
                  }
                />
              </div>

              <div>
                {tradeLeagueId ? (
                  <select
                    value={selectedOwnerB}
                    onChange={(e) => setSelectedOwnerB(e.target.value)}
                    data-account-persist="off"
                    aria-label="Trade Analyzer Side B owner"
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.user_id} value={owner.user_id}>
                        {owner.display_name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <TradeSide
                  title={getSideTitle("B")}
                  players={sideB}
                  onRemove={(i) => removePlayer("B", i)}
                  getPlayerValue={getMetric}
                  suggestedPlayers={recSide === "B" ? recommendedPlayers : []}
                  addPlayerToSide={(p) => addPlayer("B", p)}
                  searchBox={
                    <SearchBox
                      players={filteredPlayers("B")}
                      onSelect={(p) => addPlayer("B", p)}
                      getPlayerValue={getMetric}
                      isPlayerRanked={isPlayerRanked}
                      sourceLabel={selectedSourceLabel}
                    />
                  }
                />
              </div>
            </div>

            {sideA.length > 0 || sideB.length > 0 ? (
              <div className="text-center mt-6">
                <button
                  onClick={() => {
                    setSideA([]);
                    setSideB([]);
                    setSelectedOwnerA("");
                    setSelectedOwnerB("");
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
                >
                  Clear Trade
                </button>
              </div>
            ) : null}

            {players && Object.keys(players).length > 0 ? (
              <div className="mt-10 bg-gray-900 p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-semibold mb-4">Top Available Players</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {topRecommendations.map((p) => (
                    <PlayerCard
                      key={p.player_id}
                      player={p}
                      value={getMetric(p)}
                      onAddA={() => addPlayer("A", p)}
                      onAddB={() => addPlayer("B", p)}
                    />
                  ))}
                </div>
              </div>
            ) : null}</div>
          </>
        )}
      </div>
    </>
  );
}
