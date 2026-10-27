/**
 * The first-party recommendations profile cookie.
 *
 * Personalization is on by default: the middleware issues an opaque, httpOnly
 * token on the first public page view, and the server turns that token into a
 * salted viewer hash. The token itself carries no identity and is useless
 * without the server-side hash secret.
 *
 * This module is imported by the Edge middleware, so it must stay free of
 * Node-only imports.
 */

export const RECOMMENDATION_COOKIE = "erobabe-rec-profile";

/** Shape of a server-issued token; anything else is replaced. */
export const RECOMMENDATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

export const RECOMMENDATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

/** 32 random bytes, base64url — 43 characters, always a valid token. */
export function newRecommendationToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
