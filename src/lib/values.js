// src/lib/values.js
export const OFF_POS = ["QB","RB","WR","TE"];
export const IDP_POS = ["DL","LB","DB","DT","DE","CB","S"];
export const isIDP  = (pos) => pos && IDP_POS.includes(String(pos).toUpperCase());
export const isPick = (pos) => String(pos || "").toUpperCase() === "PICK";

// Copied from your Power Rankings logic (kept 1:1)
export function makeGetPlayerValue(valueSource, format, qbType, scoring = "ppr") {
  return (p) => {
    if (!p) return 0;
    if (valueSource === "FantasyCalc") {
      const base = `${format === "dynasty" ? "dynasty" : "redraft"}_${qbType === "sf" ? "sf" : "1qb"}`;
      const profile = ["std","half","ppr","std-tep","half-tep","ppr-tep","std-tep-plus","half-tep-plus","ppr-tep-plus"].includes(String(scoring).toLowerCase())
        ? String(scoring).toLowerCase()
        : "ppr";
      return p.fc_values?.[`${base}__${profile}`] || p.fc_values?.[base] || 0;
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
    if (valueSource === "FantasyPros") {
      if (format !== "dynasty") return 0;
      if (String(scoring).toLowerCase() === "tep") {
        return qbType === "sf" ? (p.fp_values?.dynasty_sf_tep || p.fp_values?.dynasty_sf || 0) : (p.fp_values?.dynasty_1qb_tep || p.fp_values?.dynasty_1qb || 0);
      }
      return qbType === "sf" ? (p.fp_values?.dynasty_sf || 0) : (p.fp_values?.dynasty_1qb || 0);
    }
    if (valueSource === "FantasyProsECR") {
      const score = ["std","half","ppr"].includes(String(scoring).toLowerCase()) ? String(scoring).toLowerCase() : "ppr";
      const key = `${format === "dynasty" ? "dynasty" : "redraft"}_${qbType === "sf" ? "sf" : "1qb"}_${score}`;
      return p.fpecr_values?.[key] || 0;
    }
    if (valueSource === "IDynastyP") {
      if (String(scoring).toLowerCase() === "tep") {
        return qbType === "sf"
          ? (p.idp_values?.superflex_tep || p.idp_values?.superflex || 0)
          : (p.idp_values?.one_qb_tep || p.idp_values?.one_qb || 0);
      }
      return qbType === "sf" ? (p.idp_values?.superflex || 0) : (p.idp_values?.one_qb || 0);
    }
    if (valueSource === "IDPShow") {
      return qbType === "sf" ? (p.idpshow_values?.superflex || 0) : (p.idpshow_values?.one_qb || 0);
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
    "FantasyPros",
    "FantasyProsECR",
    "IDynastyP",
    "IDPShow",
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
