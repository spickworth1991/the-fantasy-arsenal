export const runtime = "edge";

import { NextResponse } from "next/server";

// Fetches the full draft "bundle" needed by the Draft Pick Tracker UI.
// Query params:
//   - draftId (required)
//   - leagueId (recommended; used to fetch users/rosters for roster->name + myRosterId)
//
// Returns:
//   { ok: true, draft, picks, users, rosters, traded_picks }

const json = (data, init = {}) =>
  NextResponse.json(data, {
    ...init,
    headers: {
      // short shared cache; client still polls frequently
      "cache-control": "public, max-age=5, s-maxage=10, stale-while-revalidate=30",
      ...(init.headers || {}),
    },
  });

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const draftId = String(searchParams.get("draftId") || "").trim();
    const leagueId = String(searchParams.get("leagueId") || "").trim();

    if (!draftId) {
      return json({ ok: false, error: "Missing draftId" }, { status: 400 });
    }

    const base = "https://api.sleeper.app/v1";
    const draftUrl = `${base}/draft/${encodeURIComponent(draftId)}`;
    const picksUrl = `${base}/draft/${encodeURIComponent(draftId)}/picks`;
    const tradedUrl = `${base}/draft/${encodeURIComponent(draftId)}/traded_picks`;

    const [draftRes, picksRes, tradedRes] = await Promise.all([
      fetch(draftUrl, { cf: { cacheTtl: 10, cacheEverything: true } }),
      fetch(picksUrl, { cf: { cacheTtl: 5, cacheEverything: true } }),
      fetch(tradedUrl, { cf: { cacheTtl: 10, cacheEverything: true } }),
    ]);

    if (!draftRes.ok) {
      return json(
        { ok: false, error: `Sleeper draft fetch failed (${draftRes.status})` },
        { status: 502 }
      );
    }

    const draft = await draftRes.json();
    const picks = picksRes.ok ? await picksRes.json() : [];
    const traded_picks = tradedRes.ok ? await tradedRes.json() : [];

    let users = [];
    let rosters = [];
    if (leagueId) {
      const usersUrl = `${base}/league/${encodeURIComponent(leagueId)}/users`;
      const rostersUrl = `${base}/league/${encodeURIComponent(leagueId)}/rosters`;
      const [usersRes, rostersRes] = await Promise.all([
        fetch(usersUrl, { cf: { cacheTtl: 60, cacheEverything: true } }),
        fetch(rostersUrl, { cf: { cacheTtl: 60, cacheEverything: true } }),
      ]);
      users = usersRes.ok ? await usersRes.json() : [];
      rosters = rostersRes.ok ? await rostersRes.json() : [];
    }

    return json({
      ok: true,
      draft,
      picks: Array.isArray(picks) ? picks : [],
      users: Array.isArray(users) ? users : [],
      rosters: Array.isArray(rosters) ? rosters : [],
      traded_picks: Array.isArray(traded_picks) ? traded_picks : [],
    });
  } catch (e) {
    return json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
