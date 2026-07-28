export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, arsenalEnv, authenticateArsenal, ensureArsenalSchema } from "../../../../lib/arsenalAccountServer";

const json=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`Sleeper HTTP ${r.status}`);return r.json();};
const num=v=>Number(v||0);
async function gmail(env,to,subject,html){
  if(!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET||!env.GMAIL_REFRESH_TOKEN)throw new Error("Gmail delivery secrets are not configured.");
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,client_secret:env.GMAIL_CLIENT_SECRET,refresh_token:env.GMAIL_REFRESH_TOKEN,grant_type:"refresh_token"})});
  const tokenPayload=await tokenResponse.json().catch(()=>({}));
  if(!tokenResponse.ok){
    const code=String(tokenPayload?.error||tokenResponse.status).slice(0,60);
    const detail=String(tokenPayload?.error_description||"Google rejected the stored OAuth credentials.").replace(/\s+/g," ").slice(0,180);
    throw new Error(`Gmail token refresh failed: ${code} — ${detail}`);
  }
  const access=tokenPayload.access_token;
  if(!access)throw new Error("Gmail token refresh failed: Google returned no access token.");
  const from="contact.stickypicky@gmail.com";
  const message=[`From: The Fantasy Arsenal <${from}>`,`To: ${to}`,`Subject: ${subject}`,"MIME-Version: 1.0","Content-Type: text/html; charset=UTF-8","",html].join("\r\n");
  const raw=btoa(unescape(encodeURIComponent(message))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const sent=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json"},body:JSON.stringify({raw})});
  if(!sent.ok)throw new Error(`Gmail send failed (${sent.status}).`);
}
async function buildDigest(username,season,week){
  const user=await json(`https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`);
  const leagues=await json(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`);
  const rows=(await Promise.all((leagues||[]).map(async league=>{
    const [rosters,matchups]=await Promise.all([json(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).catch(()=>[]),json(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${week}`).catch(()=>[])]);
    const mine=rosters.find(r=>String(r.owner_id)===String(user.user_id));const my=matchups.find(m=>String(m.roster_id)===String(mine?.roster_id));const opp=matchups.find(m=>m.matchup_id===my?.matchup_id&&String(m.roster_id)!==String(mine?.roster_id));if(!my)return null;
    return{name:league.name,points:num(my.points),opp:num(opp?.points),empty:(my.starters||[]).filter(id=>!id||id==="0").length};
  }))).filter(Boolean);
  const wins=rows.filter(r=>r.points>r.opp).length,losses=rows.filter(r=>r.points<r.opp).length,points=rows.reduce((s,r)=>s+r.points,0),empty=rows.reduce((s,r)=>s+r.empty,0),close=rows.filter(r=>Math.abs(r.points-r.opp)<=10).length;
  return{rows,wins,losses,points,empty,close};
}

async function ready(db){
  await ensureArsenalSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS arsenal_digest_subscriptions (
    account_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    delivery_day INTEGER NOT NULL DEFAULT 2,
    updated_at INTEGER NOT NULL,
    last_sent_at INTEGER
  )`).run();
}

export async function POST(request){
  try{
    const db=arsenalDb();await ready(db);
    const account=await authenticateArsenal(request,db);
    if(!account)return new NextResponse("Sign in to manage digest delivery.",{status:401});
    const body=await request.json();
    const email=String(body?.email||"").trim().toLowerCase().slice(0,254);
    const enabled=body?.enabled?1:0;
    if(enabled&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return new NextResponse("Enter a valid delivery email.",{status:400});
    await db.prepare(`INSERT INTO arsenal_digest_subscriptions(account_id,email,enabled,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET email=excluded.email,enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .bind(account.account_id,email,enabled,Date.now()).run();
    return NextResponse.json({ok:true,email,enabled:!!enabled});
  }catch(error){return new NextResponse(error?.message||"Digest preference could not be saved.",{status:500});}
}

export async function GET(request){
  try{
    const env=arsenalEnv();
    if(!env.DIGEST_CRON_SECRET||request.headers.get("authorization")!==`Bearer ${env.DIGEST_CRON_SECRET}`)return new NextResponse("Unauthorized.",{status:401});
    const db=arsenalDb();await ready(db);
    const state=await json("https://api.sleeper.app/v1/state/nfl");
    const season=num(state.season)||new Date().getUTCFullYear(),week=Math.max(1,num(state.week)||1);
    const due=await db.prepare(`SELECT s.*,a.sleeper_username,a.display_name FROM arsenal_digest_subscriptions s JOIN arsenal_accounts a ON a.account_id=s.account_id WHERE s.enabled=1 AND (s.last_sent_at IS NULL OR s.last_sent_at<?) LIMIT 100`).bind(Date.now()-5*86400000).all();
    let sent=0;const failures=[];
    for(const row of due.results||[]){
      try{
        const d=await buildDigest(row.sleeper_username,season,week);
        const games=d.rows.map(r=>`<tr><td style="padding:8px">${r.name}</td><td style="padding:8px;text-align:right">${r.points.toFixed(1)}–${r.opp.toFixed(1)}</td></tr>`).join("");
        const html=`<div style="font-family:Arial;background:#07111f;color:#fff;padding:28px"><h1>The Fantasy Arsenal</h1><p style="color:#7dd3fc">Week ${week} Portfolio Digest</p><h2>${row.display_name||row.sleeper_username}: ${d.wins}-${d.losses}</h2><p>${d.points.toFixed(1)} total points · ${d.close} close matchups · ${d.empty} empty lineup slots</p><table style="width:100%;color:#fff">${games}</table><p><a style="color:#67e8f9" href="https://thefantasyarsenal.com/account">Open the full interactive digest</a></p><small style="color:#94a3b8">Manage delivery from your Arsenal account profile.</small></div>`;
        await gmail(env,row.email,`Your Week ${week} Fantasy Arsenal Portfolio Digest`,html);
        await db.prepare("UPDATE arsenal_digest_subscriptions SET last_sent_at=? WHERE account_id=?").bind(Date.now(),row.account_id).run();sent+=1;
      }catch(error){failures.push({account:row.account_id,error:String(error.message||error).slice(0,180)});}
    }
    return NextResponse.json({ok:true,season,week,sent,failed:failures.length,failures});
  }catch(error){return new NextResponse(error?.message||"Digest delivery failed.",{status:500});}
}
