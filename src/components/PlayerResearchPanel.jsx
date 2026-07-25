"use client";

import { useEffect, useState } from "react";

export default function PlayerResearchPanel({ player, name }) {
  const [article,setArticle]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    fetch(`/api/player-news?q=${encodeURIComponent(name)}`)
      .then(response=>response.ok?response.json():null)
      .then(payload=>{if(active)setArticle(payload?.article||null);})
      .catch(()=>{})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[name]);
  const newsUrl=`https://news.google.com/search?q=${encodeURIComponent(`${name} NFL`)}`;
  const contractUrl=`https://www.spotrac.com/search?q=${encodeURIComponent(name)}`;
  return <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-black">News and player context</h3><span className="text-[10px] text-white/30">External research</span></div><div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 sm:p-4"><div className="grid grid-cols-2 gap-2 text-center text-[10px] sm:grid-cols-4"><div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.injury_status||"Clear"}</b>Injury</div><div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.depth_chart_order||player?.depth_chart_position||"—"}</b>Depth chart</div><div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.years_exp??"—"}</b>Years exp.</div><div className="rounded-xl bg-black/20 p-2"><b className="block text-sm text-white/80">{player?.status||"Unknown"}</b>Status</div></div>{article?<a href={article.link} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3 transition hover:bg-cyan-300/[0.07]"><div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-100/45">Latest article</div><div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-white/75">{article.title}</div><div className="mt-1 text-[9px] text-white/30">{article.source||"Latest coverage"}{article.published?` · ${new Date(article.published).toLocaleDateString()}`:""} · Read article ↗</div></a>:<div className="mt-3 rounded-xl bg-black/15 p-3 text-xs text-white/30">{loading?"Finding recent coverage…":"No recent article was found."}</div>}<div className="mt-3 flex flex-wrap gap-2"><a href={newsUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-cyan-300/[0.07] px-3 py-2 text-xs font-semibold text-cyan-100">View all news ↗</a><a href={contractUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-violet-300/[0.07] px-3 py-2 text-xs font-semibold text-violet-100">Contract details ↗</a></div></div></section>;
}
