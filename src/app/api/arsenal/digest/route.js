export const runtime = "edge";

import { NextResponse } from "next/server";
import {
  arsenalDb,
  arsenalEnv,
  authenticateArsenal,
  ensureArsenalSchema,
} from "../../../../lib/arsenalAccountServer";
import { classifyLeagueFormat } from "../../../../lib/leagueFormat";

const json = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sleeper HTTP ${r.status}`);
  return r.json();
};
const num = (v) => Number(v || 0);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const DIGEST_TEST_EMAIL = "spickworth1991@gmail.com";
const localWeekday = (timezone = "America/New_York") => {
  const short = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timezone,
  }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
};
const decodeXml = (value = "") =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const xmlTag = (xml, name) =>
  decodeXml(
    xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ||
      "",
  ).trim();
const textOnly = (value = "") =>
  decodeXml(
    String(value)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        String.fromCharCode(parseInt(code, 16)),
      )
      .replace(/\s+/g, " ")
      .trim(),
  );
const absoluteFantasyPros = (value) =>
  new URL(String(value || ""), "https://www.fantasypros.com").toString();
function normalizeFantasyProsApi(payload) {
  return (payload?.items || payload?.news || [])
    .map((item) => ({
      title: textOnly(item.title),
      source: "FantasyPros",
      link: absoluteFantasyPros(item.link),
      published: item.created || item.created_formated || "",
      summary: textOnly(item.desc || item.description || "").replace(
        /\s*view fantasy impact\s*»?\s*$/i,
        "",
      ),
    }))
    .filter((article) => article.title && /^https?:\/\//i.test(article.link));
}
function parseFantasyProsPage(html) {
  return [
    ...String(html || "").matchAll(
      /<div class="player-news-item">([\s\S]*?)<\/div><!-- \.player-news-item -->/gi,
    ),
  ]
    .map((match) => {
      const block = match[1];
      const header = block.match(
        /player-news-header[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const impact = block.match(
        /<b><em>Fantasy Impact:<\/em><\/b>\s*([\s\S]*?)<\/p>/i,
      );
      const date = block.match(/<\/span><br\s*\/?><p>([\s\S]*?)<br>/i);
      return {
        title: textOnly(header?.[2]),
        source: "FantasyPros",
        link: absoluteFantasyPros(header?.[1]),
        published: textOnly(date?.[1]),
        summary: textOnly(impact?.[1]),
      };
    })
    .filter((article) => article.title && /^https?:\/\//i.test(article.link));
}
async function fantasyProsNews(env) {
  if (env.FANTASYPROS_API_KEY)
    try {
      const response = await fetch(
        "https://api.fantasypros.com/public/v2/json/nfl/news?limit=10",
        {
          headers: {
            "x-api-key": env.FANTASYPROS_API_KEY,
            Accept: "application/json",
          },
          cf: { cacheTtl: 900, cacheEverything: true },
        },
      );
      if (response.ok) {
        const articles = normalizeFantasyProsApi(await response.json());
        if (articles.length)
          return {
            articles: articles.slice(0, 10),
            mode: "official API",
            ok: true,
          };
      }
    } catch {}
  try {
    const urls = [
      "",
      "?position=QB",
      "?position=RB",
      "?position=WR",
      "?position=TE",
      "?position=K",
      "?position=DL",
    ];
    const settled = await Promise.allSettled(
      urls.map(async (query) => {
        const response = await fetch(
          `https://www.fantasypros.com/nfl/player-news.php${query}`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; TheFantasyArsenal/1.0; +https://thefantasyarsenal.com)",
              Accept: "text/html,application/xhtml+xml",
            },
            cf: { cacheTtl: 900, cacheEverything: true },
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseFantasyProsPage(await response.text());
      }),
    );
    const seen = new Set(),
      articles = [];
    for (const result of settled)
      if (result.status === "fulfilled")
        for (const article of result.value) {
          const key =
            article.link ||
            article.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          articles.push(article);
        }
    const publishedTime = (article) =>
      Date.parse(
        String(article.published || "").replace(/(\d+)(st|nd|rd|th)/i, "$1"),
      ) || 0;
    articles.sort((a, b) => publishedTime(b) - publishedTime(a));
    return {
      articles: articles.slice(0, 10),
      mode: "public player-news position feeds",
      ok: articles.length > 0,
    };
  } catch {
    return {
      articles: [],
      mode: env.FANTASYPROS_API_KEY
        ? "API and page unavailable"
        : "public page unavailable",
      ok: false,
    };
  }
}
async function xInsiderPosts(env) {
  const profiles = [
    { username: "AdamSchefter", name: "Adam Schefter" },
    { username: "RapSheet", name: "Ian Rapoport" },
  ];
  if (!env.X_BEARER_TOKEN)
    return {
      posts: [],
      configured: false,
      profiles,
      status: "X API token not configured",
    };
  try {
    const headers = {
      Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
      Accept: "application/json",
    };
    const users = await Promise.all(
      profiles.map(async (profile) => {
        const response = await fetch(
          `https://api.x.com/2/users/by/username/${profile.username}`,
          { headers, cf: { cacheTtl: 900, cacheEverything: true } },
        );
        if (!response.ok)
          throw new Error(`${profile.username} lookup HTTP ${response.status}`);
        return { ...profile, id: (await response.json())?.data?.id };
      }),
    );
    const timelines = await Promise.all(
      users.map(async (user) => {
        const response = await fetch(
          `https://api.x.com/2/users/${user.id}/tweets?max_results=10&exclude=retweets,replies&tweet.fields=created_at,public_metrics`,
          { headers, cf: { cacheTtl: 900, cacheEverything: true } },
        );
        if (!response.ok)
          throw new Error(`${user.username} timeline HTTP ${response.status}`);
        const payload = await response.json();
        return (payload.data || []).map((post) => ({
          ...post,
          username: user.username,
          name: user.name,
          engagement:
            num(post.public_metrics?.like_count) +
            num(post.public_metrics?.retweet_count) * 2 +
            num(post.public_metrics?.reply_count),
        }));
      }),
    );
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const recent = timelines
      .flat()
      .filter(
        (post) =>
          !post.created_at || new Date(post.created_at).getTime() >= cutoff,
      );
    const pool = recent.length ? recent : timelines.flat();
    return {
      posts: pool
        .sort(
          (a, b) =>
            b.engagement - a.engagement ||
            new Date(b.created_at) - new Date(a.created_at),
        )
        .slice(0, 6)
        .map((post) => ({
          title: textOnly(post.text),
          source: post.name,
          link: `https://x.com/${post.username}/status/${post.id}`,
          published: post.created_at,
          engagement: post.engagement,
        })),
      configured: true,
      profiles,
      status: "connected",
    };
  } catch (error) {
    return {
      posts: [],
      configured: true,
      profiles,
      status: String(error?.message || error).slice(0, 140),
    };
  }
}
async function dailyNews(env) {
  const [fantasyPros, insiders] = await Promise.all([
    fantasyProsNews(env),
    xInsiderPosts(env),
  ]);
  const seen = new Set(),
    articles = [];
  for (const article of fantasyPros.articles) {
    const key = article.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    articles.push(article);
  }
  return {
    articles: articles.slice(0, 10),
    insiders,
    sources: [
      {
        source: "FantasyPros",
        ok: fantasyPros.ok,
        articles: articles.length,
        mode: fantasyPros.mode,
      },
      {
        source: "X Insiders",
        ok: insiders.posts.length > 0,
        articles: insiders.posts.length,
        mode: insiders.status,
      },
    ],
  };
}
async function gmail(env, to, subject, html) {
  if (
    !env.GMAIL_CLIENT_ID ||
    !env.GMAIL_CLIENT_SECRET ||
    !env.GMAIL_REFRESH_TOKEN
  )
    throw new Error("Gmail delivery secrets are not configured.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    const code = String(tokenPayload?.error || tokenResponse.status).slice(
      0,
      60,
    );
    const detail = String(
      tokenPayload?.error_description ||
        "Google rejected the stored OAuth credentials.",
    )
      .replace(/\s+/g, " ")
      .slice(0, 180);
    throw new Error(`Gmail token refresh failed: ${code} — ${detail}`);
  }
  const access = tokenPayload.access_token;
  if (!access)
    throw new Error(
      "Gmail token refresh failed: Google returned no access token.",
    );
  const from = "contact.stickypicky@gmail.com";
  const message = [
    `From: The Fantasy Arsenal <${from}>`,
    `To: ${to}`,
    `Reply-To: Fantasy Arsenal Support <${from}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
  ].join("\r\n");
  const raw = btoa(unescape(encodeURIComponent(message)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sent = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!sent.ok) throw new Error(`Gmail send failed (${sent.status}).`);
}
async function buildDigest(
  username,
  season,
  week,
  { includeBestBall = false, leagueIds = [] } = {},
) {
  const user = await json(
    `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`,
  );
  const allLeagues = await json(
    `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`,
  );
  const selected = new Set((leagueIds || []).map(String));
  const eligible = allLeagues.filter(
    (league) => includeBestBall || !classifyLeagueFormat(league).flags.bestBall,
  );
  const leagues = selected.size
    ? eligible.filter((league) => selected.has(String(league.league_id)))
    : eligible;
  const rows = (
    await Promise.all(
      (leagues || []).map(async (league) => {
        const commissioner =
          String(league.owner_id || "") === String(user.user_id);
        const [rosters, users, matchups, transactions] = await Promise.all([
          json(
            `https://api.sleeper.app/v1/league/${league.league_id}/rosters`,
          ).catch(() => []),
          commissioner
            ? json(
                `https://api.sleeper.app/v1/league/${league.league_id}/users`,
              ).catch(() => [])
            : Promise.resolve([]),
          json(
            `https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`,
          ).catch(() => []),
          commissioner
            ? json(
                `https://api.sleeper.app/v1/league/${league.league_id}/transactions/${week}`,
              ).catch(() => [])
            : Promise.resolve([]),
        ]);
        const mine = rosters.find(
          (r) => String(r.owner_id) === String(user.user_id),
        );
        const my = matchups.find(
          (m) => String(m.roster_id) === String(mine?.roster_id),
        );
        const opp = matchups.find(
          (m) =>
            m.matchup_id === my?.matchup_id &&
            String(m.roster_id) !== String(mine?.roster_id),
        );
        if (!my) return null;
        const points = num(my.points),
          oppPoints = num(opp?.points);
        const managerName = (rosterId) => {
          const roster = rosters.find(
            (row) => String(row.roster_id) === String(rosterId),
          );
          const manager = users.find(
            (row) => String(row.user_id) === String(roster?.owner_id),
          );
          return (
            manager?.metadata?.team_name ||
            manager?.display_name ||
            manager?.username ||
            `Roster ${rosterId}`
          );
        };
        const commissionerSignals = [];
        if (commissioner) {
          matchups.forEach((matchup) => {
            const lineupEmpty = (matchup.starters || []).filter(
              (id) => !id || String(id) === "0",
            ).length;
            if (lineupEmpty)
              commissionerSignals.push({
                leagueId: String(league.league_id),
                leagueName: league.name,
                type: "empty-lineup",
                priority: 100,
                title: `${managerName(matchup.roster_id)} has ${lineupEmpty} empty starting slot${lineupEmpty === 1 ? "" : "s"}`,
                detail: `Week ${week} lineup requires commissioner follow-up.`,
                href: `https://sleeper.com/leagues/${league.league_id}/matchup`,
              });
          });
          const pending = transactions.filter(
            (row) =>
              row.type === "trade" &&
              !["complete", "completed", "failed"].includes(
                String(row.status || "").toLowerCase(),
              ),
          );
          if (pending.length)
            commissionerSignals.push({
              leagueId: String(league.league_id),
              leagueName: league.name,
              type: "pending-trade",
              priority: 78,
              title: `${pending.length} unresolved trade${pending.length === 1 ? "" : "s"} in ${league.name}`,
              detail:
                "Review transaction status and affected managers before dependent roster moves.",
              href: `https://thefantasyarsenal.com/commissioner-dashboard?league=${league.league_id}`,
            });
        }
        return {
          name: league.name,
          points,
          opp: oppPoints,
          started: points > 0 || oppPoints > 0,
          empty: (my.starters || []).filter((id) => !id || id === "0").length,
          playoffWeekStart: num(league.settings?.playoff_week_start) || 15,
          commissionerSignals,
        };
      }),
    )
  ).filter(Boolean);
  const active = rows.filter((r) => r.started);
  const wins = active.filter((r) => r.points > r.opp).length,
    losses = active.filter((r) => r.points < r.opp).length,
    points = rows.reduce((s, r) => s + r.points, 0),
    empty = rows.reduce((s, r) => s + r.empty, 0),
    close = active.filter((r) => Math.abs(r.points - r.opp) <= 10).length;
  return {
    rows,
    wins,
    losses,
    points,
    empty,
    close,
    commissionerSignals: rows
      .flatMap((row) => row.commissionerSignals || [])
      .sort((a, b) => b.priority - a.priority),
    playoffLeagues: rows.filter((r) => week >= r.playoffWeekStart).length,
    playoffPushLeagues: rows.filter(
      (r) =>
        week >= Math.max(9, r.playoffWeekStart - 3) &&
        week < r.playoffWeekStart,
    ).length,
  };
}

