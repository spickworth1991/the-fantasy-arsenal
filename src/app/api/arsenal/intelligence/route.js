export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, authenticateArsenal, ensureArsenalSchema } from "../../../../lib/arsenalAccountServer";

const CACHE_KEY = "tfa:intelligence-server";
const CACHE_MS = 5 * 60 * 1000;
const sleeper = async (path) => {
  const response = await fetch(`https://api.sleeper.app/v1${path}`, {
    headers:{ Accept:"application/json" },
  });
  if (!response.ok) throw new Error(`Sleeper returned HTTP ${response.status}`);
  return response.json();
};
const number = (value) => Number(value || 0);
const unique = (items) => [...new Map(items.map((item) => [item.id, item])).values()];
const tone = (priority) => priority >= 90 ? "critical" : priority >= 70 ? "warning" : priority >= 45 ? "opportunity" : "planning";

async function readSnapshot(db, accountId) {
  const row = await db.prepare("SELECT item_value,updated_at FROM arsenal_sync_items WHERE account_id=? AND item_key=?")
    .bind(accountId, CACHE_KEY).first();
  if (!row?.item_value) return null;
  try { return { ...JSON.parse(row.item_value), storedAt:Number(row.updated_at || 0) }; } catch { return null; }
}

async function saveSnapshot(db, accountId, snapshot) {
  const at = Date.now();
  await db.prepare(`INSERT INTO arsenal_sync_items(account_id,item_key,item_value,updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(account_id,item_key) DO UPDATE SET item_value=excluded.item_value,updated_at=excluded.updated_at`)
    .bind(accountId, CACHE_KEY, JSON.stringify(snapshot), at).run();
}

function priorityChange(item, previous) {
  if (!previous) return { ...item, previousPriority:null, priorityChange:0, priorityReason:"Newly detected during this refresh." };
  const change = number(item.priority) - number(previous.priority);
  let priorityReason = "Priority is unchanged because the underlying deadline and impact are stable.";
  if (change > 0) priorityReason = "Priority increased because this action is now more urgent or has greater immediate impact.";
  if (change < 0) priorityReason = "Priority decreased because the deadline passed, the signal weakened, or a higher-risk condition cleared.";
  return { ...item, previousPriority:number(previous.priority), priorityChange:change, priorityReason };
}

