import { NextRequest } from "next/server";
import { isDamplipsMediaUrl } from "@/lib/video/playback";

/**
 * Diagnostic: can this runtime reach a damplips file?
 *
 * The Node function is met with a Cloudflare managed challenge on every client,
 * every transport and every header set that has been tried, which makes the
 * same-origin proxy useless for this host. Vercel's edge network is a different
 * egress on a different runtime, so it is asked the same question. Nothing is
 * streamed here and the target must be damplips media: this route only reports.
 */
export const runtime = "edge";
export const dynamic = "force-dynamic";

const DEFAULT_TARGET = "https://video.damplips.com/video7/686/01.mp4";

const HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-encoding": "gzip, deflate, br",
  "sec-ch-ua": '"Chromium";v="126", "Not:A-Brand";v="24", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "video",
  "sec-fetch-mode": "no-cors",
  "sec-fetch-site": "same-origin",
  referer: "https://www.damplips.com/",
};

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("src") || DEFAULT_TARGET;
  if (!isDamplipsMediaUrl(src)) {
    return Response.json({ error: "damplips media only" }, { status: 400 });
  }
  const started = Date.now();
  try {
    const response = await fetch(src, {
      headers: { ...HEADERS, range: "bytes=0-1" },
      cache: "no-store",
      redirect: "follow",
    });
    const body = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    return Response.json(
      {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
        server: response.headers.get("server"),
        bytes: body.byteLength,
        ms: Date.now() - started,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "failed", ms: Date.now() - started },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
