import { ENV, HttpError } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Minimal Supabase PostgREST client (service role, server-only).
 * The service-role key NEVER reaches the browser.
 * ────────────────────────────────────────────────────────────── */

const base = () => `${ENV("SUPABASE_URL")}/rest/v1`;
const key = () => ENV("SUPABASE_SERVICE_ROLE_KEY");

export function dbConfigMissing() {
  return !ENV("SUPABASE_URL") || !ENV("SUPABASE_SERVICE_ROLE_KEY");
}

function headers(extra = {}) {
  return {
    apikey: key(),
    authorization: `Bearer ${key()}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function request(path, { method = "GET", body, prefer, range, count } = {}) {
  const h = {};
  if (prefer) h.prefer = Array.isArray(prefer) ? prefer.join(",") : prefer;
  if (count) h.prefer = (h.prefer ? h.prefer + "," : "") + "count=exact";
  if (range) {
    h["range-unit"] = "items";
    h.range = `${range[0]}-${range[1]}`;
  }
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: headers(h),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok) {
    const msg = data?.message || data?.hint || `Database error (${res.status})`;
    const code = data?.code;
    // 23505 = unique violation, 23503 = foreign key violation
    const status = code === "23505" ? 409 : code === "23503" ? 400 : res.status >= 500 ? 502 : 400;
    throw new HttpError(status, msg, "db_error");
  }

  let total = null;
  const cr = res.headers.get("content-range");
  if (cr && cr.includes("/")) {
    const n = Number(cr.split("/")[1]);
    if (!Number.isNaN(n)) total = n;
  }
  return { data, total };
}

/** Query builder helpers (encode values, leave PostgREST operators raw). */
const enc = (v) => encodeURIComponent(v);

export const dbApi = {
  /** table: e.g. "videos", query: raw PostgREST querystring (without ?) */
  async select(table, query = "", opts = {}) {
    const { data, total } = await request(`/${table}${query ? `?${query}` : ""}`, opts);
    return { data: data ?? [], total };
  },
  async one(table, query = "") {
    const { data } = await request(`/${table}${query ? `?${query}` : ""}&limit=1`, {});
    return data?.[0] ?? null;
  },
  async insert(table, rows, { returning = "representation" } = {}) {
    const { data } = await request(`/${table}`, {
      method: "POST",
      body: rows,
      prefer: `return=${returning}`,
    });
    return Array.isArray(rows) ? data : data?.[0];
  },
  async update(table, query, patch) {
    const { data } = await request(`/${table}${query ? `?${query}` : ""}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    });
    return data;
  },
  async remove(table, query) {
    await request(`/${table}${query ? `?${query}` : ""}`, { method: "DELETE" });
  },
  async rpc(name, params = {}) {
    const res = await fetch(`${base()}/rpc/${name}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(502, `Database RPC failed (${res.status}) ${text.slice(0, 200)}`);
    }
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  },
};

/** Time-safe unique-ish object key for R2. */
export function objectKey(prefix, originalName = "") {
  const clean = originalName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60);
  return `${prefix}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}${clean ? `-${clean}` : ""}`;
}
import crypto from "node:crypto";
export { enc };
