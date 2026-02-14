export const runtime = "edge";

import { NextResponse } from "next/server";
import { buildPushPayload } from "@block65/webcrypto-web-push";

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

function getVapid(env) {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY; // JWK JSON string
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error("Missing VAPID env vars.");
  return { publicKey, privateKey, subject };
}

export async function POST(req, context) {
  try {
    const env = context?.env || {};
    const db = env.PUSH_DB;

    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const { title, body, url = "/draft-pick-tracker" } = (await req.json()) || {};
    const vapid = getVapid(env);

    const rows = await db.prepare(`SELECT endpoint, subscription_json FROM push_subscriptions`).all();
    const subs = (rows?.results || [])
      .map((r) => {
        try {
          return { endpoint: r.endpoint, sub: JSON.parse(r.subscription_json) };
        } catch {
          return null;
        }
      })
      .filter((x) => x?.sub?.endpoint);

    let sent = 0;
    let failed = 0;
    const failures = [];

    for (const s of subs) {
      try {
        const msg = {
          data: JSON.stringify({
            title: title || "TFA Test",
            body: body || "If you see this, push delivery works.",
            url,
          }),
          options: { ttl: 60 },
        };

        const payload = await buildPushPayload(msg, s.sub, vapid);
        const res = await fetch(s.sub.endpoint, payload);

        if (res.ok) {
          sent += 1;
        } else {
          const txt = await res.text().catch(() => "");
          failures.push({ endpoint: s.endpoint, status: res.status, body: txt });

          // prune dead subs
          if (res.status === 404 || res.status === 410) {
            await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
          }
          failed += 1;
        }
      } catch (e) {
        failures.push({ endpoint: s.endpoint, error: e?.message || String(e) });
        failed += 1;
      }
    }

    return NextResponse.json({ ok: true, subs: subs.length, sent, failed, failures });
  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
