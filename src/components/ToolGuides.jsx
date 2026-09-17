"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import GuidedTips from "./GuidedTips";

const s = (selector, title, detail, onEnter, options = {}) => ({ selector, title, detail, onEnter, ...options });
const tab = (label) => () => {
  [...document.querySelectorAll("main button")]
    .find((button) => button.textContent.trim().startsWith(label))?.click();
};

const GUIDES = {
  "/league-hub": [
    s('[data-guide-tip="league-hub-intro"]', "League Hub is the weekly portfolio inbox", "It scans all included leagues for urgent, fixable work. It remains portfolio-wide; the league selected in the sidebar still controls single-league tools."),
    s("#for-you", "Expand the Action Center when you are ready", "The collapsed count tells you how many items need attention. Expand it to filter lineup, injury, waiver, and trade items; each card names the league, reason, and next action. Dismiss only items you intentionally reviewed."),
    s("#summary", "Jump to the remaining workspaces", "These counts link to the detailed sections below: waiver candidates, injuries, and lineup-risk leagues. The old cross-league watchlist and Waiver Analytics blocks have been removed so these operational sections remain the focus."),
    s("#free-agents", "Build waivers from league need", "Candidates combine availability, the selected player model, and roster need. Open a player to see where the add is possible, then verify waiver rules and the corresponding drop before acting.", undefined, { scrollBlock:"start" }),
    s('button[title^="Cycle opportunity display"]', "Choose how opportunities appear", "This single button cycles through three modes: Opportunities active shows every player and marks qualifying opportunities; Opportunities off shows every player without opportunity labels; Opportunities only filters the table to qualifying opportunities.", undefined, { scrollBlock:"start" }),
    s("#waivers", "Review recent league activity", "Activity shows waivers, free-agent moves, and trades returned by Sleeper. Use it for context about manager behavior and market demand; it is not another recommendation ranking.", undefined, { scrollBlock:"start" }),
    s("#injuries", "Find roster exposure to injury", "The injury report groups affected players and the leagues where you roster them. Open the player or league context, confirm current news, and distinguish an injury tag from a confirmed inactive designation.", undefined, { scrollBlock:"start" }),
    s("#lineup-risk", "Finish with lineup-risk leagues", "This section identifies leagues with empty or risky starting slots. Best Ball leagues should not create lineup actions unless their custom rules allow moves.", undefined, { scrollBlock:"start" }),
    s("main details", "Use Decision Memory for judgment calls", "The merged memory workspace lives inside League Hub. Save a waiver target with its star, then save or snooze injury and bye-week concerns. Completed items remain in Memory until the relevant week has passed; the shared league scope controls which leagues create recommendations."),
  ],
  "/player-availability": [
    s('[data-guide-tip="availability-intro"]', "Search availability across the portfolio", "Add one or several players to see exactly where each is available, rostered by you, or held by another manager. Results always come from the latest completed roster scan."),
    s('[data-guide-tip="availability-scan"]', "Understand the portfolio counts", "Scanned is every league successfully read. Showing is the smaller set left after format filters. Refresh rereads Sleeper ownership after a draft, waiver, trade, or free-agent move."),
    s('[data-guide-tip="availability-settings"]', "One place controls league scope and ranking", "Open this group for the single Included leagues selector, projection or value source, scoring and quarterback assumptions, Best Ball scope, drafting leagues, position, sorting, minimum availability, and result limit. Best Available ranks the chosen player model only across those included leagues; projections fit weekly adds and values fit longer-term acquisitions."),
    s('[data-guide-tip="availability-player-picker"]', "Add the exact players you want checked", "Type a player name in Search & Add Player and select the correct result. Add several players when you want one league-by-player comparison instead of repeating the same search."),
    s('[data-guide-tip="availability-check-controls"]', "Run or refresh the availability check", "Check rebuilds results for the selected players. Refresh rosters first when a draft, waiver run, trade, or free-agent move may have changed Sleeper ownership. Filters and Included control which leagues are considered."),
    s('[data-guide-tip="availability-hot-adds"]', "Hot Adds show market movement", "These are the players Sleeper managers are adding most during the selected lookback—not automatically the best players available to you. Count measures add activity; Open% measures availability in your included leagues. Click a row to see the specific open leagues."),
    s('[data-guide-tip="availability-best"]', "Best Available ranks actionable options", "This board ranks players from your selected Arsenal projection or value source, then shows how many included leagues still have each player open. Click any row for the league list; use projections for weekly help and values for longer-term roster decisions."),
    s('[data-guide-tip="availability-cold-drops"]', "Cold Drops reveal possible churn", "These are the players being dropped most on Sleeper during the same lookback. A drop trend is context, not advice: injuries, bye weeks, shallow benches, and news can all drive it. Click a row to check where that player is now open before deciding."),
  ],
  "/draft-grades": [
    s("main header", "Select the completed draft and grading lens", "Choose the league, draft, and market used for review. Grades compare selection value and roster construction with the available model; they evaluate the decision, not a guaranteed future player outcome."),
    s("main .sticky button:nth-of-type(1)", "Team Grades", "This league-wide ranking blends covered-pick quality, roster construction, and league-relative performance. Click a team card to open its detailed report.", tab("Team Grades")),
    s("main .sticky button:nth-of-type(2)", "Every Pick", "Review the complete draft in pick order, search it, and expand any selection for its expected range and verdict. Reach and steal labels measure the selected lens—not future certainty.", tab("Every Pick")),
    s("main .sticky button:nth-of-type(3)", "Team Report", "Choose one roster to separate selection value, positional construction, strengths, weaknesses, and individual picks. A bargain can still create imbalance, so read value and fit together.", tab("Team Report")),
    s("main .sticky button:nth-of-type(4)", "Awards & Runs", "See the strongest values, largest reaches, and position runs across the room. A run explains draft movement; it does not automatically prove following or fading it was correct.", tab("Awards & Runs")),
    s("main .sticky button:nth-of-type(5)", "Methodology", "Review coverage requirements, weighting, and the blend of absolute process quality with league-relative performance. Missing coverage lowers confidence instead of silently becoming a bad grade.", tab("Methodology")),
  ],
  "/stat-central-legacy": [
    s("main header", "Begin with the player and the question", "Stat Central joins weekly scoring, role, opportunity, matchups, advanced usage, and projection evidence. Select a player first, then move to the view that answers the specific decision in front of you."),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(1)', "Player Lab", "Player Research explains scoring and weekly evidence. Its inner tabs add advanced usage, career history, and side-by-side player comparison.", tab("Player Lab")),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(2)', "Matchup Lab", "Choose position, offense, and defense to compare team production with what that defense allowed. The allowance badge is percent above or below league average—not a 0–100 grade.", tab("Matchups")),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(3)', "Projection Center", "Weekly forecasts distribute the season baseline using schedule, recent role, matchup evidence, and available context. Safe, expected, and boom/bust are modeled ranges—not guarantees.", tab("Projections")),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(4)', "Leaderboards", "Rank players by production, position, archetype, and consistency. Filters define the qualified population, so read rank together with sample size.", tab("Rankings")),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(5)', "Data Guide", "Methodology documents sources, formulas, measured facts, estimates, and missing coverage. A blank measurement means unavailable evidence—not zero. Closing or finishing returns you to Player Lab.", () => { tab("Data Guide")(); return () => tab("Player Lab")(); }),
  ],
  "/stat-central": [
    s("main header", "Set the shared research context once", "Season and scoring live in the Stat Central header. Player views also expose position and player search; Matchups keeps one shared position, offense, and defense bar. Feature-specific controls stay with the feature they affect."),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(1)', "Player Lab", "Player Research covers scoring identity and underlying production. Advanced Stats, Career History, and Compare Players answer different questions without crowding one screen.", tab("Player Lab")),
    s('[data-guide-tip="stat-secondary-tabs"] button:nth-of-type(1)', "Player Research: understand the scoring profile", "Use this first view for weekly scoring, floor and ceiling, consistency, and the workload evidence behind a player’s results.", tab("Player Research")),
    s('[data-guide-tip="stat-secondary-tabs"] button:nth-of-type(2)', "Advanced Stats: validate the role", "Open Advanced Stats to inspect snaps, opportunity, target and carry share, high-value work, and efficiency. It helps separate a repeatable role from a fragile box score.", tab("Advanced Stats")),
    s('[data-guide-tip="stat-secondary-tabs"] button:nth-of-type(3)', "Career History: add the longer view", "Use Career History for season-over-season production and role trends. It is historical context, not a current-week projection.", tab("Career History")),
    s('[data-guide-tip="stat-secondary-tabs"] button:nth-of-type(4)', "Compare Players: answer a direct choice", "Search for a primary player, then choose a comparison player from that same position. The view keeps their identity through a season or scoring change whenever that player exists in the new data.", tab("Compare Players")),
    s('[data-guide-tip="stat-player-picker"]', "Search and select in one field", "Start typing and choose the player from the matching browser suggestions. Stat Central keeps that player selected when you move through Player Research, Advanced Stats, Career History, and Compare Players instead of resetting to the first-ranked name."),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(2)', "Matchups uses one shared setup", "Choose season, scoring, position, offense, and defense once. Team Profiles does not require a selected team; only Matchup Overview uses the offense-versus-defense pairing.", tab("Matchups")),
    s('[data-guide-tip="matchup-shared-controls"]', "Position, offense, and defense stay shared", "Offense supplies the team baseline; defense supplies positional allowance and opponent history. Adjustment is relative to the league average for that position—not a 0–100 grade."),
    s('[data-guide-tip="matchup-secondary-tabs"] button:nth-of-type(1)', "Matchup Overview", "Read the common matchup grade, modeled room output, points allowed, evidence count, and offense baseline.", tab("Matchup Overview")),
    s('[data-guide-tip="matchup-secondary-tabs"] button:nth-of-type(2)', "Team Profiles", "Open QB, RB, WR, or TE one at a time. Each row shows combined fantasy points produced by that team's players per NFL game, alongside fantasy points that defense allowed to the same position. Prior seasons are context-weighted, not treated as current-year results.", tab("Team Profiles")),
    s('[data-guide-tip="matchup-secondary-tabs"] button:nth-of-type(3)', "Player History", "This workspace uses one table at a time. Switch between the best individual weekly performances and sample-adjusted repeated performance against the selected opponent.", tab("Player History")),
    s('[data-guide-tip="matchup-player-history-toggle"]', "Choose the kind of history you need", "Best weekly performances supports player search, scoring thresholds, and points/yards/recency sorting. Repeated opponent performance compares multi-season results with the same player's other-opponent baseline and reports evidence-based confidence."),
    s('[data-guide-tip="stat-workspaces"] button:nth-of-type(3)', "Leaderboards", "Rank observed historical production by total, average, floor, ceiling, consistency, and archetype-not current value or forecast.", tab("Rankings")),
  ],
  "/projection-center": [
    s("main header", "Projection Center is the forward-looking workspace", "Use this tool when you want weekly ranks, one-player forecasts, projected stat lines, and measured accuracy. Stat Central now stays focused on historical player research and matchup evidence."),
    s('[data-guide-tip="projection-secondary-tabs"] button:nth-of-type(1)', "Player Forecast", "Audit one player's week, schedule, range, workload, matchup, availability, market, weather, and simulation evidence.", tab("Player Forecast")),
    s('[data-guide-tip="projection-secondary-tabs"] button:nth-of-type(2)', "Rankings", "Rank the slate with the same scoring, lens, position, team, and week controls. Sorting changes presentation, not the underlying forecast.", tab("Rankings")),
    s('[data-guide-tip="projection-secondary-tabs"] button:nth-of-type(3)', "Projected Stat DNA", "See the stat line that becomes fantasy points. Source badges name external ingredients; the Arsenal synthesis badge identifies the calibrated final model.", tab("Projected Stat DNA")),
    s('[data-guide-tip="projection-dna-week"]', "Move Stat DNA through the schedule", "Previous, next, and the week selector update the component stat line, opponent history, other-opponent baseline, and final Arsenal estimate together.", tab("Projected Stat DNA")),
    s('[data-guide-tip="projection-stat-dna"]', "Separate the forecast from the result", "For completed games, the comparison panel pairs the frozen fantasy-point forecast with the recorded actual score and box-score stat line. Hover any metric for a plain-language explanation; future weeks remain forecast-only until graded.", tab("Projected Stat DNA")),
    s('[data-guide-tip="projection-secondary-tabs"] button:nth-of-type(4)', "Accuracy", "Compare frozen projections against actual results. MAE, median miss, RMSE, bias, over rate, rank correlation, Top-N, and position splits help show whether the model is useful beyond one lucky week.", tab("Accuracy")),
    s('[data-guide-tip="projection-accuracy"]', "Accuracy uses frozen pre-kickoff snapshots", "The model is graded from saved projections that existed before games started. That keeps live updates from rewriting history and makes Arsenal, Sleeper, CBS, and other source comparisons fair.", () => { tab("Accuracy")(); return () => tab("Player Forecast")(); }),
  ],
  "/depth-charts": [
    s("main header", "Build the opportunity tree", "Choose a team and position or search for a player. The result combines depth order with injuries, projections, market value, rookie competition, handcuff context, contracts, and your portfolio exposure."),
    s("main details", "Switch the Player Model deliberately", "Projections help answer near-term workload and scoring questions. Values help assess dynasty cost and roster investment. Changing this source changes the numbers beside players, not the NFL team's official depth-chart designation."),
    s("main h2", "Compare a position as a competition", "Read incumbents, backups, specialists, and challengers together. Depth order is a current signal—not a guaranteed snap share—so confirm injuries and recent role evidence before acting."),
  ],
  "/sos": [
    s('[data-guide-tip="sos-setup"]', "Build the schedule lens", "Choose the league and exact start/end weeks first. The page uses that league's schedule, roster slots, scoring, and quarterback rules; changing the sidebar league changes this tool too.", undefined, { scrollBlock:"start" }),
    s('[data-guide-tip="sos-setup"] details', "Choose the strength model", "Open Model Settings for projections or values. Projections estimate weekly starting-lineup output and are best for schedule difficulty. Values measure roster market strength and should not be read as literal fantasy points.", () => { const details=document.querySelector('[data-guide-tip="sos-setup"] details'); if(details) details.open=true; return()=>{if(details)details.open=false;} }),
    s('[data-guide-tip="sos-view-toggle"] button:nth-of-type(1)', "Table view", "Table ranks the complete selected window by schedule ease, average opponent strength, total team strength, and number of games. Use it for sortable comparison across every roster.", tab("Table")),
    s('[data-guide-tip="sos-results"]', "Read the table from its header", "Each row summarizes the selected range rather than one isolated matchup. Compare schedule difficulty with the team's own strength before calling a path easy or hard.", undefined, { scrollBlock:"start" }),
    s('[data-guide-tip="sos-view-toggle"] button:nth-of-type(2)', "Heatmap view", "Heatmap exposes the week-by-week path. Green favors the optimized lineup, yellow is close, and red favors the opponent. In elimination formats, color represents weekly survival pressure.", tab("Heatmap")),
    s('[data-guide-tip="sos-results"]', "Open a weekly matchup", "Tap a heatmap cell to inspect both optimized lineups behind the color. Bye weeks are removed when schedule data exists; missing schedule evidence stays missing.", undefined, { scrollBlock:"start" }),
    s('[data-guide-tip="sos-intelligence"]', "Finish in the Intelligence Lab", "Compare two teams, separate regular-season and playoff SOS, inspect position-specific difficulty and volatility, then send difficult windows to Player Availability for waiver research. Closing the tour leaves Heatmap as the main view.", () => () => tab("Heatmap")(), { scrollBlock:"start" }),
  ],
  "/intelligence": [
    s('[data-guide-tip="intelligence-header"]', "Scan the portfolio, then read the pulse", "Scan every included league to rebuild decisions. Open decisions are unresolved items; Critical Now crossed the highest urgency threshold; Helpful Outcomes comes only from rated decisions; Device or Synced tells you where memory is stored."),
    s('[data-guide-tip="intelligence-tabs"]', "Use time and workflow tabs deliberately", "Today holds urgent work, This Week catches near-term planning, Opportunities contains optional upside, Watching and Saved preserve research, and Memory records completed, dismissed, snoozed, and rated outcomes."),
    s('[data-guide-tip="intelligence-scope"]', "Control exactly which leagues can create advice", "Standard leagues are included by default. Best Ball is excluded from lineup-style action unless you explicitly include a custom league. Select leagues individually when commissioner or waiver rules differ."),
    s('[data-guide-tip="intelligence-decisions"]', "Read evidence before following the link", "Every card identifies the league, trigger, priority, evidence, and destination tool. Save or snooze ideas that are not ready; complete or dismiss only after review, then rate the outcome so Decision Memory becomes useful.", undefined, { scrollBlock:"start" }),
  ],
  "/manager-intelligence": [
    s("main header", "Search the manager and season", "Enter a Sleeper username and season to build the public portfolio. The results describe recorded leagues, rosters, drafts, transactions, and outcomes—not personality or intent."),
    s("main nav.mt-5 button:nth-of-type(1)", "Manager Profile", "Start with the full portfolio summary and recurring behavior. Repetition can suggest a tendency, but small samples and inactive seasons should lower confidence.", tab("Manager Profile")),
    s("main nav.mt-5 button:nth-of-type(2)", "Leagues", "Choose a league to load its owners and transaction activity. Selecting another owner opens that manager's portfolio without returning to the search form.", tab("Leagues")),
    s("main nav.mt-5 button:nth-of-type(3)", "Compare Owners", "Compare managers inside the same scoring and scarcity context. Use it with Rivalry Center: comparison describes broader tendencies, while rivalry isolates repeated head-to-head history.", tab("Compare Owners")),
    s("main nav.mt-5 button:nth-of-type(4)", "Weekly Report", "Use weekly results and activity to distinguish a recurring pattern from one unusual move or matchup.", tab("Weekly Report")),
    s("main nav.mt-5 button:nth-of-type(5)", "Rivalry Center", "Choose an opponent to combine head-to-head results, shared leagues, transactions, and repeated matchup history. Closing or finishing returns to Manager Profile.", () => { tab("Rivalry Center")(); return () => tab("Manager Profile")(); }),
  ],
  "/leaderboard": [
    s("main header", "This is the Arsenal account leaderboard", "Eligible public Arsenal profiles are ranked using the displayed scoring rules. It is not the standings for the active Sleeper league, and its scope depends on evidence connected to each Arsenal account."),
    s("main section", "Open the profile behind the rank", "A leaderboard position is only a summary. Select a manager to inspect portfolio scope, public badges, and the components that contribute to the score before comparing profiles."),
  ],
  "/league-history": [
    s("main header", "Follow one league across seasons", "The selected league follows the shared sidebar choice. League History walks Sleeper's previous-league links so renewed or renamed seasons remain connected whenever Sleeper preserved that chain."),
    s("main select", "Choose the league, then explore its eras", "Changing the league rebuilds standings, games, drafts, transactions, rivalries, records, and manager continuity. Season controls change the focused year without discarding the full history."),
    s("main nav.sticky button:nth-of-type(1)", "Overview", "Use the linked-season summary, franchise leaderboard, champions, and headline records as the index to the league's history.", tab("Overview")),
    s("main nav.sticky button:nth-of-type(2)", "Record Book", "All-time standings combine regular-season results across linked years. The record cards capture peak games, margins, activity, and recurring opponents.", tab("Record Book")),
    s("main nav.sticky button:nth-of-type(3)", "Rivalries", "Choose a repeated pairing to see wins, ties, points, closest game, and largest margin. At least two recorded meetings are required.", tab("Rivalries")),
    s("main nav.sticky button:nth-of-type(4)", "Seasons", "This factual ledger shows each year's standings, champion, games, transactions, scoring, and awards.", tab("Seasons")),
    s("main nav.sticky button:nth-of-type(5)", "Yearbook", "Choose a year for a shareable recap, printable PDF, and complete appendix. Current-market roster values are retrospectives—not values captured during that season. The tour returns to Overview when closed.", () => { tab("Yearbook")(); return () => tab("Overview")(); }),
  ],
  "/playoff-odds": [
    s('[data-guide-tip="playoff-setup"]', "Choose the league and forecasting lens", "Select a league and projection source before reading any percentage. The simulator starts from actual Sleeper wins, points, playoff-team count, byes, median-win setting, and completed matchups, then plays the remaining schedule repeatedly."),
    s('[data-guide-tip="playoff-setup"] button', "Open Model Settings", "Settings show the exact simulation window, observed cutoff, remaining weeks, league context, and number of runs. The displayed ± sampling noise estimates Monte Carlo error; it does not include player-injury or projection-model uncertainty.", () => { const button=document.querySelector('[data-guide-tip="playoff-setup"] button'); button?.click(); return()=>{const panel=document.querySelector('[data-guide-tip="playoff-settings"]'); if(panel) button?.click();} }, { focusSelector:'[data-guide-tip="playoff-setup"] button' }),
    s('[data-guide-tip="playoff-settings"]', "Verify the assumptions", "More runs reduce random sampling noise. Projections are the defensible weekly-performance lens; values are a roster-strength proxy. Confirm the schedule mode says League rather than synthetic whenever Sleeper exposes the remaining matchups.", undefined, { scrollBlock:"start" }),
    s('[data-guide-tip="playoff-odds-board"]', "Read the Odds Board", "Make playoffs, bye, seed range, and championship odds are shares of simulated season paths—not promises. Compare the percentage with expected wins and points so you understand why two teams with similar records can have different paths.", undefined, { scrollBlock:"start" }),
  ],
  "/commissioner-dashboard": [
    s("main header", "Choose the league you are auditing", "The dashboard follows the shared sidebar league. It reads Sleeper settings, rosters, completed activity, weekly matchups, starters, ownership, and linked seasons; the source control below the header changes roster-strength estimates, not factual activity."),
    s("main nav.sticky button:nth-of-type(1)", "Overview separates facts from review signals", "Health blends participation, empty-starter compliance, ownership, and competitive balance. The table exposes the evidence behind each score. A review signal asks for commissioner context; it never labels tanking, collusion, or misconduct.", tab("Overview")),
    s("main nav.sticky button:nth-of-type(2)", "Action Center turns findings into work", "Use the action queue for current empty starters, past lineup misses, open rosters, activity concerns, and trade reviews. Dues, deadlines, constitution checks, and private notes stay inside this focused workspace and are never written to Sleeper.", tab("Action Center")),
    s("main nav.sticky button:nth-of-type(3)", "League Setup explains the format", "This workspace translates the actual roster slots, bench depth, scoring, flex and superflex rules, playoffs, and waiver pressure into league-economy effects. It explains the league you selected without adding a separate hypothetical settings lab.", tab("League Setup")),
    s("main nav.sticky button:nth-of-type(4)", "Commissioner Portfolio audits all your leagues", "The rollup reruns the same current-lineup, historical empty-starter, orphan, participation, activity, and trade-review checks across commissioned leagues. Open any league for its full evidence.", tab("Commissioner Portfolio")),
    s("main nav.sticky button:nth-of-type(5)", "History checks whether health is persistent", "Scan Sleeper's linked seasons to compare parity, participation, lineup compliance, retention, franchise changes, trades, and waivers across eras.", tab("History")),
    s("main nav.sticky button:nth-of-type(6)", "Reports package the audit", "Reports summarize standings, participation, review signals, league identity, recommendations, and source assumptions. Review the output before sharing it. Closing the tour returns to Overview.", () => { tab("Reports")(); return () => tab("Overview")(); }),
  ],
  "/account": [
    s("main header", "My Arsenal is the persistent account layer", "Your Sleeper username loads leagues and rosters. An Arsenal account adds cross-device saved work, preferences, sessions, and public-profile features; those are separate identities with different purposes."),
    s("main .mt-5.flex.snap-x button:nth-of-type(1)", "Command Home", "See weekly objectives, private notes, decision intelligence, recent tools, pinned leagues, watched players, and saved scenarios in one starting point.", tab("Command Home")),
    s("main .mt-5.flex.snap-x button:nth-of-type(2)", "Profile & Preferences", "Control public identity, fantasy style, tool defaults, digest choices, and the preferences used when a saved item has no league-specific context.", tab("Profile & Preferences")),
    s("main .mt-5.flex.snap-x button:nth-of-type(3)", "Career & Badges", "Refresh the factual Sleeper career record and inspect how badges were earned. Missing historical Sleeper links remain missing rather than being guessed.", tab("Career & Badges")),
    s("main .mt-5.flex.snap-x button:nth-of-type(4)", "Collections", "Manage the universal saved library, pinned leagues, watched players, trades, scenarios, and other synchronized work without mixing it into the command home.", tab("Collections")),
    s("main .mt-5.flex.snap-x button:nth-of-type(5)", "Community", "Manager bookmarks are private and do not notify anyone. They provide shortcuts into Manager Intelligence and rivalry research.", tab("Community")),
    s("main .mt-5.flex.snap-x button:nth-of-type(6)", "Account Control", "Review visibility, downloads, connected sessions, meaningful activity, and deletion controls. Destructive actions affect Arsenal account data, not Sleeper. Closing returns to Command Home.", () => { tab("Account Control")(); return () => tab("Command Home")(); }),
  ],
  "/trust-center": [
    s("main header", "Evidence before confidence", "The center distinguishes observed facts, estimates, and simulations. Use it to audit freshness, coverage, disagreement, validation, known limitations, and the timestamp behind a claim."),
    s("main .sticky button:nth-of-type(1)", "Trust Overview", "Start with freshness, coverage, source status, and known limitations. A healthy fetch does not guarantee complete player coverage, so read both status and matched counts.", tab("Trust overview")),
    s("main .sticky button:nth-of-type(2)", "Sources & Values", "Coverage, format availability, freshness, and source methodology now live in one workspace. A file with players no longer displays zero merely because that publisher does not offer the selected format; the selected board and total stored population are labeled separately.", tab("Sources & values")),
    s("main .sticky button:nth-of-type(3)", "Trends", "Rotate the top-25 mover chart through available publishers or search for a player. The searchable disagreement explorer uses normalized market percentiles so incompatible raw value scales are never compared directly.", tab("Trends")),
    s("main .sticky button:nth-of-type(4)", "Projection Accuracy", "Historical Model Validation shows the leakage-safe 2025 holdout produced from 2023 training and 2024 tuning. The separate publisher comparison requires forecasts frozen before kickoff, matched players, compatible scoring, and finalized outcomes; retrospective files are labeled accordingly.", tab("Projection accuracy")),
    s("main .sticky button:nth-of-type(5)", "Model Transparency", "Review inputs, calibration, promotion gates, limitations, and stored artifacts behind Arsenal estimates. Validation evidence is versioned separately from current projections so a routine refresh does not rewrite the historical result. Closing returns to Trust Overview.", () => { tab("Model transparency")(); return () => tab("Trust overview")(); }),
  ],
  "/ballsville-stats": [
    s("main header", "Ballsville draft intelligence", "This page uses the scheduled Ballsville cache, not live requests on every visit. The timestamp tells you when its league, draft, manager, roster, and selection evidence was last rebuilt."),
    s('[data-guide-tip="ballsville-totals"]', "Start with clean all-mode totals", "Unique managers counts distinct Sleeper IDs. Ballsville leagues counts included leagues; completed draft boards can exceed leagues when one league has multiple drafts. Distinct players is the number selected at least once across every indexed mode."),
    s('[data-guide-tip="ballsville-modes"]', "Filter the population before comparing it", "Select or clear any game mode. The summary below the mode cards recalculates unique managers, leagues, drafts, seats, selections, and distinct players for only that selection. Seats can repeat a manager; managers do not."),
    s('[data-guide-tip="ballsville-tabs"]', "Keep player and team questions separate", "Player Popularity measures selection counts, unique managers, ADP, range, and mode distribution. Team Power Board grades complete Ballsville rosters with the selected Arsenal model."),
    s('[data-guide-tip="ballsville-players"]', "Find the most-selected players", "Drafted is total selections in active modes; Managers is the distinct-manager count; ADP and range describe pick position. Search, filter position, or change sorting. Click a row for mode-by-mode ADP and the managers drafting that player.", tab("Player Popularity"), { scrollBlock:"start" }),
    s('[data-guide-tip="ballsville-teams"]', "Compare complete Ballsville teams", "Choose a projection or value model that fits the selected mode. The board uses 70% top-starter strength and 30% depth; click a team to inspect its covered roster. Mixed modes are intentionally warned because their roster rules differ.", () => { tab("Team Power Board")(); return () => tab("Player Popularity")(); }, { scrollBlock:"start" }),
  ],
};

