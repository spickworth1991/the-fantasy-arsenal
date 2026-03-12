export const runtime = "edge";

import { NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { buildWebPushRequest } from "../../../../lib/webpush";

function getEnv(ctx) {
  try {
    const rc = typeof getRequestContext === "function" ? getRequestContext() : null;
    return ctx?.env || rc?.env || process.env;
  } catch {
    return ctx?.env || process.env;
  }
}

function assertAuth(req, env) {
  const secret = req.headers.get("x-push-secret");
  return !!env.PUSH_ADMIN_SECRET && secret === env.PUSH_ADMIN_SECRET;
}

async function shortHash(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = Array.from(new Uint8Array(buf));
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(-8);
}

const te = new TextEncoder();

export async function POST(req, context) {
  try {
    const env = getEnv(context);

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
      input = {};
    }

    const urlObj = new URL(req.url);
    const debug = input.debug === true || urlObj.searchParams.get("debug") === "1";

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
    const noPayload = input.noPayload === true;
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
    const results = [];

    for (const s of subs) {
      try {
        const { endpoint, fetchInit } = await buildWebPushRequest({
          subscription: s.sub,
          payload: noPayload
            ? null
            : {
                title,
                body,
                url,
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

        const debugReq = debug
          ? {
              endpointHost: (() => {
                try {
                  return new URL(endpoint).host;
                } catch {
                  return "";
                }
              })(),
              headers: (() => {
                try {
                  const h = fetchInit?.headers || {};
                  const obj = {};
                  if (h && typeof h.forEach === "function") {
                    h.forEach((v, k) => (obj[k] = v));
                  } else {
                    for (const k of Object.keys(h)) obj[k] = h[k];
                  }
                  if (obj.Authorization && obj.Authorization.length > 64) {
                    obj.Authorization = obj.Authorization.slice(0, 64) + "…";
                  }
                  if (obj.authorization && obj.authorization.length > 64) {
                    obj.authorization = obj.authorization.slice(0, 64) + "…";
                  }
                  return obj;
                } catch {
                  return {};
                }
              })(),
              bodyBytes: (() => {
                const b = fetchInit?.body;
                if (!b) return 0;
                if (typeof b === "string") return te.encode(b).byteLength;
                if (b instanceof ArrayBuffer) return b.byteLength;
                if (b?.buffer && typeof b.byteLength === "number") return b.byteLength;
                return 0;
              })(),
            }
          : null;

        const res = await fetch(endpoint, fetchInit);
        const resText = debug ? await res.text().catch(() => "") : "";

        if (res.ok) {
          sent++;
          if (debug) {
            results.push({
              endpointHash: await shortHash(s.endpoint),
              status: res.status,
              ok: true,
              body: resText,
              req: debugReq,
            });
          }
        } else {
          const txt = resText || (await res.text().catch(() => ""));
          failures.push({
            endpointHash: await shortHash(s.endpoint),
            status: res.status,
            body: txt,
          });

          if (debug) {
            results.push({
              endpointHash: await shortHash(s.endpoint),
              status: res.status,
              ok: false,
              body: txt,
              req: debugReq,
            });
          }

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

        if (debug) {
          results.push({
            endpointHash: await shortHash(s.endpoint),
            ok: false,
            error: e?.message || String(e),
            req: null,
          });
        }
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      target: onlyEndpoint ? { endpointHash: await shortHash(onlyEndpoint) } : null,
      subsConsidered: subs.length,
      sent,
      failed,
      failures: debug ? failures : failures.slice(0, 10),
      ...(debug ? { results } : {}),
    });
  } catch (e) {
    return new NextResponse(e?.message || "Push send failed", { status: 500 });
  }
}