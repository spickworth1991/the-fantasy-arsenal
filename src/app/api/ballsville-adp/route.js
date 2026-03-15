export const runtime = "edge";

const CANDIDATE_BASES = [
  process.env.NEXT_PUBLIC_BALLSVILLE_BASE_URL || "",
  "https://www.theballsvillegame.com",
  "https://theballsvillegame.com",
].filter(Boolean);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      ...(init.headers || {}),
    },
  });
}

function sanitizeKey(value) {
  const key = String(value || "").replace(/^\/+/, "").trim();
  if (!key) return "";
  if (key.includes("..")) return "";
  if (!/^data\/draft-compare\/[A-Za-z0-9._\/-]+\.json$/.test(key)) return "";
  return key;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const key = sanitizeKey(searchParams.get("key"));
  if (!key) {
    return json({ error: "Invalid key" }, { status: 400 });
  }

  for (const base of CANDIDATE_BASES) {
    const url = `${String(base).replace(/\/$/, "")}/r2/${key}`;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      if (!res.ok) continue;
      const text = await res.text();
      return new Response(text, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        },
      });
    } catch {}
  }

  return json({ error: "Ballsville data unavailable", key }, { status: 502 });
}
