#!/usr/bin/env node
import { hashPassword } from "../server/util.mjs";
import crypto from "node:crypto";

/**
 * Generates the admin credential env vars.
 * Usage:  node scripts/hash-password.mjs "your-strong-password"
 * (Prefer running locally and pasting the output into your host's env UI.)
 */

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error("Usage: node scripts/hash-password.mjs \"password\"  (min 10 chars)");
  process.exit(1);
}

console.log("\n# Add these to your environment (Vercel/Netlify dashboard or .env):\n");
console.log(`ADMIN_USERNAME="admin"`);
console.log(`ADMIN_PASSWORD_SCRYPT="${hashPassword(password)}"`);
console.log(`SESSION_SECRET="${crypto.randomBytes(48).toString("hex")}"`);
console.log("");
