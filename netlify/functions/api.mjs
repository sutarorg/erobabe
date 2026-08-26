import { handle } from "../../server/handler.mjs";

/**
 * Netlify Functions adapter — bridges (event, context) to the shared
 * Web-standard handler in /server. netlify.toml redirects /api/* here.
 */
export const handler = async (event) => {
  try {
    const proto = event.headers?.["x-forwarded-proto"] || "https";
    const host = event.headers?.["x-forwarded-host"] || event.headers?.host || "localhost";
    let rawPath = event.rawUrl ? new URL(event.rawUrl).pathname : event.path || "/";
    rawPath = rawPath.replace(/^\/\.netlify\/functions\/api/, "");
    const rawQuery = event.rawUrl ? new URL(event.rawUrl).search.slice(1) : event.rawQuery || "";
    const url = `${proto}://${host}${rawPath}${rawQuery ? `?${rawQuery}` : ""}`;

    const headers = {};
    for (const [k, v] of Object.entries(event.headers || {})) headers[k] = v;

    const bodyBuf = event.body
      ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
      : undefined;

    const request = new Request(url, {
      method: event.httpMethod,
      headers,
      body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : bodyBuf,
    });

    const response = await handle(request);

    const outHeaders = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") outHeaders[key] = value;
    });
    const cookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie")]
          : [];

    return {
      statusCode: response.status,
      headers: outHeaders,
      multiValueHeaders: cookies.length ? { "set-cookie": cookies } : undefined,
      body: Buffer.from(await response.arrayBuffer()).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    console.error("[erobabe api:netlify]", e);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Internal server error", code: "adapter" }),
    };
  }
};
