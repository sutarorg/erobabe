import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getVideoProvider } from "@/lib/video/provider";
import { requireActiveAdmin } from "@/lib/video/publishing";
import { reconcileOutstandingJobs } from "@/lib/video/processing";
import { errorResponse, isSchedulerRequest, noStoreJson } from "@/lib/video/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background reconciliation of UFOLOAD uploads and imports.
 *
 * This is the mechanism that finishes work nobody is watching: it advances
 * every unfinished job (import task → file → `ready` → published; failures get
 * their reason recorded). One call does a bounded amount of work — at most 50
 * jobs and about 45 seconds — and returns a summary; it never waits for UFOLOAD
 * to finish encoding.
 *
 * ⚠ It only runs when something CALLS it. This repository does not ship a
 * scheduler (there is no cron configuration, and the supported hosts differ).
 * To get hands-off publishing, point an external scheduler at this route every
 * few minutes — see DEPLOYMENT.md → "Background reconciliation". Without one,
 * unfinished videos are still advanced whenever an admin has the upload page
 * open (it polls `/api/videos/status` and calls this route once on load).
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (a scheduler; Vercel Cron sends
 * exactly this header when the `CRON_SECRET` env var is set) OR an active admin
 * session. With no `CRON_SECRET` configured only the admin session works.
 *
 * GET and POST behave the same (Vercel Cron issues GET).
 */
async function handle(req: NextRequest) {
  try {
    let service;
    if (isSchedulerRequest(req.headers)) {
      service = createServiceClient();
    } else {
      ({ service } = await requireActiveAdmin());
    }

    let options: { limit?: number; budgetMs?: number } = {};
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object") options = body;
    }
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 25;
    const budgetMs = Number.isFinite(Number(options.budgetMs)) ? Number(options.budgetMs) : 45_000;

    const summary = await reconcileOutstandingJobs({
      service,
      provider: getVideoProvider(),
      limit: Math.min(50, limit),
      budgetMs: Math.min(50_000, budgetMs),
    });
    return noStoreJson({ ok: true, ...summary });
  } catch (error) {
    return errorResponse(error, "Reconciliation failed");
  }
}

export const GET = handle;
export const POST = handle;
