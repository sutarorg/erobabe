import { handle } from "../server/handler.mjs";

/**
 * Vercel Serverless adapter — all /api/* traffic is rewritten here
 * (see vercel.json) and bridged to the shared handler in /server.
 * The rewrite captures the sub-path into the `path` query param;
 * we rebuild the original URL before dispatching.
 */
export default async function vercelApi(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
    const parsed = new URL(`${proto}://${host}${req.url}`);

    if (parsed.searchParams.has("path")) {
      const sub = parsed.searchParams.get("path") || "";
      parsed.searchParams.delete("path");
      parsed.pathname = `/api/${sub}`;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const hasBody = !["GET", "HEAD"].includes(req.method);

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;

    const request = new Request(parsed.toString(), {
      method: req.method,
      headers,
      body: hasBody && chunks.length ? Buffer.concat(chunks) : undefined,
    });

    const response = await handle(request);

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
    });
    const cookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie")]
          : [];
    if (cookies.length) res.setHeader("set-cookie", cookies);

    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error("[erobabe api:vercel]", e);
    res.status(500).json({ error: "Internal server error", code: "adapter" });
  }
}
