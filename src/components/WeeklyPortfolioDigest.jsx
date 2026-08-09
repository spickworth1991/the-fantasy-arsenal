"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSleeper } from "../context/SleeperContext";
import { useArsenalAccount } from "../context/ArsenalAccountContext";
import { classifyLeagueFormat } from "../lib/leagueFormat";

const n = (v) => Number(v || 0);
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sleeper HTTP ${r.status}`);
  return r.json();
};
const Panel = ({ children, className = "" }) => (
  <section
    className={`rounded-[26px] border border-white/10 bg-gradient-to-b from-slate-900/95 to-slate-950/90 ${className}`}
  >
    {children}
  </section>
);
const Metric = ({ label, value, detail }) => (
  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
    <div className="text-[9px] font-bold uppercase tracking-wider text-white/30">
      {label}
    </div>
    <div className="mt-1 text-xl font-black">{value}</div>
    {detail ? (
      <div className="mt-1 text-[10px] text-white/32">{detail}</div>
    ) : null}
  </div>
);

export default function WeeklyPortfolioDigest() {
  const { username, leagues = [] } = useSleeper();
  const { account, accountRequest, syncNow } = useArsenalAccount();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [deliveryDay, setDeliveryDay] = useState(2);
  const [includeNews, setIncludeNews] = useState(true);
  const [newsEnabled, setNewsEnabled] = useState(false);
  const [newsDeliveryDays, setNewsDeliveryDays] = useState([4]);
  const [commissionerUrgent, setCommissionerUrgent] = useState(false);
  const [includeBestBall, setIncludeBestBall] = useState(false);
  const [digestLeagueIds, setDigestLeagueIds] = useState([]);
  const [message, setMessage] = useState("");
  const season = new Date().getFullYear();
  const week = Math.max(1, n(leagues[0]?.settings?.leg) || 1);
  useEffect(() => {
    const restore = () => {
      try {
        const p = JSON.parse(
          localStorage.getItem("tfa:account-preferences") || "{}",
        );
        setEmail(p.digestEmail || "");
        setEmailEnabled(!!p.weeklyDigest);
        setDeliveryDay(n(p.digestDeliveryDay ?? 2));
        setIncludeNews(p.digestIncludeNews !== false);
        setNewsEnabled(!!p.newsBrief);
        setCommissionerUrgent(!!p.newsCommissionerUrgent);
        setIncludeBestBall(!!p.digestIncludeBestBall);
        setDigestLeagueIds(
          Array.isArray(p.digestLeagueIds) ? p.digestLeagueIds.map(String) : [],
        );
        const savedNewsDays = (
          Array.isArray(p.newsDeliveryDays)
            ? p.newsDeliveryDays
            : [p.newsDeliveryDay ?? 4]
        )
          .map(n)
          .filter((day) => day >= 0 && day <= 6);
        setNewsDeliveryDays(
          savedNewsDays.length
            ? [...new Set(savedNewsDays)].sort((a, b) => a - b)
            : [4],
        );
      } catch {}
    };
    restore();
    window.addEventListener("tfa:cloud-sync-applied", restore);
    return () => window.removeEventListener("tfa:cloud-sync-applied", restore);
  }, []);
  const eligibleLeagues = useMemo(
    () =>
      leagues.filter(
        (league) =>
          includeBestBall || !classifyLeagueFormat(league).flags.bestBall,
      ),
    [includeBestBall, leagues],
  );
  const digestLeagues = useMemo(() => {
    const selected = new Set(digestLeagueIds.map(String));
    return selected.size
      ? eligibleLeagues.filter((league) =>
          selected.has(String(league.league_id)),
        )
      : eligibleLeagues;
  }, [digestLeagueIds, eligibleLeagues]);
  useEffect(() => {
    if (!username || !leagues.length) return;
    let live = true;
    setLoading(true);
    setError("");
    (async () => {
      const user = await get(
        `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`,
      );
      const data = await Promise.all(
        digestLeagues.map(async (league) => {
          const [rosters, users, matchups] = await Promise.all([
            get(
              `https://api.sleeper.app/v1/league/${league.league_id}/rosters`,
            ).catch(() => []),
            get(
              `https://api.sleeper.app/v1/league/${league.league_id}/users`,
            ).catch(() => []),
            get(
              `https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`,
            ).catch(() => []),
          ]);
          const mine = rosters.find(
            (r) => String(r.owner_id) === String(user.user_id),
          );
          if (!mine) return null;
          const my = matchups.find(
            (m) => String(m.roster_id) === String(mine.roster_id),
          );
          const opp = matchups.find(
            (m) =>
              m.matchup_id === my?.matchup_id &&
              String(m.roster_id) !== String(mine.roster_id),
          );
          const oppRoster = rosters.find(
            (r) => String(r.roster_id) === String(opp?.roster_id),
          );
          const oppUser = users.find(
            (u) => String(u.user_id) === String(oppRoster?.owner_id),
          );
          const points = n(my?.points),
            oppPoints = n(opp?.points);
          const empty = (my?.starters || []).filter(
            (id) => !id || id === "0",
          ).length;
          const started = points > 0 || oppPoints > 0;
          return {
            id: league.league_id,
            name: league.name,
            points,
            oppPoints,
            margin: points - oppPoints,
            started,
            result: !started
              ? "Not started"
              : points > oppPoints
                ? "Winning"
                : points < oppPoints
                  ? "Losing"
                  : "Tied",
            empty,
            opponent: oppUser?.display_name || oppUser?.username || "Opponent",
          };
        }),
      );
      if (live) setRows(data.filter(Boolean));
    })()
      .catch((e) => live && setError(e.message || "Digest unavailable."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [username, digestLeagues, week]);
  const summary = useMemo(() => {
    const active = rows.filter((r) => r.started),
      wins = active.filter((r) => r.margin > 0).length,
      losses = active.filter((r) => r.margin < 0).length,
      ties = active.length - wins - losses,
      points = rows.reduce((s, r) => s + r.points, 0),
      close = active.filter((r) => Math.abs(r.margin) <= 10).length,
      empty = rows.reduce((s, r) => s + r.empty, 0),
      gradedEmpty = active.reduce((s, r) => s + r.empty, 0);
    if (!active.length)
      return {
        wins: 0,
        losses: 0,
        ties: 0,
        started: 0,
        points,
        close: 0,
        empty,
        score: null,
        grade: "—",
        best: null,
        worst: null,
      };
    const winRate = (wins + ties * 0.5) / active.length;
    const score = Math.round(
      Math.max(0, Math.min(100, 76 + winRate * 22 - gradedEmpty * 4)),
    );
    return {
      wins,
      losses,
      ties,
      started: active.length,
      points,
      close,
      empty,
      score,
      grade:
        score >= 97
          ? "A+"
          : score >= 93
            ? "A"
            : score >= 90
              ? "A−"
              : score >= 87
                ? "B+"
                : score >= 83
                  ? "B"
                  : score >= 80
                    ? "B−"
                    : score >= 77
                      ? "C+"
                      : score >= 73
                        ? "C"
                        : "D",
      best: [...active].sort((a, b) => b.margin - a.margin)[0],
      worst: [...active].sort((a, b) => a.margin - b.margin)[0],
    };
  }, [rows]);
  const toggleNewsDay = (day) =>
    setNewsDeliveryDays((current) =>
      current.includes(day)
        ? current.length > 1
          ? current.filter((item) => item !== day)
          : current
        : [...current, day].sort((a, b) => a - b),
    );
  const saveEmail = async () => {
    setMessage("");
    const newsDeliveryDay = newsDeliveryDays[0] ?? 4;
    const prefs = {
      ...JSON.parse(localStorage.getItem("tfa:account-preferences") || "{}"),
      weeklyDigest: emailEnabled,
      digestEmail: email.trim(),
      digestDeliveryDay: deliveryDay,
      digestIncludeNews: includeNews,
      newsBrief: newsEnabled,
      newsDeliveryDay,
      newsDeliveryDays,
      newsCommissionerUrgent: commissionerUrgent,
      digestIncludeBestBall: includeBestBall,
      digestLeagueIds,
    };
    localStorage.setItem("tfa:account-preferences", JSON.stringify(prefs));
    await syncNow();
    await accountRequest("/api/arsenal/digest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        enabled: emailEnabled,
        deliveryDay,
        includeNews,
        newsEnabled,
        newsDeliveryDay,
        newsDeliveryDays,
        commissionerUrgent,
        includeBestBall,
        leagueIds: digestLeagueIds,
      }),
    });
    setMessage(
      emailEnabled || newsEnabled
        ? "Email preferences saved."
        : "Email delivery disabled.",
    );
  };
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.14),transparent_42%)] p-5">
        <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200/55">
          Week {week} · {season}
        </div>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-black">Weekly Portfolio Digest</h2>
            <p className="mt-1 text-xs leading-5 text-white/38">
              One account-level recap across every loaded league, with urgent
              problems and direct next steps.
            </p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-black text-cyan-100">
              {summary.grade}
            </div>
            <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-white/30">
              {summary.started
                ? `${summary.started} live matchup${summary.started === 1 ? "" : "s"}`
                : "Grading begins at kickoff"}
            </div>
          </div>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        {loading ? (
          <div className="text-sm text-white/40">
            Building this week’s portfolio story…
          </div>
        ) : error ? (
          <div className="text-sm text-rose-100">{error}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
              <Metric
                label="Live record"
                value={
                  summary.started
                    ? `${summary.wins}-${summary.losses}${summary.ties ? `-${summary.ties}` : ""}`
                    : "Not started"
                }
              />
              <Metric label="Points" value={summary.points.toFixed(1)} />
              <Metric label="Close live games" value={summary.close} />
              <Metric label="Lineup zeros" value={summary.empty} />
              <Metric
                label="Best live result"
                value={
                  summary.best
                    ? `${summary.best.margin >= 0 ? "+" : ""}${summary.best.margin.toFixed(1)}`
                    : "—"
                }
                detail={summary.best?.name}
              />
              <Metric
                label="Biggest live concern"
                value={
                  summary.worst ? `${summary.worst.margin.toFixed(1)}` : "—"
                }
                detail={summary.worst?.name}
              />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[...rows]
                .sort(
                  (a, b) =>
                    Number(b.started) - Number(a.started) ||
                    (a.started
                      ? Math.abs(a.margin) - Math.abs(b.margin)
                      : a.name.localeCompare(b.name)),
                )
                .slice(0, 8)
                .map((r) => (
                  <Link
                    key={r.id}
                    href={`/league-hub?league=${r.id}`}
                    className="rounded-2xl border border-white/[0.07] bg-black/15 p-3 transition hover:bg-white/[0.04]"
                  >
                    <div className="flex justify-between gap-3">
                      <b className="truncate">{r.name}</b>
                      <span
                        className={
                          !r.started
                            ? "text-white/35"
                            : r.margin >= 0
                              ? "text-emerald-100"
                              : "text-rose-100"
                        }
                      >
                        {r.started
                          ? `${r.margin >= 0 ? "+" : ""}${r.margin.toFixed(1)}`
                          : "Not started"}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-white/32">
                      {r.started
                        ? `${r.points.toFixed(1)}–${r.oppPoints.toFixed(1)}`
                        : "0–0"}{" "}
                      vs {r.opponent}
                      {r.empty ? ` · ${r.empty} empty slot` : ""}
                    </div>
                  </Link>
                ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/game-center"
                className="rounded-xl bg-cyan-300/10 px-4 py-2 text-xs font-black text-cyan-100"
              >
                Open live command center
              </Link>
              <Link
                href="/lineup"
                className="rounded-xl bg-white/[0.05] px-4 py-2 text-xs font-black"
              >
                Review lineups
              </Link>
              <Link
                href="/player-availability"
                className="rounded-xl bg-white/[0.05] px-4 py-2 text-xs font-black"
              >
                Find acquisitions
              </Link>
            </div>
          </>
        )}
      </div>
      <div className="border-t border-white/10 p-4 sm:p-5">
        <h3 className="font-black">Email intelligence</h3>
        <p className="mt-1 text-xs text-white/35">
          Choose your portfolio-delivery day and optionally receive a separate
          Daily Intelligence Wire.
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2"
        />
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.025] p-4">
            <label className="flex items-center justify-between gap-3 text-sm font-black">
              <span>Weekly Portfolio Digest</span>
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="h-4 w-4 accent-cyan-300"
              />
            </label>
            <p className="mt-1 text-[10px] leading-4 text-white/32">
              League summary, action list, playoff announcements, and up to
              three FantasyPros updates.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[10px] text-white/38">
                Delivery day
                <select
                  value={deliveryDay}
                  onChange={(event) => setDeliveryDay(n(event.target.value))}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 p-2 text-xs text-white"
                >
                  {DAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-end">
                <span className="flex min-h-9 w-full items-center gap-2 rounded-xl bg-white/[0.04] px-3 text-[10px]">
                  <input
                    type="checkbox"
                    checked={includeNews}
                    onChange={(event) => setIncludeNews(event.target.checked)}
                    className="accent-amber-300"
                  />{" "}
                  Include top 3 news
                </span>
              </label>
            </div>
          </div>
          <div className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.025] p-4">
            <label className="flex items-center justify-between gap-3 text-sm font-black">
              <span>Daily Intelligence Wire</span>
              <input
                type="checkbox"
                checked={newsEnabled}
                onChange={(e) => setNewsEnabled(e.target.checked)}
                className="h-4 w-4 accent-amber-300"
              />
            </label>
            <p className="mt-1 text-[10px] leading-4 text-white/32">
              Urgent portfolio actions, FantasyPros player news, and
              Schefter/Rapoport insider updates.
            </p>
            <div className="mt-3">
              <div className="text-[10px] text-white/38">Delivery days</div>
              <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {DAYS.map((day, index) => {
                  const selected = newsDeliveryDays.includes(index);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleNewsDay(index)}
                      aria-pressed={selected}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-black transition ${selected ? "border-amber-300/35 bg-amber-300/15 text-amber-100 shadow-[0_0_18px_rgba(252,211,77,0.08)]" : "border-white/8 bg-white/[0.025] text-white/35 hover:border-white/15 hover:text-white/65"}`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[9px] text-white/28">
                Select one or more days—or all seven for a true daily briefing.
              </p>
            </div>
          </div>
        </div>
        <details className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-3">
          <summary className="cursor-pointer text-xs font-black">
            League delivery scope · {digestLeagues.length} of {leagues.length}
          </summary>
          <label className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.035] p-3 text-xs">
            <span>
              Include Best Ball leagues{" "}
              <small className="text-white/30">Off by default</small>
            </span>
            <input
              type="checkbox"
              checked={includeBestBall}
              onChange={(event) => {
                setIncludeBestBall(event.target.checked);
                setDigestLeagueIds([]);
              }}
            />
          </label>
          <p className="mt-2 text-[10px] text-white/32">
            Leave every league unchecked to use all eligible leagues, or choose
            specific leagues.
          </p>
          <div className="mt-2 grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">
            {eligibleLeagues.map((league) => {
              const id = String(league.league_id);
              const checked = digestLeagueIds.includes(id);
              return (
                <label
                  key={id}
                  className="flex items-center gap-2 rounded-xl bg-white/[0.025] p-2 text-[10px] text-white/50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setDigestLeagueIds((current) =>
                        checked
                          ? current.filter((item) => item !== id)
                          : [...current, id],
                      )
                    }
                  />
                  <span className="truncate">{league.name}</span>
                </label>
              );
            })}
          </div>
          {digestLeagueIds.length ? (
            <button
              type="button"
              onClick={() => setDigestLeagueIds([])}
              className="mt-2 rounded-lg bg-white/[0.05] px-3 py-2 text-[10px]"
            >
              Use all eligible leagues
            </button>
          ) : null}
        </details>
        <button
          onClick={saveEmail}
          disabled={
            !account || ((emailEnabled || newsEnabled) && !email.includes("@"))
          }
          className="mt-3 w-full rounded-xl bg-violet-300/10 px-4 py-3 text-xs font-black text-violet-100 disabled:opacity-35"
        >
          Save email preferences
        </button>
        {message ? (
          <div className="mt-2 text-xs text-emerald-100">{message}</div>
        ) : null}
      </div>
    </Panel>
  );
}
