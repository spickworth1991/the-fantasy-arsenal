// /utils/nflByeWeeks.ts

import byes2026 from "../../public/byes/2026.json";

// 2025 NFL bye weeks by team (Weeks 5–14).
// Source: Fantasy Football Calculator – 2025 NFL Bye Weeks. :contentReference[oaicite:0]{index=0}

export const BYE_WEEKS: Record<string, Record<string, number | null>> = {
  "2025": {
    ARI: 8,
    ATL: 5,
    BAL: 7,
    BUF: 7,
    CAR: 14,
    CHI: 5,
    CIN: 10,
    CLE: 9,
    DAL: 10,
    DEN: 12,
    DET: 8,
    GB: 5,
    HOU: 6,
    IND: 11,
    JAX: 8,
    KC: 10,
    LAC: 12,
    LAR: 8,
    LV: 8,
    MIA: 12,
    MIN: 6,
    NE: 14,
    NO: 11,
    NYG: 14,
    NYJ: 9,
    PHI: 9,
    PIT: 5,
    SEA: 8,
    SF: 14,
    TB: 9,
    TEN: 10,
    WAS: 12,
  },
};

// Return the configured bye week for a team (1–18) or null if not configured.
export function getTeamByeWeek(team?: string, season?: number | string): number | null {
  if (!team) return null;
  const yr = String(season ?? new Date().getFullYear());
  if (yr === String(byes2026.season)) {
    const weeks = byes2026.by_team?.[team.toUpperCase() as keyof typeof byes2026.by_team];
    const bye = Array.isArray(weeks) ? weeks[0] : null;
    return Number.isFinite(bye) ? bye : null;
  }
  const map = BYE_WEEKS[yr];
  if (!map) return null;
  const bye = map[team.toUpperCase()];
  return Number.isFinite(bye as number) ? (bye as number) : null;
}
