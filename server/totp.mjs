import crypto from "node:crypto";
import { ENV } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * TOTP two-factor authentication (RFC 6238 / RFC 4226).
 *
 * Zero dependencies — HMAC-SHA1 over a 30-second time counter, which
 * is what Google Authenticator, 1Password, Authy and Bitwarden expect.
 *
 * Security properties:
 *  · The shared secret is encrypted at rest with AES-256-GCM using a
 *    key derived from SESSION_SECRET, so a database leak alone does
 *    not yield a working second factor.
 *  · Verification is constant-time and accepts a ±1 step window for
 *    clock drift only.
 *  · Every accepted counter is recorded, so a code cannot be replayed
 *    inside its own validity window.
 *  · Recovery codes are scrypt-hashed and single-use.
 * ────────────────────────────────────────────────────────────── */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** ±1 step ≈ 30s either side. Wider windows measurably weaken TOTP. */
const DRIFT_STEPS = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the RFC-recommended size for HMAC-SHA1. */
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

/** One 6-digit code for a given counter. */
function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const currentCounter = (at = Date.now()) => Math.floor(at / 1000 / STEP_SECONDS);

/** Current code — used by tests and the enrollment preview. */
export const generateTOTP = (secret, at = Date.now()) =>
  hotp(base32Decode(secret), currentCounter(at));

/**
 * Verify a submitted code.
 * @returns the accepted counter, or null when the code is invalid.
 */
export function verifyTOTP(secret, token, { lastCounter = 0, at = Date.now() } = {}) {
  const clean = String(token ?? "").replace(/\D/g, "");
  if (clean.length !== DIGITS) return null;
  const secretBuf = base32Decode(secret);
  if (!secretBuf.length) return null;

  const now = currentCounter(at);
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    const counter = now + drift;
    // Reject anything at or before the last accepted counter (replay).
    if (counter <= lastCounter) continue;
    const expected = hotp(secretBuf, counter);
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return counter;
  }
  return null;
}

/** otpauth:// URI consumed by authenticator apps and the QR code. */
export function otpauthUri(secret, account = "admin", issuer = "EroBabe") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ── Secret encryption (AES-256-GCM, key derived from SESSION_SECRET) ── */

const encKey = () =>
  crypto.createHash("sha256").update(`eb:2fa:${ENV("SESSION_SECRET", "")}`).digest();

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload) {
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split(".");
    if (version !== "v1") return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encKey(),
      Buffer.from(ivB64, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key (SESSION_SECRET rotated) or tampered ciphertext.
    return null;
  }
}

/* ── Recovery codes ── */

const RECOVERY_COUNT = 10;

/** Human-friendly single-use codes, e.g. "K7QF-2M9X". */
export function generateRecoveryCodes(count = RECOVERY_COUNT) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes
  const codes = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let c = 0; c < 8; c++) {
      if (c === 4) code += "-";
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
    codes.push(code);
  }
  return codes;
}

export const normalizeRecovery = (code) =>
  String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Recovery codes are stored hashed — never in plaintext. */
export function hashRecoveryCode(code) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(normalizeRecovery(code), salt, 32, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyRecoveryCode(code, stored) {
  try {
    const [saltB64, hashB64] = String(stored).split("$");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(
      normalizeRecovery(code),
      Buffer.from(saltB64, "base64"),
      expected.length,
      { N: 16384, r: 8, p: 1 }
    );
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
