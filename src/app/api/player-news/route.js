import { NextResponse } from "next/server";

export const runtime = "edge";

const decode = (value = "") => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, "\"")
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "").trim();

export async function GET(request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ article: null }, { status: 400 });
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} NFL when:30d`)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, { headers: { "User-Agent": "The Fantasy Arsenal/1.0" }, next: { revalidate: 900 } });
    if (!response.ok) throw new Error(`News HTTP ${response.status}`);
    const xml = await response.text();
    const item = xml.match(/<item>([\s\S]*?)<\/item>/i)?.[1];
    if (!item) return NextResponse.json({ article: null });
    const rawTitle = tag(item, "title");
    const parts = rawTitle.split(" - ");
    const source = tag(item, "source") || (parts.length > 1 ? parts.pop() : "");
    return NextResponse.json({
      article: {
        title: parts.join(" - ") || rawTitle,
        source,
        link: tag(item, "link"),
        published: tag(item, "pubDate"),
      },
    });
  } catch {
    return NextResponse.json({ article: null });
  }
}
