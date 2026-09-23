export const runtime = "edge";

import { NextResponse } from "next/server";
import { propContext } from "../prop-bets/route";

export async function POST(request) {
  try {
    const { db, account } = await propContext(request);
    if (!account) return new NextResponse("Unauthorized.", { status: 401 });
    const body = await request.json();
    const tickets = Array.isArray(body.tickets) ? body.tickets.slice(0, 5) : [];
    const snapshotId = String(body.snapshotId || "").slice(0, 120);
    if (!snapshotId || !tickets.length) return new NextResponse("No recommendations supplied.", { status: 400 });
    const statements = tickets.map((ticket) => {
      const recommendationId = String(ticket.recommendationId || ticket.id || "").slice(0, 160);
      return db.prepare(`INSERT OR IGNORE INTO arsenal_prop_recommendations
        (recommendation_id,account_id,snapshot_id,ticket_json,created_at) VALUES (?,?,?,?,?)`)
        .bind(`${account.account_id}:${recommendationId}`, account.account_id, snapshotId, JSON.stringify(ticket), Date.now());
    });
    await db.batch(statements);
    return NextResponse.json({ ok: true, recorded: statements.length });
  } catch (error) {
    return new NextResponse(error?.message || "Recommendations could not be recorded.", { status: 500 });
  }
}

