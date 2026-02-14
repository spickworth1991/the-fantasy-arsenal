export const runtime = "edge";

import { NextResponse } from "next/server";
import { buildWebPushRequest } from "../../../../lib/webpush";

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

export async function POST(req, context) {
  try {
    const env = context?.env || process.env;

    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = env.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const vapidPrivateRaw = env.VAPID_PRIVATE_KEY;
    const vapidSubject = env.VAPID_SUBJECT;

    if (!vapidPrivateRaw || !vapidSubject) {
      return new NextResponse("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.", { status: 500 });
    }

    let vapidPrivateJwk;
    try {
      vapidPrivateJwk = JSON.parse(vapidPrivateRaw);
    } catch {
      return new NextResponse("VAPID_PRIVATE_KEY must be a JSON JWK string.", { status: 500 });
    }

    const input = (await req.json()) || {};
    const title = input.title || "Draft Update";
    const body = input.body || input.message || "New draft activity.";
    const url = input.url || "/draft-pick-tracker";

    const rows = await db.prepare(`SELECT endpoint, subscription_json FROM push_subscriptions`).all();
    const subs = (rows?.results || [])
      .map((r) => {
        try {
          return { endpoint: r.endpoint, sub: JSON.parse(r.subscription_json) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    let sent = 0;
    let failed = 0;
    const failures = [];

    for (const s of subs) {
      try {
        const { endpoint, fetchInit } = await buildWebPushRequest({
          subscription: s.sub,
          payload: { title, body, url },
          vapidSubject,
          vapidPrivateJwk,
        });

        const res = await fetch(endpoint, fetchInit);

        if (res.ok) {
          sent++;
        } else {
          const txt = await res.text().catch(() => "");
          failures.push({ endpoint: s.endpoint, status: res.status, body: txt });

          // prune dead endpoints
          if (res.status === 404 || res.status === 410) {
            await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
          }
          failed++;
        }
      } catch (e) {
        failures.push({ endpoint: s.endpoint, error: e?.message || String(e) });
        failed++;
      }
    }

    return NextResponse.json({ ok: true, sent, failed, failures, subs: subs.length });
  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
