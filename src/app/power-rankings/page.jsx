"use client";

import { useEffect, useMemo, useState } from "react";
import { useSleeper } from "../../context/SleeperContext";
import Navbar from "../../components/Navbar";
import BackgroundParticles from "../../components/BackgroundParticles";
import ValueSourceDropdown from "../../components/ValueSourceDropdown";

/** Value sources support */
const VALUE_SOURCES = {
  FantasyCalc:        { label: "FantasyCalc",        supports: { dynasty: true,  redraft: true,  qbToggle: true  } },
  DynastyProcess:     { label: "DynastyProcess",     supports: { dynasty: true,  redraft: false, qbToggle: true  } },
  KeepTradeCut:       { label: "KeepTradeCut",       supports: { dynasty: true,  redraft: false, qbToggle: true  } },
  FantasyNavigator:   { label: "FantasyNavigator",   supports: { dynasty: true,  redraft: true,  qbToggle: true  } },
  IDynastyP:          { label: "IDynastyP",          supports: { dynasty: true,  redraft: false, qbToggle: true  } },
};

const OFF_POS = ["QB","RB","WR","TE"];
const IDP_POS  = ["DL","LB","DB","DT","DE","CB","S"];
const isIDP  = (pos) => pos && IDP_POS.includes(pos.toUpperCase());
const isPick = (pos) => (pos || "").toUpperCase() === "PICK";

/* ===========================
   Small UI helpers
=========================== */
const ORD = ["","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th","13th","14th","15th","16th","17th","18th","19th","20th"];
const toOrdinal = (n) => ORD[n] || `${n}th`;

function SectionTitle({ children, subtitle }) {
  return (
    <div className="mt-8 mb-3">
      <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight">
        {children}
      </h2>
      {subtitle ? <div className="text-xs sm:text-sm opacity-70 mt-1">{subtitle}</div> : null}
    </div>
  );
}
function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-white/10 bg-gray-900 ${className}`}>{children}</div>;
}

/** Compact, responsive pill; can be hidden via className on breakpoints */
function StatPill({ label, value, hint, className = "" }) {
  return (
    <div className={`min-w-0 flex items-center justify-between gap-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] sm:text-xs ${className}`}>
      <span className="uppercase tracking-wide opacity-70 truncate">{label}</span>
      <span className="font-semibold shrink-0">{(value ?? 0).toLocaleString()}</span>
      {hint ? <span className="opacity-60 shrink-0">({hint})</span> : null}
    </div>
  );
}

function Bar({ pct, from="from-blue-500", to="to-cyan-400" }) {
  return (
    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
      <div className={`h-full bg-gradient-to-r ${from} ${to}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
function StackedMini({ parts }) {
  const total = parts.reduce((s,p)=>s+(p.value||0),0) || 1;
  return (
    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden flex">
      {parts.map((p,i)=>(
        <div key={i} className={p.className} style={{width:`${(100*(p.value||0)/total).toFixed(2)}%`}}/>
      ))}
    </div>
  );
}

/** Mobile accordion wrapper */
function MobileAccordion({ title, children, defaultOpen=false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o=>!o)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <span className="font-semibold">{title}</span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path d="M5.23 7.21a.75.75 0 011.06.02L10 10.17l3.71-2.94a.75.75 0 01.92 1.18l-4.25 3.37a.75.75 0 01-.92 0L5.21 8.41a.75.75 0 01.02-1.2z"/>
        </svg>
      </button>
      <div className={`${open ? "block" : "hidden"} border-t border-white/10 p-4`}>{children}</div>
    </Card>
  );
}

/* ===========================
   Values + ages
=========================== */
function makeGetPlayerValue(valueSource, format, qbType) {
  return (p) => {
    if (!p) return 0;
    if (valueSource === "FantasyCalc") {
      return format === "dynasty"
        ? (qbType === "sf" ? p.fc_values?.dynasty_sf : p.fc_values?.dynasty_1qb)
        : (qbType === "sf" ? p.fc_values?.redraft_sf : p.fc_values?.redraft_1qb);
    }
    if (valueSource === "DynastyProcess") {
      return qbType === "sf" ? (p.dp_values?.superflex || 0) : (p.dp_values?.one_qb || 0);
    }
    if (valueSource === "KeepTradeCut") {
      return qbType === "sf" ? (p.ktc_values?.superflex || 0) : (p.ktc_values?.one_qb || 0);
    }
    if (valueSource === "FantasyNavigator") {
      return format === "dynasty"
        ? (qbType === "sf" ? p.fn_values?.dynasty_sf : p.fn_values?.dynasty_1qb)
        : (qbType === "sf" ? p.fn_values?.redraft_sf : p.fn_values?.redraft_1qb);
    }
    if (valueSource === "IDynastyP") {
      return qbType === "sf" ? (p.idp_values?.superflex || 0) : (p.idp_values?.one_qb || 0);
    }
    if (valueSource === "TheFantasyArsenal") {
      return format === "dynasty"
        ? (qbType === "sf" ? (p.sp_values?.dynasty_sf || 0) : (p.sp_values?.dynasty_1qb || 0))
        : (qbType === "sf" ? (p.sp_values?.redraft_sf || 0) : (p.sp_values?.redraft_1qb || 0));
    }
    return 0;
  };
}

