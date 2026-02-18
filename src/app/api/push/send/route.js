export const runtime = "edge";

import { NextResponse } from "next/server";
import { buildPushHTTPRequest } from "@pushforge/builder";

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

function getPrivateJWK(env) {
  const raw = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;

  if (!raw || !subject) throw new Error("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.");

  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error(
      "VAPID_PRIVATE_KEY must be a JSON JWK string (from `npx @pushforge/builder vapid`)."
    );
  }
  return { jwk, subject };
}

function toNativeHeaders(h) {
  // pushforge may return a Headers-like from a different realm — rebuild it for Cloudflare
  const out = new Headers();
  if (!h) return out;

  if (typeof h.forEach === "function") {
    h.forEach((v, k) => out.set(k, v));
    return out;
  }

  // plain object
  for (const [k, v] of Object.entries(h)) {
    out.set(k, String(v));
  }
  return out;
}

export async function POST(req, context) {
  try {
    const env = context?.env || process.env;

    if (!assertAuth(req, env)) return new NextResponse("Unauthorized", { status: 401 });

    const db = env.PUSH_DB;
    if (!db?.prepare) return new NextResponse("PUSH_DB binding not found.", { status: 500 });

    const { jwk, subject } = getPrivateJWK(env);

    let input = {};
    try {
      input = (await req.json()) || {};
    } catch {
      // allow empty body
      input = {};
    }

    // Core fields
    const title = input.title || "Draft Update";
    const body = input.body || input.message || "New draft activity.";
    const url = input.url || "/draft-pick-tracker";

    // Optional premium fields (passed through to the Service Worker)
    const tag = typeof input.tag === "string" ? input.tag : undefined;
    const renotify = typeof input.renotify === "boolean" ? input.renotify : undefined;
    const requireInteraction =
      typeof input.requireInteraction === "boolean" ? input.requireInteraction : undefined;
    const icon = typeof input.icon === "string" ? input.icon : undefined;
    const badge = typeof input.badge === "string" ? input.badge : undefined;
    const image = typeof input.image === "string" ? input.image : undefined;
    const actions = Array.isArray(input.actions) ? input.actions : undefined;
    const data = typeof input.data === "object" && input.data ? input.data : undefined;

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
        const { endpoint, headers, body: pushBody } = await buildPushHTTPRequest({
          privateJWK: jwk,
          subscription: s.sub,
          message: {
            payload: {
              title,
              body,
              url,
              tag,
              renotify,
              requireInteraction,
              icon,
              badge,
              image,
              actions,
              data,
            },
            adminContact: subject,
          },
        });

        const res = await fetch(endpoint, {
          method: "POST",
          headers: toNativeHeaders(headers),
          body: pushBody,
        });

        if (res.ok) {
          sent += 1;
        } else {
          const txt = await res.text().catch(() => "");
          failures.push({ endpoint: s.endpoint, status: res.status, body: txt });

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

    return NextResponse.json({ ok: true, sent, failed, failures, subs: subs.length });
  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
