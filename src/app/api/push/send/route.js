export const runtime = "edge";

import { NextResponse } from "next/server";
import { buildWebPushRequest } from "../../../../lib/webpush";

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

// Small stable hash for debugging (no crypto deps)
function hashEndpoint(endpoint) {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (h * 31 + endpoint.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function getPrivateJWK(env) {
  const raw = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!raw || !subject) throw new Error("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT");
  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error("VAPID_PRIVATE_KEY must be JSON JWK string.");
  }
  return { jwk, subject };
}

export async function POST(req, context) {
  try {
    const env = context?.env || process.env;

    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = env.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const input = (await req.json()) || {};
    const title = input.title || "Draft Update";
    const body = input.body || input.message || "New draft activity.";
    const url = input.url || "/draft-pick-tracker";

    // Optional targeting
    const targetEndpoint = input.endpoint || null;
    const targetHash = input.endpointHash || null;

    const { jwk, subject } = getPrivateJWK(env);

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

    let targets = subs;
    if (targetEndpoint) targets = subs.filter((s) => s.endpoint === targetEndpoint);
    if (targetHash) targets = subs.filter((s) => hashEndpoint(s.endpoint) === targetHash);

    let sent = 0;
    let failed = 0;
    const failures = [];

    for (const s of targets) {
      try {
        const { endpoint, fetchInit } = await buildWebPushRequest({
          subscription: s.sub,
          payload: { title, body, url },
          vapidSubject: subject,
          vapidPrivateJwk: jwk,
          ttl: 60,
        });

        const res = await fetch(endpoint, fetchInit);

        if (res.ok) {
          sent++;
          continue;
        }

        const txt = await res.text().catch(() => "");
        failures.push({ endpointHash: hashEndpoint(s.endpoint), status: res.status, body: txt });

        if (res.status === 404 || res.status === 410) {
          await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
        }
        failed++;
      } catch (e) {
        failures.push({ endpointHash: hashEndpoint(s.endpoint), error: e?.message || String(e) });
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      target: targetEndpoint
        ? { endpointHash: hashEndpoint(targetEndpoint) }
        : targetHash
        ? { endpointHash: targetHash }
        : null,
      subsConsidered: targets.length,
      sent,
      failed,
      failures,
    });
  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
