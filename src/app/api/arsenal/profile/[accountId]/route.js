export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, ensureArsenalSchema, publicProfile } from "../../../../../lib/arsenalAccountServer";

export async function GET(_request, { params }) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const { accountId } = await params;
    const account = await db.prepare("SELECT * FROM arsenal_accounts WHERE account_id=? AND profile_public=1")
      .bind(String(accountId || "")).first();
    if (!account) return NextResponse.json({ error:"Public manager profile not found." }, { status:404 });
    return NextResponse.json({ account:publicProfile(account) });
  } catch (error) {
    return NextResponse.json({ error:error?.message || "Profile unavailable." }, { status:503 });
  }
}
