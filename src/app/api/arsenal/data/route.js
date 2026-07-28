export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, arsenalEnv, authenticateArsenal, ensureArsenalSchema, passwordHash, publicAccount } from "../../../../lib/arsenalAccountServer";

export async function GET(request){
  try{
    const db=arsenalDb();await ensureArsenalSchema(db);
    const account=await authenticateArsenal(request,db);if(!account)return new NextResponse("Unauthorized.",{status:401});
    const [sync,sessions]=await Promise.all([
      db.prepare("SELECT item_key,item_value,updated_at FROM arsenal_sync_items WHERE account_id=?").bind(account.account_id).all(),
      db.prepare("SELECT created_at,last_seen_at FROM arsenal_sessions WHERE account_id=?").bind(account.account_id).all(),
    ]);
    let digest=null;try{digest=await db.prepare("SELECT email,enabled,timezone,delivery_day,include_news,news_enabled,news_delivery_day,updated_at,last_sent_at,news_last_sent_at FROM arsenal_digest_subscriptions WHERE account_id=?").bind(account.account_id).first();}catch{}
    return NextResponse.json({exportedAt:new Date().toISOString(),profile:publicAccount(account),syncItems:sync.results||[],sessions:sessions.results||[],digest});
  }catch(error){return new NextResponse(error?.message||"Export unavailable.",{status:500});}
}

export async function DELETE(request){
  try{
    const db=arsenalDb();await ensureArsenalSchema(db);
    const account=await authenticateArsenal(request,db);if(!account)return new NextResponse("Unauthorized.",{status:401});
    const body=await request.json().catch(()=>({}));const mode=String(body.mode||"");
    if(mode==="sync"){await db.prepare("DELETE FROM arsenal_sync_items WHERE account_id=?").bind(account.account_id).run();return NextResponse.json({ok:true});}
    if(mode==="history"){
      await db.prepare("DELETE FROM arsenal_sync_items WHERE account_id=? AND item_key='tfa:intelligence-actions'").bind(account.account_id).run();
      const platform=await db.prepare("SELECT item_value FROM arsenal_sync_items WHERE account_id=? AND item_key='tfa:account-platform'").bind(account.account_id).first();
      if(platform?.item_value)try{const parsed=JSON.parse(platform.item_value);parsed.activity=[];await db.prepare("UPDATE arsenal_sync_items SET item_value=?,updated_at=? WHERE account_id=? AND item_key='tfa:account-platform'").bind(JSON.stringify(parsed),Date.now(),account.account_id).run();}catch{}
      return NextResponse.json({ok:true});
    }
    if(mode==="avatar"){
      const match=String(account.avatar_value||"").match(/[?&]key=([^&]+)/);const key=match?decodeURIComponent(match[1]):"";
      if(key)await arsenalEnv().PROFILE_MEDIA?.delete?.(key);
      await db.prepare("UPDATE arsenal_accounts SET avatar_type='stock',avatar_value='blitz',updated_at=? WHERE account_id=?").bind(Date.now(),account.account_id).run();
      return NextResponse.json({ok:true});
    }
    if(mode==="account"){
      const candidate=await passwordHash(String(body.password||""),account.password_salt||"");
      if(!account.password_hash||candidate!==account.password_hash)return new NextResponse("Password confirmation is incorrect.",{status:403});
      const match=String(account.avatar_value||"").match(/[?&]key=([^&]+)/);if(match)await arsenalEnv().PROFILE_MEDIA?.delete?.(decodeURIComponent(match[1]));
      try{await db.prepare("DELETE FROM arsenal_digest_subscriptions WHERE account_id=?").bind(account.account_id).run();}catch{}
      await db.batch([db.prepare("DELETE FROM arsenal_sync_items WHERE account_id=?").bind(account.account_id),db.prepare("DELETE FROM arsenal_sessions WHERE account_id=?").bind(account.account_id),db.prepare("DELETE FROM arsenal_accounts WHERE account_id=?").bind(account.account_id)]);
      return NextResponse.json({ok:true});
    }
    return new NextResponse("Unknown deletion mode.",{status:400});
  }catch(error){return new NextResponse(error?.message||"Data action failed.",{status:500});}
}