function digestEmail({ d, manager, season, week, news = [] }) {
  const active = d.rows.filter((r) => r.started),
    notStarted = d.rows.length - active.length;
  const ties = active.length - d.wins - d.losses;
  const winRate = active.length ? (d.wins + ties * 0.5) / active.length : 0;
  const gradedEmpty = active.reduce((sum, r) => sum + r.empty, 0);
  const score = active.length
    ? Math.round(
        Math.max(0, Math.min(100, 76 + winRate * 22 - gradedEmpty * 4)),
      )
    : null;
  const letter =
    score == null
      ? "—"
      : score >= 97
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
                      : "D";
  const best = [...active].sort(
    (a, b) => b.points - b.opp - (a.points - a.opp),
  )[0];
  const danger = [...active].sort(
    (a, b) => a.points - a.opp - (b.points - b.opp),
  )[0];
  const seed = [...String(manager)].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    week * 37 + d.wins * 11 + d.losses * 7,
  );
  const choose = (items, offset = 0) => items[(seed + offset) % items.length];
  const winningLines = [
    "Your portfolio brought the fire.",
    "The win column is doing the talking.",
    "Green lights are spreading across the board.",
    "Your teams are controlling the weekly script.",
    "The portfolio is stacking positive results.",
    "This slate has serious victory-lap energy.",
    "The Arsenal is winning the leverage battles.",
    "Your weekly decisions are paying rent.",
  ];
  const losingLines = [
    "A few pressure points need your attention.",
    "The board is asking for a counterpunch.",
    "There is still time to rescue the swing matchups.",
    "The margins are exposing this week’s pressure valves.",
    "A course correction can still change the portfolio story.",
    "The red side of the board needs a response.",
    "This is a triage week: protect the closest paths first.",
    "The slate is bruised, not buried.",
  ];
  const evenLines = [
    "Your portfolio is balanced on a knife edge.",
    "The week is still writing its ending.",
    "Every close decision carries extra weight.",
    "The board is split and leverage is everywhere.",
    "One lineup swing could tilt the whole portfolio.",
    "The slate remains very much in play.",
    "No runaway verdict yet—this is a decision week.",
    "The portfolio is waiting for a hero matchup.",
  ];
  const mood =
    d.wins > d.losses
      ? [
          choose(
            [
              "WINNING WEEK",
              "GREEN BOARD",
              "PORTFOLIO SURGE",
              "MOMENTUM REPORT",
            ],
            1,
          ),
          choose(winningLines, 3),
          "#34d399",
        ]
      : d.wins < d.losses
        ? [
            choose(
              [
                "BOUNCE-BACK BOARD",
                "PRESSURE REPORT",
                "RECOVERY MODE",
                "DECISION WEEK",
              ],
              1,
            ),
            choose(losingLines, 3),
            "#fb7185",
          ]
        : [
            choose(
              ["PHOTO FINISH", "LEVERAGE WEEK", "SPLIT BOARD", "MARGIN WATCH"],
              1,
            ),
            choose(evenLines, 3),
            "#fbbf24",
          ];
  const opening = choose(
    [
      `Across ${d.rows.length} leagues, the Arsenal has mapped the clearest pressure points.`,
      `This week’s portfolio scan separates signal from noise across ${d.rows.length} leagues.`,
      `The board is built: ${d.rows.length} leagues, one prioritized weekly story.`,
      `Your portfolio pulse is in, with the closest decisions pushed to the front.`,
      `The Arsenal reviewed every loaded matchup and ranked what deserves attention first.`,
      `This is the weekly command brief for all ${d.rows.length} of your active league views.`,
    ],
    5,
  );
  const phaseBanner = d.playoffLeagues
    ? `🏆 <b>${d.playoffLeagues} league playoff${d.playoffLeagues === 1 ? " is" : "s are"} active.</b> Survival, advancement, and championship paths now outweigh ordinary margin chasing.`
    : d.playoffPushLeagues
      ? `🔥 <b>Playoff push alert in ${d.playoffPushLeagues} league${d.playoffPushLeagues === 1 ? "" : "s"}.</b> Seeding leverage is rising; close matchups and empty slots carry extra cost.`
      : week >= 12
        ? `🏁 <b>Stretch-run mode.</b> Playoff fields and seed lines are tightening across the portfolio.`
        : week >= 8
          ? `📈 <b>Midseason leverage is here.</b> Every win now shapes the playoff runway and trade posture.`
          : week <= 4
            ? `🚀 <b>Opening-phase report.</b> Early results matter, but roster process is more trustworthy than a small record sample.`
            : `🧭 <b>Season-building phase.</b> Protect weekly points while keeping waiver and trade flexibility intact.`;
  const briefing = !active.length
    ? `${opening} Your slate is staged and waiting for kickoff. No matchup has been graded, so the portfolio remains neutral.`
    : `${opening} The live record is ${d.wins}-${d.losses}${ties ? `-${ties}` : ""} through ${active.length} matchup${active.length === 1 ? "" : "s"}. ${best ? choose([`${esc(best.name)} sets the pace at ${best.points - best.opp >= 0 ? "+" : ""}${(best.points - best.opp).toFixed(1)}.`, `${esc(best.name)} is carrying the strongest live margin: ${best.points - best.opp >= 0 ? "+" : ""}${(best.points - best.opp).toFixed(1)}.`, `The current portfolio leader is ${esc(best.name)} at ${best.points - best.opp >= 0 ? "+" : ""}${(best.points - best.opp).toFixed(1)}.`], 9) : ""} ${danger && danger !== best ? choose([`${esc(danger.name)} is the pressure point at ${(danger.points - danger.opp).toFixed(1)}.`, `${esc(danger.name)} needs the closest attention with a ${(danger.points - danger.opp).toFixed(1)} margin.`, `The rescue board starts with ${esc(danger.name)} at ${(danger.points - danger.opp).toFixed(1)}.`], 13) : ""}`;
  const actions = [];
  if (d.empty)
    actions.push(
      `<b style="color:#fda4af">Fix ${d.empty} empty lineup slot${d.empty === 1 ? "" : "s"}.</b> Open affected lineups before their players lock.`,
    );
  if (d.close)
    actions.push(
      `<b style="color:#fde68a">Watch ${d.close} close matchup${d.close === 1 ? "" : "s"}.</b> These are the leagues where one decision has the most leverage.`,
    );
  if (d.playoffLeagues || d.playoffPushLeagues)
    actions.push(
      `<b style="color:#c4b5fd">Open the playoff leverage board.</b> Prioritize advancement and seeding paths over low-impact margin chasing.`,
    );
  if (notStarted)
    actions.push(
      `<b style="color:#bae6fd">${notStarted} matchup${notStarted === 1 ? "" : "s"} still waiting.</b> Recheck injuries, weather, and inactive news near kickoff.`,
    );
  if (!actions.length)
    actions.push(
      `<b style="color:#a7f3d0">No urgent portfolio fire.</b> Your submitted lineups have no empty slots or close-game alerts right now.`,
    );
  const actionRows = actions
    .map(
      (action, index) =>
        `<tr><td valign="top" style="padding:${index ? "7px" : "0"} 10px 7px 0;color:#67e8f9;font-weight:900">${index + 1}</td><td style="padding:${index ? "7px" : "0"} 0 7px;font-size:12px;line-height:19px;color:#9fb0c6">${action}</td></tr>`,
    )
    .join("");
  const newsRows = news
    .slice(0, 3)
    .map((article, index) => {
      const date = article.published
        ? new Date(article.published).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "";
      return `<tr><td valign="top" style="padding:11px 12px 11px 0;font-size:12px;font-weight:900;color:#67e8f9">${index + 1}</td><td style="padding:11px 0;border-bottom:1px solid #233148"><a href="${esc(article.link)}" style="font-size:13px;line-height:19px;font-weight:800;color:#eef6ff;text-decoration:none">${esc(article.title)}</a>${article.summary ? `<div style="padding-top:4px;font-size:11px;line-height:17px;color:#aebed2">${esc(article.summary).slice(0, 260)}</div>` : ""}<div style="padding-top:4px;font-size:10px;color:#718198">${esc(article.source || "FantasyPros")}${date ? ` · ${date}` : ""}</div></td></tr>`;
    })
    .join("");
  const games = [...d.rows]
    .sort((a, b) => Math.abs(a.points - a.opp) - Math.abs(b.points - b.opp))
    .map((r) => {
      const margin = r.points - r.opp,
        winning = margin > 0,
        tied = r.started && margin === 0;
      const color = !r.started
        ? "#8292aa"
        : tied
          ? "#fbbf24"
          : winning
            ? "#34d399"
            : "#fb7185";
      return `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #26354d;border-radius:16px;background:#101b2d"><tr><td style="padding:15px 16px"><div style="font-size:14px;font-weight:800;color:#f8fafc">${esc(r.name)}</div><div style="padding-top:5px;font-size:11px;color:#8292aa">${r.empty ? `⚠ ${r.empty} empty lineup slot${r.empty === 1 ? "" : "s"}` : "Lineup submitted"}</div></td><td align="right" style="padding:15px 16px;white-space:nowrap"><div style="font-size:10px;font-weight:900;letter-spacing:1.5px;color:${color}">${!r.started ? "NOT STARTED" : tied ? "TIED" : winning ? "WIN" : "LOSS"}</div><div style="padding-top:4px;font-size:18px;font-weight:900;color:#f8fafc">${r.points.toFixed(1)} <span style="color:#52627a">–</span> ${r.opp.toFixed(1)}</div><div style="padding-top:3px;font-size:10px;color:${color}">${r.started ? `${margin >= 0 ? "+" : ""}${margin.toFixed(1)} margin` : "Waiting for kickoff"}</div></td></tr></table></td></tr>`;
    })
    .join("");
  const metric = (value, label, color = "#f8fafc", last = false) =>
    `<td class="metric${last ? " metric-last" : ""}" width="25%" align="center" style="padding:17px 8px"><div style="font-size:24px;font-weight:900;color:${color}">${value}</div><div style="font-size:9px;font-weight:800;letter-spacing:1.2px;color:#718198">${label}</div></td>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark only"><meta name="supported-color-schemes" content="dark"><style>@media(max-width:520px){.wrap{padding:12px!important}.hero{padding:24px 18px!important}.metric{display:block!important;width:auto!important;border-bottom:1px solid #26354d}.metric-last{border-bottom:0!important}}</style></head><body style="margin:0;background:#050b16;color:#f8fafc;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Week ${week}: ${d.wins}-${d.losses} across ${d.rows.length} leagues · ${d.points.toFixed(1)} portfolio points.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#050b16" style="background:#050b16"><tr><td align="center" class="wrap" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#091321" style="width:100%;max-width:680px;border:1px solid #24324a;border-radius:24px;background:#091321;overflow:hidden">
  <tr><td class="hero" bgcolor="#101c31" style="padding:34px;background-color:#101c31;background-image:linear-gradient(135deg,#101c31,#10263a 58%,#241b49)"><table role="presentation" width="100%"><tr><td><span style="display:inline-block;border-radius:12px;background:#f8fafc;padding:8px 11px"><img src="https://thefantasyarsenal.com/icons/TFA.png" width="190" alt="The Fantasy Arsenal" style="display:block;width:190px;max-width:100%;height:auto"></span></td><td align="right" style="font-size:10px;font-weight:900;letter-spacing:2px;color:#bae6fd">WEEK ${week} · ${season}</td></tr></table><div style="padding-top:22px;font-size:11px;font-weight:900;letter-spacing:2px;color:${mood[2]}">${mood[0]}</div><h1 style="margin:7px 0 0;font-size:32px;line-height:1.08;color:#ffffff!important;-webkit-text-fill-color:#ffffff;text-shadow:0 1px 1px #000000">The Weekly Arsenal</h1><p style="margin:10px 0 0;font-size:14px;line-height:22px;color:#e6eef8!important;-webkit-text-fill-color:#e6eef8">Hey ${esc(manager)} — ${mood[1]}</p></td></tr>
  <tr><td style="padding:0 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #34445e;border-radius:16px;background:#0d192a"><tr>${metric(`${d.wins}-${d.losses}`, "LIVE RECORD", mood[2])}${metric(d.points.toFixed(1), "POINTS")}${metric(letter, "LIVE GRADE", score == null ? "#8292aa" : "#c4b5fd")}${metric(d.empty, "EMPTY SLOTS", d.empty ? "#fb7185" : "#34d399", true)}</tr></table></td></tr>
  <tr><td style="padding:28px 24px 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #31415c;border-radius:18px;background:#101a30"><tr><td style="padding:20px"><div style="font-size:10px;font-weight:900;letter-spacing:1.8px;color:#67e8f9">ARSENAL INTELLIGENCE BRIEFING</div><h2 style="margin:7px 0 8px;font-size:20px;color:#fff">What the week is saying</h2><p style="margin:0;font-size:13px;line-height:21px;color:#b9c8dc">${briefing}</p><div style="margin-top:15px;border:1px solid #4c3f75;border-radius:12px;background:#211b3a;padding:12px;font-size:12px;line-height:19px;color:#ddd6fe">${phaseBanner}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px;border-top:1px solid #26354d;padding-top:13px">${actionRows}</table></td></tr></table></td></tr>
  <tr><td style="padding:28px 24px 8px"><div style="font-size:11px;font-weight:900;letter-spacing:1.6px;color:#a78bfa">MATCHUP RADAR</div><h2 style="margin:5px 0 7px;font-size:21px;color:#fff">Closest decisions first</h2><p style="margin:0;font-size:12px;line-height:19px;color:#718198">The tightest margins rise to the top so you can focus where a move matters most.</p></td></tr>
  <tr><td style="padding:12px 24px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${games || `<tr><td style="padding:22px;text-align:center;color:#8292aa">No scored matchups were available yet.</td></tr>`}</table></td></tr>
  ${newsRows ? `<tr><td style="padding:4px 24px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #26354d;border-radius:18px;background:#0d1727"><tr><td style="padding:20px"><div style="font-size:10px;font-weight:900;letter-spacing:1.7px;color:#fbbf24">FANTASYPROS PLAYER NEWS</div><h2 style="margin:6px 0 4px;font-size:20px;color:#fff">Fantasy impact shaping the week</h2><p style="margin:0 0 8px;font-size:11px;line-height:18px;color:#718198">Player updates and fantasy-impact context from FantasyPros. Open any story for the original coverage.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${newsRows}</table></td></tr></table></td></tr>` : ""}
  <tr><td align="center" style="padding:4px 24px 28px"><a href="https://thefantasyarsenal.com/account" style="display:inline-block;padding:15px 24px;border-radius:14px;background:#67e8f9;color:#07111f;font-size:13px;font-weight:900;text-decoration:none">OPEN MY COMMAND CENTER →</a><div style="padding-top:13px;font-size:10px;color:#607089">Lineups · live matchups · waivers · trades · playoff leverage</div></td></tr>
  <tr><td style="padding:0 24px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #2a3b54;border-radius:14px;background:#0c1727"><tr><td align="center" style="padding:16px"><div style="font-size:12px;font-weight:800;color:#d7e3f2">Questions, feedback, or something not looking right?</div><div style="padding-top:5px;font-size:11px;line-height:17px;color:#718198">Reply to this email or contact Fantasy Arsenal Support.</div><a href="mailto:contact.stickypicky@gmail.com?subject=${encodeURIComponent(`Fantasy Arsenal Digest Support · Week ${week}`)}" style="display:inline-block;padding-top:9px;font-size:11px;font-weight:800;color:#67e8f9;text-decoration:none">contact.stickypicky@gmail.com →</a></td></tr></table></td></tr>
  <tr><td align="center" style="border-top:1px solid #1d2b40;padding:20px 24px;font-size:10px;line-height:17px;color:#91a4bd">Built for your entire fantasy portfolio by <span style="color:#ffffff!important;-webkit-text-fill-color:#ffffff;font-weight:900">The Fantasy Arsenal</span>.<br>Manage weekly delivery from My Arsenal.</td></tr>
  </table></td></tr></table></body></html>`;
}

