export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, authenticateArsenal, bearerToken, ensureArsenalSchema, sha256 } from "../../../../lib/arsenalAccountServer";

export async function GET(request){
  try{
    const db=arsenalDb();await ensureArsenalSchema(db);
    const account=await authenticateArsenal(request,db);if(!account)return new NextResponse("Unauthorized.",{status:401});
    const current=await sha256(bearerToken(request));
    const rows=await db.prepare("SELECT token_hash, created_at, last_seen_at FROM arsenal_sessions WHERE account_id=? ORDER BY last_seen_at DESC").bind(account.account_id).all();
    return NextResponse.json({sessions:(rows.results||[]).map(row=>({id:row.token_hash,createdAt:Number(row.created_at),lastSeenAt:Number(row.last_seen_at),current:row.token_hash===current}))});
  }catch(error){return new NextResponse(error?.message||"Sessions unavailable.",{status:500});}
}

export async function DELETE(request){
  try{
    const db=arsenalDb();await ensureArsenalSchema(db);
    const account=await authenticateArsenal(request,db);if(!account)return new NextResponse("Unauthorized.",{status:401});
    const body=await request.json().catch(()=>({}));const current=await sha256(bearerToken(request));
    if(body.all)await db.prepare("DELETE FROM arsenal_sessions WHERE account_id=? AND token_hash<>?").bind(account.account_id,current).run();
    else if(body.id&&body.id!==current)await db.prepare("DELETE FROM arsenal_sessions WHERE account_id=? AND token_hash=?").bind(account.account_id,String(body.id)).run();
    return NextResponse.json({ok:true});
  }catch(error){return new NextResponse(error?.message||"Session could not be removed.",{status:500});}
}
