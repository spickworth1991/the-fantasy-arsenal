export const runtime = "edge";

import { NextResponse } from "next/server";
import { buildWebPushRequest } from "../../../../lib/webpush";

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

async function shortHash(str) {
  // Edge-safe: WebCrypto
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  // last 8 hex chars is plenty for matching
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(-8);
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

    let input = {};
    try {
      input = (await req.json()) || {};
    } catch {
      // allow empty body
      input = {};
    }

    const title = input.title || "Draft Update";
    const body = input.body || input.message || "New draft activity.";
    const url = input.url || "/draft-pick-tracker";

    const tag = typeof input.tag === "string" ? input.tag : null;
    const icon = typeof input.icon === "string" ? input.icon : null;
    const badge = typeof input.badge === "string" ? input.badge : null;
    const renotify = !!input.renotify;
    const requireInteraction = !!input.requireInteraction;
    const actions = Array.isArray(input.actions) ? input.actions : null;
    const data = input.data && typeof input.data === "object" ? input.data : null;

    // ✅ Optional: only send to one endpoint (exact match)
    const onlyEndpoint = typeof input.endpoint === "string" ? input.endpoint : null;

    const rows = await db.prepare(`SELECT endpoint, subscription_json FROM push_subscriptions`).all();
    let subs = (rows?.results || [])
      .map((r) => {
        try {
          return { endpoint: r.endpoint, sub: JSON.parse(r.subscription_json) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (onlyEndpoint) {
      subs = subs.filter((s) => s.endpoint === onlyEndpoint || s.sub?.endpoint === onlyEndpoint);
    }

    let sent = 0;
    let failed = 0;
    const failures = [];

    for (const s of subs) {
      try {
        const { endpoint, fetchInit } = await buildWebPushRequest({
          subscription: s.sub,
          payload: {
            title, body, url,
            ...(tag ? { tag } : {}),
            ...(icon ? { icon } : {}),
            ...(badge ? { badge } : {}),
            ...(actions ? { actions } : {}),
            ...(data ? { data } : {}),
            ...(renotify ? { renotify: true } : {}),
            ...(requireInteraction ? { requireInteraction: true } : {}),
          },

          vapidSubject,
          vapidPrivateJwk,
        });

        const res = await fetch(endpoint, fetchInit);

        if (res.ok) {
          sent++;
        } else {
          const txt = await res.text().catch(() => "");
          failures.push({
            endpointHash: await shortHash(s.endpoint),
            status: res.status,
            body: txt,
          });

          // prune dead endpoints
          if (res.status === 404 || res.status === 410) {
            await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
          }
          failed++;
        }
      } catch (e) {
        failures.push({
          endpointHash: await shortHash(s.endpoint),
          error: e?.message || String(e),
        });
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      target: onlyEndpoint ? { endpointHash: await shortHash(onlyEndpoint) } : null,
      subsConsidered: subs.length,
      sent,
      failed,
      failures,
    });
  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
