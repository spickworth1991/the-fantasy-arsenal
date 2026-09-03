import { NextResponse } from "next/server";

export const runtime = "edge";

const SNAPSHOTS = {
  2025: {
    commit: "503c61e8ed0cbc698f6a1efaf4ab70d866f004c8",
    files: [
      ["Fantasy Football Analytics", "projections_2025.json"],
      ["ESPN", "projections_espn_2025.json"],
      ["CBS", "projections_cbs_2025.json"],
    ],
  },
};

export async function GET(request) {
  const season = Number(new URL(request.url).searchParams.get("season"));
  const snapshot = SNAPSHOTS[season];
  if (!snapshot) return NextResponse.json({ ok: false, season, message: "No frozen preseason snapshot is registered for this season." }, { status: 404 });

  const base = `https://raw.githubusercontent.com/spickworth1991/the-fantasy-arsenal/${snapshot.commit}/public`;
  const sources = await Promise.all(snapshot.files.map(async ([label, file]) => {
    try {
      const response = await fetch(`${base}/${file}`, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { label, file, data: await response.json(), available: true };
    } catch (error) {
      return { label, file, available: false, error: error?.message || "Unavailable" };
    }
  }));

  return NextResponse.json({ ok: sources.some((source) => source.available), season, snapshot: "preseason", commit: snapshot.commit, sources }, {
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" },
  });
}
