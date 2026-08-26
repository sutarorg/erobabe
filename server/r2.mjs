import crypto from "node:crypto";
import { ENV, HttpError } from "./util.mjs";

/* ──────────────────────────────────────────────────────────────
 * Cloudflare R2 (S3-compatible) client.
 *  - SigV4 presigned URLs for direct browser uploads (PUT / parts)
 *  - Server-side signed requests for multipart lifecycle, small
 *    PUTs (thumbnails) and deletes.
 * R2 credentials are only ever used server-side.
 * ────────────────────────────────────────────────────────────── */

const REGION = "auto";
const SERVICE = "s3";

const AK = () => ENV("R2_ACCESS_KEY_ID");
const SK = () => ENV("R2_SECRET_ACCESS_KEY");
const account = () => ENV("R2_ACCOUNT_ID");
const bucket = () => ENV("R2_BUCKET");
const host = () => `${account()}.r2.cloudflarestorage.com`;

export function r2ConfigMissing() {
  return [!AK(), !SK(), !account(), !bucket(), !ENV("R2_PUBLIC_BASE_URL")].some(Boolean);
}

const sha256hex = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (key) => key.split("/").map(enc).join("/");

function amzDates(d = new Date()) {
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { date: iso.slice(0, 8), amz: iso };
}

function signingKey(date) {
  return hmac(hmac(hmac(hmac(`AWS4${SK()}`, date), REGION), SERVICE), "aws4_request");
}

function signString(scope, amz, canonical) {
  return `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256hex(canonical)}`;
}

/** Presigned URL handed to the browser for direct-to-R2 upload. */
export function presignUrl({ method = "PUT", key, query = {}, expires = 3600 }) {
  const { date, amz } = amzDates();
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const params = new Map([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${AK()}/${scope}`],
    ["X-Amz-Date", amz],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
    ...Object.entries(query).map(([k, v]) => [k, String(v)]),
  ]);
  const qs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join("&");
  const canonical = `${method}\n/${bucket()}/${encPath(key)}\n${qs}\nhost:${host()}\n\nhost\nUNSIGNED-PAYLOAD`;
  const sig = crypto.createHmac("sha256", signingKey(date)).update(signString(scope, amz, canonical)).digest("hex");
  return `https://${host()}/${bucket()}/${encPath(key)}?${qs}&X-Amz-Signature=${sig}`;
}

/** Server-to-R2 signed request (Authorization header). */
async function signedFetch(method, key, { query = {}, body = "", contentType = "application/octet-stream" } = {}) {
  const { date, amz } = amzDates();
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const payloadHash = sha256hex(body ?? "");
  const qs = Object.entries(query)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`)
    .join("&");
  const signedHeaderMap = {
    host: host(),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };
  const signedKeys = Object.keys(signedHeaderMap).sort();
  const canonicalHeaders = signedKeys.map((k) => `${k}:${signedHeaderMap[k]}\n`).join("");
  const canonical = `${method}\n/${bucket()}/${encPath(key)}\n${qs}\n${canonicalHeaders}\n${signedKeys.join(";")}\n${payloadHash}`;
  const sig = crypto.createHmac("sha256", signingKey(date)).update(signString(scope, amz, canonical)).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${AK()}/${scope}, SignedHeaders=${signedKeys.join(";")}, Signature=${sig}`;

  const url = `https://${host()}/${bucket()}/${encPath(key)}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization,
      "x-amz-date": amz,
      "x-amz-content-sha256": payloadHash,
      ...(body ? { "content-type": contentType } : {}),
    },
    body: body || undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(502, `Storage request failed (${res.status}): ${text.slice(0, 160)}`);
  }
  return res;
}

/* ── Multipart upload lifecycle (for 500MB – 2GB files) ── */

export async function createMultipartUpload(key, contentType) {
  const res = await signedFetch("POST", key, { query: { uploads: "" }, contentType });
  const xml = await res.text();
  const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!m) throw new HttpError(502, "Could not start multipart upload");
  return m[1];
}

export const presignPart = (key, uploadId, partNumber) =>
  presignUrl({ method: "PUT", key, query: { partNumber, uploadId }, expires: 4 * 3600 });

export const presignSinglePut = (key, expires = 3600) => presignUrl({ method: "PUT", key, expires });

export async function completeMultipartUpload(key, uploadId, parts) {
  const xml =
    `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    parts
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.startsWith('"') ? p.etag : `"${p.etag}"`}</ETag></Part>`
      )
      .join("") +
    `</CompleteMultipartUpload>`;
  await signedFetch("POST", key, { query: { uploadId }, body: xml, contentType: "application/xml" });
}

export async function abortMultipartUpload(key, uploadId) {
  await signedFetch("DELETE", key, { query: { uploadId } });
}

export const putObject = (key, buffer, contentType) => signedFetch("PUT", key, { body: buffer, contentType });

export const deleteObject = (key) => signedFetch("DELETE", key, {});

export function publicUrlFor(key) {
  return `${String(ENV("R2_PUBLIC_BASE_URL")).replace(/\/$/, "")}/${encPath(key)}`;
}
