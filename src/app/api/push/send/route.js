import { NextResponse } from "next/server";
import { buildPushPayload } from "@block65/webcrypto-web-push";

function getDb() {
  return process.env.PUSH_DB;
}

function assertAuth(req) {
  const secret = req.headers.get("x-push-secret");
  if (!process.env.PUSH_ADMIN_SECRET || secret !== process.env.PUSH_ADMIN_SECRET) {
    return false;
  }
  return true;
}

function getVapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing VAPID env vars.");
  }

  return { subject, publicKey, privateKey };
}

export async function POST(req) {
  try {
    if (!assertAuth(req)) return new NextResponse("Unauthorized", { status: 401 });

    const { title, message, url = "/draft-pick-tracker" } = (await req.json()) || {};
    const vapid = getVapid();

    const db = getDb();
    if (!db?.prepare) {
      return new NextResponse("PUSH_DB binding not found.", { status: 500 });
    }

    const rows = await db
      .prepare(`SELECT subscription_json FROM push_subscriptions`)
      .all();

    const subs = (rows?.results || [])
      .map((r) => {
        try { return JSON.parse(r.subscription_json); } catch { return null; }
      })
      .filter(Boolean);

    const payloadMsg = {
      data: JSON.stringify({
        title: title || "Draft Update",
        body: message || "New draft activity.",
        url,
      }),
      options: { ttl: 60 },
    };

    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        const payload = await buildPushPayload(payloadMsg, sub, vapid);
        const res = await fetch(sub.endpoint, payload);
        if (!res.ok) throw new Error(`Push failed: ${res.status}`);
        return true;
      })
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;

    return NextResponse.json({ ok: true, sent: ok, failed });
  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
