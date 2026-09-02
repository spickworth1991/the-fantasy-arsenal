"use client";

import { usePathname } from "next/navigation";
import GuidedTips from "./GuidedTips";

const s = (selector, title, detail, onEnter) => ({ selector, title, detail, onEnter });
const tab = (label) => () => {
  [...document.querySelectorAll("main button")]
    .find((button) => button.textContent.trim() === label)?.click();
};

const GUIDES = {
  "/league-hub": [
    s('[data-guide-tip="league-hub-intro"]', "League Hub is the weekly portfolio inbox", "It scans all included leagues for urgent, fixable work. It remains portfolio-wide; the league selected in the sidebar still controls single-league tools."),
    s("#for-you", "Expand the Action Center when you are ready", "The collapsed count tells you how many items need attention. Expand it to filter lineup, injury, waiver, and trade items; each card names the league, reason, and next action. Dismiss only items you intentionally reviewed."),
    s("#summary", "Jump to the remaining workspaces", "These counts link to the detailed sections below: waiver candidates, injuries, and lineup-risk leagues. The old cross-league watchlist and Waiver Analytics blocks have been removed so these operational sections remain the focus."),
    s("#free-agents", "Build waivers from league need", "Candidates combine availability, the selected player model, and roster need. Open a player to see where the add is possible, then verify waiver rules and the corresponding drop before acting."),
    s("#waivers", "Review recent league activity", "Activity shows waivers, free-agent moves, and trades returned by Sleeper. Use it for context about manager behavior and market demand; it is not another recommendation ranking."),
    s("#injuries", "Find roster exposure to injury", "The injury report groups affected players and the leagues where you roster them. Open the player or league context, confirm current news, and distinguish an injury tag from a confirmed inactive designation."),
    s("#lineup-risk", "Finish with lineup-risk leagues", "This section identifies leagues with empty or risky starting slots. Best Ball leagues should not create lineup actions unless their custom rules allow moves."),
  ],
  "/player-availability": [
    s('[data-guide-tip="availability-intro"]', "Search availability across the portfolio", "Add one or several players to see exactly where each is available, rostered by you, or held by another manager. Results always come from the latest completed roster scan."),
    s('[data-guide-tip="availability-scan"]', "Understand the three league counts", "Scanned is the full loaded portfolio. Showing reflects format filters. Best Available is the subset included in rankings. Click any count to inspect or change the leagues behind it, and Refresh when Sleeper rosters have changed."),
    s('[data-guide-tip="availability-settings"]', "All ranking and filter controls now live together", "Open this premium settings group for projection or value source, scoring and quarterback assumptions, Best Ball scope, drafting leagues, position, sorting, minimum availability, result limit, and the exact included leagues. Projections fit weekly adds; values fit longer-term acquisitions."),
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
  "/stat-central": [
    s("main header", "Begin with the player and the question", "Stat Central joins weekly scoring, role, opportunity, matchups, advanced usage, and projection evidence. Select a player first, then move to the view that answers the specific decision in front of you."),
    s("main .sticky button:nth-of-type(1)", "Player Lab", "Player Research explains scoring and weekly evidence; Advanced Stats adds snaps, opportunity, leverage, EPA, and tracking data; Career History shows season trends; Compare Players places two profiles side by side.", tab("Player Lab")),
    s("main .sticky button:nth-of-type(2)", "Matchup Lab", "Choose position, offense, and defense to compare team production with what that defense allowed. The defense badge now states percent more or fewer points allowed versus league average. Click defensive bars or rankings for the full positional profile.", tab("Matchups")),
    s("main .sticky button:nth-of-type(3)", "Projection Center", "Weekly forecasts redistribute the season baseline using schedule, recent role, matchup evidence, and available context. Safe, expected, and boom/bust outputs are modeled ranges—not guarantees.", tab("Projections")),
    s("main .sticky button:nth-of-type(4)", "Leaderboards", "Rank players by season production, position, archetype, and consistency. Filters define the qualified population, so compare both rank and sample before using a leaderboard result.", tab("Rankings")),
    s("main .sticky button:nth-of-type(5)", "Data Guide", "Methodology documents sources, formulas, measured facts, model estimates, and missing coverage. A blank measurement means unavailable evidence—not zero.", tab("Data Guide")),
  ],
  "/depth-charts": [
    s("main header", "Build the opportunity tree", "Choose a team and position or search for a player. The result combines depth order with injuries, projections, market value, rookie competition, handcuff context, contracts, and your portfolio exposure."),
    s("main details", "Switch the Player Model deliberately", "Projections help answer near-term workload and scoring questions. Values help assess dynasty cost and roster investment. Changing this source changes the numbers beside players, not the NFL team's official depth-chart designation."),
    s("main h2", "Compare a position as a competition", "Read incumbents, backups, specialists, and challengers together. Depth order is a current signal—not a guaranteed snap share—so confirm injuries and recent role evidence before acting."),
  ],
  "/sos": [
    s('[data-guide-tip="sos-setup"]', "Set the league, model, and week range", "Choose the active league and exact start/end weeks. Open Model Settings for projections or values, scoring, format, and quarterback rules. Projections estimate weekly strength; values describe roster quality and are not literal point forecasts."),
    s('[data-guide-tip="sos-view-toggle"]', "Choose Heatmap or Table", "Heatmap reveals the weekly path at a glance; green favors your optimized lineup, yellow is close, and red favors the opponent. Table compresses the same range into overall ease, opponent average, total strength, and games."),
    s('[data-guide-tip="sos-results"]', "Open any week for the actual matchup", "Tap a heatmap cell to inspect the optimized lineups behind its color. Bye weeks are removed when schedule data exists. In CHOPPED formats, colors represent weekly elimination risk instead of head-to-head margin."),
    s('[data-guide-tip="sos-intelligence"]', "Use the deeper intelligence after the weekly map", "The lab now follows the heatmap. Compare two teams, separate regular-season and playoff SOS, inspect position-specific difficulty and volatility, then send the hardest weeks to Player Availability for waiver research."),
  ],
  "/intelligence": [
    s("main header", "Start with the decision window", "Arsenal Intelligence turns league and roster evidence into a prioritized research inbox. Address items closest to lineup lock, waiver processing, or another real deadline before longer-term ideas."),
    s("main section", "Open the evidence, then the destination tool", "A recommendation should explain the league, players, trigger, and expected benefit. Use its linked tool to investigate further and verify current news, eligibility, and league rules before acting."),
  ],
  "/manager-intelligence": [
    s("main header", "Search the manager and season", "Enter a Sleeper username and season to build the public portfolio. The results describe recorded leagues, rosters, drafts, transactions, and outcomes—not personality or intent."),
    s("main nav button:nth-of-type(1)", "Manager Profile", "Start with the full portfolio summary and recurring behavior. Repetition can suggest a tendency, but small samples and inactive seasons should lower confidence.", tab("Manager Profile")),
    s("main nav button:nth-of-type(2)", "Leagues", "Choose a league to load its owners and transaction activity. Selecting another owner opens that manager's portfolio without returning to the search form.", tab("Leagues")),
    s("main nav button:nth-of-type(3)", "Compare Owners", "Compare managers in the same league, where scoring and scarcity match. Use differences to prepare an offer or draft plan—not as an absolute cross-format ranking.", tab("Compare Owners")),
    s("main nav button:nth-of-type(4)", "Weekly Report", "Use weekly results and activity to distinguish a recurring pattern from one unusual move or matchup.", tab("Weekly Report")),
    s("main nav button:nth-of-type(5)", "Rivalry Center", "Review repeated head-to-head outcomes and shared history. Rivalry results describe these matchups; they do not prove universal manager quality.", tab("Rivalry Center")),
  ],
  "/leaderboard": [
    s("main header", "This is the Arsenal account leaderboard", "Eligible public Arsenal profiles are ranked using the displayed scoring rules. It is not the standings for the active Sleeper league, and its scope depends on evidence connected to each Arsenal account."),
    s("main section", "Open the profile behind the rank", "A leaderboard position is only a summary. Select a manager to inspect portfolio scope, public badges, and the components that contribute to the score before comparing profiles."),
  ],
  "/league-history": [
    s("main header", "Follow one league across seasons", "The selected league follows the shared sidebar choice. League History walks Sleeper's previous-league links so renewed or renamed seasons remain connected whenever Sleeper preserved that chain."),
    s("main select", "Choose the league, then explore its eras", "Changing the league rebuilds standings, games, drafts, transactions, rivalries, records, and manager continuity. Season controls change the focused year without discarding the full history."),
    s("main nav button:nth-of-type(1)", "Overview", "Use the linked-season summary, franchise leaderboard, champions, and headline records as the index to the league's history.", tab("Overview")),
    s("main nav button:nth-of-type(2)", "Record Book", "All-time standings combine regular-season results across linked years. The record cards capture peak games, margins, activity, and recurring opponents.", tab("Record Book")),
    s("main nav button:nth-of-type(3)", "Rivalries", "Choose a repeated pairing to see wins, ties, points, closest game, and largest margin. At least two recorded meetings are required.", tab("Rivalries")),
    s("main nav button:nth-of-type(4)", "Seasons", "This factual ledger shows each year's standings, champion, games, transactions, scoring, and awards.", tab("Seasons")),
    s("main nav button:nth-of-type(5)", "Yearbook", "Choose a year for a shareable recap, printable PDF, and complete appendix. Current-market roster values are retrospectives—not values captured during that season.", tab("Yearbook")),
  ],
  "/playoff-odds": [
    s("main header", "Confirm the league before reading probabilities", "The model combines standings, remaining schedule, team strength, and repeated simulations. Confirm playoff-team count, schedule window, and source before interpreting qualification, bye, seed, or title odds."),
    s("main details", "The settings define the simulation", "More simulations reduce random sampling noise, but they cannot remove uncertainty from projections, future lineups, or NFL outcomes. Adjust assumptions only when they match the league's real rules."),
    s("main h2", "Read odds as a collection of possible paths", "A percentage is the share of simulated seasons producing an outcome, not a promise. Compare make-playoff, bye, seed, and title chances on the core odds board; the approximate Scenario Explorer has been removed."),
  ],
  "/commissioner-dashboard": [
    s("main header", "Audit the active league", "This dashboard follows the sidebar league and brings settings, roster compliance, activity, competitive balance, and commissioner follow-ups into one review."),
    s("main details", "Keep advanced checks available but contained", "Collapsed controls hold thresholds, sources, methodology, and lower-frequency settings. Open them when investigating a finding rather than letting configuration compete with the action list."),
    s("main h2", "Separate information from intervention", "A warning may expose a rule quirk or incomplete data rather than misconduct. Review the evidence and league constitution, communicate clearly, and change settings only when commissioner action is actually warranted."),
  ],
  "/account": [
    s("main header", "My Arsenal is the persistent account layer", "Your Sleeper username loads leagues and rosters. An Arsenal account adds cross-device saved work, preferences, sessions, and public-profile features; those are separate identities with different purposes."),
    s("main section", "Check synchronization before changing devices", "Review connection and sync status, saved work, privacy, and sessions here. A tool can save locally even if account sync fails, so confirm the latest sync before expecting that work on another browser."),
  ],
  "/trust-center": [
    s("main header", "Evidence before confidence", "The center distinguishes observed facts, estimates, and simulations. Use it to audit freshness, coverage, disagreement, validation, known limitations, and the timestamp behind a claim."),
    s("main .sticky", "Each tab investigates a different risk", "Overview covers source health; Accuracy covers eligible historical tests; model evidence documents inputs and validation; disagreement views show where markets diverge. Missing evidence stays visibly missing."),
    s("main h2", "Always read the sample and timing", "Accuracy requires comparable scoring, matched players, finalized outcomes, and forecasts frozen before kickoff. Warnings identify retrospective comparisons that should not be mistaken for certified live performance."),
  ],
  "/ballsville-stats": [
    s("main header", "Understand the indexed draft population", "These totals describe Ballsville drafts and managers across game modes. Check league count, unique-manager count, update time, and selected mode before comparing ADP or participation."),
    s("main h2", "Filter game modes before comparing markets", "Rookie, dynasty, and other formats create different player demand. Click the relevant league or mode filter, then interpret ADP, selection frequency, and manager results only inside that population."),
    s("main details", "Use methodology for coverage questions", "Expandable notes explain refresh timing and incomplete samples. Drafting/Drafted refers to participation in the indexed draft cycle; it does not mean every displayed manager is actively drafting at this moment."),
  ],
};

export default function ToolGuides() {
  const pathname = usePathname();
  const steps = GUIDES[pathname];
  return steps ? <GuidedTips storageKey={`tfa:tips:${pathname.slice(1)}:premium`} label="Tool tour" steps={steps} /> : null;
}
