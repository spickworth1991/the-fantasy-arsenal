// src/lib/webpush.js
// Web Push (aes128gcm) for Cloudflare Pages/Workers (Edge runtime)
// Native WebCrypto only.

const te = new TextEncoder();

function b64urlToUint8(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function uint8ToB64url(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function u32be(n) {
  return new Uint8Array([
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ]);
}

function concat(...parts) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return new Uint8Array(sig);
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk, info, length) {
  const infoBytes = typeof info === "string" ? te.encode(info) : info;
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let counter = 1;
  let pos = 0;

  while (pos < length) {
    const input = concat(prev, infoBytes, new Uint8Array([counter]));
    const t = await hmacSha256(prk, input);
    const take = Math.min(t.length, length - pos);
    out.set(t.slice(0, take), pos);
    pos += take;
    prev = t;
    counter++;
  }
  return out;
}

function jwkToRawPublic(jwk) {
  // Uncompressed P-256 point: 0x04 || X || Y
  const x = b64urlToUint8(jwk.x);
  const y = b64urlToUint8(jwk.y);
  return concat(new Uint8Array([0x04]), x, y); // 65 bytes
}

async function signVapidJWT({ aud, sub, exp }, vapidPrivateJwk) {
  const header = { typ: "JWT", alg: "ES256" };
  const enc = (obj) => uint8ToB64url(te.encode(JSON.stringify(obj)));

  const h = enc(header);
  const p = enc({ aud, exp, sub });
  const data = te.encode(`${h}.${p}`);

  const key = await crypto.subtle.importKey(
    "jwk",
    vapidPrivateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Cloudflare Workers ECDSA returns P-1363 (64 bytes) which ES256 wants.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data)
  );

  return `${h}.${p}.${uint8ToB64url(sig)}`;
}

async function encryptAes128gcm({ subscription, payloadJsonString }) {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;

  if (!endpoint || !p256dh || !auth) throw new Error("Bad subscription (missing endpoint/keys).");

  const uaPub = b64urlToUint8(p256dh); // 65 bytes (uncompressed)
  const authSecret = b64urlToUint8(auth); // 16 bytes

  // Import UA public key for ECDH
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Ephemeral server keypair for ECDH
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey },
      serverKeys.privateKey,
      256
    )
  );

  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey)); // 65

  // PRK_key = HMAC(auth_secret, ecdh_secret)
  const prkKey = await hkdfExtract(authSecret, ecdhSecret);

  // key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = concat(te.encode("WebPush: info"), new Uint8Array([0x00]), uaPub, asPub);

  // IKM = HKDF-Expand(PRK_key, key_info, 32)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK = HKDF-Extract(salt, IKM)
  const prk = await hkdfExtract(salt, ikm);

  const cek = await hkdfExpand(
    prk,
    concat(te.encode("Content-Encoding: aes128gcm"), new Uint8Array([0x00])),
    16
  );
  const nonce = await hkdfExpand(
    prk,
    concat(te.encode("Content-Encoding: nonce"), new Uint8Array([0x00])),
    12
  );

  // ✅ Spec: delimiter 0x02 appended to plaintext (no need for extra 0x00)
  const pt = concat(te.encode(payloadJsonString), new Uint8Array([0x02]));

  const rs = 4096;

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, pt));

  // ✅ CRITICAL FIX:
  // aes128gcm body MUST include keyid (server public key) inside the body header:
  // salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const idlen = 65;
  const body = concat(salt, u32be(rs), new Uint8Array([idlen]), asPub, ct);

  // Keep these headers (you’re already seeing 201):
  // - dh in Crypto-Key is still fine to include
  // - Encryption salt header is fine to include
  const cryptoKey = `dh=${uint8ToB64url(asPub)}`;
  const encryption = `salt=${uint8ToB64url(salt)}`;

  return {
    endpoint,
    body,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "Crypto-Key": cryptoKey,
      Encryption: encryption,
      TTL: "60",
    },
  };
}

export async function buildWebPushRequest({ subscription, payload, vapidSubject, vapidPrivateJwk }) {
  const url = new URL(subscription.endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;

  const vapidPublicRaw = jwkToRawPublic(vapidPrivateJwk);
  const jwt = await signVapidJWT({ aud, sub: vapidSubject, exp }, vapidPrivateJwk);

  const vapidAuthHeader = {
    Authorization: `vapid t=${jwt}, k=${uint8ToB64url(vapidPublicRaw)}`,
  };

  // No-payload push
  if (payload == null) {
    return {
      endpoint: subscription.endpoint,
      fetchInit: {
        method: "POST",
        headers: {
          TTL: "60",
          "Crypto-Key": `p256ecdsa=${uint8ToB64url(vapidPublicRaw)}`,
          ...vapidAuthHeader,
        },
      },
    };
  }

  const enc = await encryptAes128gcm({
    subscription,
    payloadJsonString: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

  const bodyBuf = enc.body.buffer.slice(
    enc.body.byteOffset,
    enc.body.byteOffset + enc.body.byteLength
  );

  return {
    endpoint: enc.endpoint,
    fetchInit: {
      method: "POST",
      headers: {
        ...enc.headers,
        ...vapidAuthHeader,
      },
      body: bodyBuf,
    },
  };
}