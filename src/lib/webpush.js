// src/lib/webpush.js
// Edge-safe Web Push (aes128gcm) builder for Cloudflare Pages.
// - Uses WebCrypto only (no node:crypto)
// - Produces fetch() init for Push Service endpoints
// - Fixes ECDH public key export to ALWAYS be a 65-byte uncompressed point.

const textEncoder = new TextEncoder();

// ------------------------------
// Base64url helpers
// ------------------------------
function b64urlToBytes(b64url) {
  // tolerate standard base64 too
  let s = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ------------------------------
// Crypto helpers
// ------------------------------
async function importP256Public(rawBytes) {
  return crypto.subtle.importKey(
    "raw",
    rawBytes,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

async function importP256PrivateFromJwk(jwk, usage) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    usage
  );
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
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

// HKDF extract: PRK = HMAC(salt, IKM)
async function hkdfExtract(saltBytes, ikmBytes) {
  return hmacSha256(saltBytes, ikmBytes);
}

// HKDF expand (single block is enough for 16/12 bytes): OKM = HMAC(PRK, info || 0x01)
async function hkdfExpand(prkBytes, infoBytes, len) {
  const t = await hmacSha256(prkBytes, concatBytes(infoBytes, new Uint8Array([1])));
  return t.slice(0, len);
}

function jwkToRawPublic(jwk) {
  // Uncompressed point: 0x04 || X || Y where X,Y are 32 bytes each
  const x = b64urlToBytes(jwk.x);
  const y = b64urlToBytes(jwk.y);
  return concatBytes(new Uint8Array([4]), x, y);
}

async function generateEcdhKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
}

async function exportRawPublic(keyPair) {
  // Cloudflare Workers can sometimes return a non-raw-point buffer for ECDH public keys.
  // Chrome requires the `dh` param to be a 65-byte uncompressed P-256 point (0x04||X||Y).
  // If it's not, you'll see:
  // "The public key included in the binary message header must be a valid P-256 ECDH uncompressed point that is 65 bytes..."
  //
  // Try exportKey("raw") + validate; otherwise fall back to JWK->raw.
  try {
    const raw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const u8 = new Uint8Array(raw);
    if (u8.length === 65 && u8[0] === 4) return u8;
  } catch {
    // fall through
  }

  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const u8 = jwkToRawPublic(jwk);
  if (u8.length !== 65 || u8[0] !== 4) {
    throw new Error("Failed to export ECDH public key as a 65-byte uncompressed point.");
  }
  return u8;
}

async function deriveSharedSecretBits(clientPublicKey, serverKeyPair) {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    serverKeyPair.privateKey,
    256
  );
  return new Uint8Array(bits);
}

// ------------------------------
// VAPID (JWT) for Push Service auth
// ------------------------------
function base64urlJson(obj) {
  return bytesToB64url(textEncoder.encode(JSON.stringify(obj)));
}

async function signVapidJwt(vapidPrivateJwk, jwtHeader, jwtPayload) {
  const headerB64 = base64urlJson(jwtHeader);
  const payloadB64 = base64urlJson(jwtPayload);
  const toSign = `${headerB64}.${payloadB64}`;

  const key = await importP256PrivateFromJwk(vapidPrivateJwk, ["sign"]);
  const sigDer = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      textEncoder.encode(toSign)
    )
  );

  // Convert DER signature to raw (r||s)
  const rawSig = derToJose(sigDer, 64);
  const sigB64 = bytesToB64url(rawSig);

  return `${toSign}.${sigB64}`;
}

// Minimal DER->JOSE converter for ECDSA P-256 signatures
function derToJose(derSig, joseLen) {
  // Very small DER parser for: 30.. 02.. r 02.. s
  let i = 0;
  if (derSig[i++] !== 0x30) throw new Error("Bad DER");
  const seqLen = derSig[i++];
  if (seqLen + 2 !== derSig.length && derSig.length > 2) {
    // tolerate
  }
  if (derSig[i++] !== 0x02) throw new Error("Bad DER");
  const rLen = derSig[i++];
  let r = derSig.slice(i, i + rLen);
  i += rLen;
  if (derSig[i++] !== 0x02) throw new Error("Bad DER");
  const sLen = derSig[i++];
  let s = derSig.slice(i, i + sLen);

  const out = new Uint8Array(joseLen);
  const half = joseLen / 2;

  // Strip leading zeros then left-pad
  r = stripLeadingZeros(r);
  s = stripLeadingZeros(s);

  out.set(leftPad(r, half), 0);
  out.set(leftPad(s, half), half);
  return out;
}

