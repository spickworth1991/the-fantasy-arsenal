// Next.js Sitemap route
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thefantasyarsenal.com";

export default function sitemap() {
  const now = new Date();

  // Keep this list small + intentional (Google prefers stable, canonical URLs).
  const routes = [
    "",
    "/trade",
    "/player-stock",
    "/player-availability",
    "/power-rankings",
    "/sos",
    "/lineup",
    "/draft-pick-tracker",
  ];

  return routes.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
