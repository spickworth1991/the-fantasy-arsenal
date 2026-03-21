const ROUND_WORD_TO_NUM = {
  first: 1,
  "1st": 1,
  "1": 1,
  second: 2,
  "2nd": 2,
  "2": 2,
  third: 3,
  "3rd": 3,
  "3": 3,
  fourth: 4,
  "4th": 4,
  "4": 4,
  fifth: 5,
  "5th": 5,
  "5": 5,
  sixth: 6,
  "6th": 6,
  "6": 6,
  seventh: 7,
  "7th": 7,
  "7": 7,
};

const ROUND_NUM_TO_ORDINAL = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "5th",
  6: "6th",
  7: "7th",
};

const TEAM_ABBR_MAP = {
  JAX: "JAC",
  LA: "LAR",
  STL: "LAR",
  SD: "LAC",
  OAK: "LV",
  WFT: "WAS",
  WSH: "WAS",
  LVR: "LV",
  NEP: "NE",
  GBP: "GB",
  KCC: "KC",
  SFO: "SF",
  TBB: "TB",
  NOR: "NO",
  NOS: "NO",
};

function normalizeRoundToken(token) {
  const raw = String(token || "").toLowerCase().trim();
  return ROUND_WORD_TO_NUM[raw] || 0;
}

export function roundToOrdinal(round) {
  const n = Number(round);
  return ROUND_NUM_TO_ORDINAL[n] || `${n}th`;
}

export function normalizeFantasyTeamAbbr(team) {
  const raw = String(team || "").toUpperCase().trim();
  return TEAM_ABBR_MAP[raw] || raw;
}

export function parsePickLabel(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;

  const exactMatch = raw.match(/\b(20\d{2})\s*(?:pick\s*)?(\d{1,2})\.(\d{1,2})\b/i);
  if (exactMatch) {
    const year = Number(exactMatch[1]);
    const round = Number(exactMatch[2]);
    const slot = Number(exactMatch[3]);
    if (year && round && slot) {
      return {
        year,
        round,
        slot,
        bucket: "",
        kind: "exact",
        key: `exact|${year}|${round}|${slot}`,
      };
    }
  }

  const bucketMatch = raw.match(
    /\b(20\d{2})\s+(early|mid|middle|late)\s+(first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)?|[1-7])\b/i
  );
  if (bucketMatch) {
    const year = Number(bucketMatch[1]);
    const round = normalizeRoundToken(bucketMatch[3]);
    const bucketRaw = bucketMatch[2].toLowerCase();
    const bucket = bucketRaw === "middle" ? "mid" : bucketRaw;
    if (year && round && bucket) {
      return {
        year,
        round,
        slot: 0,
        bucket,
        kind: "bucket",
        key: `bucket|${year}|${round}|${bucket}`,
      };
    }
  }

  const genericMatch = raw.match(
    /\b(20\d{2})\s+(?:pick\s*)?(first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)?|[1-7])\b/i
  );
  if (genericMatch) {
    const year = Number(genericMatch[1]);
    const round = normalizeRoundToken(genericMatch[2]);
    if (year && round) {
      return {
        year,
        round,
        slot: 0,
        bucket: "",
        kind: "generic",
        key: `generic|${year}|${round}`,
      };
    }
  }

  return null;
}

export function formatPickLabel(meta) {
  if (!meta?.year || !meta?.round || !meta?.kind) return "";
  if (meta.kind === "exact") {
    return `${meta.year} Pick ${meta.round}.${String(meta.slot || 0).padStart(2, "0")}`;
  }
  if (meta.kind === "bucket") {
    const bucket = String(meta.bucket || "").toLowerCase();
    const bucketLabel = bucket ? `${bucket.charAt(0).toUpperCase()}${bucket.slice(1)}` : "";
    return `${meta.year} ${bucketLabel} ${roundToOrdinal(meta.round)}`.trim();
  }
  return `${meta.year} ${roundToOrdinal(meta.round)}`;
}

export function getPickSyntheticPlayerId(meta) {
  if (!meta?.year || !meta?.round || !meta?.kind) return "";
  if (meta.kind === "exact") {
    return `DP_${meta.round - 1}_${meta.slot - 1}`;
  }
  if (meta.kind === "bucket") {
    return `PK_${meta.year}_${meta.round}_${String(meta.bucket || "").toLowerCase()}`;
  }
  return `FP_${meta.year}_${meta.round}`;
}

export function getPickDisplayLastName(meta) {
  if (!meta?.year || !meta?.round || !meta?.kind) return "";
  if (meta.kind === "exact") {
    return `${meta.round}.${String(meta.slot || 0).padStart(2, "0")}`;
  }
  if (meta.kind === "bucket") {
    const bucket = String(meta.bucket || "").toLowerCase();
    const bucketLabel = bucket ? `${bucket.charAt(0).toUpperCase()}${bucket.slice(1)}` : "";
    return `${bucketLabel} ${roundToOrdinal(meta.round)}`.trim();
  }
  return roundToOrdinal(meta.round);
}
