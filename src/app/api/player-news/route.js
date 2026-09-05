import { NextResponse } from "next/server";

export const runtime = "edge";

const decode = (value = "") => String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const textOnly = (value = "") => decode(value).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16))).replace(/\s+/g, " ").trim();
const absoluteFantasyPros = (value) => { try { return new URL(String(value || ""), "https://www.fantasypros.com").toString(); } catch { return ""; } };
const normalized = (value) => textOnly(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b/g, " ").replace(/\s+/g, " ").trim();
const categoryFor = (article) => {
  const value = `${article.title} ${article.summary}`.toLowerCase();
  if (/injur|questionable|doubtful|out\b|practice|surgery/.test(value)) return "Injury";
  if (/contract|extension|free agent|re-sign|signed/.test(value)) return "Contract";
  if (/trade|rumor/.test(value)) return "Trade";
  if (/depth chart|starter|role|snap|target|touch/.test(value)) return "Role";
  return "Fantasy impact";
};
const normalizeApi = (payload) => (payload?.items || payload?.news || []).map((item) => ({
  title: textOnly(item.title), source: "FantasyPros", link: absoluteFantasyPros(item.link),
  published: item.created || item.created_formated || "",
  summary: textOnly(item.desc || item.description || "").replace(/\s*view fantasy impact\s*»?\s*$/i, ""),
})).filter((article) => article.title && article.link);
const parsePage = (html) => [...String(html || "").matchAll(/<div class="player-news-item">([\s\S]*?)<\/div><!-- \.player-news-item -->/gi)].map((match) => {
  const block = match[1];
  const header = block.match(/player-news-header[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  const impact = block.match(/<b><em>Fantasy Impact:<\/em><\/b>\s*([\s\S]*?)<\/p>/i);
  const date = block.match(/<\/span><br\s*\/?>\s*<p>([\s\S]*?)<br>/i);
  return { title: textOnly(header?.[2]), source: "FantasyPros", link: absoluteFantasyPros(header?.[1]), published: textOnly(date?.[1]), summary: textOnly(impact?.[1]) };
}).filter((article) => article.title && article.link);
const belongsToPlayer = (article, playerName) => {
  const needle = normalized(playerName), haystack = normalized(`${article.title} ${article.summary}`);
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  const parts = needle.split(" ");
  return parts.length > 1 && haystack.includes(parts.at(-1)) && haystack.includes(parts[0]);
};

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  const position = String(params.get("position") || "").toUpperCase();
  if (!query) return NextResponse.json({ article: null, articles: [] }, { status: 400 });
  const candidates = [];
  if (process.env.FANTASYPROS_API_KEY) try {
    const response = await fetch("https://api.fantasypros.com/public/v2/json/nfl/news?limit=100", { headers: { "x-api-key": process.env.FANTASYPROS_API_KEY, Accept: "application/json" }, next: { revalidate: 900 } });
    if (response.ok) candidates.push(...normalizeApi(await response.json()));
  } catch {}
  if (!candidates.some((article) => belongsToPlayer(article, query))) try {
    const suffix = ["QB", "RB", "WR", "TE", "K", "DL"].includes(position) ? `?position=${position}` : "";
    const response = await fetch(`https://www.fantasypros.com/nfl/player-news.php${suffix}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TheFantasyArsenal/1.0; +https://thefantasyarsenal.com)", Accept: "text/html,application/xhtml+xml" }, next: { revalidate: 900 } });
    if (response.ok) candidates.push(...parsePage(await response.text()));
  } catch {}
  const seen = new Set();
  const articles = candidates.filter((article) => belongsToPlayer(article, query)).filter((article) => { const key = article.link || article.title; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 10).map((article) => ({ ...article, category: categoryFor(article) }));
  return NextResponse.json({ article: articles[0] || null, articles, source: "FantasyPros" });
}
