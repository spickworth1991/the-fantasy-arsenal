export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, arsenalEnv, authenticateArsenal, ensureArsenalSchema } from "../../../../lib/arsenalAccountServer";

const json=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`Sleeper HTTP ${r.status}`);return r.json();};
const num=v=>Number(v||0);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const DIGEST_TEST_EMAIL="spickworth1991@gmail.com";
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
    const points=num(my.points),oppPoints=num(opp?.points);
    return{name:league.name,points,opp:oppPoints,started:points>0||oppPoints>0,empty:(my.starters||[]).filter(id=>!id||id==="0").length};
  }))).filter(Boolean);
  const active=rows.filter(r=>r.started);
  const wins=active.filter(r=>r.points>r.opp).length,losses=active.filter(r=>r.points<r.opp).length,points=rows.reduce((s,r)=>s+r.points,0),empty=rows.reduce((s,r)=>s+r.empty,0),close=active.filter(r=>Math.abs(r.points-r.opp)<=10).length;
  return{rows,wins,losses,points,empty,close};
}

function digestEmail({d,manager,season,week}){
  const mood=d.wins>d.losses?["WINNING WEEK","Your portfolio brought the fire.","#34d399"]:d.wins<d.losses?["BOUNCE-BACK BOARD","A few pressure points need your attention.","#fb7185"]:["PHOTO FINISH","Your portfolio is balanced on a knife edge.","#fbbf24"];
  const games=[...d.rows].sort((a,b)=>Math.abs(a.points-a.opp)-Math.abs(b.points-b.opp)).map(r=>{
    const margin=r.points-r.opp,winning=margin>0,tied=r.started&&margin===0;
    const color=!r.started?"#8292aa":tied?"#fbbf24":winning?"#34d399":"#fb7185";
    return `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #26354d;border-radius:16px;background:#101b2d"><tr><td style="padding:15px 16px"><div style="font-size:14px;font-weight:800;color:#f8fafc">${esc(r.name)}</div><div style="padding-top:5px;font-size:11px;color:#8292aa">${r.empty?`⚠ ${r.empty} empty lineup slot${r.empty===1?"":"s"}`:"Lineup submitted"}</div></td><td align="right" style="padding:15px 16px;white-space:nowrap"><div style="font-size:10px;font-weight:900;letter-spacing:1.5px;color:${color}">${!r.started?"NOT STARTED":tied?"TIED":winning?"WIN":"LOSS"}</div><div style="padding-top:4px;font-size:18px;font-weight:900;color:#f8fafc">${r.points.toFixed(1)} <span style="color:#52627a">–</span> ${r.opp.toFixed(1)}</div><div style="padding-top:3px;font-size:10px;color:${color}">${r.started?`${margin>=0?"+":""}${margin.toFixed(1)} margin`:"Waiting for kickoff"}</div></td></tr></table></td></tr>`;
  }).join("");
  const metric=(value,label,color="#f8fafc",last=false)=>`<td class="metric${last?" metric-last":""}" width="25%" align="center" style="padding:17px 8px"><div style="font-size:24px;font-weight:900;color:${color}">${value}</div><div style="font-size:9px;font-weight:800;letter-spacing:1.2px;color:#718198">${label}</div></td>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:520px){.wrap{padding:12px!important}.hero{padding:24px 18px!important}.metric{display:block!important;width:auto!important;border-bottom:1px solid #26354d}.metric-last{border-bottom:0!important}}</style></head><body style="margin:0;background:#050b16;color:#f8fafc;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Week ${week}: ${d.wins}-${d.losses} across ${d.rows.length} leagues · ${d.points.toFixed(1)} portfolio points.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050b16"><tr><td align="center" class="wrap" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;border:1px solid #24324a;border-radius:24px;background:#091321;overflow:hidden">
  <tr><td class="hero" style="padding:34px;background:linear-gradient(135deg,#101c31,#10263a 58%,#241b49)"><table role="presentation" width="100%"><tr><td><img src="https://thefantasyarsenal.com/icons/TFA.png" width="58" height="58" alt="The Fantasy Arsenal" style="display:block;width:58px;height:58px;object-fit:contain"></td><td align="right" style="font-size:10px;font-weight:900;letter-spacing:2px;color:#7dd3fc">WEEK ${week} · ${season}</td></tr></table><div style="padding-top:22px;font-size:11px;font-weight:900;letter-spacing:2px;color:${mood[2]}">${mood[0]}</div><h1 style="margin:7px 0 0;font-size:32px;line-height:1.08;color:#fff">The Weekly Arsenal</h1><p style="margin:10px 0 0;font-size:14px;line-height:22px;color:#a7b7cd">Hey ${esc(manager)} — ${mood[1]}</p></td></tr>
  <tr><td style="padding:0 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #26354d;border-radius:16px;background:#0d192a"><tr>${metric(`${d.wins}-${d.losses}`,"RECORD",mood[2])}${metric(d.points.toFixed(1),"POINTS")}${metric(d.close,"CLOSE GAMES","#fbbf24")}${metric(d.empty,"EMPTY SLOTS",d.empty?"#fb7185":"#34d399",true)}</tr></table></td></tr>
  <tr><td style="padding:28px 24px 8px"><div style="font-size:11px;font-weight:900;letter-spacing:1.6px;color:#a78bfa">MATCHUP RADAR</div><h2 style="margin:5px 0 7px;font-size:21px;color:#fff">Closest decisions first</h2><p style="margin:0;font-size:12px;line-height:19px;color:#718198">The tightest margins rise to the top so you can focus where a move matters most.</p></td></tr>
  <tr><td style="padding:12px 24px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${games||`<tr><td style="padding:22px;text-align:center;color:#8292aa">No scored matchups were available yet.</td></tr>`}</table></td></tr>
  <tr><td align="center" style="padding:4px 24px 32px"><a href="https://thefantasyarsenal.com/account" style="display:inline-block;padding:15px 24px;border-radius:14px;background:#67e8f9;color:#07111f;font-size:13px;font-weight:900;text-decoration:none">OPEN MY COMMAND CENTER →</a><div style="padding-top:13px;font-size:10px;color:#607089">Lineups · live matchups · waivers · trades · playoff leverage</div></td></tr>
  <tr><td align="center" style="border-top:1px solid #1d2b40;padding:20px 24px;font-size:10px;line-height:17px;color:#52627a">Built for your entire fantasy portfolio by <span style="color:#8da0ba">The Fantasy Arsenal</span>.<br>Manage weekly delivery from My Arsenal.</td></tr>
  </table></td></tr></table></body></html>`;
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
    const testMode=new URL(request.url).searchParams.get("test")==="1";
    const due=testMode
      ? await db.prepare(`SELECT s.*,a.sleeper_username,a.display_name FROM arsenal_digest_subscriptions s JOIN arsenal_accounts a ON a.account_id=s.account_id ORDER BY s.updated_at DESC LIMIT 1`).all()
      : await db.prepare(`SELECT s.*,a.sleeper_username,a.display_name FROM arsenal_digest_subscriptions s JOIN arsenal_accounts a ON a.account_id=s.account_id WHERE s.enabled=1 AND (s.last_sent_at IS NULL OR s.last_sent_at<?) LIMIT 100`).bind(Date.now()-5*86400000).all();
    let sent=0;const failures=[];
    for(const row of due.results||[]){
      try{
        const d=await buildDigest(row.sleeper_username,season,week);
        const html=digestEmail({d,manager:row.display_name||row.sleeper_username,season,week});
        await gmail(env,testMode?DIGEST_TEST_EMAIL:row.email,`Week ${week} Arsenal: ${d.wins}-${d.losses} · ${d.points.toFixed(1)} points`,html);
        if(!testMode)await db.prepare("UPDATE arsenal_digest_subscriptions SET last_sent_at=? WHERE account_id=?").bind(Date.now(),row.account_id).run();
        sent+=1;
      }catch(error){failures.push({account:row.account_id,error:String(error.message||error).slice(0,180)});}
    }
    return NextResponse.json({ok:true,testMode,testRecipient:testMode?DIGEST_TEST_EMAIL:undefined,season,week,sent,failed:failures.length,failures});
  }catch(error){return new NextResponse(error?.message||"Digest delivery failed.",{status:500});}
}
