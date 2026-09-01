import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const season = Number(process.argv.find((arg) => /^--season=/.test(arg))?.split("=")[1] || new Date().getFullYear());
const outputFile = path.join(root, "public", "data", `ballsville-stats-${season}.json`);
const BALLSVILLE = "https://www.theballsvillegame.com/r2/data/draft-compare";
const BALLSVILLE_LEADERBOARDS = "https://www.theballsvillegame.com/r2/data/leaderboards";
const SLEEPER = "https://api.sleeper.app/v1";
const clean = (value) => String(value ?? "").trim();
const num = (value) => Number(value || 0);
const normalizeName = (value) => clean(value).replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/gi, "").replace(/[.'’\-]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const playerKey = (name, position) => `${normalizeName(name)}|||${clean(position).toUpperCase()}`;
const asArray = (value) => Array.isArray(value) ? value : [];
const anonymousOwnerKey = (value) => createHash("sha256").update(`ballsville-stats:${value}`).digest("hex").slice(0,16);
const publicOwner = (user) => ({
  key:anonymousOwnerKey(clean(user?.user_id)),
  name:clean(user?.display_name || user?.username || "Unknown manager"),
  username:clean(user?.username),
  avatar:clean(user?.avatar),
});

async function getJson(url, fallback = null) {
  const response = await fetch(url, { headers:{ accept:"application/json", "user-agent":"the-fantasy-arsenal-ballsville-stats" } });
  if (!response.ok) {
    if (fallback !== null) return fallback;
    throw new Error(`${url} returned ${response.status}`);
  }
  const payload = await response.json();
  return payload;
}

async function mapLimit(rows, limit, worker) {
  const output = new Array(rows.length); let cursor = 0;
  await Promise.all(Array.from({ length:Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) { const index=cursor++; try { output[index]=await worker(rows[index],index); } catch (error) { console.warn(error.message); output[index]=null; } }
  }));
  return output.filter(Boolean);
}

function normalizeModes(payload, fallbackSeason) {
  return asArray(payload?.rows ?? payload).map((row) => ({ modeSlug:clean(row?.modeSlug || row?.slug || row?.id).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""), title:clean(row?.title || row?.name || row?.modeSlug), subtitle:clean(row?.subtitle || row?.blurb), season:num(row?.year || row?.season || fallbackSeason), order:num(row?.order || 999) })).filter((row)=>row.modeSlug).sort((a,b)=>a.order-b.order||a.title.localeCompare(b.title));
}

function aggregatePublishedPlayers(payloads) {
  const map = new Map();
  payloads.forEach(({ payload }) => asArray(payload?.leagues).forEach((league) => Object.entries(league?.players && typeof league.players === "object" ? league.players : {}).forEach(([rawKey, player]) => {
    const [fallbackName,fallbackPosition]=rawKey.split("|||");const name=clean(player?.name||fallbackName);const position=clean(player?.position||fallbackPosition);if(!name)return;
    const key=playerKey(name,position);const row=map.get(key)||{name,position,drafts:0,pickSum:0,pickSamples:0};const count=Math.max(1,num(player?.count));row.drafts+=count;if(num(player?.avgOverallPick)>0){row.pickSum+=num(player.avgOverallPick)*count;row.pickSamples+=count;}map.set(key,row);
  })));
  return map;
}

console.log(`Loading Ballsville ${season} modes...`);
const currentModes = normalizeModes(await getJson(`${BALLSVILLE}/modes_${season}.json`), season);
if (!currentModes.length) throw new Error(`No Ballsville modes found for ${season}`);
const currentPayloads = await mapLimit(currentModes, 4, async (mode) => ({ mode, payload:await getJson(`${BALLSVILLE}/drafts_${season}_${mode.modeSlug}.json`) }));
const draftRows = currentPayloads.flatMap(({ mode,payload }) => asArray(payload?.leagues).map((league)=>({mode,league}))).filter(({league})=>league?.leagueId&&league?.draftId);
const leaderboardPayload = await getJson(`${BALLSVILLE_LEADERBOARDS}/leaderboards_${season}.json`, {});
const leaderboardYear = leaderboardPayload?.[String(season)] || leaderboardPayload || {};
const leaderboardLeagues = Object.entries(leaderboardYear).flatMap(([mode,block]) => clean(mode).startsWith("__") ? [] : Object.entries(block?.leagueMeta || {}).map(([name,meta]) => ({ mode, name, leagueId:clean(meta?.leagueId) })).filter((row)=>row.leagueId));
const publishedLeagueIds = new Set(draftRows.map(({league})=>clean(league?.leagueId)).filter(Boolean));
const missingLeaderboardLeagues = leaderboardLeagues.filter((row)=>!publishedLeagueIds.has(row.leagueId));
const publishedDraftIds = new Set(draftRows.map(({league})=>clean(league?.draftId)).filter(Boolean));
console.log(`Joining ${publishedDraftIds.size} unique Ballsville drafts (${draftRows.length} mode-feed rows) to Sleeper...`);
if (missingLeaderboardLeagues.length) {
  throw new Error(`Ballsville draft feeds are incomplete: ${missingLeaderboardLeagues.length} leaderboard league${missingLeaderboardLeagues.length === 1 ? " is" : "s are"} still missing. Refusing to replace the last complete statistics cache.`);
}
const joined = await mapLimit(draftRows, 6, async ({mode,league}) => {
  const [usersRaw,rostersRaw,picksRaw,leagueInfo]=await Promise.all([getJson(`${SLEEPER}/league/${league.leagueId}/users`,[]),getJson(`${SLEEPER}/league/${league.leagueId}/rosters`,[]),getJson(`${SLEEPER}/draft/${league.draftId}/picks`,[]),getJson(`${SLEEPER}/league/${league.leagueId}`,{})]);
  const users=asArray(usersRaw),rosters=asArray(rostersRaw),picks=asArray(picksRaw);const rosterOwner=new Map(rosters.map((row)=>[clean(row?.roster_id),clean(row?.owner_id)]));
  return {mode,league,leagueInfo,users,rosters,picks:picks.map((pick)=>({...pick,ownerId:clean(pick?.picked_by||rosterOwner.get(clean(pick?.roster_id))) }))};
});
if (joined.length !== draftRows.length) {
  throw new Error(`Sleeper data was unavailable for ${draftRows.length - joined.length} of ${draftRows.length} draft rows. Refusing to publish partial statistics.`);
}