// Stat Central changed from the old player-first / Team Profiles layout to a
// rankings-first workspace with actual weekly-game evidence. Keep this tour
// beside the guide registry so its steps cannot silently drift with legacy UI.
GUIDES["/stat-central"] = [
  s('[data-guide-tip="stat-workspaces"] button:nth-of-type(1)', "Start with the season leaders", "Rankings is the fastest way to find standout performers, disappointments, archetypes, and consistency outliers. Use its filters to define the player pool, then open any player for the evidence behind the result.", tab("Rankings")),
  s('[data-guide-tip="stat-workspaces"] button:nth-of-type(2)', "Matchups begin with the NFL schedule", "Open Matchups to choose a week and position, then select one real NFL game. Its modal compares both teams against the opposing defense using observed positional-room data.", tab("Matchups")),
  s('[data-guide-tip="matchup-shared-controls"]', "Set the evidence lens", "Season, scoring, position, and week control the Matchup Lab. League scoring recalculates the fantasy-point totals with that league’s Sleeper rules; it does not alter the underlying football stats."),
  s('[data-guide-tip="matchup-secondary-tabs"] button:nth-of-type(1)', "Weekly Matchups compare both sides", "Each card is one scheduled NFL game, not a player recommendation. Open it to see both position rooms, each opponent’s allowance, coverage, and the box-score evidence behind the totals.", tab("Weekly Matchups")),
  s('[data-guide-tip="matchup-weekly-schedule"]', "Open the actual game you want", "Choose the matchup—not a generic team pairing. The modal lets you move directly into player history for either side after you understand the team-level context."),
  s('[data-guide-tip="matchup-secondary-tabs"] button:nth-of-type(2)', "Defense Board is a season-to-date ledger", "This is total fantasy scoring allowed to the entire opposing position room per game. It is never divided by roster spots and it is not a prediction. Click a defense to inspect the completed games and stats that created its number.", tab("Defense Board")),
  s('[data-guide-tip="matchup-defense-board"]', "Verify the number before using it", "The board ranks every defense from least to most permissive for the selected position. Its game count is current-season coverage; the drill-in ledger shows the opponent, points, and key box-score stats for every logged game."),
  s('[data-guide-tip="matchup-secondary-tabs"] button:nth-of-type(3)', "Player History answers the individual question", "Choose an offense and defense, then inspect either best one-week performances or repeated player results against that opponent. Treat it as evidence, not a promise that history will repeat.", tab("Player History")),
  s('[data-guide-tip="matchup-player-history-toggle"]', "Choose the history view deliberately", "Best weekly performances is a searchable game log. Repeated opponent performance compares multi-game results with that player’s other-opponent baseline and reports confidence from the evidence."),
  s('[data-guide-tip="stat-workspaces"] button:nth-of-type(3)', "Player Lab explains the player behind the result", "Player Research, Advanced Stats, Career History, and Compare Players share your selected player, moving from box score to role to longer-term context without repeated searching.", tab("Player Lab")),
  s('[data-guide-tip="stat-player-picker"]', "Search once, keep the player context", "Type a player name and select the result. The same player stays selected through Player Research, Advanced Stats, Career History, and Compare Players when that player exists in the chosen view."),
  s('[data-guide-tip="stat-secondary-tabs"] button:nth-of-type(2)', "Use Advanced Stats to test repeatability", "Snaps, opportunity share, targets, carries, high-value work, efficiency, and EPA help distinguish a sustainable role from a one-week box-score spike.", tab("Advanced Stats")),
  s('[data-guide-tip="stat-secondary-tabs"] button:nth-of-type(4)', "Compare like-for-like players", "Choose a primary player, then compare someone at the same position. Season and scoring changes preserve each selection where possible, so direct comparisons do not force unnecessary re-searching.", () => { tab("Compare Players")(); return () => tab("Rankings")(); }),
];