async function buildSnapshot(account, previous, requestedLeagueIds = []) {
  const state = await sleeper("/state/nfl").catch(() => ({}));
  const season = number(state.season) || new Date().getFullYear();
  const week = Math.max(1, number(state.week) || 1);
  const user = await sleeper(`/user/${encodeURIComponent(account.sleeper_username)}`);
  const leagues = await sleeper(`/user/${user.user_id}/leagues/nfl/${season}`);
  const requested = new Set(requestedLeagueIds.map(String));
  const targets = requested.size ? leagues.filter((league) => requested.has(String(league.league_id))) : leagues;
  const previousLeagueItems = new Map((previous?.items || []).map((item) => [String(item.leagueId || ""), item]));
  const failures = [];
  let cursor = 0;
  const collected = [];
  const workers = Array.from({ length:Math.min(8, targets.length || 1) }, async () => {
    while (cursor < targets.length) {
      const league = targets[cursor++];
      const leagueId = String(league.league_id);
      try {
        const commissionerAccount = String(league.owner_id || "") === String(user.user_id);
        const [rosters, users, matchups, previousMatchups, transactions, drafts] = await Promise.all([
          sleeper(`/league/${leagueId}/rosters`),
          sleeper(`/league/${leagueId}/users`),
          sleeper(`/league/${leagueId}/matchups/${week}`).catch(() => []),
          commissionerAccount && week > 1 ? sleeper(`/league/${leagueId}/matchups/${week - 1}`).catch(() => []) : Promise.resolve([]),
          sleeper(`/league/${leagueId}/transactions/${week}`).catch(() => []),
          sleeper(`/league/${leagueId}/drafts`).catch(() => []),
        ]);
        const roster = rosters.find((row) => String(row.owner_id) === String(user.user_id));
        if (!roster) continue;
        const manager = users.find((row) => String(row.user_id) === String(user.user_id));
        const teamName = manager?.metadata?.team_name || manager?.display_name || user.display_name || user.username;
        const matchup = matchups.find((row) => String(row.roster_id) === String(roster.roster_id));
        const starters = Array.isArray(matchup?.starters) ? matchup.starters : [];
        const empty = starters.filter((id) => !id || String(id) === "0").length;
        const base = { leagueId, leagueName:league.name || `League ${leagueId}`, teamName, generatedBy:"server" };
        if (empty) collected.push({ ...base, id:`empty:${leagueId}:${week}`, category:"lineup", priority:100, title:`Fill ${empty} empty starting slot${empty === 1 ? "" : "s"}`, impact:"Prevents a guaranteed zero", impactValue:empty, confidence:100, deadline:null, why:"Sleeper currently reports an empty position in this week’s starting lineup.", evidence:[`${empty} empty starter slot${empty === 1 ? "" : "s"}`,`Week ${week} matchup`], href:`https://sleeper.com/leagues/${leagueId}/matchup`, external:true, action:"Fix in Sleeper" });
        const activeDraft = drafts.find((draft) => ["drafting","paused"].includes(String(draft.status).toLowerCase()));
        if (activeDraft || String(league.status).toLowerCase() === "drafting") collected.push({ ...base, id:`draft:${activeDraft?.draft_id || leagueId}`, category:"draft", priority:92, title:"Draft currently active", impact:"A selection clock is live", impactValue:1, confidence:100, deadline:null, why:"Sleeper reports this league or its current draft as actively drafting.", evidence:[activeDraft ? `Draft ${activeDraft.draft_id}` : "League status: drafting"], href:`/draft-helper?league=${leagueId}${activeDraft?.draft_id ? `&draft=${activeDraft.draft_id}` : ""}`, action:"Enter draft room" });
        const pending = transactions.filter((row) => row.type === "trade" && !["complete","failed"].includes(String(row.status).toLowerCase()));
        if (pending.length) collected.push({ ...base, id:`pending-trades:${leagueId}:${week}`, category:"trade", priority:74, title:`${pending.length} trade${pending.length === 1 ? "" : "s"} awaiting resolution`, impact:"Roster and lineup dependencies", impactValue:pending.length, confidence:95, deadline:null, why:"Sleeper reports trade activity that has not reached a completed or failed state.", evidence:pending.slice(0,4).map((row) => `Transaction ${row.transaction_id || "pending"}`), href:`/trade?league=${leagueId}`, action:"Review trade context" });
        const isCommissioner = commissionerAccount || manager?.is_owner === true;
        if (isCommissioner) {
          const managerName = (rosterId) => {
            const targetRoster = rosters.find((row) => String(row.roster_id) === String(rosterId));
            const targetUser = users.find((row) => String(row.user_id) === String(targetRoster?.owner_id));
            return targetUser?.metadata?.team_name || targetUser?.display_name || targetUser?.username || `Roster ${rosterId}`;
          };
          matchups.forEach((row) => {
            const count = (row.starters || []).filter((id) => !id || String(id) === "0").length;
            if (!count) return;
            const prior = previousMatchups.find((priorRow) => String(priorRow.roster_id) === String(row.roster_id));
            const priorEmpty = (prior?.starters || []).filter((id) => !id || String(id) === "0").length;
            collected.push({ ...base, id:`commissioner-empty:${leagueId}:${week}:${row.roster_id}`, category:"commissioner", priority:100, title:`${managerName(row.roster_id)} has ${count} empty starting slot${count === 1 ? "" : "s"}`, impact:priorEmpty ? "Repeated lineup-compliance signal" : "League lineup compliance", impactValue:count + priorEmpty, confidence:100, deadline:null, why:priorEmpty ? "Sleeper reports empty starting positions for this manager in consecutive weeks." : "Sleeper reports an empty starting position for a manager in a league this account commissions.", evidence:[`Manager: ${managerName(row.roster_id)}`,`Roster ${row.roster_id}`,`${count} empty slot${count === 1 ? "" : "s"} in Week ${week}`,priorEmpty ? `${priorEmpty} empty slot${priorEmpty === 1 ? "" : "s"} in Week ${week - 1}` : ""].filter(Boolean), href:`/commissioner-dashboard?league=${leagueId}&tab=activity`, action:"Review manager activity" });
          });
          rosters.filter((row) => !row.owner_id).forEach((row) => collected.push({ ...base, id:`commissioner-orphan:${leagueId}:${row.roster_id}`, category:"commissioner", priority:84, title:`Roster ${row.roster_id} has no assigned manager`, impact:"League continuity", impactValue:1, confidence:100, deadline:null, why:"Sleeper exposes this roster without an owner ID, making it a replacement-manager priority.", evidence:[`Roster ${row.roster_id}`, "No owner_id returned by Sleeper"], href:`/commissioner-dashboard?league=${leagueId}&tab=orphan`, action:"Open orphan evaluator" }));
          if (pending.length) {
            const involved = [...new Set(pending.flatMap((row) => row.roster_ids || Object.values(row.adds || {})).map(String))];
            collected.push({ ...base, id:`commissioner-trades:${leagueId}:${week}`, category:"commissioner", priority:78, title:`Review ${pending.length} unresolved league trade${pending.length === 1 ? "" : "s"}`, impact:"Transaction review", impactValue:pending.length, confidence:96, deadline:null, why:"One or more league trades have not reached a completed or failed state.", evidence:[...involved.slice(0,6).map((id) => `Manager: ${managerName(id)}`), ...pending.slice(0,4).map((row) => `Transaction ${row.transaction_id || "pending"}`)], href:`/commissioner-dashboard?league=${leagueId}&tab=review`, action:"Review trade evidence" });
          }
        }
        if (week >= 11 && String(league.status).toLowerCase() === "in_season") collected.push({ ...base, id:`playoffs:${leagueId}:${week}`, category:"playoffs", priority:52, title:"Playoff leverage is active", impact:"Qualification and seeding paths", impactValue:week, confidence:82, deadline:null, why:`The NFL state is in Week ${week}, when remaining results can materially affect playoff qualification and seeding.`, evidence:[`Week ${week}`,`${number(league.settings?.playoff_teams) || "Configured"} playoff teams`], href:`/playoff-odds?league=${leagueId}`, action:"Explore scenarios" });
      } catch (error) {
        failures.push({ leagueId, leagueName:league.name || leagueId, message:error?.message || "League scan failed" });
      }
    }
  });
  await Promise.all(workers);
  const retained = requested.size ? (previous?.items || []).filter((item) => !requested.has(String(item.leagueId))) : [];
  const previousById = new Map((previous?.items || []).map((item) => [item.id, item]));
  const items = unique([...retained, ...collected]).map((item) => priorityChange({ ...item, tone:tone(item.priority) }, previousById.get(item.id))).sort((a,b) => b.priority-a.priority);
  return { generatedAt:Date.now(), season, week, username:user.username, items, failures, scannedLeagues:targets.length, totalLeagues:leagues.length, source:"account-server" };
}

