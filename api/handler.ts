/**
 * Vercel serverless adapter — single function mounted under /api/* via
 * the __path rewrite in vercel.json. Requires Node runtime (scrypt login
 * + AWS SDK presigning). The router itself is provider-agnostic.
 */
import { handleApi } from "../server/app";

export const config = { runtime: "nodejs", maxDuration: 30 };

export default async function handler(req: any, res: any) {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers.host ?? "localhost";

  // Rebuild the logical /api/* path from the __path rewrite parameter.
  const incoming = new URL(String(req.url ?? "/"), `${proto}://${host}`);
  const logical = incoming.searchParams.get("__path") ?? incoming.pathname.replace(/^\/api\/handler/, "");
  incoming.searchParams.delete("__path");
  const qs = incoming.searchParams.toString();
  const url = `${proto}://${host}/api${logical}${qs ? `?${qs}` : ""}`;

  let body: BodyInit | undefined;
  if (!["GET", "HEAD"].includes(req.method ?? "GET")) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    if (chunks.length) body = Buffer.concat(chunks);
  }

  const response = await handleApi(new Request(url, { method: req.method, headers: req.headers as HeadersInit, body }));

  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(Buffer.from(await response.arrayBuffer()));
}