GUIDES["/account"] = [
  s("main header", "My Arsenal is your account-level home", "This is where personal preferences, saved research, digest choices, career recognition, and account controls live. Your Sleeper portfolio remains the source for leagues and rosters; an Arsenal account keeps your personal layer synchronized across devices."),
  s('nav[aria-label="My Arsenal sections"]', "Use these sections by purpose", "Overview is your season snapshot and tool-tour control. Profile manages identity. Digest controls communications. Library holds saved work. Career & badges records verified progress. Account & privacy manages visibility, data, and sessions."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(1)', "Overview keeps the season in view", "Use this as the landing page for current portfolio context, manager bookmarks, and the universal Tool Tours switch. It is not a second League Hub or an intelligence inbox."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(3)', "Digest controls delivery, not your record", "Digest settings determine which leagues can create daily lineup and news alerts. Portfolio records and season statistics still use every eligible league, including median-game results where applicable."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(4)', "Library is for intentional saves", "Use Library for favorite leagues and saved research you want to keep. It is separate from League Hub&apos;s operational memory, which is for snoozed or completed weekly decisions."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(5)', "Career & badges update from verified records", "Badges preserve previously earned recognition. The scheduled leaderboard refresh updates current-season record and badge progress; it does not require every manager to sign in again."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(6)', "Account & privacy stays in your control", "Review profile visibility, leaderboard eligibility, connected devices, downloaded account data, and deletion controls here. These settings affect Arsenal data, never Sleeper league data."),
];
GUIDES["/account/profile"] = [
  s("main header", "Edit the identity people see", "Profile controls the public Arsenal identity attached to your account. It is separate from your Sleeper username and never changes your Sleeper profile."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(2)', "Profile settings are deliberate", "Update display details and account preferences here. Save before leaving; an Arsenal account synchronizes these choices across signed-in devices."),
];
GUIDES["/account/digest"] = [
  s("main header", "Digest preferences control useful delivery", "Choose how Arsenal communicates with you without changing the underlying portfolio record. Daily intelligence uses the delivery scope; season stats and records continue to reflect all eligible leagues."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(3)', "Return here to tune delivery", "Use the Digest tab whenever you want to change delivery day, alert preferences, or the leagues that can create daily actionable notices."),
];
GUIDES["/account/library"] = [
  s("main header", "Library is your cloud-synced reference shelf", "Save intentional research and favorite leagues here so it follows your Arsenal account. This is for longer-lived reference, not automatic weekly alerts."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(4)', "Keep saved work organized", "Favorite leagues and saved items are account-level. League Hub memory remains the place for operational snoozes and completed injury or lineup reviews."),
];
GUIDES["/account/career"] = [
  s("main header", "Career & badges are evidence-based", "Your record and achievements use verified Sleeper portfolio data. The scheduled leaderboard workflow refreshes current-season progress; historical coverage is shown only where it can be confirmed."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(5)', "Badges keep their earned status", "An already-earned badge is preserved. New badge progress is reconciled during the scheduled refresh rather than guessed from a local visit."),
];
GUIDES["/account/privacy"] = [
  s("main header", "Account & privacy keeps ownership clear", "Control public visibility, leaderboard eligibility, sessions, downloads, and deletion from one place. These controls change Arsenal account data—not Sleeper leagues, rosters, or transactions."),
  s('nav[aria-label="My Arsenal sections"] a:nth-of-type(6)', "Review destructive actions carefully", "Signing out or clearing synced data can be reversed only by signing in and rebuilding it. Account deletion is permanent for Arsenal data, while your Sleeper account remains untouched."),
];

export default function ToolGuides() {
  const pathname = usePathname();
  const steps = GUIDES[pathname];
  const statTabBeforeTour = useRef("");
  const isStatCentral = pathname === "/stat-central";
  const restoreStatCentralTab = () => {
    const labels = { overview:"Player Research", advanced:"Advanced Stats", history:"Career History", compare:"Compare Players", matchups:"Matchup Lab", projections:"Projection Center", leaders:"Leaderboards", model:"Accuracy & Method" };
    const label = labels[statTabBeforeTour.current];
    if (label) tab(label)();
  };
  return steps ? <GuidedTips storageKey={`tfa:tips:${pathname.slice(1)}:premium`} label="Tool tour" steps={steps} onTourStart={isStatCentral ? () => { statTabBeforeTour.current = document.documentElement.dataset.statTab || "overview"; } : undefined} onTourEnd={isStatCentral ? restoreStatCentralTab : undefined} /> : null;
}
