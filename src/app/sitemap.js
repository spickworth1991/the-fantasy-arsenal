// Next.js Sitemap route
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thefantasyarsenal.com";

export default function sitemap() {
  const now = new Date();

  // Keep this list small + intentional (Google prefers stable, canonical URLs).
  const routes = [
    "",
    "/trade",
    "/player-stock/results",
    "/ballsville-stats",
    "/player-availability",
    "/power-rankings",
    "/sos",
    "/lineup",
    "/draft-pick-tracker",
    "/draft-helper",
    "/draft-grades",
    "/manager-intelligence",
    "/game-center",
    "/depth-charts",
    "/stat-central",
    "/intelligence",
    "/leaderboard",
    "/trust-center",
    "/league-hub",
    "/league-history",
    "/commissioner-dashboard",
    "/playoff-odds",
  ];

  return routes.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : ["/trade", "/player-stock/results", "/draft-pick-tracker", "/league-hub"].includes(path) ? 0.9 : 0.7,
  }));
}
