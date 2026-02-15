export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

export async function POST(req) {
  try {
    const { env } = getRequestContext();
    const db = env?.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const { endpoint } = await req.json().catch(() => ({}));
    if (!endpoint) return new NextResponse("Missing endpoint.", { status: 400 });

    await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(endpoint).run();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e?.message || "Unsubscribe failed.", { status: 500 });
  }
}
