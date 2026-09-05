"use client";

import { useEffect, useState } from "react";

export default function PlayerResearchPanel({ player, name, expanded = false }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/player-news?q=${encodeURIComponent(name)}&position=${encodeURIComponent(player?.position || "")}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (active) setArticles(Array.isArray(payload?.articles) ? payload.articles : payload?.article ? [payload.article] : []);
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [name, player?.position]);

  const shown = expanded ? articles : articles.slice(0, 1);
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(`${name} NFL`)}`;
  const contractUrl = `https://www.spotrac.com/search?q=${encodeURIComponent(name)}`;

  return (
    <section>
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-sm font-black">Player context</h3>
        <span className="text-[10px] text-white/30">Status and research links</span>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 text-center text-[10px] min-[350px]:grid-cols-2 sm:grid-cols-4">
          <div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.injury_status || "Clear"}</b>Injury</div>
          <div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.depth_chart_order || player?.depth_chart_position || "—"}</b>Depth order</div>
          <div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.years_exp ?? "—"}</b>Years exp.</div>
          <div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.status || "Unknown"}</b>Status</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={newsUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-cyan-300/[0.07] px-3 py-2 text-xs font-semibold text-cyan-100">View all news ↗</a>
          <a href={contractUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-violet-300/[0.07] px-3 py-2 text-xs font-semibold text-violet-100">Contract details ↗</a>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.12),transparent_55%),rgba(255,255,255,.025)] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-100/55">FantasyPros player news</div>
            <h3 className="mt-1 text-lg font-black">Current news</h3>
          </div>
          <span className="shrink-0 text-[10px] text-white/30">{articles.length ? `${articles.length} update${articles.length === 1 ? "" : "s"}` : "Player specific"}</span>
        </div>
        <div className="mt-3 space-y-2">
          {shown.map((article) => (
            <a key={`${article.link}-${article.title}`} href={article.link} target="_blank" rel="noreferrer" className="block rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3 transition hover:bg-cyan-300/[0.07]">
              <div className="flex items-center justify-between gap-3 text-[9px] font-semibold uppercase tracking-wider">
                <span className="text-cyan-100/55">{article.category || "News"}</span>
                <span className="text-white/25">{article.published ? new Date(article.published).toLocaleDateString() : ""}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-white/75">{article.title}</div>
              {article.summary ? <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-white/45">{article.summary}</p> : null}
              <div className="mt-1 text-[9px] text-white/30">{article.source || "Latest coverage"} · Read article ↗</div>
            </a>
          ))}
          {!shown.length ? <div className="rounded-xl bg-black/15 p-3 text-xs text-white/30">{loading ? "Checking FantasyPros for player-specific updates…" : "FantasyPros does not currently have a player-specific update for this player."}</div> : null}
        </div>
      </div>
    </section>
  );
}