/** Picks often exist in only some sources. Try current source first, then fall back so value isn't 0. */
function getAnyPickValue(p, valueSource, format, qbType) {
  if (!p) return 0;
  const tryOrder = [
    valueSource,
    "TheFantasyArsenal",
    "FantasyCalc",
    "DynastyProcess",
    "KeepTradeCut",
    "FantasyNavigator",
    "IDynastyP",
  ];
  for (const src of tryOrder) {
    const v = makeGetPlayerValue(src, format, qbType)(p);
    if (v && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

function getPlayerAge(p) {
  if (!p) return null;
  if (typeof p.age === "number" && Number.isFinite(p.age)) return p.age;
  const bd = p.birth_date || p.birthdate || p.birthYear || null;
  if (!bd) return null;
  let y, m=1, d=1;
  if (typeof bd === "string" && /^\d{4}-\d{2}-\d{2}/.test(bd)) {
    const [yy, mm, dd] = bd.split("-").map(Number);
    y = yy; m = mm; d = dd;
  } else if (typeof bd === "string" && /^\d{4}$/.test(bd)) {
    y = Number(bd);
  } else if (typeof bd === "number") {
    y = bd;
  } else return null;
  const birth = new Date(y, (m-1)||0, d||1).getTime();
  const now = Date.now();
  const years = (now - birth) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, Math.round(years * 10) / 10);
}

/* ===========================
   Picks: Build current ownership
=========================== */
async function getOwnedPicksByRoster(leagueId) {
  const league   = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json());
  const rosters  = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json());
  const rounds   = league?.settings?.rounds || 4;

  const byRoster = {};
  for (const r of rosters) byRoster[r.roster_id] = [];

  const traded = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`).then(r => r.json()).catch(() => []);
  const tradedSeasons = new Set(traded.map(t => String(t.season)));

  const drafts = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json()).catch(() => []);
  const inDraftAll = [];
  for (const d of drafts) {
    try {
      const inDraft = await fetch(`https://api.sleeper.app/v1/draft/${d.draft_id}/traded_picks`).then(r => r.json());
      inDraftAll.push(...inDraft);
    } catch {}
  }
  const inDraftSeasons = new Set(inDraftAll.map(t => String(t.season)));

  const seasonsSet = new Set([...tradedSeasons, ...inDraftSeasons]);
  if (seasonsSet.size === 0) return byRoster;

  const seasons = [...seasonsSet].sort();
  for (const r of rosters) {
    for (const yr of seasons) {
      for (let rd = 1; rd <= rounds; rd++) {
        byRoster[r.roster_id].push({
          season: String(yr),
          round: rd,
          original_roster_id: r.roster_id,
          owner_roster_id: r.roster_id,
        });
      }
    }
  }

  const movePick = ({ season: s, round: rd, fromRoster, toRoster }) => {
    s = String(s);
    const arr = byRoster[fromRoster] || [];
    const idx = arr.findIndex(
      (p) => p.season === s && p.round === rd && p.owner_roster_id === fromRoster
    );
    if (idx >= 0) {
      const [pick] = arr.splice(idx, 1);
      pick.owner_roster_id = toRoster;
      if (!byRoster[toRoster]) byRoster[toRoster] = [];
      byRoster[toRoster].push(pick);
    }
  };

  traded.forEach(t => {
    if (!seasonsSet.has(String(t.season))) return;
    movePick({ season: t.season, round: t.round, fromRoster: t.roster_id, toRoster: t.owner_id });
  });
  inDraftAll.forEach(t => {
    if (!seasonsSet.has(String(t.season))) return;
    movePick({ season: t.season, round: t.round, fromRoster: t.roster_id, toRoster: t.owner_id });
  });

  return byRoster;
}

function indexPickPlayers(playersMap) {
  const idx = new Map();
  const picks = Object.values(playersMap || {}).filter(p => isPick(p.position));
  const yearRegex  = /(20\d{2})/;
  const ordToNum   = { first:1, 1:1, "1st":1, second:2, 2:2, "2nd":2, third:3, 3:3, "3rd":3, fourth:4, 4:4, "4th":4, fifth:5, 5:5, "5th":5, sixth:6, 6:6, "6th":6, seventh:7, 7:7, "7th":7 };
  const roundRegexes = [
    /\bround\s+(1|2|3|4|5|6|7|1st|2nd|3rd|4th|5th|6th|7th)\b/i,
    /\br(1|2|3|4|5|6|7)\b/i,
    /\b(1st|2nd|3rd|4th|5th|6th|7th|first|second|third|fourth|fifth|sixth|seventh)\b/i,
    /\b(1|2|3|4|5|6|7)(?:st|nd|rd|th)\s*round\b/i,
  ];

  const norm = (s) => (s || "").toLowerCase();
  const bucketOf = (nameLow) => {
    if (/\bmid(dle)?\b/i.test(nameLow)) return "mid";
    if (/\blate\b/i.test(nameLow)) return "late";
    if (/\bearly\b/i.test(nameLow)) return "early";
    return null;
  };
  const bucketPriority = (b) => (b === "mid" ? 3 : b === "late" ? 2 : b === "early" ? 1 : 0);

  const guess = (pl) =>
    (pl.sp_values?.dynasty_sf || pl.fc_values?.dynasty_sf || pl.fn_values?.dynasty_sf ||
     pl.dp_values?.superflex || pl.ktc_values?.superflex || 0);

  for (const p of picks) {
    const name = `${p.full_name || ""} ${p.first_name || ""} ${p.last_name || ""}`.trim();
    const low  = norm(name.replace(/\(via[^)]+\)/g, ""));
    const y = low.match(yearRegex)?.[1];
    if (!y) continue;

    let rd = null;
    for (const rr of roundRegexes) {
      const m = low.match(rr);
      if (m?.[1]) {
        const raw = norm(m[1]);
        rd = ordToNum[raw] ?? Number(raw);
        break;
      }
    }
    if (!rd || !Number.isFinite(rd)) continue;

    const key = `${y}|${rd}`;
    const candBucket = bucketOf(low);
    const candPri = bucketPriority(candBucket);
    const candVal = guess(p);

    const prev = idx.get(key);
    if (!prev) {
      idx.set(key, p);
    } else {
      const prevLow = norm([prev.full_name, prev.first_name, prev.last_name].filter(Boolean).join(" "));
      const prevBucket = bucketOf(prevLow);
      const prevPri = bucketPriority(prevBucket);
      const prevVal = guess(prev);
      if (candPri > prevPri || (candPri === prevPri && candVal > prevVal)) {
        idx.set(key, p);
      }
    }
  }
  return idx;
}

