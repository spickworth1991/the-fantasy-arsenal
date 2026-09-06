import { NextResponse } from "next/server";

export const runtime = "edge";

const SOURCE_ORIGIN = "https://www.fantasysharks.com";
const SOURCE_PATH = "/apps/bert/forecasts/projections.php";

const sourceHeaders = {
  Accept: "text/html,application/xhtml+xml,text/csv;q=0.9,*/*;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (compatible; TheFantasyArsenal/1.0; +https://thefantasyarsenal.com)",
};

export async function GET(request) {
  const segment = String(request.nextUrl.searchParams.get("segment") || "");
  if (segment && !/^\d{1,8}$/.test(segment))
    return NextResponse.json({ error: "Invalid season segment." }, { status: 400 });

  const upstream = new URL(SOURCE_PATH, SOURCE_ORIGIN);
  if (segment) {
    upstream.searchParams.set("csv", "1");
    upstream.searchParams.set("Sort", "");
    upstream.searchParams.set("Segment", segment);
    upstream.searchParams.set("Position", "99");
    upstream.searchParams.set("scoring", "2");
    upstream.searchParams.set("League", "");
    upstream.searchParams.set("uid", "4");
    upstream.searchParams.set("uid2", "");
    upstream.searchParams.set("printable", "");
  } else {
    upstream.searchParams.set("Position", "");
  }

  try {
    const response = await fetch(upstream, {
      headers: sourceHeaders,
      cf: { cacheEverything: true, cacheTtl: 900 },
    });
    if (!response.ok)
      return NextResponse.json(
        { error: `FantasySharks returned HTTP ${response.status}.` },
        { status: 502 },
      );

    return new NextResponse(await response.text(), {
      status: 200,
      headers: {
        "Content-Type": segment
          ? "text/csv; charset=utf-8"
          : "text/html; charset=utf-8",
        "Cache-Control":
          "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upstream request failed." },
      { status: 502 },
    );
  }
}