function newsBriefEmail({
  news,
  insiders,
  d,
  manager,
  season,
  week,
  includeCommissioner = false,
}) {
  const rows = news
    .slice(0, 10)
    .map((article, index) => {
      const date = article.published
        ? new Date(article.published).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "";
      return `<tr><td valign="top" style="padding:15px 14px 15px 0;font-size:13px;font-weight:900;color:#67e8f9">${index + 1}</td><td style="padding:15px 0;border-bottom:1px solid #26354d"><a href="${esc(article.link)}" style="font-size:14px;line-height:20px;font-weight:900;color:#ffffff;text-decoration:none">${esc(article.title)}</a>${article.summary ? `<div style="padding-top:5px;font-size:11px;line-height:18px;color:#b8c7da">${esc(article.summary).slice(0, 360)}</div>` : ""}<div style="padding-top:5px;font-size:10px;color:#91a4bd">${esc(article.source || "FantasyPros")}${date ? ` · ${date}` : ""}</div></td></tr>`;
    })
    .join("");
  const insiderRows = (insiders?.posts || [])
    .map((post) => {
      const date = post.published
        ? new Date(post.published).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "";
      return `<tr><td style="padding:13px 0;border-bottom:1px solid #26354d"><a href="${esc(post.link)}" style="font-size:13px;line-height:19px;font-weight:800;color:#ffffff;text-decoration:none">${esc(post.title).slice(0, 500)}</a><div style="padding-top:5px;font-size:10px;color:#91a4bd">${esc(post.source)}${date ? ` · ${date}` : ""}${post.engagement ? ` · ${post.engagement.toLocaleString()} engagement score` : ""}</div></td></tr>`;
    })
    .join("");
  const insiderFallback = (insiders?.profiles || [])
    .map(
      (profile) =>
        `<a href="https://x.com/${profile.username}" style="display:inline-block;margin:5px 6px 0 0;border:1px solid #34445e;border-radius:999px;padding:8px 11px;color:#bae6fd;font-size:11px;font-weight:800;text-decoration:none">${esc(profile.name)} on X →</a>`,
    )
    .join("");
  const emptyLeagues = d.rows.filter((row) => row.empty),
    active = d.rows.filter((row) => row.started),
    closeLeagues = active.filter((row) => Math.abs(row.points - row.opp) <= 10),
    notStarted = d.rows.length - active.length;
  const actions = [];
  if (emptyLeagues.length)
    actions.push({
      tone: "#fb7185",
      title: `Fix ${d.empty} empty starting slot${d.empty === 1 ? "" : "s"}`,
      detail: `Affected: ${emptyLeagues
        .slice(0, 4)
        .map((row) => esc(row.name))
        .join(
          ", ",
        )}${emptyLeagues.length > 4 ? ` +${emptyLeagues.length - 4} more` : ""}.`,
    });
  if (closeLeagues.length)
    actions.push({
      tone: "#fbbf24",
      title: `Monitor ${closeLeagues.length} high-leverage matchup${closeLeagues.length === 1 ? "" : "s"}`,
      detail: `Closest: ${closeLeagues
        .slice(0, 3)
        .map(
          (row) =>
            `${esc(row.name)} (${Math.abs(row.points - row.opp).toFixed(1)} pts)`,
        )
        .join(", ")}.`,
    });
  if (notStarted)
    actions.push({
      tone: "#67e8f9",
      title: `Recheck ${notStarted} lineup${notStarted === 1 ? "" : "s"} before kickoff`,
      detail:
        "Confirm injuries, inactives, weather, and late-swap flexibility before players lock.",
    });
  if (d.playoffLeagues || d.playoffPushLeagues)
    actions.push({
      tone: "#c4b5fd",
      title: "Review playoff leverage",
      detail: `${d.playoffLeagues ? `${d.playoffLeagues} playoff league${d.playoffLeagues === 1 ? "" : "s"} active. ` : ""}${d.playoffPushLeagues ? `${d.playoffPushLeagues} league${d.playoffPushLeagues === 1 ? " is" : "s are"} in the playoff push.` : ""}`,
    });
  if (includeCommissioner)
    (d.commissionerSignals || [])
      .slice(0, 6)
      .forEach((signal) =>
        actions.push({
          tone: signal.priority >= 90 ? "#fb7185" : "#fbbf24",
          title: `Commissioner · ${signal.title}`,
          detail: `${signal.leagueName}: ${signal.detail}`,
        }),
      );
  if (!actions.length)
    actions.push({
      tone: "#34d399",
      title: "No urgent portfolio fire",
      detail:
        "No empty starters or close-game alerts were detected. Check again near the next kickoff window.",
    });
  const actionRows = actions
    .map(
      (action, index) =>
        `<tr><td valign="top" style="padding:12px 12px 12px 0;color:${action.tone};font-size:13px;font-weight:900">${index + 1}</td><td style="padding:12px 0;border-bottom:1px solid #26354d"><div style="font-size:13px;line-height:19px;font-weight:900;color:#ffffff!important;-webkit-text-fill-color:#ffffff">${action.title}</div><div style="padding-top:4px;font-size:11px;line-height:17px;color:#aebed2">${action.detail}</div></td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark only"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;background:#050b16;font-family:Arial,sans-serif;color:#ffffff"><div style="display:none;max-height:0;overflow:hidden">Urgent portfolio actions and the NFL stories shaping fantasy decisions.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#050b16" style="background:#050b16"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#091321" style="width:100%;max-width:680px;border:1px solid #26354d;border-radius:24px;background:#091321;overflow:hidden">
  <tr><td bgcolor="#10263a" style="padding:30px;background-color:#10263a;background-image:linear-gradient(135deg,#10263a,#241b49)"><span style="display:inline-block;border-radius:12px;background:#f8fafc;padding:8px 11px"><img src="https://thefantasyarsenal.com/icons/TFA.png" width="190" alt="The Fantasy Arsenal" style="display:block;width:190px;max-width:100%;height:auto"></span><div style="padding-top:22px;font-size:10px;font-weight:900;letter-spacing:2px;color:#fbbf24">DAILY FANTASY INTELLIGENCE · WEEK ${week} · ${season}</div><h1 style="margin:7px 0 0;font-size:30px;line-height:36px;color:#ffffff!important;-webkit-text-fill-color:#ffffff;text-shadow:0 1px 1px #000000">The Daily Intelligence Wire</h1><p style="margin:10px 0 0;font-size:13px;line-height:21px;color:#e6eef8!important;-webkit-text-fill-color:#e6eef8">Hey ${esc(manager)} — your urgent portfolio work, FantasyPros player updates, and trusted NFL insider reports.</p></td></tr>
  <tr><td style="padding:24px 24px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#101a30" style="border:1px solid #31415c;border-radius:18px;background:#101a30"><tr><td style="padding:19px"><div style="font-size:10px;font-weight:900;letter-spacing:1.7px;color:#fb7185">DO THIS FIRST</div><h2 style="margin:6px 0 2px;font-size:20px;color:#ffffff!important;-webkit-text-fill-color:#ffffff">Your urgent account briefing</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${actionRows}</table></td></tr></table></td></tr>
  <tr><td style="padding:18px 24px 6px"><div style="font-size:10px;font-weight:900;letter-spacing:1.7px;color:#fbbf24">FANTASYPROS PLAYER NEWS</div><h2 style="margin:6px 0 2px;font-size:20px;color:#ffffff!important;-webkit-text-fill-color:#ffffff">Fantasy impact shaping the board</h2><p style="margin:0;font-size:11px;line-height:18px;color:#91a4bd">Direct fantasy-relevant player updates and analysis. Open a headline for the full FantasyPros report.</p></td></tr>
  <tr><td style="padding:0 24px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows || `<tr><td style="padding:24px 0;color:#b8c7da;font-size:12px;line-height:19px">The live news feeds did not return fresh headlines for this edition. Your account briefing above is still current; the Arsenal will retry every scheduled delivery.</td></tr>`}</table></td></tr>
  <tr><td style="padding:0 24px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#101a30" style="border:1px solid #31415c;border-radius:18px;background:#101a30"><tr><td style="padding:19px"><div style="font-size:10px;font-weight:900;letter-spacing:1.7px;color:#67e8f9">NFL INSIDER WIRE</div><h2 style="margin:6px 0 3px;font-size:20px;color:#ffffff!important;-webkit-text-fill-color:#ffffff">Schefter & Rapoport</h2><p style="margin:0 0 8px;font-size:11px;line-height:18px;color:#91a4bd">Recent high-engagement posts from Adam Schefter and Ian Rapoport.</p>${insiderRows ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${insiderRows}</table>` : `<div style="padding-top:7px;font-size:11px;line-height:18px;color:#aebed2">Live X posts are unavailable until the official X API token is connected. Use the verified profile links below in the meantime.</div><div style="padding-top:7px">${insiderFallback}</div>`}</td></tr></table></td></tr>
  <tr><td align="center" style="padding:0 24px 26px"><a href="https://thefantasyarsenal.com/account" style="display:inline-block;border-radius:13px;background:#67e8f9;padding:14px 22px;color:#07111f!important;font-size:12px;font-weight:900;text-decoration:none">OPEN MY ARSENAL</a></td></tr><tr><td align="center" style="border-top:1px solid #26354d;padding:18px 24px;font-size:10px;line-height:17px;color:#91a4bd">Questions or feedback? Reply to this email or contact <a href="mailto:contact.stickypicky@gmail.com?subject=${encodeURIComponent(`Fantasy Arsenal News Brief Support - Week ${week}`)}" style="color:#67e8f9;text-decoration:none">contact.stickypicky@gmail.com</a>.<br><span style="color:#ffffff!important;-webkit-text-fill-color:#ffffff;font-weight:900">The Fantasy Arsenal</span></td></tr></table></td></tr></table></body></html>`;
}

async function ready(db) {
  await ensureArsenalSchema(db);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS arsenal_digest_subscriptions (
    account_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    delivery_day INTEGER NOT NULL DEFAULT 2,
    updated_at INTEGER NOT NULL,
    last_sent_at INTEGER
  )`,
    )
    .run();
  for (const statement of [
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN include_news INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN news_enabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN news_delivery_day INTEGER NOT NULL DEFAULT 4",
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN news_delivery_days TEXT",
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN news_last_sent_at INTEGER",
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN commissioner_urgent INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN include_best_ball INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE arsenal_digest_subscriptions ADD COLUMN league_ids TEXT",
  ])
    try {
      await db.prepare(statement).run();
    } catch {}
}

