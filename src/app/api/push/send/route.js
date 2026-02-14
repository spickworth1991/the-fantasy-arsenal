export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { buildPushHTTPRequest } from "@pushforge/builder";

function assertAuth(req) {
  const secret = req.headers.get("x-push-secret");
  return !!process.env.PUSH_ADMIN_SECRET && secret === process.env.PUSH_ADMIN_SECRET;
}

function getDb() {
  return process.env.PUSH_DB;
}

function getPrivateJWK() {
  const raw = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!raw || !subject) throw new Error("Missing VAPID_PRIVATE_KEY or VAPID_SUBJECT.");

  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error("VAPID_PRIVATE_KEY must be a JSON JWK string (from `npx @pushforge/builder vapid`).");
  }
  return { jwk, subject };
}

export async function POST(req) {
  try {
    if (!assertAuth(req)) return new NextResponse("Unauthorized", { status: 401 });

    const { title, message, url = "/draft-pick-tracker" } = (await req.json()) || {};
    const { jwk, subject } = getPrivateJWK();

    const db = getDb();
    if (!db?.prepare) {
      return new NextResponse(
        "PUSH_DB binding not found. Add a D1 binding named PUSH_DB in Cloudflare Pages.",
        { status: 500 }
      );
    }

    const rows = await db.prepare(`SELECT subscription_json FROM push_subscriptions`).all();
    const subs = (rows?.results || [])
      .map((r) => {
        try { return JSON.parse(r.subscription_json); } catch { return null; }
      })
      .filter(Boolean);

    const payload = {
      title: title || "Draft Update",
      body: message || "New draft activity.",
      url,
    };

    let sent = 0;
    let failed = 0;
    let failures = [];

    for (const subscription of subs) {
      try {
        const { endpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK: jwk,
          subscription,
          message: {
            payload,
            adminContact: subject,
          },
        });

        const res = await fetch(endpoint, { method: "POST", headers, body });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          failures.push({
            status: res.status,
            body: text,
          });

          // Auto-clean dead subscriptions
          if (res.status === 404 || res.status === 410) {
            await db
              .prepare(`DELETE FROM push_subscriptions WHERE subscription_json=?`)
              .bind(JSON.stringify(subscription))
              .run();
          }

          failed++;
        } else {
          sent++;
        }
      } catch (err) {
        failures.push({ error: err.message });
        failed++;
      }
    }

    return NextResponse.json({ ok: true, sent, failed, failures });

  } catch (e) {
    return new NextResponse(e?.message || "Send failed", { status: 500 });
  }
}
