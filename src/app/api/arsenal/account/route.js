export const runtime = "edge";

import { NextResponse } from "next/server";
import {
  arsenalDb,
  authenticateArsenal,
  createSession,
  ensureArsenalSchema,
  passwordHash,
  publicAccount,
  randomSecret,
  sha256,
} from "../../../../lib/arsenalAccountServer";

const clean = (value, max) => String(value || "").trim().slice(0, max);

export async function GET(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Invalid or expired Arsenal key.", { status: 401 });
    return NextResponse.json({ ok: true, account: publicAccount(account) });
  } catch (error) {
    return new NextResponse(error?.message || "Account unavailable.", { status: 503 });
  }
}

export async function POST(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const body = await request.json();
    const sleeperUsername = clean(body?.sleeperUsername, 40);
    const loginName = clean(body?.loginName || sleeperUsername, 40);
    const password = String(body?.password || "");
    if (!sleeperUsername) return new NextResponse("A Sleeper username is required.", { status: 400 });
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(loginName)) return new NextResponse("Account name must be 3–40 letters, numbers, dots, dashes, or underscores.", { status: 400 });
    if (password.length < 10) return new NextResponse("Password must be at least 10 characters.", { status: 400 });
    const sleeperResponse = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(sleeperUsername)}`);
    if (!sleeperResponse.ok) return new NextResponse("Sleeper username was not found.", { status: 404 });
    const sleeper = await sleeperResponse.json();
    if (!sleeper?.user_id) return new NextResponse("Sleeper username was not found.", { status: 404 });

    const token = `tfa_${randomSecret(32)}`;
    const tokenHash = await sha256(token);
    const passwordSalt = randomSecret(18);
    const hashedPassword = await passwordHash(password, passwordSalt);
    const accountId = crypto.randomUUID();
    const now = Date.now();
    await db.prepare(`INSERT INTO arsenal_accounts
      (account_id, token_hash, sleeper_username, display_name, bio, avatar_type, avatar_value, created_at, updated_at, last_seen_at, login_name, password_hash, password_salt)
      VALUES (?, ?, ?, ?, '', 'stock', 'blitz', ?, ?, ?, ?, ?, ?)`)
      .bind(accountId, tokenHash, sleeper.username || sleeperUsername, sleeper.display_name || sleeper.username || sleeperUsername, now, now, now, loginName, hashedPassword, passwordSalt)
      .run();
    await db.prepare(`INSERT INTO arsenal_sessions(token_hash, account_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)`)
      .bind(tokenHash, accountId, now, now).run();
    const account = await db.prepare(`SELECT * FROM arsenal_accounts WHERE account_id=?`).bind(accountId).first();
    return NextResponse.json({ ok: true, token, account: publicAccount(account) });
  } catch (error) {
    return new NextResponse(error?.message || "Account could not be created.", { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const body = await request.json();
    const loginName = clean(body?.loginName, 40);
    const password = String(body?.password || "");
    const account = await db.prepare(`SELECT * FROM arsenal_accounts WHERE login_name=? COLLATE NOCASE`).bind(loginName).first();
    if (!account?.password_hash || !account?.password_salt) return new NextResponse("Account name or password is incorrect.", { status: 401 });
    const candidate = await passwordHash(password, account.password_salt);
    if (candidate !== account.password_hash) return new NextResponse("Account name or password is incorrect.", { status: 401 });
    const token = await createSession(db, account.account_id);
    return NextResponse.json({ ok:true, token, account:publicAccount(account) });
  } catch (error) {
    return new NextResponse(error?.message || "Sign in failed.", { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const db = arsenalDb();
    await ensureArsenalSchema(db);
    const account = await authenticateArsenal(request, db);
    if (!account) return new NextResponse("Invalid or expired Arsenal key.", { status: 401 });
    const body = await request.json();
    const displayName = clean(body?.displayName ?? account.display_name, 48) || account.sleeper_username;
    const bio = clean(body?.bio ?? account.bio, 280);
    const avatarType = body?.avatarType === "upload" ? "upload" : "stock";
    const avatarValue = clean(body?.avatarValue ?? account.avatar_value, 180) || "blitz";
    let loginName = clean(body?.loginName ?? account.login_name, 40);
    let nextHash = account.password_hash;
    let nextSalt = account.password_salt;
    if (body?.newPassword) {
      if (String(body.newPassword).length < 10) return new NextResponse("Password must be at least 10 characters.", { status:400 });
      nextSalt = randomSecret(18);
      nextHash = await passwordHash(String(body.newPassword), nextSalt);
    }
    if (!nextHash) return new NextResponse("Set a password to enable account sign-in.", { status:400 });
    if (loginName && !/^[a-zA-Z0-9_.-]{3,40}$/.test(loginName)) return new NextResponse("Invalid account name.", { status:400 });
    const now = Date.now();
    await db.prepare(`UPDATE arsenal_accounts SET display_name=?, bio=?, avatar_type=?, avatar_value=?, login_name=?, password_hash=?, password_salt=?, updated_at=? WHERE account_id=?`)
      .bind(displayName, bio, avatarType, avatarValue, loginName || null, nextHash || null, nextSalt || null, now, account.account_id).run();
    const updated = await db.prepare(`SELECT * FROM arsenal_accounts WHERE account_id=?`).bind(account.account_id).first();
    return NextResponse.json({ ok: true, account: publicAccount(updated) });
  } catch (error) {
    return new NextResponse(error?.message || "Profile could not be updated.", { status: 500 });
  }
}