/* ===========================
   PAGE
=========================== */
export default function PowerRankingsPage() {
  const {
    username,
    leagues,
    players,
    activeLeague,
    setActiveLeague,
    fetchLeagueRosters,
  } = useSleeper();

  // Controls
  const [valueSource, setValueSource] = useState("FantasyCalc");
  const supports = VALUE_SOURCES[valueSource].supports;
  const [format, setFormat] = useState("dynasty");
  const [qbType, setQbType] = useState("sf");
  const [includeIDP, setIncludeIDP] = useState(true);
  const [includePicks, setIncludePicks] = useState(true);
  const [sortKey, setSortKey] = useState("rating");

  // Comparison + drilldown
  const [teamAId, setTeamAId] = useState("");
  const [teamBId, setTeamBId] = useState("");
  const [openTeamId, setOpenTeamId] = useState(null);

  // Picks ownership
  const [ownedPicks, setOwnedPicks] = useState(null);
  const [picksLoading, setPicksLoading] = useState(false);
  const [picksError, setPicksError] = useState("");

  const league = useMemo(
    () => leagues.find((lg) => lg.league_id === activeLeague),
    [leagues, activeLeague]
  );

  useEffect(() => {
    if (league && !league.rosters) {
      fetchLeagueRosters(league.league_id).catch(()=>{});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.league_id]);

  const getPlayerValue = useMemo(
    () => makeGetPlayerValue(valueSource, format, qbType),
    [valueSource, format, qbType]
  );

  const startersCount = useMemo(() => {
    const rp = league?.roster_positions || [];
    return rp.filter((p) => !["BN","IR","TAXI"].includes((p||"").toUpperCase())).length || 8;
  }, [league?.roster_positions]);

  useEffect(() => {
    let cancelled = false;
    async function loadPicks() {
      if (!league?.league_id) {
        setOwnedPicks(null);
        return;
      }
      try {
        setPicksLoading(true);
        setPicksError("");
        const map = await getOwnedPicksByRoster(league.league_id);
        if (!cancelled) setOwnedPicks(map);
      } catch (e) {
        if (!cancelled) setPicksError(String(e?.message || e));
      } finally {
        if (!cancelled) setPicksLoading(false);
      }
    }
    loadPicks();
    return () => { cancelled = true; };
  }, [league?.league_id]);

  const pickIndex = useMemo(() => indexPickPlayers(players || {}), [players]);

  const strengthBucket = useMemo(() => {
    const map = new Map();
    if (!league?.rosters || league.rosters.length === 0) return map;
    const strength = league.rosters.map(r => {
      const fpts = Number(r.settings?.fpts ?? 0);
      const fdec = Number(r.settings?.fpts_decimal ?? 0);
      const wins = Number(r.settings?.wins ?? 0);
      const score = fpts + fdec / 1000 + wins * 0.001;
      return { rid: r.roster_id, score };
    });
    const allZero = strength.every(s => s.score === 0);
    if (allZero) {
      strength.forEach(s => map.set(s.rid, "mid"));
      return map;
    }
    const sorted = [...strength].sort((a, b) => a.score - b.score);
    const n = sorted.length;
    const idxOf = new Map(sorted.map((s, i) => [s.rid, i]));
    const loCut = Math.floor((n - 1) * (1/3));
    const hiCut = Math.floor((n - 1) * (2/3));
    for (const { rid } of strength) {
      const i = idxOf.get(rid) ?? 0;
      let bucket = "mid";
      if (i <= loCut) bucket = "early";
      else if (i >= hiCut) bucket = "late";
      map.set(rid, bucket);
    }
    return map;
  }, [league?.rosters]);

  /** Compute team metrics */
  const teams = useMemo(() => {
    if (!league?.rosters || !players) return [];

    return league.rosters.map((r) => {
      const owner = league.users?.find((u) => u.user_id === r.owner_id);
      const name = owner?.metadata?.team_name || owner?.display_name || "Unknown";
      const rosterIds = r.players || [];
      const roster = rosterIds.map((pid) => players[pid]).filter(Boolean);

      const nonPicks = roster.filter((p) => !isPick(p.position));
      const rosterFiltered = nonPicks.filter((p) => includeIDP || !isIDP(p.position));

      const valued = rosterFiltered
        .map((p) => ({ p, v: getPlayerValue(p) || 0, age: getPlayerAge(p) }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v);

      const starters = valued.slice(0, startersCount);
      const bench = valued.slice(startersCount);

      const stars = starters.reduce((s,x)=>s+x.v,0);
      const depth = bench.reduce((s,x)=>s+x.v,0);

      const rosterNameById = new Map(
        (league.rosters || []).map(rr => {
          const own = league.users?.find(u => u.user_id === rr.owner_id);
          const nm = own?.metadata?.team_name || own?.display_name || `Team ${rr.roster_id}`;
          return [rr.roster_id, nm];
        })
      );

      const owned = ownedPicks?.[r.roster_id] || [];
      const matchedPicks = owned
        .map(pk => {
          const season = String(pk.season);
          const round  = Number(pk.round);
          const key = `${season}|${round}`;
          const pickPlayer = pickIndex.get(key);
          if (!pickPlayer) return null;

          const value = getAnyPickValue(pickPlayer, valueSource, format, qbType);
          if (!value) return null;

          const rawBucket = (strengthBucket.get(pk.original_roster_id) || "mid");
          const labelBucket = rawBucket.charAt(0).toUpperCase() + rawBucket.slice(1);

          const base = `${labelBucket} ${season} ${toOrdinal(round)}`;
          const via =
            pk.owner_roster_id !== pk.original_roster_id
              ? ` (via ${rosterNameById.get(pk.original_roster_id) || `Team ${pk.original_roster_id}`})`
              : "";

          return { player: pickPlayer, value, label: `${base}${via}` };
        })
        .filter(Boolean);

      const picksValue = matchedPicks.reduce((s, x) => s + x.value, 0);

      const total = stars + depth + (includePicks ? picksValue : 0);
      const rating = Math.round(stars * 0.7 + depth * 0.3 + (includePicks ? picksValue * 0.15 : 0));

      const posTotals = { QB:0, RB:0, WR:0, TE:0 };
      [...starters, ...bench].forEach(({p,v}) => {
        const tag = (p.position||"").toUpperCase();
        if (OFF_POS.includes(tag)) posTotals[tag] += v;
      });
      const posSum = Object.values(posTotals).reduce((a,b)=>a+b,0) || 1;
      const mixPct = Object.fromEntries(Object.entries(posTotals).map(([k,v])=>[k, (100*v/posSum)]));

      const ageNumer = valued.reduce((s,x)=> s + (x.age ? x.age * x.v : 0), 0);
      const ageDenom = valued.reduce((s,x)=> s + (x.v || 0), 0) || 1;
      const valueWeightedAge = Math.round((ageNumer / ageDenom) * 10) / 10;

      return {
        teamId: r.roster_id,
        ownerId: r.owner_id,
        name,
        displayName: owner?.display_name || "",
        starters, bench,
        picksDetail: matchedPicks,
        stars, depth, picksValue, total, rating,
        mix: posTotals, mixPct,
        valueWeightedAge,
      };
    });
  }, [league, players, getPlayerValue, includeIDP, includePicks, startersCount, ownedPicks, pickIndex, valueSource, format, qbType, strengthBucket]);

  const positionRanks = useMemo(() => {
    const perTeam = teams.map(t => {
      const byPos = { QB:0, RB:0, WR:0, TE:0 };
      [...t.starters, ...t.bench].forEach(({p,v})=>{
        const tag = (p.position||"").toUpperCase();
        if (OFF_POS.includes(tag)) byPos[tag] += v;
      });
      return { teamId: t.teamId, ...byPos };
    });
    const rankPos = (pos) => {
      const arr = [...perTeam].sort((a,b)=> (b[pos]||0) - (a[pos]||0));
      return new Map(arr.map((x,idx)=>[x.teamId, idx+1]));
    };
    return { QB: rankPos("QB"), RB: rankPos("RB"), WR: rankPos("WR"), TE: rankPos("TE") };
  }, [teams]);

  const sortedTeams = useMemo(() => {
    const arr = [...teams];
    arr.sort((a, b) => {
      if (sortKey === "total") return b.total - a.total;
      if (sortKey === "stars") return b.stars - a.stars;
      if (sortKey === "depth") return b.depth - a.depth;
      return b.rating - a.rating;
    });
    return arr.map((t, i) => ({ ...t, rank: i + 1 }));
  }, [teams, sortKey]);

  const maxes = useMemo(() => ({
    rating: Math.max(1, ...sortedTeams.map(t=>t.rating||0)),
    total:  Math.max(1, ...sortedTeams.map(t=>t.total||0)),
    stars:  Math.max(1, ...sortedTeams.map(t=>t.stars||0)),
    depth:  Math.max(1, ...sortedTeams.map(t=>t.depth||0)),
  }), [sortedTeams]);

  const leagueMeta = useMemo(() => {
    if (sortedTeams.length === 0) return null;

    const bestQB = [...sortedTeams].sort((a,b)=> (b.mix.QB||0)-(a.mix.QB||0))[0];
    const bestRB = [...sortedTeams].sort((a,b)=> (b.mix.RB||0)-(a.mix.RB||0))[0];
    const bestWR = [...sortedTeams].sort((a,b)=> (b.mix.WR||0)-(a.mix.WR||0))[0];
    const bestTE = [...sortedTeams].sort((a,b)=> (b.mix.TE||0)-(a.mix.TE||0))[0];
    const deepestBench = [...sortedTeams].sort((a,b)=> (b.depth||0)-(a.depth||0))[0];
    const mostPicks    = [...sortedTeams].sort((a,b)=> (b.picksValue||0)-(a.picksValue||0))[0];
    const youngest     = [...sortedTeams].sort((a,b)=> (a.valueWeightedAge||99) - (b.valueWeightedAge||99))[0];
    const oldest       = [...sortedTeams].sort((a,b)=> (b.valueWeightedAge||0) - (a.valueWeightedAge||0))[0];
    const biggestGap   = [...sortedTeams].sort((a,b)=> ((b.stars - b.depth) - (a.stars - a.depth)))[0];

    const topPos = (pos) => [...sortedTeams]
      .map(t => ({ team: t.name, val: t.mix[pos] || 0 }))
      .sort((a,b)=> b.val - a.val)
      .slice(0,5);

    const pickLeaders = [...sortedTeams]
      .map(t => ({ team: t.name, val: t.picksValue || 0 }))
      .sort((a,b)=> b.val - a.val)
      .slice(0,5);

    const ratings = sortedTeams.map(t=>t.rating).sort((a,b)=>a-b);
    const pct = (x) => {
      let i = ratings.findIndex(v=>v>=x);
      if (i < 0) i = ratings.length - 1;
      return Math.round((i / Math.max(1, ratings.length-1)) * 100);
    };
    const tiers = sortedTeams.map(t => {
      const p = pct(t.rating);
      let tag = "Fringe";
      if (p >= 85) tag = "Contender";
      else if (p >= 65) tag = "Playoff Lock";
      else if (p <= 30) tag = "Rebuilder";
      return { teamId: t.teamId, name: t.name, tier: tag, pct: p, rating: t.rating };
    });

    return {
      bestQB, bestRB, bestWR, bestTE,
      deepestBench, mostPicks, youngest, oldest, biggestGap,
      topQB: topPos("QB"), topRB: topPos("RB"), topWR: topPos("WR"), topTE: topPos("TE"),
      pickLeaders,
      tiers,
    };
  }, [sortedTeams]);

  const compA = useMemo(()=> sortedTeams.find(t => String(t.teamId) === String(teamAId)), [sortedTeams, teamAId]);
  const compB = useMemo(()=> sortedTeams.find(t => String(t.teamId) === String(teamBId)), [sortedTeams, teamBId]);

  return (
    <>
      <BackgroundParticles />
      <Navbar pageTitle="Power Rankings" />
      <div className="max-w-7xl mx-auto px-4 pt-20 -mt-2">
        {!username ? (
          <div className="text-center text-gray-400 mt-20">
            Please log in on the{" "}
            <a href="/" className="text-blue-400 underline">homepage</a>{" "}
            to use this tool.
          </div>
        ) : (
          <>
            {/* Controls */}
            <Card className="p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">League:</span>
                    <select
                      value={activeLeague || ""}
                      onChange={(e) => setActiveLeague(e.target.value)}
                      className="bg-gray-800 text-white p-2 rounded"
                    >
                      <option value="">Choose a League</option>
                      {leagues.map((lg) => (
                        <option key={lg.league_id} value={lg.league_id}>
                          {lg.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Values:</span>
                    <ValueSourceDropdown valueSource={valueSource} setValueSource={setValueSource} />
                  </div>

                  {supports.dynasty && supports.redraft && (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Format:</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={format === "dynasty"}
                          onChange={() => setFormat(format === "dynasty" ? "redraft" : "dynasty")}
                          className="sr-only peer"
                        />
                        <div className="w-14 h-7 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:h-5 after:w-5 after:rounded-full after:transition-all peer-checked:after:translate-x-7"></div>
                        <span className="ml-3">{format === "dynasty" ? "Dynasty" : "Redraft"}</span>
                      </label>
                    </div>
                  )}

                  {supports.qbToggle && (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">QB:</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={qbType === "sf"}
                          onChange={() => setQbType(qbType === "sf" ? "1qb" : "sf")}
                          className="sr-only peer"
                        />
                        <div className="w-14 h-7 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:h-5 after:w-5 after:rounded-full after:transition-all peer-checked:after:translate-x-7"></div>
                        <span className="ml-3">{qbType === "sf" ? "Superflex" : "1QB"}</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Starters/picks status */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs sm:text-sm opacity-80">
                    <span className="font-semibold">Starters (auto):</span>{" "}
                    {(() => {
                      const rp = league?.roster_positions || [];
                      return rp.filter((p) => !["BN","IR","TAXI"].includes((p||"").toUpperCase())).length || 8;
                    })()}{" "}
                    <span className="opacity-60">(from Sleeper)</span>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={includeIDP} onChange={(e)=>setIncludeIDP(e.target.checked)} />
                    <span>Include IDP</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={includePicks} onChange={(e)=>setIncludePicks(e.target.checked)} />
                    <span>Include Picks</span>
                  </label>
                </div>
              </div>
            </Card>

            {/* ===== MOBILE TOP META (accordions) ===== */}
            <div className="space-y-4 mt-6 lg:hidden">
              <MobileAccordion title="Team Tiers">
                {(!league || !league.rosters) ? (
                  <div className="text-center text-gray-400 py-4">Choose a league to see tiers.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {["Contender","Playoff Lock","Fringe","Rebuilder"].map((tier) => (
                      <div key={tier} className="rounded-lg bg-white/5 border border-white/10 p-3">
                        <div className="font-semibold mb-2">{tier}</div>
                        <div className="space-y-1">
                          {(leagueMeta?.tiers || []).filter(t => t.tier === tier).map((t,i) => (
                            <div key={t.teamId} className="flex items-center justify-between text-sm">
                              <div className="truncate">{i+1}. {t.name}</div>
                              <div className="opacity-70">{t.rating.toLocaleString()}</div>
                            </div>
                          ))}
                          {(!leagueMeta?.tiers || leagueMeta?.tiers.filter(t=>t.tier===tier).length===0) && (
                            <div className="text-sm opacity-60">—</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </MobileAccordion>

              <MobileAccordion title="Leaderboards">
                {(!league || !league.rosters) ? (
                  <div className="text-center text-gray-400 py-4">Choose a league to see leaderboards.</div>
                ) : (
                  <div className="space-y-4">
                    {[
                      { title:"Top QB Rooms",  list: leagueMeta?.topQB },
                      { title:"Top RB Rooms",  list: leagueMeta?.topRB },
                      { title:"Top WR Rooms",  list: leagueMeta?.topWR },
                      { title:"Top TE Rooms",  list: leagueMeta?.topTE },
                      { title:"Pick Leaderboard", list: leagueMeta?.pickLeaders },
                    ].map((col, idx) => (
                      <div key={idx} className="rounded-lg bg-white/5 border border-white/10 p-3">
                        <div className="font-semibold mb-2">{col.title}</div>
                        <div className="space-y-1">
                          {(col.list || []).map((row, i) => (
                            <div key={i} className="flex items-center justify-between">
                              <div className="opacity-70">{i+1}.</div>
                              <div className="flex-1 px-2 truncate">{row.team}</div>
                              <div className="text-sm font-semibold">{Math.round(row.val).toLocaleString()}</div>
                            </div>
                          ))}
                          {(!col.list || col.list.length === 0) && <div className="text-sm opacity-60">—</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </MobileAccordion>

              <MobileAccordion title="League Summary">
                {(!league || !league.rosters) ? (
                  <div className="text-center text-gray-400 py-4">Choose a league to populate summary.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {[
                      { label: "Best QB Room", value: leagueMeta?.bestQB?.name },
                      { label: "Best RB Room", value: leagueMeta?.bestRB?.name },
                      { label: "Best WR Room", value: leagueMeta?.bestWR?.name },
                      { label: "Best TE Room", value: leagueMeta?.bestTE?.name },
                      { label: "Deepest Bench", value: leagueMeta?.deepestBench?.name },
                      { label: "Most Picks", value: leagueMeta?.mostPicks?.name },
                      { label: "Youngest Team", value: leagueMeta?.youngest?.name },
                      { label: "Oldest Team", value: leagueMeta?.oldest?.name },
                      { label: "Biggest Stars-Depth Gap", value: leagueMeta?.biggestGap?.name },
                    ].map((x, i) => (
                      <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10">
                        <div className="opacity-70 text-sm">{x.label}</div>
                        <div className="font-semibold">{x.value || "—"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </MobileAccordion>
            </div>
            {/* ===== END MOBILE META ===== */}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
              {/* MAIN COLUMN */}
              <main className="lg:col-span-8 space-y-8">
                {/* Comparison */}
                <SectionTitle subtitle="Pick two teams for a premium head-to-head snapshot.">
                  Comparison Mode
                </SectionTitle>
                <Card className="p-4">
                  {(!league || !league.rosters) ? (
                    <div className="text-center text-gray-400 py-12">Choose a league to compare teams.</div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-3 mb-3">
                        <select className="bg-gray-800 p-2 rounded" value={teamAId} onChange={e=>setTeamAId(e.target.value)}>
                          <option value="">Select Team A</option>
                          {sortedTeams.map(t => <option key={t.teamId} value={t.teamId}>{t.name}</option>)}
                        </select>
                        <select className="bg-gray-800 p-2 rounded" value={teamBId} onChange={e=>setTeamBId(e.target.value)}>
                          <option value="">Select Team B</option>
                          {sortedTeams.map(t => <option key={t.teamId} value={t.teamId}>{t.name}</option>)}
                        </select>
                      </div>
                      {(compA && compB) ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {[compA, compB].map((t, idx)=>(
                            <div key={idx} className="rounded-xl p-4 bg-gradient-to-br from-[#0c2035] to-[#0f2741] border border-white/10">
                              <div className="flex items-center justify-between mb-3">
                                <div className="text-lg font-semibold">{t.name}</div>
                                <div className="text-sm opacity-70">Rank #{t.rank}</div>
                              </div>
                              <div className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-2 mb-3">
                                <StatPill label="Overall" value={t.rating} />
                                <StatPill label="Total" value={t.total} className="hidden sm:flex" />
                                <StatPill label={`Top ${startersCount}`} value={t.stars} />
                                <StatPill label="Depth" value={t.depth} />
                                {includePicks && <StatPill label="Picks" value={t.picksValue} className="hidden sm:flex" />}
                                <StatPill label="Avg Age" value={t.valueWeightedAge} className="hidden md:flex" />
                              </div>
                              <div className="mb-2">
                                <div className="flex justify-between text-xs opacity-70 mb-1">
                                  <span>Positional Balance (QB/RB/WR/TE)</span>
                                  <span>
                                    QB {t.mixPct.QB.toFixed(0)}% · RB {t.mixPct.RB.toFixed(0)}% · WR {t.mixPct.WR.toFixed(0)}% · TE {t.mixPct.TE.toFixed(0)}%
                                  </span>
                                </div>
                                <StackedMini parts={[
                                  { value: t.mix.QB, className: "bg-cyan-400" },
                                  { value: t.mix.RB, className: "bg-blue-400" },
                                  { value: t.mix.WR, className: "bg-violet-400" },
                                  { value: t.mix.TE, className: "bg-fuchsia-400" },
                                ]}/>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm opacity-70">Select both teams to compare.</div>
                      )}
                    </>
                  )}
                </Card>

                {/* Power Rankings */}
                <SectionTitle subtitle="Overall power with stars, depth, picks, and positional balance.">
                  Power Rankings
                </SectionTitle>
                {(!activeLeague) ? (
                  <div className="text-center text-gray-400 py-20">Choose a league to see power rankings.</div>
                ) : !league?.rosters ? (
                  <div className="text-center text-gray-400 py-20">Loading league rosters…</div>
                ) : (
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <span className="opacity-70 text-sm">Sort by:</span>
                      <div className="flex gap-2">
                        {[
                          { k: "rating", lbl: `Overall (Top ${startersCount} / Depth / Picks)` },
                          { k: "total",  lbl: "Total Value" },
                          { k: "stars",  lbl: `Top ${startersCount} Value` },
                          { k: "depth",  lbl: "Depth Value" },
                        ].map(({ k, lbl }) => (
                          <button
                            key={k}
                            onClick={() => setSortKey(k)}
                            className={`px-3 py-1 rounded-lg border text-sm ${sortKey === k ? "bg-white/10 border-white/20" : "border-white/10 hover:bg-white/5"}`}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {sortedTeams.map((t) => {
                        const ratingPct = (t.rating / maxes.rating) * 100;
                        const starsPct  = (t.stars  / maxes.stars)  * 100;
                        const depthPct  = (t.depth  / maxes.depth)  * 100;

                        const ranks = {
                          QB: positionRanks.QB.get(t.teamId) || sortedTeams.length,
                          RB: positionRanks.RB.get(t.teamId) || sortedTeams.length,
                          WR: positionRanks.WR.get(t.teamId) || sortedTeams.length,
                          TE: positionRanks.TE.get(t.teamId) || sortedTeams.length,
                        };
                        const weakest = Object.entries(ranks).sort((a,b)=> b[1]-a[1])[0];
                        const tier = leagueMeta?.tiers.find(x => x.teamId === t.teamId)?.tier || "—";

                        return (
                          <div key={t.teamId} className="rounded-xl p-4 bg-gradient-to-br from-[#0c2035] to-[#0f2741] border border-white/10">
                            {/* header stacks on mobile */}
                            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 mb-3">
                              <div className="flex items-center gap-3">
                                <div className="text-3xl font-black w-12 text-right pr-2 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,.35)]">
                                  {t.rank}
                                </div>
                                <div>
                                  <div className="text-base sm:text-lg font-semibold">{t.name}</div>
                                  {t.displayName ? <div className="text-xs sm:text-sm opacity-70 -mt-0.5">{t.displayName}</div> : null}
                                  <div className="text-[11px] sm:text-xs mt-1 opacity-80">
                                    <span className="opacity-70">Needs:</span>{" "}
                                    {weakest ? `${weakest[0]} room (rank ${weakest[1]})` : "—"} ·{" "}
                                    <span className="opacity-70">Tier:</span> {tier}
                                  </div>
                                </div>
                              </div>

                              {/* Responsive pills: 2–3 across on small, inline on md+ */}
                              <div className="w-full md:flex-1 md:justify-end">
                                <div className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-2 md:flex md:flex-wrap md:gap-2">
                                  <StatPill label="Overall" value={t.rating} />
                                  <StatPill label={`Top ${startersCount}`} value={t.stars} />
                                  <StatPill label="Depth" value={t.depth} />
                                  {includePicks && <StatPill label="Picks" value={t.picksValue} className="hidden sm:flex" />}
                                  <StatPill label="Total" value={t.total} className="hidden sm:flex" />
                                  <StatPill label="Avg Age" value={t.valueWeightedAge} className="hidden md:flex" />
                                </div>
                              </div>
                            </div>

                            {/* Overall */}
                            <div className="mb-2">
                              <div className="flex justify-between text-xs opacity-70 mb-1">
                                <span>Overall Power</span>
                                <span>{Math.round(ratingPct)}%</span>
                              </div>
                              <Bar pct={ratingPct} />
                            </div>

                            {/* Detail bars */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <div className="flex justify-between text-xs opacity-70 mb-1">
                                  <span>{`Top ${startersCount}`}</span>
                                  <span>{Math.round(starsPct)}%</span>
                                </div>
                                <Bar pct={(t.stars / maxes.stars) * 100} from="from-cyan-400" to="to-blue-500" />
                              </div>

                              <div>
                                <div className="flex justify-between text-xs opacity-70 mb-1">
                                  <span>Depth</span>
                                  <span>{Math.round(depthPct)}%</span>
                                </div>
                                <Bar pct={(t.depth / maxes.depth) * 100} from="from-violet-400" to="to-fuchsia-500" />
                              </div>

                              <div>
                                <div className="flex justify-between text-xs opacity-70 mb-1">
                                  <span>Positional Balance (QB/RB/WR/TE)</span>
                                  <span>
                                    QB {t.mixPct.QB.toFixed(0)}% · RB {t.mixPct.RB.toFixed(0)}% · WR {t.mixPct.WR.toFixed(0)}% · TE {t.mixPct.TE.toFixed(0)}%
                                  </span>
                                </div>
                                <StackedMini parts={[
                                  { value: t.mix.QB, className: "bg-cyan-400" },
                                  { value: t.mix.RB, className: "bg-blue-400" },
                                  { value: t.mix.WR, className: "bg-violet-400" },
                                  { value: t.mix.TE, className: "bg-fuchsia-400" },
                                ]}/>
                              </div>
                            </div>

                            {/* Drilldown */}
                            <div className="mt-3">
                              <button
                                onClick={() => setOpenTeamId(openTeamId === t.teamId ? null : t.teamId)}
                                className="text-sm px-3 py-1 rounded-lg border border-white/10 hover:bg-white/5"
                              >
                                {openTeamId === t.teamId ? "Hide Roster Breakdown" : "Show Roster Breakdown"}
                              </button>
                            </div>

                            {openTeamId === t.teamId && (
                              <div className="mt-3 rounded-lg bg-white/5 border border-white/10 p-3">
                                <div className="text-sm font-semibold mb-2">Top {startersCount}</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {t.starters.map(({p,v})=>(
                                    <div key={p.player_id} className="flex items-center justify-between bg-[#0c2035] border border-white/10 rounded-md px-2 py-1">
                                      <div className="truncate">
                                        <span className="opacity-70 text-xs mr-2">{p.position}</span>
                                        <span className="font-medium">{p.full_name || `${p.first_name||""} ${p.last_name||""}`}</span>
                                      </div>
                                      <div className="font-semibold">{v.toLocaleString()}</div>
                                    </div>
                                  ))}
                                </div>

                                <div className="text-sm font-semibold mt-4 mb-2">Depth</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {t.bench.map(({p,v})=>(
                                    <div key={p.player_id} className="flex items-center justify-between bg-[#0c2035] border border-white/10 rounded-md px-2 py-1">
                                      <div className="truncate">
                                        <span className="opacity-70 text-xs mr-2">{p.position}</span>
                                        <span className="font-medium">{p.full_name || `${p.first_name||""} ${p.last_name||""}`}</span>
                                      </div>
                                      <div className="font-semibold">{v.toLocaleString()}</div>
                                    </div>
                                  ))}
                                </div>

                                {includePicks && (t.picksDetail?.length || 0) > 0 && (
                                  <>
                                    <div className="text-sm font-semibold mt-4 mb-2">Future Picks</div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      {t.picksDetail.map((pd, i)=>(
                                        <div
                                          key={`${pd.player.player_id}_${i}`}
                                          className="flex items-center justify-between bg-[#0c2035] border border-white/10 rounded-md px-2 py-1"
                                        >
                                          <div className="truncate">
                                            <span className="opacity-70 text-xs mr-2">PICK</span>
                                            <span className="font-medium">{pd.label}</span>
                                          </div>
                                          <div className="font-semibold">{pd.value.toLocaleString()}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </main>

              {/* DESKTOP SIDEBAR ONLY */}
              <aside className="hidden lg:block lg:col-span-4 space-y-6 lg:sticky lg:top-20">
                <div>
                  <SectionTitle subtitle="Auto-bucketed by rating percentiles.">Team Tiers</SectionTitle>
                  <Card className="p-4">
                    {(!league || !league.rosters) ? (
                      <div className="text-center text-gray-400 py-8">Choose a league to see tiers.</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {["Contender","Playoff Lock","Fringe","Rebuilder"].map((tier) => (
                          <div key={tier} className="rounded-lg bg-white/5 border border-white/10 p-3">
                            <div className="font-semibold mb-2">{tier}</div>
                            <div className="space-y-1">
                              {(leagueMeta?.tiers || []).filter(t => t.tier === tier).map((t,i) => (
                                <div key={t.teamId} className="flex items-center justify-between text-sm">
                                  <div className="truncate">{i+1}. {t.name}</div>
                                  <div className="opacity-70">{t.rating.toLocaleString()}</div>
                                </div>
                              ))}
                              {(!leagueMeta?.tiers || leagueMeta?.tiers.filter(t=>t.tier===tier).length===0) && (
                                <div className="text-sm opacity-60">—</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>

                <div>
                  <SectionTitle subtitle="Who dominates each position and the draft chest.">Leaderboards</SectionTitle>
                  <Card className="p-4">
                    {(!league || !league.rosters) ? (
                      <div className="text-center text-gray-400 py-8">Choose a league to see leaderboards.</div>
                    ) : (
                      <div className="space-y-4">
                        {[
                          { title:"Top QB Rooms",  list: leagueMeta?.topQB },
                          { title:"Top RB Rooms",  list: leagueMeta?.topRB },
                          { title:"Top WR Rooms",  list: leagueMeta?.topWR },
                          { title:"Top TE Rooms",  list: leagueMeta?.topTE },
                          { title:"Pick Leaderboard", list: leagueMeta?.pickLeaders },
                        ].map((col, idx) => (
                          <div key={idx} className="rounded-lg bg-white/5 border border-white/10 p-3">
                            <div className="font-semibold mb-2">{col.title}</div>
                            <div className="space-y-1">
                              {(col.list || []).map((row, i) => (
                                <div key={i} className="flex items-center justify-between">
                                  <div className="opacity-70">{i+1}.</div>
                                  <div className="flex-1 px-2 truncate">{row.team}</div>
                                  <div className="text-sm font-semibold">{Math.round(row.val).toLocaleString()}</div>
                                </div>
                              ))}
                              {(!col.list || col.list.length === 0) && <div className="text-sm opacity-60">—</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>

                <div>
                  <SectionTitle subtitle="At-a-glance honors across the league.">League Summary</SectionTitle>
                  <Card className="p-4">
                    {(!league || !league.rosters) ? (
                      <div className="text-center text-gray-400 py-8">Choose a league to populate summary.</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {[
                          { label: "Best QB Room", value: leagueMeta?.bestQB?.name },
                          { label: "Best RB Room", value: leagueMeta?.bestRB?.name },
                          { label: "Best WR Room", value: leagueMeta?.bestWR?.name },
                          { label: "Best TE Room", value: leagueMeta?.bestTE?.name },
                          { label: "Deepest Bench", value: leagueMeta?.deepestBench?.name },
                          { label: "Most Picks", value: leagueMeta?.mostPicks?.name },
                          { label: "Youngest Team", value: leagueMeta?.youngest?.name },
                          { label: "Oldest Team", value: leagueMeta?.oldest?.name },
                          { label: "Biggest Stars-Depth Gap", value: leagueMeta?.biggestGap?.name },
                        ].map((x, i) => (
                          <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10">
                            <div className="opacity-70 text-sm">{x.label}</div>
                            <div className="font-semibold">{x.value || "—"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </>
  );
}
