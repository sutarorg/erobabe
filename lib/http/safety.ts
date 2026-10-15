import { createHmac } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function boundedText(
  req: Request,
  maxBytes = 16384,
): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) throw new RequestError("Body required", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestError("Request too large", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
export async function boundedJson(
  req: Request,
  maxBytes = 16384,
): Promise<unknown> {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new RequestError("JSON required", 415);
  const text = await boundedText(req, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError("Invalid JSON", 400);
  }
}
// Configure ingress to overwrite x-real-ip. No raw IP/UA is stored. Daily rotation
// limits linkability; this is abuse reduction, NOT proof of a human visitor.
export function visitorHash(req: Request, includeAgent = true): string {
  const secret =
    process.env.ANALYTICS_HASH_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new RequestError("Service unavailable", 503);
  return createHmac("sha256", secret)
    .update(
      `${new Date().toISOString().slice(0, 10)}:${req.headers.get("x-real-ip") || "unknown"}:${includeAgent ? (req.headers.get("user-agent") || "").slice(0, 256) : ""}`,
    )
    .digest("hex");
}
export async function limitRequest(req: Request, scope: string, limit: number) {
  const hash = visitorHash(req);
  const { data, error } = await createServiceClient().rpc("consume_request", {
    p_key: `${scope}:${visitorHash(req, false)}`,
    p_limit: limit,
  });
  if (error) throw new RequestError("Service unavailable", 503);
  if (!data) throw new RequestError("Too many requests", 429);
  return hash;
}
