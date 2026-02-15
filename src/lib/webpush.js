// src/lib/webpush.js
// Edge-safe Web Push request builder (no node:crypto)
// Implements RFC8291 (Content-Encoding: aes128gcm) using WebCrypto.

const te = new TextEncoder();

function b64urlToBytes(str) {
  str = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function u16be(n) {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
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
  // HKDF-Extract(salt, IKM) = HMAC(salt, IKM)
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk, info, length) {
  // HKDF-Expand(PRK, info, L)
  let prev = new Uint8Array(0);
  let out = new Uint8Array(0);
  let i = 0;
  while (out.length < length) {
    i++;
    const input = concat(prev, info, new Uint8Array([i]));
    const t = await hmacSha256(prk, input);
    out = concat(out, t);
    prev = t;
  }
  return out.slice(0, length);
}

async function importP256Public(rawUncompressed) {
  return crypto.subtle.importKey(
    "raw",
    rawUncompressed,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

async function exportRawPublic(keyPair) {
  const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  return new Uint8Array(raw);
}

async function deriveSharedSecret(clientPublicKey, serverKeyPair) {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    serverKeyPair.privateKey,
    256
  );
  return new Uint8Array(bits);
}

function makeJWT({ aud, sub, expSeconds }) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud, sub, exp: expSeconds };
  const enc = (obj) => bytesToB64url(te.encode(JSON.stringify(obj)));
  return `${enc(header)}.${enc(payload)}`;
}

async function signJWT(data, vapidPrivateJwk) {
  const key = await crypto.subtle.importKey(
    "jwk",
    vapidPrivateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    te.encode(data)
  );

  return `${data}.${bytesToB64url(new Uint8Array(sig))}`;
}

function jwkToRawPublic(jwk) {
  // Uncompressed point: 0x04 || X || Y
  const x = b64urlToBytes(jwk.x);
  const y = b64urlToBytes(jwk.y);
  return concat(new Uint8Array([0x04]), x, y);
}

async function encryptAes128gcm({ subscription, payloadObj }) {
  const clientPubRaw = b64urlToBytes(subscription.keys.p256dh);
  const authSecret = b64urlToBytes(subscription.keys.auth);

  const clientPubKey = await importP256Public(clientPubRaw);
  const serverKP = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const serverPubRaw = await exportRawPublic(serverKP);
  const sharedSecret = await deriveSharedSecret(clientPubKey, serverKP);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // ===== RFC8291 key derivation =====
  // 1) PRK = HKDF-Extract(authSecret, sharedSecret)
  const prk = await hkdfExtract(authSecret, sharedSecret);

  // 2) IKM = HKDF-Expand(PRK, "WebPush: info\0" || ua_pub || as_pub, 32)
  const info = concat(te.encode("WebPush: info\0"), clientPubRaw, serverPubRaw);
  const ikm = await hkdfExpand(prk, info, 32);

  // 3) PRK2 = HKDF-Extract(salt, IKM)
  const prk2 = await hkdfExtract(salt, ikm);

  // 4) CEK / NONCE
  const cek = await hkdfExpand(prk2, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk2, te.encode("Content-Encoding: nonce\0"), 12);

  // ===== Payload format =====
  // Plaintext = uint16_be(paddingLength) || payload || paddingZeros
  const plainJson = te.encode(JSON.stringify(payloadObj));
  const padLen = 0;
  const plaintext = concat(u16be(padLen), plainJson);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);

  return {
    ciphertext: new Uint8Array(ct),
    salt,
    serverPubRaw,
  };
}

export async function buildWebPushRequest({ subscription, payload, vapidSubject, vapidPrivateJwk }) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("Invalid subscription (missing endpoint/keys).");
  }

  const { ciphertext, salt, serverPubRaw } = await encryptAes128gcm({
    subscription,
    payloadObj: payload,
  });

  const endpoint = subscription.endpoint;
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour
  const jwtUnsigned = makeJWT({ aud, sub: vapidSubject, expSeconds: exp });
  const jwt = await signJWT(jwtUnsigned, vapidPrivateJwk);

  const vapidPublicRaw = jwkToRawPublic(vapidPrivateJwk);

    const headers = {
        // TTL is seconds. Keep it reasonably high so the browser has time to wake.
        TTL: "300",
        Urgency: "high",
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        Encryption: `salt=${bytesToB64url(salt)}`,
        "Crypto-Key": `dh=${bytesToB64url(serverPubRaw)}; p256ecdsa=${bytesToB64url(vapidPublicRaw)}`,
        // Spec-compliant VAPID header (works across push services).
        // (Older "vapid t=..., k=..." format can be silently dropped by some providers.)
        Authorization: `WebPush ${jwt}`,
    };


  return {
    endpoint,
    fetchInit: {
      method: "POST",
      headers,
      body: ciphertext,
    },
  };
}
