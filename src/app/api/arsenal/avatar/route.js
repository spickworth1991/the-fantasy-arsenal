export const runtime = "edge";

import { NextResponse } from "next/server";
import { arsenalDb, arsenalEnv, authenticateArsenal, ensureArsenalSchema } from "../../../../lib/arsenalAccountServer";

export async function POST(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Invalid Arsenal key.", { status: 401 });
    const media = arsenalEnv().PROFILE_MEDIA;
    if (!media?.put) return new NextResponse("PROFILE_MEDIA R2 binding is not configured.", { status: 503 });
    const form = await request.formData();
    const file = form.get("avatar");
    if (!file || typeof file.arrayBuffer !== "function") return new NextResponse("Choose an image.", { status: 400 });
    if (file.size > 1_500_000) return new NextResponse("Avatar must be 1.5 MB or smaller.", { status: 413 });
    const type = String(file.type || "");
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) return new NextResponse("Use JPEG, PNG, WEBP, or GIF.", { status: 415 });
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type];
    const key = `avatars/${account.account_id}/${Date.now()}.${extension}`;
    await media.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type, cacheControl: "public, max-age=3600" } });
    const avatarValue = `/api/arsenal/avatar?account=${encodeURIComponent(account.account_id)}&key=${encodeURIComponent(key)}`;
    await db.prepare(`UPDATE arsenal_accounts SET avatar_type='upload', avatar_value=?, updated_at=? WHERE account_id=?`)
      .bind(avatarValue, Date.now(), account.account_id).run();
    return NextResponse.json({ ok: true, avatarValue });
  } catch (error) {
    return new NextResponse(error?.message || "Avatar upload failed.", { status: 500 });
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("account") || "";
    const key = url.searchParams.get("key") || "";
    if (!accountId || !key.startsWith(`avatars/${accountId}/`)) return new NextResponse("Invalid avatar.", { status: 400 });
    const media = arsenalEnv().PROFILE_MEDIA;
    const object = await media?.get?.(key);
    if (!object) return new NextResponse("Avatar not found.", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata?.(headers);
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("ETag", object.httpEtag || "");
    return new Response(object.body, { headers });
  } catch {
    return new NextResponse("Avatar unavailable.", { status: 404 });
  }
}
