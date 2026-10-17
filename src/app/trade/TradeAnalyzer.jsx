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
import LeagueSearchSelect from "../../components/LeagueSearchSelect";
import GuidedTips from "../../components/GuidedTips";
import { classifyLeagueFormat, classifyQbFormat } from "../../lib/leagueFormat";
import { makeGetPlayerValue } from "../../lib/values";
import { parsePickLabel, roundToOrdinal } from "../../lib/picks";
import {
  metricModeFromSourceKey,
  projectionSourceFromKey,
  valueSourceFromKey,
} from "../../lib/sourceSelection";
import { fantasyWeekFromNflState } from "../../lib/nflSeasonState";


function escapePrintHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMetric(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export default function TradeAnalyzer() {
  const { isConnected, syncNow } = useArsenalAccount();
  const {
    username,
    leagues,
    players,
    activeLeague,
    setActiveLeague,
    fetchLeagueRostersSilent,
    format,
    qbType,
    setFormat,
    setQbType,
    sourceKey,
    setSourceKey,
    getProjection,
    getWeeklyProjectionDetails,
    hasProjection,
    projectionScoring,
    preloadProjections,
    preloadWeeklyProjections,
  } = useSleeper();

  const metricMode = metricModeFromSourceKey(sourceKey);
  const projectionSource = projectionSourceFromKey(sourceKey);
  const valueSource = valueSourceFromKey(sourceKey);

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
  const [tradeLeagueData, setTradeLeagueData] = useState(null);
  const [tradeLeagueLoading, setTradeLeagueLoading] = useState(false);
  const [tradeLeagueError, setTradeLeagueError] = useState("");
  const [playerAddMessage, setPlayerAddMessage] = useState("");
  const [currentNflWeek, setCurrentNflWeek] = useState(1);
  const [projectionSeason, setProjectionSeason] = useState(new Date().getFullYear());
  const routeHandoffApplied = useRef(false);
  const [handoffContext, setHandoffContext] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("https://api.sleeper.app/v1/state/nfl", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((state) => {
        if (!active || !state) return;
        setCurrentNflWeek(fantasyWeekFromNflState(state));
        if (state.season) setProjectionSeason(Number(state.season));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const resetTrade = () => {
      setSideA([]);
      setSideB([]);
      setSelectedOwnerA("");
      setSelectedOwnerB("");
      setLeaguePickAssets({});
    };
    resetTrade();
    window.addEventListener("pageshow", resetTrade);
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (["analyzer", "finder", "block", "history", "market"].includes(requestedTab))
      setTradeTab(requestedTab);
    return () => window.removeEventListener("pageshow", resetTrade);
  }, []);

  useEffect(() => {
    if (metricMode !== "projections") {
      setProjLoading(false);
      setProjError("");
      return;
    }
    let mounted = true;
    setProjError("");
    setProjLoading(true);
    Promise.all([
      preloadProjections(projectionSource),
      preloadWeeklyProjections(projectionSource, projectionSeason).catch(() => null),
    ])
      .then(([index]) => {
        if (mounted && !index) setProjError(`${projectionSource} projections are currently unavailable.`);
      })
      .catch(() => {
        if (mounted) setProjError(`${projectionSource} projections are currently unavailable.`);
      })
      .finally(() => {
        if (mounted) setProjLoading(false);
      });
    return () => {
      mounted = false;
    };
    // preloadProjections is supplied by the shared context and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricMode, projectionSource, projectionSeason]);

  const handleLeagueChange = async (leagueId) => {
    setTradeLeagueId(leagueId || "");
    setActiveLeague(leagueId || null);
    if (leagueId) setSourceKey("proj:thefantasyarsenal-model");
    setSelectedOwnerA("");
    setSelectedOwnerB("");
    setLeaguePickAssets({});
    setTradeLeagueData(null);
    setTradeLeagueError("");
    setPlayerAddMessage("");
    if (leagueId) {
      setTradeLeagueLoading(true);
      let loaded;
      try {
        loaded = await fetchLeagueRostersSilent(leagueId);
      } catch {
        setTradeLeagueError("This league's rosters could not be loaded from Sleeper. Try selecting it again.");
        setTradeLeagueLoading(false);
        return;
      }
      const selectedLeague = {
        ...(leagues.find((item) => String(item.league_id) === String(leagueId)) || {}),
        ...(loaded || {}),
      };
      setTradeLeagueData(selectedLeague);
      setFormat(classifyLeagueFormat(selectedLeague).key === "dynasty" ? "dynasty" : "redraft");
      setQbType(classifyQbFormat(selectedLeague).key);
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
      setTradeLeagueLoading(false);
    } else {
      setTradeLeagueLoading(false);
    }
  };

  useEffect(() => {
    const nextLeagueId = String(activeLeague || "");
    if (nextLeagueId === String(tradeLeagueId || "")) return;
    if (nextLeagueId && !leagues.some((item) => String(item.league_id) === nextLeagueId)) return;
    handleLeagueChange(nextLeagueId);
    // handleLeagueChange intentionally refreshes all league-specific trade data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeague, leagues]);

  useEffect(() => {
    if (routeHandoffApplied.current || !leagues?.length) return;
    const params = new URLSearchParams(window.location.search);
    const requestedLeague = params.get("league") || "";
    const surplus = String(params.get("surplus") || "").toUpperCase();
    const need = String(params.get("need") || "").toUpperCase();
    if (!requestedLeague && !surplus && !need) {
      routeHandoffApplied.current = true;
      return;
    }
    routeHandoffApplied.current = true;
    if (surplus || need) setHandoffContext({ surplus, need });
    if (requestedLeague && leagues.some((item) => String(item.league_id) === requestedLeague))
      handleLeagueChange(requestedLeague);
    // Route values are a one-time handoff. Removing them prevents a later
    // visit to /trade from reapplying stale Intelligence constraints.
    window.history.replaceState({}, "", "/trade");
  }, [leagues]);

  const listedLeague = leagues.find(
    (lg) => String(lg.league_id) === String(tradeLeagueId),
  );
  const league =
    String(tradeLeagueData?.league_id || "") === String(tradeLeagueId || "")
      ? { ...(listedLeague || {}), ...tradeLeagueData }
      : listedLeague;
  const allOwners = league
    ? (league.rosters || []).map((roster) => ({
        user_id: String(roster.owner_id || ""),
        roster_id: String(roster.roster_id),
        selection_id: roster.owner_id
          ? String(roster.owner_id)
          : `roster:${String(roster.roster_id)}`,
        display_name: league.users?.find((u) => String(u.user_id) === String(roster.owner_id))?.display_name || `Unclaimed roster ${roster.roster_id}`,
        team_name: league.users?.find((u) => String(u.user_id) === String(roster.owner_id))?.metadata?.team_name || null,
        players: [
          ...new Set(
            [
              ...(roster.players || []),
              ...(roster.starters || []),
              ...(roster.reserve || []),
              ...(roster.taxi || []),
            ]
              .map(String)
              .filter((playerId) => playerId && playerId !== "0"),
          ),
        ],
      }))
    : [];

  const findOwner = (selectionId) => {
    const key = String(selectionId || "");
    if (!key) return null;
    return allOwners.find(
      (owner) =>
        owner.selection_id === key ||
        owner.user_id === key ||
        owner.roster_id === key,
    ) || null;
  };

  const getSideTitle = (side) => {
    if (side === "A" && selectedOwnerA) {
      const owner = findOwner(selectedOwnerA);
      return owner?.team_name || owner?.display_name || "Side A";
    }
    if (side === "B" && selectedOwnerB) {
      const owner = findOwner(selectedOwnerB);
      return owner?.team_name || owner?.display_name || "Side B";
    }
    return side === "A" ? "Side A" : "Side B";
  };

  const getPlayerValue = useMemo(() => makeGetPlayerValue(valueSource, format, qbType, projectionScoring), [valueSource, format, qbType, projectionScoring]);
  const getFallbackTradeValue = useMemo(() => makeGetPlayerValue("FantasyCalc", format, qbType, projectionScoring), [format, qbType, projectionScoring]);
  const leagueScoringSettings = league?.scoring_settings || null;
  const hasLeagueScoring = Boolean(
    tradeLeagueId && Object.keys(leagueScoringSettings || {}).length,
  );
  const exactLeagueStatProjection = ["ARSENAL_MODEL", "ARSENAL_RISKY", "SLEEPER"].includes(
    projectionSource,
  );
  const estimatedLeagueStatProjection = ["FANTASYPROS", "DRAFTSHARKS", "FANTASYSHARKS"].includes(
    projectionSource,
  );
  const usesLeagueRescoring = Boolean(
    hasLeagueScoring && (exactLeagueStatProjection || estimatedLeagueStatProjection),
  );

  const getMetric = useMemo(() => {
    if (metricMode === "projections") {
      if (usesLeagueRescoring) {
        return (player) => {
          if (!hasProjection?.(player, projectionSource)) return 0;
          let remainingTotal = 0;
          for (let week = currentNflWeek; week <= 18; week += 1) {
            const details = getWeeklyProjectionDetails(
              player,
              projectionSource,
              week,
              {
                season: projectionSeason,
                scoring: projectionScoring,
                scoringSettings: leagueScoringSettings,
                qbType,
              },
            );
            if (details?.projectionRow?.completed) continue;
            remainingTotal += Number(details?.points || 0);
          }
          return remainingTotal;
        };
      }
      return (p) => getProjection(p, projectionSource) || 0;
    }
    return (p) => getPlayerValue(p) || 0;
  }, [
    metricMode,
    projectionSource,
    getPlayerValue,
    getProjection,
    getWeeklyProjectionDetails,
    hasProjection,
    usesLeagueRescoring,
    currentNflWeek,
    projectionSeason,
    projectionScoring,
    leagueScoringSettings,
    qbType,
  ]);
  const getFinderMetric = useMemo(() => (player) => Number(getMetric(player) || getFallbackTradeValue(player) || 0), [getMetric, getFallbackTradeValue]);

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
  const selectedSource = DEFAULT_SOURCES.find((source) => source.key === sourceKey);
  const selectedSourceLabel = selectedSource
    ? `${selectedSource.label}${selectedSource.productLabel ? ` · ${selectedSource.productLabel}` : ""}`
    : sourceKey || "Selected source";
  const projectionContextMessage = !hasLeagueScoring
    ? "Comparing sides with season projection totals."
    : exactLeagueStatProjection
      ? `Remaining Weeks ${currentNflWeek}–18 are recalculated from ${selectedSourceLabel} weekly stat lines using ${league?.name || "the selected league"} scoring.`
      : estimatedLeagueStatProjection
        ? `Remaining Weeks ${currentNflWeek}–18 use ${selectedSourceLabel}'s raw season stat projections and ${league?.name || "the selected league"} scoring. The per-game estimate respects byes; unsupported categories are not invented.`
        : `${selectedSourceLabel} does not expose enough raw stats for league rescoring. Its result is unchanged from using the calculator without a selected league.`;
  const isPlayerRanked = (player) => {
    if (metricMode === "projections") {
      return hasProjection?.(player, projectionSource) ?? getMetric(player) > 0;
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
    const favoredAssets = tradeValueA > tradeValueB ? sideA : sideB;
    const favoredSide = tradeValueA > tradeValueB ? getSideTitle("A") : getSideTitle("B");
    const shortSide = tradeValueA < tradeValueB ? getSideTitle("A") : getSideTitle("B");
    const candidates = favoredAssets
      .filter((player) =>
        ["QB", "RB", "WR", "TE"].includes(
          String(player?.position || "").toUpperCase(),
        ),
      )
      .map((player) => ({ player, value: Number(getMetric(player) || 0) }))
      .filter((row) => row.value > 0)
      .sort((a, b) => Math.abs(a.value - gap) - Math.abs(b.value - gap));
    const closest = candidates[0];
    if (!closest || Math.abs(closest.value - gap) / gap > 0.25) return null;
    const name =
      closest.player.full_name ||
      closest.player.search_full_name ||
      "premium starter";
    const templates = [
      `${favoredSide} is ahead by roughly the entire value of ${name} — and ${name} is already in this trade.`,
      `This is basically ${name} being included for free on the ${favoredSide} side.`,
      `Take ${name} out of the ${favoredSide} package and this gets much closer to even.`,
      `The advantage is about one whole ${name}, who is part of the deal itself.`,
      `${shortSide} is effectively giving up an extra ${name}-sized piece in this very trade.`,
      `${name} is not just a throw-in here — their value is roughly the entire gap.`,
      `The imbalance is nearly the value of ${name}, one of the players actually changing hands.`,
      `In practical terms, the ${favoredSide} side is winning by about the included ${name}.`,
      `You could almost remove ${name} from ${favoredSide} and land near midfield.`,
      `That margin is a whole real asset from this deal: approximately ${name}.`,
    ];
    const seed = `${sourceKey}:${favoredAssets.map((asset) => asset.player_id || asset.full_name).join("|")}:${Math.round(gap)}`;
    const index = [...seed].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7) % templates.length;
    return { text: templates[index], name, value: closest.value };
  }, [getMetric, sideA, sideB, sourceKey, tradeValueA, tradeValueB]);
  const getWeeklyMetric = useMemo(() => {
    if (metricMode !== "projections") return (p) => Math.sqrt(Math.max(0, getMetric(p)));
    // Partner Finder compares durable roster strength, not this week's lineup.
    // A bye or one difficult matchup must not make a season-long asset expendable.
    const remainingWeeks = usesLeagueRescoring ? Math.max(1, 19 - currentNflWeek) : 17;
    return (p) => getMetric(p) / remainingWeeks;
  }, [getMetric, metricMode, usesLeagueRescoring, currentNflWeek]);

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
    const playerId = String(player.player_id || "");
    if (
      (side === "A" && sideA.some((item) => String(item.player_id) === playerId)) ||
      (side === "B" && sideB.some((item) => String(item.player_id) === playerId))
    ) {
      setPlayerAddMessage(`${player.full_name || "That player"} is already on Side ${side}.`);
      return;
    }
    const isDraftPick = String(player.position || "").toUpperCase() === "PICK";

    const ownerA = findOwner(selectedOwnerA);
    const ownerB = findOwner(selectedOwnerB);

    if (tradeLeagueId) {
      const playerOwner = !isDraftPick
        ? allOwners.find((owner) => owner.players.includes(playerId))
        : allOwners.find(
            (owner) => owner.roster_id === String(player.league_pick_owner_roster_id || ""),
          );
      if (!playerOwner) {
        setPlayerAddMessage(
          `${player.full_name || "That asset"} is not currently owned in ${league?.name || "this league"}, so it cannot be added to a roster-to-roster trade.`,
        );
        return;
      }

      if (ownerA && ownerB) {
        const allowedOwner = side === "A" ? ownerA : ownerB;
        if (isDraftPick) {
          if (String(player.league_pick_owner_roster_id || "") !== allowedOwner.roster_id) {
            setPlayerAddMessage(`${player.full_name || "That pick"} belongs to ${playerOwner.display_name}, not ${allowedOwner.display_name}.`);
            return;
          }
        } else if (!allowedOwner.players.includes(playerId)) {
          setPlayerAddMessage(`${player.full_name || "That player"} belongs to ${playerOwner.display_name}, not ${allowedOwner.display_name}.`);
          return;
        }
      } else if (ownerA && !ownerB) {
        const ownedByA = isDraftPick
          ? String(player.league_pick_owner_roster_id || "") === ownerA.roster_id
          : ownerA.players.includes(playerId);
        if ((side === "A" && !ownedByA) || (side === "B" && ownedByA)) {
          setPlayerAddMessage(
            side === "A"
              ? `${player.full_name || "That asset"} is not on ${ownerA.display_name}'s roster.`
              : `${player.full_name || "That asset"} is already owned by Side A.`,
          );
          return;
        }
      } else if (ownerB && !ownerA) {
        const ownedByB = isDraftPick
          ? String(player.league_pick_owner_roster_id || "") === ownerB.roster_id
          : ownerB.players.includes(playerId);
        if ((side === "B" && !ownedByB) || (side === "A" && ownedByB)) {
          setPlayerAddMessage(
            side === "B"
              ? `${player.full_name || "That asset"} is not on ${ownerB.display_name}'s roster.`
              : `${player.full_name || "That asset"} is already owned by Side B.`,
          );
          return;
        }
      }

      if (playerOwner) {
        if (side === "A" && !selectedOwnerA) setSelectedOwnerA(playerOwner.selection_id);
        if (side === "B" && !selectedOwnerB) setSelectedOwnerB(playerOwner.selection_id);
      }
    }

    setPlayerAddMessage("");
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
    const ownerA = findOwner(selectedOwnerA);
    const ownerB = findOwner(selectedOwnerB);
    if (ownerA && ownerB) {
      const source = recSide === "A" ? ownerA : ownerB;
      candidatePool = (source.players || []).map((pid) => players[pid]).filter(Boolean);
    } else if (ownerA || ownerB) {
      const exclude = new Set((ownerA || ownerB)?.players || []);
      candidatePool = allOwners
        .flatMap((owner) => owner.players)
        .filter((playerId) => !exclude.has(String(playerId)))
        .map((playerId) => players[playerId])
        .filter(Boolean);
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
      metricMode === "projections"
        ? []
        :
      Object.entries(leaguePickAssets).filter(
        ([, pick]) =>
          !owner ||
          String(pick.league_pick_owner_roster_id) === String(owner.roster_id),
      );
    const withPicks = (map, owner) =>
      Object.fromEntries([...Object.entries(map), ...picksFor(owner)]);
    const playersForOwners = (owners) =>
      owners.reduce((map, owner) => {
        owner.players.forEach((playerId) => {
          if (players[playerId]) map[playerId] = players[playerId];
        });
        return map;
      }, {});
    const ownerA = findOwner(selectedOwnerA);
    const ownerB = findOwner(selectedOwnerB);
    if (ownerA && ownerB) {
      const source = side === "A" ? ownerA : ownerB;
      return withPicks(playersForOwners([source]), source);
    }
    if (ownerA && !ownerB) {
      return side === "A"
        ? withPicks(playersForOwners([ownerA]), ownerA)
        : withPicks(
            playersForOwners(allOwners.filter((owner) => owner.roster_id !== ownerA.roster_id)),
            null,
          );
    }
    if (ownerB && !ownerA) {
      return side === "B"
        ? withPicks(playersForOwners([ownerB]), ownerB)
        : withPicks(
            playersForOwners(allOwners.filter((owner) => owner.roster_id !== ownerB.roster_id)),
            null,
          );
    }
    // Before a side is identified, player search covers only rostered players.
    // Typing a player selects that roster; draft picks appear after an owner is selected.
    return playersForOwners(allOwners);
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
      sideASnapshots:sideA,
      sideBSnapshots:sideB,
      valueA:tradeValueA,
      valueB:tradeValueB,
      sourceKey,
      outcome:"Open",
    };
    localStorage.setItem(key, JSON.stringify([item, ...current].slice(0, 30)));
    window.dispatchEvent(new CustomEvent("tfa:trade-workspaces-updated", { detail:{ key } }));
    const syncResult = await syncNow({ quiet:true });
    setSaveMessage(syncResult?.ok
      ? "Trade saved and synced to your Arsenal account."
      : "Trade saved on this device, but Arsenal account sync did not complete yet.");
  };

  const printTradeSummary = () => {
    if (!sideA.length && !sideB.length) {
      setSaveMessage("Add at least one asset before printing the trade.");
      return;
    }
    const printWindow = window.open("", "_blank", "width=1000,height=800");
    if (!printWindow) {
      setSaveMessage("Your browser blocked the print window. Allow pop-ups and try again.");
      return;
    }
    printWindow.opener = null;
    const valueText = formatMetric;
    const assetRows = (assets) => assets.map((player) => {
      const name = player.full_name || player.search_full_name || player.player_id || "Unknown asset";
      const detail = [player.position, player.team].filter(Boolean).join(" · ");
      return `<div class="asset"><div><b>${escapePrintHtml(name)}</b>${detail ? `<small>${escapePrintHtml(detail)}</small>` : ""}</div><strong>${escapePrintHtml(valueText(getMetric(player)))}</strong></div>`;
    }).join("") || '<div class="empty">No assets</div>';
    const titleA = getSideTitle("A");
    const titleB = getSideTitle("B");
    const verdict = favoredSide === "EVEN" ? "Even trade" : `${getSideTitle(favoredSide)} favored`;
    printWindow.document.write(`<!doctype html><html><head><title>Trade Summary · The Fantasy Arsenal</title><style>
      @page{size:auto;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#172033;font-family:Inter,Arial,sans-serif;background:#fff;font-size:12px}header{border-bottom:4px solid #16a9bd;padding-bottom:16px;margin-bottom:20px}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#168ca0}h1{font-size:29px;margin:5px 0 3px}header p{margin:0;color:#667085}.sides{display:grid;grid-template-columns:1fr 1fr;gap:16px}.side{border:1px solid #d8e1ea;border-radius:14px;overflow:hidden;break-inside:avoid}.side h2{margin:0;padding:13px 15px;background:#f1f7fa;font-size:17px}.side-b h2{background:#f9f1f4}.assets{padding:4px 15px}.asset{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:11px 0;border-bottom:1px solid #e8edf2}.asset:last-child{border-bottom:0}.asset b{display:block;font-size:13px}.asset small{display:block;margin-top:3px;color:#7a8797;font-size:9px}.asset strong{font-size:14px}.empty{padding:18px 0;color:#8793a2}.total{display:flex;justify-content:space-between;padding:13px 15px;border-top:2px solid #cdd9e3;background:#fafcfd;font-size:16px}.balance{margin-top:20px;padding:17px;border:1px solid #d8e1ea;border-radius:14px;break-inside:avoid}.balance-top{display:flex;justify-content:space-between;align-items:end;gap:20px}.balance h2{margin:3px 0 0;font-size:19px}.source{color:#667085;font-size:10px}.labels{display:flex;justify-content:space-between;margin-top:17px;font-weight:800}.bar{position:relative;height:42px;margin-top:8px;border:2px solid #263648;border-radius:10px;overflow:visible;background:linear-gradient(90deg,#20b8cb 0%,#126c81 var(--marker),#6d3fa0 var(--marker),#be4161 100%)}.bar:after{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.75)}.football{position:absolute;z-index:2;left:var(--marker);top:50%;width:36px;height:36px;display:grid;place-items:center;transform:translate(-50%,-50%);border:2px solid #f2c66d;border-radius:50%;background:#172033;font-size:21px;color:#fff}.footer{margin-top:22px;padding-top:10px;border-top:1px solid #d8e1ea;color:#7a8797;font-size:9px}@media(max-width:650px){.sides{grid-template-columns:1fr}}@media print{.side,.balance{break-inside:avoid}}
    </style></head><body><header><div class="eyebrow">The Fantasy Arsenal · Trade Analyzer</div><h1>Trade Summary</h1><p>${escapePrintHtml(selectedSourceLabel)}${league?.name ? ` · ${escapePrintHtml(league.name)}` : ""}</p></header><main><div class="sides"><section class="side"><h2>${escapePrintHtml(titleA)}</h2><div class="assets">${assetRows(sideA)}</div><div class="total"><b>Total value</b><strong>${escapePrintHtml(valueText(tradeValueA))}</strong></div></section><section class="side side-b"><h2>${escapePrintHtml(titleB)}</h2><div class="assets">${assetRows(sideB)}</div><div class="total"><b>Total value</b><strong>${escapePrintHtml(valueText(tradeValueB))}</strong></div></section></div><section class="balance" style="--marker:${footballPosition}%"><div class="balance-top"><div><div class="eyebrow">Trade balance meter</div><h2>${escapePrintHtml(verdict)} · ${escapePrintHtml(favoredPercentage.toFixed(1))}%</h2></div><div class="source">Based on ${escapePrintHtml(selectedSourceLabel)}</div></div><div class="labels"><span>${escapePrintHtml(titleA)} · ${sideAPercentage.toFixed(1)}%</span><span>${(100-sideAPercentage).toFixed(1)}% · ${escapePrintHtml(titleB)}</span></div><div class="bar"><div class="football">&#127944;</div></div></section></main><div class="footer">Generated by The Fantasy Arsenal. Values reflect the selected source and league settings at the time of printing.</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);
    printWindow.document.close();
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
              <details data-guide-tip="trade-model" className="premium-disclosure">
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
                    projectionHorizon={usesLeagueRescoring ? "remaining" : "season"}
                  />
                </div>
                <div className="mt-2 text-xs text-white/60">
                  {projError && metricMode === "projections"
                    ? projError
                    : projLoading && metricMode === "projections"
                    ? "Loading projection inputs..."
                    : metricMode === "projections"
                    ? projectionContextMessage
                    : "Comparing sides with the selected trade market."}
                </div>
                {tradeLeagueId ? (
                  <div
                    className={`mt-3 rounded-2xl border p-3 text-xs leading-5 ${
                      metricMode !== "projections" || !usesLeagueRescoring
                        ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-50/75"
                        : estimatedLeagueStatProjection
                          ? "border-violet-300/20 bg-violet-300/[0.06] text-violet-50/75"
                          : "border-emerald-300/20 bg-emerald-300/[0.055] text-emerald-50/75"
                    }`}
                  >
                    {metricMode !== "projections" ? (
                      <><b className="text-amber-100">League scoring is not applied to market values.</b> This source still works, but its number is the same as using it without a selected league.</>
                    ) : !hasLeagueScoring ? (
                      <><b className="text-amber-100">League scoring settings are unavailable.</b> The selected projection still works, but it cannot be recalculated for this league.</>
                    ) : exactLeagueStatProjection ? (
                      <><b className="text-emerald-100">Weekly league scoring active.</b> This source exposes weekly stat lines that are recalculated with the selected league&apos;s settings.</>
                    ) : estimatedLeagueStatProjection ? (
                      <><b className="text-violet-100">Season-stat league scoring active.</b> Available raw season stats are rescored and converted to a bye-aware per-game estimate. Unsupported categories remain excluded instead of being guessed.</>
                    ) : (
                      <><b className="text-amber-100">This source cannot be recalculated.</b> It still works, but the result is the same as using it without a selected league. Choose Arsenal Safe or Boom / Bust for full league scoring.</>
                    )}
                  </div>
                ) : null}
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

              <div data-guide-tip="trade-league" className="rounded-2xl border border-white/10 bg-gray-900 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">League Context</div>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs text-white/55">Choose a league for roster-aware trading</label>
                    <LeagueSearchSelect leagues={leagues} value={tradeLeagueId} onChange={handleLeagueChange} />
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
                {tradeLeagueLoading ? (
                  <div className="mt-3 text-xs font-semibold text-cyan-100">Loading every roster in this league…</div>
                ) : null}
                {tradeLeagueError ? (
                  <div className="mt-3 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-3 text-xs text-rose-100">{tradeLeagueError}</div>
                ) : null}
                {tradeLeagueId && !tradeLeagueLoading ? (
                  <div
                    className={`mt-3 rounded-xl border px-3 py-3 text-xs leading-5 ${
                      exactLeagueStatProjection && hasLeagueScoring
                        ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-50/80"
                        : estimatedLeagueStatProjection && hasLeagueScoring
                          ? "border-violet-300/20 bg-violet-300/[0.06] text-violet-50/80"
                          : "border-amber-300/20 bg-amber-300/[0.06] text-amber-50/80"
                    }`}
                  >
                    {exactLeagueStatProjection && hasLeagueScoring ? (
                      <>
                        <b className="text-emerald-100">League scoring is active.</b>{" "}
                        {selectedSourceLabel} exposes weekly projected stats, so this league&apos;s scoring settings are being applied.
                      </>
                    ) : estimatedLeagueStatProjection && hasLeagueScoring ? (
                      <>
                        <b className="text-violet-100">League scoring estimate is active.</b>{" "}
                        {selectedSourceLabel} exposes season stat projections. Those stats are rescored for this league and converted to a bye-aware per-game rate. Arsenal Safe, Boom / Bust, and Sleeper are more matchup-specific because they expose weekly stat lines.
                      </>
                    ) : (
                      <>
                        <b className="text-amber-100">For a league-scoring comparison, use Arsenal Safe, Boom / Bust, Sleeper, FantasyPros, DraftSharks, or FantasySharks.</b>{" "}
                        Those sources expose stat projections that can be recalculated. {selectedSourceLabel} uses its standard number without this league&apos;s scoring.
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div data-guide-tip="trade-tabs" className="mb-4 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-2"><div className="flex w-max gap-1">{[["analyzer","Analyzer"],["finder","Partner Finder"],["workspace","Saved Trades"],["block","Trade Block"],["history","Trade History"],["market","League Market"]].map(([key,label])=><button type="button" key={key} onClick={()=>setTradeTab(key)} className={`min-h-11 rounded-xl px-5 text-sm font-black ${tradeTab===key?"bg-cyan-300/10 text-cyan-100":"text-white/40"}`}>{label}</button>)}</div></div>

            {tradeTab !== "analyzer" ? <div><TradeWorkspaceSuite
              league={league}
              players={players}
              getMetric={getMetric}
              finderMetric={getFinderMetric}
              getWeeklyMetric={getWeeklyMetric}
              metricMode={metricMode}
              username={username}
              sideA={sideA}
              sideB={sideB}
              selectedOwnerA={selectedOwnerA}
              selectedOwnerB={selectedOwnerB}
              sourceKey={sourceKey}
              onLoadPackage={(nextA, nextB, ownerA, ownerB, savedSourceKey) => {
                setSideA(nextA || []);
                setSideB(nextB || []);
                setSelectedOwnerA(ownerA || "");
                setSelectedOwnerB(ownerB || "");
                if (savedSourceKey) setSourceKey(savedSourceKey);
                setTradeTab("analyzer");
              }}
              initialTab={tradeTab === "analyzer" ? "finder" : tradeTab}
              handoffContext={handoffContext}
              onClearHandoff={() => setHandoffContext(null)}
              hideNavigation
            /></div> : null}

            <div data-guide-tip="trade-analyzer" className={tradeTab === "analyzer" ? "block" : "hidden"}><div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-gray-900 p-4 md:grid-cols-3">
              <div className="rounded-xl bg-[#0f2134] px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-blue-200/60">Side A</div>
                <div className="mt-1 text-2xl font-semibold text-white">{formatMetric(tradeValueA)}</div>
              </div>
              <div className="rounded-xl bg-[#2b1518] px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-rose-200/60">Side B</div>
                <div className="mt-1 text-2xl font-semibold text-white">{formatMetric(tradeValueB)}</div>
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
              <button type="button" onClick={printTradeSummary} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-black text-white/65">Print / save PDF</button>
              {saveMessage ? <span className="text-xs text-white/45">{saveMessage}</span> : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                {tradeLeagueId ? (
                  <select
                    value={selectedOwnerA}
                    onChange={(e) => {
                      setSelectedOwnerA(e.target.value);
                      setPlayerAddMessage("");
                    }}
                    data-account-persist="off"
                    aria-label="Trade Analyzer Side A owner"
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Side A owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.roster_id} value={owner.selection_id} disabled={!owner.players.length}>
                        {owner.display_name} ({owner.players.length} players{owner.players.length ? "" : " · empty roster"})
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
                      browseLabel={
                        selectedOwnerA
                          ? `${getSideTitle("A")} roster`
                          : "Eligible players · selecting one finds their team"
                      }
                      browseOnFocus={!tradeLeagueId || Boolean(selectedOwnerA)}
                      focusHint={
                        tradeLeagueId && !selectedOwnerA
                          ? "Start typing a rostered player's name. Selecting that player will identify and select their team automatically."
                          : ""
                      }
                    />
                  }
                />
              </div>

              <div>
                {tradeLeagueId ? (
                  <select
                    value={selectedOwnerB}
                    onChange={(e) => {
                      setSelectedOwnerB(e.target.value);
                      setPlayerAddMessage("");
                    }}
                    data-account-persist="off"
                    aria-label="Trade Analyzer Side B owner"
                    className="bg-gray-800 text-white p-2 rounded mb-4 w-full"
                  >
                    <option value="">Select Side B owner</option>
                    {allOwners.map((owner) => (
                      <option key={owner.roster_id} value={owner.selection_id} disabled={!owner.players.length}>
                        {owner.display_name} ({owner.players.length} players{owner.players.length ? "" : " · empty roster"})
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
                      browseLabel={
                        selectedOwnerB
                          ? `${getSideTitle("B")} roster`
                          : "Eligible players · selecting one finds their team"
                      }
                      browseOnFocus={!tradeLeagueId || Boolean(selectedOwnerB)}
                      focusHint={
                        tradeLeagueId && !selectedOwnerB
                          ? "Start typing a rostered player's name. Selecting that player will identify and select their team automatically."
                          : ""
                      }
                    />
                  }
                />
              </div>
            </div>

            {playerAddMessage ? (
              <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-50/85">
                {playerAddMessage}
              </div>
            ) : null}

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

            {!tradeLeagueId && players && Object.keys(players).length > 0 ? (
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
        {username ? <GuidedTips storageKey="tfa:tips:trade-analyzer" label="Trade Analyzer tips" steps={[
          { target:"trade-league", title:"Add league context", detail:"Choose a league when you want roster-aware trading. This identifies each manager's roster, available roster space, team needs, draft picks, and the league's scoring and quarterback format." },
          { target:"trade-model", title:"Choose the evaluation lens", detail:"Model Settings controls the value or projection source, dynasty or redraft format, quarterback setup, and negotiation cushion. Every tab uses this same active lens." },
          { target:"trade-analyzer", scrollBlock:"start", title:"Analyzer: build a specific deal", detail:"Add assets to both sides or select league managers to work from their rosters. The balance meter compares the active source, suggests gap-closing additions, and lets you save or print the result.", onEnter:()=>setTradeTab("analyzer") },
          { target:"trade-finder", title:"Partner Finder: discover workable packages", detail:"Partner Finder ranks trades by both teams' needs, lineup impact, direction, roster limits, picks, and value. Load any idea into Analyzer when you want to edit it.", onEnter:()=>setTradeTab("finder") },
          { target:"trade-workspace", title:"Saved Trades: manage negotiations", detail:"Saved Trades is available without an Arsenal account. In guest or portfolio-only use, versions, notes, sources, and outcomes are saved only in this browser and depend on its storage/privacy settings; clearing site data can remove them. When signed into an Arsenal account, these trade workspaces are included in automatic account sync so they can follow you across supported devices. Reopen any version in Analyzer to continue without rebuilding it.", onEnter:()=>setTradeTab("workspace") },
          { target:"trade-block", title:"Trade Block: start with what you will move", detail:"Select players you are willing to discuss and the positions or picks you want back. The tool generates matching offers locally and can copy a private board link; it does not post to Sleeper.", onEnter:()=>setTradeTab("block") },
          { target:"trade-history", title:"Trade History: review completed deals", detail:"Review the league's completed trades one by one, including players and picks. Current values are labeled as current; fair-at-the-time values appear only where archived data exists.", onEnter:()=>setTradeTab("history") },
          { target:"trade-market", title:"League Market: understand trading behavior", detail:"League Market summarizes the same completed-deal sample into volume, package size, frequently traded positions, active managers, and repeated trading relationships. Finishing or closing returns to Analyzer.", onEnter:()=>{setTradeTab("market");return()=>setTradeTab("analyzer");} },
        ]} /> : null}
      </div>
    </>
  );
}
