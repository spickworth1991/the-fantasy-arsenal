// src/lib/webpush.js
// Web Push request builder for Cloudflare Workers / Next.js Edge.
// - Uses WebCrypto only (no node:crypto)
// - Encrypts payload using aes128gcm (RFC 8291)
// - Sends VAPID auth header in widely supported format: `Authorization: vapid t=..., k=...`

const te = new TextEncoder();

// ---------- base64url helpers (avoid illegal invocation quirks) ----------

function b64ToBytes(b64) {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return globalThis.btoa(s);
}

function b64urlToBytes(b64url) {
  if (typeof b64url !== "string") throw new Error("Invalid base64url input");
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return b64ToBytes(b64 + pad);
}

function bytesToB64url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ---------- crypto helpers ----------

async function hkdfExtract(saltBytes, ikmBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    ikmBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const prk = await crypto.subtle.sign("HMAC", key, saltBytes);
  return new Uint8Array(prk);
}

async function hkdfExpand(prkBytes, infoBytes, length) {
  const key = await crypto.subtle.importKey(
    "raw",
    prkBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let counter = 1;
  let pos = 0;

  while (pos < length) {
    const input = new Uint8Array(prev.length + infoBytes.length + 1);
    input.set(prev, 0);
    input.set(infoBytes, prev.length);
    input[input.length - 1] = counter;

    const t = new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
    const take = Math.min(t.length, length - pos);
    out.set(t.slice(0, take), pos);
    pos += take;
    prev = t;
    counter += 1;
  }

  return out;
}

async function importP256Public(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

async function makeServerKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}

async function exportRawPublic(key) {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

function jwkToRawPublic(jwk) {
  if (!jwk?.x || !jwk?.y) throw new Error("Invalid VAPID JWK (missing x/y)");
  const x = b64urlToBytes(jwk.x);
  const y = b64urlToBytes(jwk.y);
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return raw;
}

async function signJwtES256(jwk, payload, { aud, sub, expSeconds = 12 * 60 * 60 } = {}) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const body = { aud, exp: now + expSeconds, sub, ...payload };

  const enc = (obj) => bytesToB64url(te.encode(JSON.stringify(obj)));
  const input = `${enc(header)}.${enc(body)}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // WebCrypto returns DER signature; convert to JOSE (r||s)
  const der = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(input))
  );
  const jose = derToJose(der, 64);

  return `${input}.${bytesToB64url(jose)}`;
}

function derToJose(derSig, joseLen) {
  let offset = 0;
  if (derSig[offset++] !== 0x30) throw new Error("Invalid DER signature");
  offset += 1; // skip seq length

  if (derSig[offset++] !== 0x02) throw new Error("Invalid DER signature");
  const rLen = derSig[offset++];
  let r = derSig.slice(offset, offset + rLen);
  offset += rLen;

  if (derSig[offset++] !== 0x02) throw new Error("Invalid DER signature");
  const sLen = derSig[offset++];
  let s = derSig.slice(offset, offset + sLen);

  while (r.length > 1 && r[0] === 0x00) r = r.slice(1);
  while (s.length > 1 && s[0] === 0x00) s = s.slice(1);

  const out = new Uint8Array(joseLen);
  const half = joseLen / 2;

  out.set(r.slice(Math.max(0, r.length - half)), half - Math.min(half, r.length));
  out.set(s.slice(Math.max(0, s.length - half)), joseLen - Math.min(half, s.length));
  return out;
}

// ---------- main: build fetch init for a push ----------

export async function buildWebPushRequest({
  subscription,
  payload,
  vapidSubject,
  vapidPrivateJwk,
  ttl = 60,
}) {
  if (!subscription?.endpoint) throw new Error("Missing subscription.endpoint");
  if (!subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("Subscription missing keys.p256dh/auth");
  }

  const clientPubRaw = b64urlToBytes(subscription.keys.p256dh);
  const authSecret = b64urlToBytes(subscription.keys.auth);

  if (clientPubRaw.length !== 65) {
    throw new Error(`Invalid subscription p256dh key length: ${clientPubRaw.length} (expected 65)`);
  }

  const clientPubKey = await importP256Public(clientPubRaw);

  const serverKeys = await makeServerKeyPair();
  const serverPubRaw = await exportRawPublic(serverKeys.publicKey);

  if (serverPubRaw.length !== 65) {
    throw new Error(`Invalid server public key length: ${serverPubRaw.length} (expected 65)`);
  }

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientPubKey }, serverKeys.privateKey, 256)
  );

  // RFC8291 derivation
  const prk = await hkdfExtract(authSecret, sharedSecret);
  const info = new Uint8Array([...te.encode("WebPush: info\0"), ...clientPubRaw, ...serverPubRaw]);
  const ikm = await hkdfExpand(prk, info, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk2 = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk2, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk2, te.encode("Content-Encoding: nonce\0"), 12);

  // plaintext = 2-byte padLen (0) + utf8(JSON)
  const bodyBytes = te.encode(JSON.stringify(payload ?? {}));
  const plain = new Uint8Array(2 + bodyBytes.length);
  plain[0] = 0;
  plain[1] = 0;
  plain.set(bodyBytes, 2);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plain)
  );

  const endpointUrl = new URL(subscription.endpoint);
  const aud = endpointUrl.origin;

  const jwt = await signJwtES256(vapidPrivateJwk, {}, { aud, sub: vapidSubject });
  const vapidPublicRaw = jwkToRawPublic(vapidPrivateJwk);

  return {
    endpoint: subscription.endpoint,
    fetchInit: {
      method: "POST",
      headers: {
        TTL: String(ttl),
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        Encryption: `salt=${bytesToB64url(salt)}`,
        "Crypto-Key": `dh=${bytesToB64url(serverPubRaw)}`,
        Authorization: `vapid t=${jwt}, k=${bytesToB64url(vapidPublicRaw)}`,
      },
      body: ciphertext,
    },
  };
}
