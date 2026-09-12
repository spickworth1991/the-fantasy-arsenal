const TEAM_ALIASES = { WSH: "WAS", JAX: "JAC", OAK: "LV", SD: "LAC", STL: "LAR" };

export const normalizeNflTeam = (value) => {
  const team = String(value || "").trim().toUpperCase();
  return TEAM_ALIASES[team] || team;
};

export const completedTeamsFromGames = (games = []) =>
  new Set(
    games.flatMap((game) => {
      const complete =
        game?.statusState === "post" ||
        String(game?.status || "").toLowerCase().startsWith("final");
      return complete
        ? (game.teams || []).map(normalizeNflTeam).filter(Boolean)
        : [];
    }),
  );

export async function fetchNflWeekStatus(season, week) {
  if (!season || !week)
    return { completedTeams: new Set(), gameCount: 0, allComplete: false };
  const query = `limit=100&dates=${encodeURIComponent(season)}&seasontype=2&week=${encodeURIComponent(week)}`;
  const endpoints = [
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${query}`,
    `https://cdn.espn.com/core/nfl/scoreboard?xhr=1&${query}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const events = Array.isArray(payload?.events)
        ? payload.events
        : payload?.content?.sbData?.events;
      if (!Array.isArray(events)) continue;
      const completedTeams = new Set(
        events.flatMap((event) => {
          const status = event?.status?.type;
          const complete =
            status?.state === "post" ||
            String(status?.description || status?.shortDetail || "")
              .toLowerCase()
              .startsWith("final");
          if (!complete) return [];
          return (event?.competitions?.[0]?.competitors || [])
            .map((entry) => normalizeNflTeam(entry?.team?.abbreviation))
            .filter(Boolean);
        }),
      );
      const completedGameCount = events.filter((event) => {
        const status = event?.status?.type;
        return status?.state === "post" || String(status?.description || status?.shortDetail || "").toLowerCase().startsWith("final");
      }).length;
      return {
        completedTeams,
        gameCount: events.length,
        allComplete: events.length > 0 && completedGameCount === events.length,
      };
    } catch {}
  }
  // A failed scoreboard lookup must not suppress legitimate recommendations.
  return { completedTeams: new Set(), gameCount: 0, allComplete: false };
}

export async function fetchCompletedNflTeams(season, week) {
  return (await fetchNflWeekStatus(season, week)).completedTeams;
}

export const playerGameIsComplete = (player, completedTeams) =>
  completedTeams?.has(normalizeNflTeam(player?.team));
