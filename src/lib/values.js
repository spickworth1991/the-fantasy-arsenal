// src/lib/values.js
export const OFF_POS = ["QB","RB","WR","TE"];
export const IDP_POS = ["DL","LB","DB","DT","DE","CB","S"];
export const isIDP  = (pos) => pos && IDP_POS.includes(String(pos).toUpperCase());
export const isPick = (pos) => String(pos || "").toUpperCase() === "PICK";

// Copied from your Power Rankings logic (kept 1:1)
export function makeGetPlayerValue(valueSource, format, qbType) {
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

// If you need a fallback for picks (exactly as in your PR page)
export function getAnyPickValue(p, valueSource, format, qbType) {
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

export function getPlayerAge(p) {
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
  const years = (Date.now() - birth) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, Math.round(years * 10) / 10);
}

// Strength proxy used by SOS/Playoff Odds/etc
export function computeTeamStrength(roster, players, getValue, startersCount = 8) {
  const ids = (roster?.players || []).filter(Boolean);
  const objs = ids.map(pid => players?.[pid]).filter(Boolean);

  const nonPicks = objs.filter(p => !isPick(p.position));
  const valued = nonPicks
    .map(p => ({ p, v: getValue(p) || 0 }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v);

  const starters = valued.slice(0, startersCount);
  const bench    = valued.slice(startersCount);

  const stars = starters.reduce((s,x)=>s+x.v,0);
  const depth = bench.reduce((s,x)=>s+x.v,0);

  // match your PR weights
  return stars + 0.35 * depth;
}