let previousPayloads=[];
try { const previousModes=normalizeModes(await getJson(`${BALLSVILLE}/modes_${season-1}.json`),season-1);previousPayloads=await mapLimit(previousModes,4,async(mode)=>({mode,payload:await getJson(`${BALLSVILLE}/drafts_${season-1}_${mode.modeSlug}.json`)})); } catch (error) { console.warn(`Prior season unavailable: ${error.message}`); }
const previousPlayers=aggregatePublishedPlayers(previousPayloads);
const modeStats=new Map(currentModes.map((mode)=>[mode.modeSlug,{...mode,leagueIds:new Set(),draftIds:new Set(),ownerIds:new Set(),seats:0,picks:0,playerIds:new Set()}]));
const players=new Map(),allOwners=new Set(),ownerModes=new Map(),ownersById=new Map();
joined.forEach(({mode,league,users,picks})=>{const stat=modeStats.get(mode.modeSlug);stat.leagueIds.add(clean(league.leagueId));stat.draftIds.add(clean(league.draftId));stat.seats+=num(league?.meta?.teams);
  users.forEach((user)=>{const id=clean(user?.user_id);if(id)ownersById.set(id,publicOwner(user));});
  picks.forEach((pick)=>{const name=clean([pick?.metadata?.first_name,pick?.metadata?.last_name].filter(Boolean).join(" ")||pick?.metadata?.player_id||pick?.player_id);const position=clean(pick?.metadata?.position);if(!name)return;const key=playerKey(name,position);const row=players.get(key)||{key,playerId:clean(pick?.player_id||pick?.metadata?.player_id),name,position,team:clean(pick?.metadata?.team),drafts:0,pickSum:0,bestPick:null,worstPick:0,ownerIds:new Set(),ownerIdsByMode:new Map(),modes:new Map(),modeDetails:new Map(),draftersByMode:new Map()};const pickNo=num(pick?.pick_no);row.drafts++;row.pickSum+=pickNo;row.bestPick=row.bestPick==null?pickNo:Math.min(row.bestPick,pickNo);row.worstPick=Math.max(row.worstPick,pickNo);const detail=row.modeDetails.get(mode.modeSlug)||{drafts:0,pickSum:0,bestPick:null,worstPick:0,rounds:{}};detail.drafts++;detail.pickSum+=pickNo;detail.bestPick=detail.bestPick==null?pickNo:Math.min(detail.bestPick,pickNo);detail.worstPick=Math.max(detail.worstPick,pickNo);detail.rounds[String(num(pick?.round)||"?")]=(detail.rounds[String(num(pick?.round)||"?")]||0)+1;row.modeDetails.set(mode.modeSlug,detail);if(pick.ownerId){stat.ownerIds.add(pick.ownerId);allOwners.add(pick.ownerId);if(!ownerModes.has(pick.ownerId))ownerModes.set(pick.ownerId,new Set());ownerModes.get(pick.ownerId).add(mode.modeSlug);row.ownerIds.add(pick.ownerId);if(!row.ownerIdsByMode.has(mode.modeSlug))row.ownerIdsByMode.set(mode.modeSlug,new Set());row.ownerIdsByMode.get(mode.modeSlug).add(pick.ownerId);if(!row.draftersByMode.has(mode.modeSlug))row.draftersByMode.set(mode.modeSlug,new Map());const managerMap=row.draftersByMode.get(mode.modeSlug);const manager=managerMap.get(pick.ownerId)||{count:0,pickSum:0,bestPick:null,worstPick:0};manager.count++;manager.pickSum+=pickNo;manager.bestPick=manager.bestPick==null?pickNo:Math.min(manager.bestPick,pickNo);manager.worstPick=Math.max(manager.worstPick,pickNo);managerMap.set(pick.ownerId,manager);}row.modes.set(mode.modeSlug,(row.modes.get(mode.modeSlug)||0)+1);players.set(key,row);stat.picks++;stat.playerIds.add(key);});
});
const playerRows=[...players.values()].map((row)=>{const previous=previousPlayers.get(row.key);const adp=row.drafts?row.pickSum/row.drafts:0;const previousAdp=previous?.pickSamples?previous.pickSum/previous.pickSamples:0;return{key:row.key,playerId:row.playerId,name:row.name,position:row.position,team:row.team,drafts:row.drafts,owners:row.ownerIds.size,ownerKeysByMode:Object.fromEntries([...row.ownerIdsByMode].map(([slug,ids])=>[slug,[...ids].map(anonymousOwnerKey)])),modes:Object.fromEntries(row.modes),modeDetails:Object.fromEntries([...row.modeDetails].map(([slug,value])=>[slug,{...value,adp:value.drafts?value.pickSum/value.drafts:0}])),draftersByMode:Object.fromEntries([...row.draftersByMode].map(([slug,managerMap])=>[slug,[...managerMap].map(([id,value])=>({...ownersById.get(id)||{key:anonymousOwnerKey(id),name:"Unknown manager",username:"",avatar:""},...value,adp:value.count?value.pickSum/value.count:0})).sort((a,b)=>b.count-a.count||a.adp-b.adp)])),modeCount:row.modes.size,adp,bestPick:row.bestPick,worstPick:row.worstPick,previousDrafts:previous?.drafts||0,previousAdp,adpChange:previousAdp&&adp?previousAdp-adp:null,returning:!!previous};}).sort((a,b)=>b.drafts-a.drafts||a.adp-b.adp);
const teamRows=joined.flatMap(({mode,league,leagueInfo,users,rosters})=>{const userMap=new Map(users.map(user=>[clean(user?.user_id),publicOwner(user)]));const starterCount=asArray(leagueInfo?.roster_positions).filter(slot=>!["BN","IR","TAXI"].includes(clean(slot).toUpperCase())).length||8;return rosters.map(roster=>{const ownerId=clean(roster?.owner_id);const owner=userMap.get(ownerId)||ownersById.get(ownerId)||{key:anonymousOwnerKey(ownerId||`${league.leagueId}:${roster.roster_id}`),name:`Roster ${roster.roster_id}`,username:"",avatar:""};return{key:`${clean(league.leagueId)}:${clean(roster?.roster_id)}`,modeSlug:mode.modeSlug,leagueId:clean(league.leagueId),leagueName:clean(leagueInfo?.name||league?.name||league?.meta?.name||"Ballsville league"),rosterId:clean(roster?.roster_id),owner,playerIds:asArray(roster?.players).map(clean).filter(Boolean),starterCount};});});
const modeRows=[...modeStats.values()].map((row)=>({modeSlug:row.modeSlug,title:row.title,subtitle:row.subtitle,order:row.order,leagues:row.leagueIds.size,drafts:row.draftIds.size,owners:row.ownerIds.size,seats:row.seats,picks:row.picks,players:row.playerIds.size}));
const uniqueRosterSeats = new Set(teamRows.map((row)=>row.key));
const includedLeagueIds = new Set(joined.map((row)=>clean(row.league?.leagueId)).filter(Boolean));
const output={schemaVersion:4,season,previousSeason:season-1,generatedAt:new Date().toISOString(),source:{ballsville:"Published draft-compare mode boards",sleeper:"League users, rosters, and draft picks",leaderboards:"Published Ballsville leaderboard league directory"},coverage:{leaderboardLeagues:new Set(leaderboardLeagues.map((row)=>row.leagueId)).size,includedLeagues:includedLeagueIds.size,missingLeagues:missingLeaderboardLeagues},summary:{totalOwners:allOwners.size,totalSeats:joined.reduce((sum,row)=>sum+num(row.league?.meta?.teams),0),uniqueRosterSeats:uniqueRosterSeats.size,totalLeagues:includedLeagueIds.size,totalDrafts:new Set(joined.map(row=>clean(row.league.draftId))).size,totalModes:modeRows.length,totalPlayers:playerRows.length,crossModeOwners:[...ownerModes.values()].filter((set)=>set.size>1).length},modes:modeRows,players:playerRows,teams:teamRows};
fs.mkdirSync(path.dirname(outputFile),{recursive:true});fs.writeFileSync(outputFile,`${JSON.stringify(output,null,2)}\n`);console.log(`Wrote ${path.relative(root,outputFile)} (${playerRows.length} players, ${allOwners.size} unique managers).`);
