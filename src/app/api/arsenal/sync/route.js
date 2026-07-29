export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, authenticateArsenal, ensureArsenalSchema } from "../../../../lib/arsenalAccountServer";

const allowedKey = (key) => {
  const value = String(key || "");
  const exact = new Set(["format","qbType","sourceKey","year","tfa:account-preferences","tfa:intelligence-actions","tfa:account-platform","tfa:ui-preferences","draft-helper-watchlist","leagueHubWatchlist"]);
  return exact.has(value) || [
    "commissioner-", "orphan-recruiting:", "lineup-saves:", "lineup-controls:", "draft-helper-queue:",
    "playoff-scenarios:", "tfa:trade-workspaces:", "tfa:trade-block:", "tfa:trade-swipes:", "ps:guard:", "ps:ballsville:",
  ].some((prefix) => value.startsWith(prefix));
};

export async function GET(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Invalid Arsenal key.", { status: 401 });
    const rows = await db.prepare(`SELECT item_key, item_value, updated_at FROM arsenal_sync_items WHERE account_id=? ORDER BY updated_at`)
      .bind(account.account_id).all();
    return NextResponse.json({
      ok: true,
      items: (rows?.results || []).map((row) => ({ key: row.item_key, value: row.item_value, updatedAt: Number(row.updated_at || 0) })),
    });
  } catch (error) {
    return new NextResponse(error?.message || "Sync unavailable.", { status: 503 });
  }
}

export async function PUT(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Invalid Arsenal key.", { status: 401 });
    const body = await request.json();
    const items = Array.isArray(body?.items) ? body.items.filter((item) => allowedKey(item?.key)).slice(0, 500) : [];
    const statements = [];
    for (const item of items) {
      const key = String(item.key).slice(0, 240);
      const value = String(item.value ?? "");
      if (value.length > 600000) continue;
      const updatedAt = Math.max(1, Number(item.updatedAt || Date.now()));
      statements.push(db.prepare(`INSERT INTO arsenal_sync_items(account_id, item_key, item_value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, item_key) DO UPDATE SET
          item_value=excluded.item_value,
          updated_at=excluded.updated_at
        WHERE excluded.updated_at >= arsenal_sync_items.updated_at`)
        .bind(account.account_id, key, value, updatedAt));
    }
    for (let index = 0; index < statements.length; index += 50) {
      await db.batch(statements.slice(index, index + 50));
    }
    return NextResponse.json({ ok: true, applied:statements.length, syncedAt: Date.now() });
  } catch (error) {
    return new NextResponse(error?.message || "Sync failed.", { status: 500 });
  }
}

export const POST = PUT;
