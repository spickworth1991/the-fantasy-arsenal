export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../lib/webpush";

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

function getDb(env) {
  return env?.PUSH_DB;
}

function getVapid(env) {
  const raw = env?.VAPID_PRIVATE_KEY;
  const subject = env?.VAPID_SUBJECT;

  if (!raw || !subject) {
    throw new Error("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.");
  }

  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error("VAPID_PRIVATE_KEY must be a JSON JWK string.");
  }

  return { jwk, subject };
}

function hashEndpoint(endpoint) {
  // tiny stable hash so you can target an endpoint without dumping it in logs
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (h * 31 + endpoint.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export async function POST(req) {
  try {
    // D1 bindings (and other CF bindings) are only available via request context.
    // process.env will NOT contain D1 bindings.
    const { env } = getRequestContext();

    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = getDb(env);
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const { jwk: vapidPrivateJwk, subject: vapidSubject } = getVapid(env);

    const input = (await req.json().catch(() => ({}))) || {};
    const title = input.title || "TFA Test";
    const body = input.body || input.message || "If you see this, push delivery works.";
    const url = input.url || "/draft-pick-tracker";

    // Optional targeting: pass either full endpoint OR endpointHash
    const targetEndpoint = typeof input.endpoint === "string" ? input.endpoint : null;
    const targetHash = typeof input.endpointHash === "string" ? input.endpointHash : null;

    const rows = await db.prepare(`SELECT endpoint, subscription_json FROM push_subscriptions`).all();

    const subs = (rows?.results || [])
      .map((r) => {
        try {
          return { endpoint: r.endpoint, sub: JSON.parse(r.subscription_json) };
        } catch {
          return null;
        }
      })
      .filter((x) => x?.sub?.endpoint && x?.endpoint);

    const filtered = subs.filter((s) => {
      if (targetEndpoint) return s.endpoint === targetEndpoint;
      if (targetHash) return hashEndpoint(s.endpoint) === targetHash;
      return true;
    });

    let sent = 0;
    let failed = 0;
    const failures = [];

    for (const s of filtered) {
      try {
        const payload = { title, body, url };

        const { endpoint, fetchInit } = await buildWebPushRequest({
          subscription: s.sub,
          payload,
          vapidSubject,
          vapidPrivateJwk,
        });

        const res = await fetch(endpoint, fetchInit);

        if (res.ok) {
          sent += 1;
        } else {
          const txt = await res.text().catch(() => "");
          failures.push({ endpointHash: hashEndpoint(s.endpoint), status: res.status, body: txt });

          // prune dead endpoints
          if (res.status === 404 || res.status === 410) {
            await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`).bind(s.endpoint).run();
          }
          failed += 1;
        }
      } catch (e) {
        failures.push({ endpointHash: hashEndpoint(s.endpoint), error: e?.message || String(e) });
        failed += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      target: targetEndpoint ? { endpointHash: hashEndpoint(targetEndpoint) } : null,
      subsConsidered: filtered.length,
      sent,
      failed,
      failures,
    });
  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
