// src/lib/webpush.js
// Web Push for Edge/Workers using WebCrypto only (no node:crypto).
// - Content-Encoding: aes128gcm (RFC 8291)
// - VAPID: ES256 JWT (RFC 8292)

const te = new TextEncoder();

function u8ToB64Url(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToU8(b64url) {
  const b64 =
    b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "==".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function concatU8(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const len2 = (n) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);

async function hkdfExtract(saltU8, ikmU8) {
  const saltKey = await crypto.subtle.importKey(
    "raw",
    saltU8,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikmU8));
  return prk;
}

async function hkdfExpand(prkU8, infoU8, length) {
  const prkKey = await crypto.subtle.importKey(
    "raw",
    prkU8,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  let t = new Uint8Array(0);
  let okm = new Uint8Array(0);
  let counter = 1;

  while (okm.length < length) {
    const input = concatU8(t, infoU8, new Uint8Array([counter]));
    t = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, input));
    okm = concatU8(okm, t);
    counter++;
  }

  return okm.slice(0, length);
}

function jwkToRawPublic(jwk) {
  // Uncompressed point 04 || X || Y
  const x = b64UrlToU8(jwk.x);
  const y = b64UrlToU8(jwk.y);
  const out = new Uint8Array(1 + x.length + y.length);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 1 + x.length);
  return out;
}

// WebCrypto ECDSA sign output is often DER-encoded on Workers.
// JWT ES256 requires P-1363 (r||s, 64 bytes).
function derToP1363(sig, size = 32) {
  if (sig.length === 64) return sig;

  let i = 0;
  if (sig[i++] !== 0x30) return sig;
  i++; // seq len (short form)

  if (sig[i++] !== 0x02) return sig;
  const rLen = sig[i++];
  let r = sig.slice(i, i + rLen);
  i += rLen;

  if (sig[i++] !== 0x02) return sig;
  const sLen = sig[i++];
  let s = sig.slice(i, i + sLen);

  while (r.length > 1 && r[0] === 0x00) r = r.slice(1);
  while (s.length > 1 && s[0] === 0x00) s = s.slice(1);

  const rOut = new Uint8Array(size);
  const sOut = new Uint8Array(size);
  rOut.set(r.slice(-size), size - Math.min(size, r.length));
  sOut.set(s.slice(-size), size - Math.min(size, s.length));
  return concatU8(rOut, sOut);
}

async function signVapidJWT({ aud, sub, exp, vapidPrivateJwk }) {
  const header = { typ: "JWT", alg: "ES256" };
  const body = { aud, exp, sub };
  const enc = (obj) => u8ToB64Url(te.encode(JSON.stringify(obj)));
  const signingInput = `${enc(header)}.${enc(body)}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    vapidPrivateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sigDer = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      te.encode(signingInput)
    )
  );
  const sig = derToP1363(sigDer, 32);
  return `${signingInput}.${u8ToB64Url(sig)}`;
}

async function encryptAes128gcm({ subscription, payloadJson }) {
  const sub = subscription;
  const userP256dh = b64UrlToU8(sub.keys.p256dh);
  const userAuth = b64UrlToU8(sub.keys.auth);

  // Import receiver public key
  const userPubKey = await crypto.subtle.importKey(
    "raw",
    userP256dh,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Generate ephemeral ECDH keypair
  const eph = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const ephPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", eph.publicKey)
  );

  // Shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: userPubKey },
    eph.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedBits);

  // 1) PRK_key = HKDF-Extract(authSecret, sharedSecret)
  const prkKey = await hkdfExtract(userAuth, sharedSecret);

  // 2) IKM = HKDF-Expand(PRK_key, "WebPush: info\0" + len(pubR) + pubR + len(pubS) + pubS, 32)
  const info = concatU8(
    te.encode("WebPush: info\0"),
    len2(userP256dh.length),
    userP256dh,
    len2(ephPubRaw.length),
    ephPubRaw
  );
  const ikm = await hkdfExpand(prkKey, info, 32);

  // 3) PRK = HKDF-Extract(salt, IKM)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);

  // 4) CEK + NONCE
  const cek = await hkdfExpand(prk, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, te.encode("Content-Encoding: nonce\0"), 12);

  // 5) plaintext = payload || 0x02 delimiter
  const payloadBytes = te.encode(JSON.stringify(payloadJson));
  const plaintext = concatU8(payloadBytes, new Uint8Array([0x02]));

  const cekKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    cekKey,
    plaintext
  );
  const ciphertext = new Uint8Array(ctBuf);

  return {
    body: ciphertext,
    headers: {
      "Content-Encoding": "aes128gcm",
      Encryption: `salt=${u8ToB64Url(salt)};rs=4096`,
      "Crypto-Key": `dh=${u8ToB64Url(ephPubRaw)}`,
    },
  };
}

export async function buildWebPushRequest({
  subscription,
  payload,
  vapidSubject,
  vapidPrivateJwk,
}) {
  if (!subscription?.endpoint) throw new Error("Missing subscription endpoint");
  if (!subscription?.keys?.p256dh || !subscription?.keys?.auth)
    throw new Error("Subscription missing keys");

  const endpoint = subscription.endpoint;
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const vapidPublicRaw = jwkToRawPublic(vapidPrivateJwk);
  const jwt = await signVapidJWT({ aud, sub: vapidSubject, exp, vapidPrivateJwk });
  const enc = await encryptAes128gcm({ subscription, payloadJson: payload });

  return {
    endpoint,
    fetchInit: {
      method: "POST",
      headers: {
        ...enc.headers,
        // Some push services still read p256ecdsa from Crypto-Key.
        "Crypto-Key": `${enc.headers["Crypto-Key"]};p256ecdsa=${u8ToB64Url(vapidPublicRaw)}`,
        Authorization: `vapid t=${jwt}, k=${u8ToB64Url(vapidPublicRaw)}`,
        TTL: "60",
      },
      body: enc.body,
    },
  };
}
