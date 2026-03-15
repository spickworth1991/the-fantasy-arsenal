const safeNum = (v) => {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const cleanString = (v) => String(v ?? "").trim();

const nonZeroish = (v) => {
  const s = cleanString(v).toLowerCase();
  return !!s && s !== "0" && s !== "null" && s !== "undefined" && s !== "false";
};

export function classifyLeagueFormat(league = {}, drafts = []) {
  const settings = league?.settings || {};
  const metadata = league?.metadata || {};
  const rosterPositions = Array.isArray(league?.roster_positions) ? league.roster_positions : [];

  const bestBall = safeNum(settings?.best_ball) === 1;

  const taxiSlots = Math.max(
    safeNum(settings?.taxi_slots),
    safeNum(settings?.taxi),
    safeNum(settings?.taxi_squads)
  );

  const reserveSlots = Math.max(
    safeNum(settings?.reserve_slots),
    safeNum(settings?.reserve)
  );

  const benchSlots = Math.max(
    safeNum(settings?.bench_slots),
    safeNum(settings?.bn),
    safeNum(settings?.bench)
  );

  const keeperDeadline =
    metadata?.keeper_deadline ??
    settings?.keeper_deadline;

  const maxKeepers = Math.max(
    safeNum(settings?.max_keepers),
    safeNum(settings?.keepers),
    safeNum(settings?.keeper_count),
    safeNum(metadata?.max_keepers)
  );

  const hasKeeperDeadline = nonZeroish(keeperDeadline);
  const hasKeeperCount = maxKeepers > 0;
  const hasKeeperSignal = hasKeeperDeadline || hasKeeperCount;

  const hasTaxiPosition = rosterPositions.some((p) =>
    String(p).toUpperCase().includes("TAXI")
  );

  const hasIRPosition = rosterPositions.some((p) => {
    const up = String(p).toUpperCase();
    return up === "IR" || up.includes("RESERVE");
  });

  const normalizedDrafts = Array.isArray(drafts)
    ? drafts.filter((d) => d && (d.draft_id || d.draft_id === 0))
    : [];

  const seasons = [
    ...new Set(
      normalizedDrafts
        .map((d) => cleanString(d?.season))
        .filter(Boolean)
    ),
  ];

  const multiSeasonDrafts = seasons.length > 1;
  const draftCount = normalizedDrafts.length;

  const draftRounds = normalizedDrafts
    .map((d) => safeNum(d?.settings?.rounds ?? d?.rounds))
    .filter((n) => n > 0);

  const fullSizeDrafts = draftRounds.filter((r) => r >= 12).length;
  const smallDrafts = draftRounds.filter((r) => r > 0 && r <= 6).length;

  const strongDynastySignal =
    taxiSlots > 0 ||
    hasTaxiPosition ||
    (multiSeasonDrafts && draftCount >= 2 && smallDrafts >= 1);

  const dynastyScore =
    (taxiSlots > 0 ? 6 : 0) +
    (hasTaxiPosition ? 5 : 0) +
    (multiSeasonDrafts ? 3 : 0) +
    (draftCount >= 2 ? 2 : 0) +
    (benchSlots >= 18 ? 1 : 0) +
    (reserveSlots >= 2 || hasIRPosition ? 1 : 0) +
    (smallDrafts >= 1 && draftCount >= 2 ? 2 : 0);

  const keeperScore =
    (hasKeeperSignal ? 3 : 0) +
    (hasKeeperDeadline ? 1 : 0) +
    (hasKeeperCount ? 1 : 0) +
    (multiSeasonDrafts ? 1 : 0) +
    (draftCount >= 2 ? 1 : 0) +
    (fullSizeDrafts >= 2 ? 1 : 0) +
    (taxiSlots === 0 && !hasTaxiPosition ? 1 : 0);

  let key = "redraft";
  let label = "Redraft";
  const reasons = [];
  let confidence = "medium";

  if (bestBall) {
    key = "bestball";
    label = "Best Ball";
    reasons.push("best_ball flag");
    confidence = "high";
  } else if (strongDynastySignal && dynastyScore >= keeperScore) {
    key = "dynasty";
    label = "Dynasty";
    if (taxiSlots > 0) reasons.push(`taxi slots: ${taxiSlots}`);
    if (hasTaxiPosition) reasons.push("taxi roster position");
    if (multiSeasonDrafts) reasons.push(`draft seasons: ${seasons.join(", ")}`);
    if (smallDrafts >= 1 && draftCount >= 2) reasons.push("recurring small draft profile");
    if (!reasons.length && draftCount >= 2) reasons.push(`${draftCount} league drafts found`);
    confidence = dynastyScore >= 8 ? "high" : "medium";
  } else if (
    keeperScore >= 3 &&
    !strongDynastySignal &&
    keeperScore >= dynastyScore
  ) {
    key = "keeper";
    label = "Keeper";
    if (hasKeeperDeadline) reasons.push(`keeper deadline: ${cleanString(keeperDeadline)}`);
    if (hasKeeperCount) reasons.push(`max keepers: ${maxKeepers}`);
    if (multiSeasonDrafts) reasons.push(`draft seasons: ${seasons.join(", ")}`);
    if (!reasons.length && draftCount >= 2) reasons.push(`${draftCount} league drafts found`);
    confidence = keeperScore >= 5 ? "high" : "medium";
  } else {
    key = "redraft";
    label = "Redraft";
    if (draftCount <= 1) reasons.push("single draft profile");
    if (!hasKeeperSignal) reasons.push("no keeper signal");
    if (taxiSlots === 0 && !hasTaxiPosition) reasons.push("no taxi squad signal");
    confidence = draftCount <= 1 ? "high" : "low";
  }

  return {
    key,
    label,
    shortLabel:
      key === "bestball" ? "BB" :
      key === "dynasty" ? "DYN" :
      key === "keeper" ? "KPR" :
      "RED",
    confidence,
    reasons,
    flags: {
      bestBall,
      hasKeeperDeadline,
      hasKeeperCount,
      hasKeeperSignal,
      maxKeepers,
      taxiSlots,
      multiSeasonDrafts,
      draftCount,
      seasons,
      benchSlots,
      reserveSlots,
      smallDrafts,
      fullSizeDrafts,
      strongDynastySignal,
      dynastyScore,
      keeperScore,
    },
  };
}