export async function POST(request) {
  try {
    const db = arsenalDb();
    await ready(db);
    const account = await authenticateArsenal(request, db);
    if (!account)
      return new NextResponse("Sign in to manage digest delivery.", {
        status: 401,
      });
    const body = await request.json();
    const email = String(body?.email || "")
      .trim()
      .toLowerCase()
      .slice(0, 254);
    const enabled = body?.enabled ? 1 : 0;
    const deliveryDay = Math.max(0, Math.min(6, num(body?.deliveryDay ?? 2)));
    const includeNews = body?.includeNews === false ? 0 : 1;
    const newsEnabled = body?.newsEnabled ? 1 : 0;
    const newsDeliveryDay = Math.max(
      0,
      Math.min(6, num(body?.newsDeliveryDay ?? 4)),
    );
    const newsDeliveryDays = [
      ...new Set(
        (Array.isArray(body?.newsDeliveryDays)
          ? body.newsDeliveryDays
          : [newsDeliveryDay]
        )
          .map(num)
          .filter((day) => day >= 0 && day <= 6),
      ),
    ].sort((a, b) => a - b);
    const commissionerUrgent = body?.commissionerUrgent ? 1 : 0;
    const includeBestBall = body?.includeBestBall ? 1 : 0;
    const leagueIds = [
      ...new Set(
        (Array.isArray(body?.leagueIds) ? body.leagueIds : [])
          .map((value) => String(value || "").trim())
          .filter((value) => /^\d+$/.test(value)),
      ),
    ].slice(0, 100);
    if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return new NextResponse("Enter a valid delivery email.", { status: 400 });
    if (newsEnabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return new NextResponse("Enter a valid delivery email.", { status: 400 });
    await db
      .prepare(
        `INSERT INTO arsenal_digest_subscriptions(account_id,email,enabled,delivery_day,include_news,news_enabled,news_delivery_day,news_delivery_days,commissioner_urgent,include_best_ball,league_ids,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET email=excluded.email,enabled=excluded.enabled,delivery_day=excluded.delivery_day,include_news=excluded.include_news,news_enabled=excluded.news_enabled,news_delivery_day=excluded.news_delivery_day,news_delivery_days=excluded.news_delivery_days,commissioner_urgent=excluded.commissioner_urgent,include_best_ball=excluded.include_best_ball,league_ids=excluded.league_ids,updated_at=excluded.updated_at`,
      )
      .bind(
        account.account_id,
        email,
        enabled,
        deliveryDay,
        includeNews,
        newsEnabled,
        newsDeliveryDay,
        JSON.stringify(newsDeliveryDays.length ? newsDeliveryDays : [4]),
        commissionerUrgent,
        includeBestBall,
        JSON.stringify(leagueIds),
        Date.now(),
      )
      .run();
    return NextResponse.json({
      ok: true,
      email,
      enabled: !!enabled,
      deliveryDay,
      includeNews: !!includeNews,
      newsEnabled: !!newsEnabled,
      newsDeliveryDays,
      commissionerUrgent: !!commissionerUrgent,
      includeBestBall: !!includeBestBall,
      leagueIds,
    });
  } catch (error) {
    return new NextResponse(
      error?.message || "Digest preference could not be saved.",
      { status: 500 },
    );
  }
}

export async function GET(request) {
  try {
    const env = arsenalEnv();
    if (
      !env.DIGEST_CRON_SECRET ||
      request.headers.get("authorization") !==
        `Bearer ${env.DIGEST_CRON_SECRET}`
    )
      return new NextResponse("Unauthorized.", { status: 401 });
    const db = arsenalDb();
    await ready(db);
    const state = await json("https://api.sleeper.app/v1/state/nfl");
    const season = num(state.season) || new Date().getUTCFullYear(),
      week = Math.max(1, num(state.week) || 1);
    const testParam = new URL(request.url).searchParams.get("test") || "";
    const testMode =
      testParam === "1" || testParam === "digest" || testParam === "news";
    const testKind = testParam === "news" ? "news" : "digest";
    const due = testMode
      ? await db
          .prepare(
            `SELECT s.*,a.sleeper_username,a.display_name FROM arsenal_digest_subscriptions s JOIN arsenal_accounts a ON a.account_id=s.account_id ORDER BY s.updated_at DESC LIMIT 1`,
          )
          .all()
      : await db
          .prepare(
            `SELECT s.*,a.sleeper_username,a.display_name FROM arsenal_digest_subscriptions s JOIN arsenal_accounts a ON a.account_id=s.account_id WHERE s.enabled=1 OR s.news_enabled=1 LIMIT 250`,
          )
          .all();
    const newsResult = (due.results || []).length
      ? await dailyNews(env)
      : { articles: [], insiders: { posts: [], profiles: [] }, sources: [] };
    const news = newsResult.articles;
    let sent = 0;
    const failures = [];
    for (const row of due.results || []) {
      let digestData = null;
      let leagueIds = [];
      try {
        const parsed = JSON.parse(row.league_ids || "");
        if (Array.isArray(parsed)) leagueIds = parsed.map(String);
      } catch {}
      const digestOptions = {
        includeBestBall: Number(row.include_best_ball || 0) === 1,
        leagueIds,
      };
      const weekday = localWeekday(row.timezone || "America/New_York"),
        cooldown = Date.now() - 5 * 86400000,
        newsCooldown = Date.now() - 20 * 60 * 60 * 1000;
      let newsDays = [num(row.news_delivery_day ?? 4)];
      try {
        const parsed = JSON.parse(row.news_delivery_days || "");
        if (Array.isArray(parsed) && parsed.length)
          newsDays = parsed.map(num).filter((day) => day >= 0 && day <= 6);
      } catch {}
      const digestDue = testMode
        ? testKind === "digest"
        : Number(row.enabled) === 1 &&
          weekday === num(row.delivery_day) &&
          (!row.last_sent_at || num(row.last_sent_at) < cooldown);
      const newsDue = testMode
        ? testKind === "news"
        : Number(row.news_enabled) === 1 &&
          newsDays.includes(weekday) &&
          (!row.news_last_sent_at || num(row.news_last_sent_at) < newsCooldown);
      if (digestDue)
        try {
          const d = (digestData = await buildDigest(
            row.sleeper_username,
            season,
            week,
            digestOptions,
          ));
          const html = digestEmail({
            d,
            manager: row.display_name || row.sleeper_username,
            season,
            week,
            news: Number(row.include_news ?? 1) === 1 ? news : [],
          });
          await gmail(
            env,
            testMode ? DIGEST_TEST_EMAIL : row.email,
            `Week ${week} Fantasy Arsenal | ${d.wins}-${d.losses} | ${d.points.toFixed(1)} points`,
            html,
          );
          if (!testMode)
            await db
              .prepare(
                "UPDATE arsenal_digest_subscriptions SET last_sent_at=? WHERE account_id=?",
              )
              .bind(Date.now(), row.account_id)
              .run();
          sent += 1;
        } catch (error) {
          failures.push({
            account: row.account_id,
            type: "digest",
            error: String(error.message || error).slice(0, 180),
          });
        }
      if (newsDue)
        try {
          const d =
            digestData ||
            (await buildDigest(
              row.sleeper_username,
              season,
              week,
              digestOptions,
            ));
          await gmail(
            env,
            testMode ? DIGEST_TEST_EMAIL : row.email,
            `Week ${week} Fantasy Arsenal Daily Intelligence`,
            newsBriefEmail({
              news,
              insiders: newsResult.insiders,
              d,
              manager: row.display_name || row.sleeper_username,
              season,
              week,
              includeCommissioner: Number(row.commissioner_urgent || 0) === 1,
            }),
          );
          if (!testMode)
            await db
              .prepare(
                "UPDATE arsenal_digest_subscriptions SET news_last_sent_at=? WHERE account_id=?",
              )
              .bind(Date.now(), row.account_id)
              .run();
          sent += 1;
        } catch (error) {
          failures.push({
            account: row.account_id,
            type: "news",
            error: String(error.message || error).slice(0, 180),
          });
        }
    }
    return NextResponse.json({
      ok: true,
      testMode,
      testKind: testMode ? testKind : undefined,
      testRecipient: testMode ? DIGEST_TEST_EMAIL : undefined,
      season,
      week,
      news: news.length,
      newsSources: newsResult.sources,
      sent,
      failed: failures.length,
      failures,
    });
  } catch (error) {
    return new NextResponse(error?.message || "Digest delivery failed.", {
      status: 500,
    });
  }
}
