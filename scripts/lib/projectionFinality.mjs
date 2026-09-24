const DEFAULT_FALLBACK_HOURS = 6;

export const normalizeFinalStatus = (game) => {
  if (game?.completed === true) return "final";
  if (game?.completed === false) return "scheduled";
  const state = String(game?.status_state || game?.statusState || "").toLowerCase();
  const detail = String(
    game?.status || game?.status_detail || game?.statusDetail || "",
  ).toLowerCase();
  if (state === "post" || detail.startsWith("final")) return "final";
  if (state === "in" || /quarter|halftime|overtime/.test(detail)) return "live";
  return "unknown";
};

export function gameFinality(
  game,
  { now = Date.now(), fallbackHours = DEFAULT_FALLBACK_HOURS } = {},
) {
  const kickoff = Date.parse(game?.date || game?.kickoff);
  const status = normalizeFinalStatus(game);
  const fallbackFinalAt = Number.isFinite(kickoff)
    ? kickoff + fallbackHours * 60 * 60 * 1000
    : Number.POSITIVE_INFINITY;
  const final =
    status === "final" ||
    (status === "unknown" && Number.isFinite(kickoff) && now >= fallbackFinalAt);
  return {
    kickoff,
    status,
    final,
    finalAt: status === "final" ? kickoff : fallbackFinalAt,
    finalitySource:
      status === "final" ? "provider_status" : status === "unknown" ? "kickoff_fallback" : "provider_status",
  };
}

export function finalScheduleWeeks(schedule, options = {}) {
  return new Set(
    (schedule?.weeks || [])
      .filter(
        ({ games }) =>
          (games || []).length > 0 &&
          games.every((game) => gameFinality(game, options).final),
      )
      .map(({ week }) => Number(week)),
  );
}

export function resultsReadyScheduleWeeks(schedule, options = {}) {
  return new Set(
    (schedule?.weeks || [])
      .filter(({ games }) =>
        (games || []).some((game) => gameFinality(game, options).final),
      )
      .map(({ week }) => Number(week)),
  );
}

export function latestFinalWeek(schedule, options = {}) {
  const weeks = [...finalScheduleWeeks(schedule, options)];
  return weeks.length ? Math.max(...weeks) : null;
}

