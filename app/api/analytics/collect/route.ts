import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, limitRequest, RequestError } from "@/lib/http/safety";
import { createServiceClient } from "@/lib/supabase/server";
import { readGeo } from "@/lib/analytics/geo";
import { normalizePath, normalizeReferrer } from "@/lib/analytics/path";
import { classifyUserAgent, isAutomatedUserAgent } from "@/lib/analytics/user-agent";
import { analyticsVisitorHash, requestSiteHost } from "@/lib/analytics/visitor";

/**
 * Pageview collector for the admin traffic report.
 *
 * The browser sends one small beacon per navigation (plus one on unload that
 * only carries the time spent on the page being left). Everything identifying
 * is derived on the server: a keyed visitor hash, the coarse device class, and
 * the edge-provided country. Automated traffic and private surfaces are
 * acknowledged but not recorded, so the report only counts real page views on
 * the public website.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

const schema = z
  .object({
    sessionId: z.string().uuid(),
    // A null path is the unload flush: it only carries the time spent on the
    // page named by `previousPath`.
    path: z.string().min(1).max(400).nullable(),
    search: z.string().max(512).nullable().optional(),
    previousPath: z.string().max(400).nullable().optional(),
    previousEngagedMs: z.number().int().min(0).max(1_800_000).optional(),
    referrer: z.string().max(2048).nullable().optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await boundedJson(req, 4096));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid pageview" }, { status: 400, headers });
    }

    // A crawler, an uptime check or a scripted client is not a visitor.
    const userAgent = req.headers.get("user-agent");
    if (isAutomatedUserAgent(userAgent)) {
      return NextResponse.json({ recorded: false, reason: "automated" }, { status: 202, headers });
    }

    if (parsed.data.path === null && !parsed.data.previousPath) {
      return NextResponse.json({ error: "Invalid pageview" }, { status: 400, headers });
    }

    const target = parsed.data.path
      ? normalizePath(parsed.data.path, parsed.data.search ?? null)
      : null;
    if (parsed.data.path !== null && !target) {
      return NextResponse.json({ recorded: false, reason: "unmeasured-path" }, { status: 202, headers });
    }
    const previous = parsed.data.previousPath
      ? normalizePath(parsed.data.previousPath, null)
      : null;

    // Abuse ceiling: a fast scroll through 150 pages in a minute is not a person.
    await limitRequest(req, "analytics-collect", 150);

    const visitor = analyticsVisitorHash(req);
    const client = classifyUserAgent(userAgent);
    const geo = readGeo(req.headers);
    const referrer = normalizeReferrer(parsed.data.referrer ?? null, requestSiteHost(req));

    const { error } = await createServiceClient().rpc("record_analytics_activity", {
      p_session: parsed.data.sessionId,
      p_visitor: visitor,
      p_path: target?.path ?? null,
      p_previous_path: previous?.path ?? null,
      p_previous_engaged_ms: parsed.data.previousEngagedMs ?? 0,
      p_referrer_host: referrer?.host ?? null,
      p_referrer_path: referrer?.path ?? null,
      p_device: client.device,
      p_browser: client.browser,
      p_os: client.os,
      p_country: geo.country,
      p_region: geo.region,
      p_city: geo.city,
      p_utm_source: target?.utm.source ?? null,
      p_utm_medium: target?.utm.medium ?? null,
      p_utm_campaign: target?.utm.campaign ?? null,
    });
    if (error) throw error;

    return NextResponse.json({ recorded: true }, { status: 202, headers });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    // Never echo database details (or the visitor key) back to the browser.
    return NextResponse.json({ error: "Analytics unavailable" }, { status: 503, headers });
  }
}
