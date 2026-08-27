/**
 * Netlify Functions adapter — mounts the same EroBabe API router.
 * /api/* is redirected here by netlify.toml / public/_redirects.
 */
import { handleApi } from "../../server/app";

export const handler = async (event: any) => {
  const url = event.rawUrl ?? `https://${event.headers?.host ?? "localhost"}${event.path ?? "/"}`;
  const init: RequestInit = { method: event.httpMethod ?? "GET", headers: event.headers as HeadersInit };
  if (event.body) {
    init.body = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  }

  const res = await handleApi(new Request(url, init));
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => (headers[key] = value));

  return {
    statusCode: res.status,
    headers,
    body: Buffer.from(await res.arrayBuffer()).toString("base64"),
    isBase64Encoded: true,
  };
};