export async function GET(request) {
  try {
    const db = arsenalDb(); await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Invalid Arsenal key.", { status:401 });
    const snapshot = await readSnapshot(db, account.account_id);
    return NextResponse.json({ ok:true, snapshot, stale:!snapshot || Date.now() - number(snapshot.generatedAt) > CACHE_MS });
  } catch (error) {
    return new NextResponse(error?.message || "Intelligence unavailable.", { status:503 });
  }
}

export async function POST(request) {
  try {
    const db = arsenalDb(); await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Invalid Arsenal key.", { status:401 });
    if (!account.sleeper_username) return new NextResponse("Attach a Sleeper manager first.", { status:400 });
    const body = await request.json().catch(() => ({}));
    const previous = await readSnapshot(db, account.account_id);
    if (!body.force && !body.leagueIds?.length && previous && Date.now() - number(previous.generatedAt) <= CACHE_MS) {
      return NextResponse.json({ ok:true, snapshot:previous, cached:true });
    }
    const snapshot = await buildSnapshot(account, previous, Array.isArray(body.leagueIds) ? body.leagueIds.slice(0,100) : []);
    await saveSnapshot(db, account.account_id, snapshot);
    return NextResponse.json({ ok:true, snapshot, cached:false });
  } catch (error) {
    return new NextResponse(error?.message || "Intelligence refresh failed.", { status:500 });
  }
}