function stripLeadingZeros(u8) {
  let i = 0;
  while (i < u8.length - 1 && u8[i] === 0) i++;
  return u8.slice(i);
}

function leftPad(u8, len) {
  if (u8.length === len) return u8;
  if (u8.length > len) return u8.slice(u8.length - len);
  const out = new Uint8Array(len);
  out.set(u8, len - u8.length);
  return out;
}

function getOriginFromEndpoint(endpoint) {
  // For VAPID "aud"
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// ------------------------------
// Main: build request for Web Push
// ------------------------------
export async function buildWebPushRequest({
  subscription,
  payload,
  vapidSubject,
  vapidPrivateJwk,
  ttl = 60,
}) {
  if (!subscription?.endpoint) throw new Error("Missing subscription.endpoint");
  const keys = subscription.keys || {};
  if (!keys.p256dh || !keys.auth) throw new Error("Missing subscription.keys");

  const endpoint = subscription.endpoint;

  // Client public key (p256dh) + auth secret
  const clientPubRaw = b64urlToBytes(keys.p256dh);
  const authSecret = b64urlToBytes(keys.auth);

  // Generate server ECDH key pair
  const serverKP = await generateEcdhKeyPair();
  const serverPubRaw = await exportRawPublic(serverKP); // ✅ must be 65 bytes
  const clientPublicKey = await importP256Public(clientPubRaw);
  const sharedSecret = await deriveSharedSecretBits(clientPublicKey, serverKP);

  // Salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC8291 / aes128gcm key derivation:
  // PRK_key = HKDF-Extract(auth_secret, shared_secret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret);

  // IKM = HKDF-Expand(PRK_key, "WebPush: info" || 0x00 || ua_pub || as_pub, 32)
  const info = concatBytes(
    textEncoder.encode("WebPush: info\u0000"),
    clientPubRaw,
    serverPubRaw
  );
  const ikm = await hkdfExpand(prkKey, info, 32);

  // PRK = HKDF-Extract(salt, IKM)
  const prk = await hkdfExtract(salt, ikm);

  // CEK = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\u0000", 16)
  const cekInfo = textEncoder.encode("Content-Encoding: aes128gcm\u0000");
  const cek = await hkdfExpand(prk, cekInfo, 16);

  // Nonce = HKDF-Expand(PRK, "Content-Encoding: nonce\u0000", 12)
  const nonceInfo = textEncoder.encode("Content-Encoding: nonce\u0000");
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  // plaintext = padlen(2 bytes) + json(payload)
  const bodyJson = JSON.stringify(payload || {});
  const bodyBytes = textEncoder.encode(bodyJson);
  const padLen = 0; // no extra padding
  const pad = new Uint8Array(padLen);
  const padLenBytes = new Uint8Array([0, 0]); // uint16be = 0
  const plaintext = concatBytes(padLenBytes, bodyBytes, pad);

  // Encrypt
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext)
  );

  // VAPID JWT
  const aud = getOriginFromEndpoint(endpoint);
  if (!aud) throw new Error("Bad endpoint URL for VAPID audience");

  const jwt = await signVapidJwt(
    vapidPrivateJwk,
    { typ: "JWT", alg: "ES256" },
    {
      aud,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: vapidSubject,
    }
  );

  // VAPID public key (p256ecdsa) derived from JWK coords
  const vapidPublicRaw = jwkToRawPublic(vapidPrivateJwk);
  const vapidPublicB64 = bytesToB64url(vapidPublicRaw);

  const headers = {
    TTL: String(ttl),
    "Content-Encoding": "aes128gcm",
    Encryption: `salt=${bytesToB64url(salt)}`,
    "Crypto-Key": `dh=${bytesToB64url(serverPubRaw)}; p256ecdsa=${vapidPublicB64}`,
    Authorization: `vapid t=${jwt}, k=${vapidPublicB64}`,
    "Content-Type": "application/octet-stream",
  };

  return {
    endpoint,
    fetchInit: {
      method: "POST",
      headers,
      body: ct,
    },
  };
}
