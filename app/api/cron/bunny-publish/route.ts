import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  errorMessageFrom,
  errorStatusFrom,
  requireActiveAdmin,
  type ServiceClient,
} from "@/lib/video/publishing";
import {
  reconcileBunnySession,
  type BunnyStatusOutcome,
  type EncodingSession,
} from "@/lib/video/auto-publish";
import { BunnyError } from "@/lib/video/bunny";
import { revalidatePublicTag } from "@/lib/public/revalidate";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Publishes Bunny uploads that finished encoding, with no browser involved.
 *
 * The upload page polls this same transition while it is open, but encoding
 * routinely outlives the tab: an administrator who closes the laptop must not
 * leave finished files stranded in `processing`. This route is the server-side
 * half of auto-publish — a scheduler calls it (Vercel Cron via `vercel.json`,
 * or any external cron/GitHub Action on other hosts) and every video whose
 * encoding has completed becomes public whether or not anybody is watching.
 *
 * It is deliberately idempotent: only sessions that have not reached a terminal
 * state are reconciled, and the database RPCs refuse to publish a completed
 * session twice, so overlapping runs and a still-open upload page cannot
 * produce a duplicate or a second catalog row.
 */

/** Sessions examined per run; each one is a provider GET plus a database write. */
const SWEEP_LIMIT = 20;
/**
 * Stop starting new work this long into the run, so a slow provider cannot push
 * the function past its own time limit. Whatever is left keeps its place in the
 * oldest-first queue and is picked up by the next run.
 */
const SWEEP_BUDGET_MS = 40_000;

const headers = { "Cache-Control": "no-store" };

type SweepResult = {
  sessionId: string;
  state: BunnyStatusOutcome["state"] | "error";
  slug?: string | null;
  providerStatus?: string;
  progress?: number;
  error?: string;
};

/** `CRON_SECRET` when set, otherwise this run is an administrator's own sweep. */
function cronSecret(): string {
  return (process.env.CRON_SECRET || "").trim();
}

/** Constant-time comparison so the secret cannot be guessed byte by byte. */
function secretMatches(candidate: string, secret: string): boolean {
  const given = Buffer.from(candidate);
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * A scheduler proves itself with `Authorization: Bearer $CRON_SECRET` (Vercel
 * Cron sends exactly that header). Anyone else has to be an active
 * administrator — the only other identity this app trusts for publishing work —
 * so an operator can always trigger the sweep by hand and a scheduler with the
 * wrong secret is refused.
 */
async function authorize(req: NextRequest): Promise<void> {
  const secret = cronSecret();
  const header = req.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (secret && secretMatches(presented, secret)) return;
  await requireActiveAdmin();
}

/**
 * Every session still waiting on Bunny, oldest first. Sessions without a
 * stored thumbnail are left alone: the video cannot be published without its
 * frame, and only a browser that still holds the file can produce one.
 *
 * `uploading` rows qualify only once a thumbnail exists, which is how a tab
 * closed between storing the frame and confirming gets picked up here instead
 * of waiting for a request that is never made.
 */
async function pendingSessions(service: ServiceClient) {
  const { data, error } = await service
    .from("bunny_uploads")
    .select("id,created_by,library_id,provider_id,state,thumbnail_path,updated_at")
    .in("state", ["uploading", "processing", "ready"])
    .not("provider_id", "is", null)
    .not("thumbnail_path", "is", null)
    .order("updated_at", { ascending: true })
    .limit(SWEEP_LIMIT);
  if (error) throw error;
  return (data || []) as (EncodingSession & { updated_at: string })[];
}

async function sweep() {
  const service = createServiceClient();
  const sessions = await pendingSessions(service);
  const deadline = Date.now() + SWEEP_BUDGET_MS;
  const results: SweepResult[] = [];
  for (const session of sessions) {
    if (Date.now() >= deadline) break;
    try {
      const outcome = await reconcileBunnySession(service, session);
      results.push({
        sessionId: session.id,
        state: outcome.state,
        ...(outcome.state === "published"
          ? { slug: outcome.slug }
          : outcome.state === "processing"
            ? {
                slug: outcome.slug,
                providerStatus: outcome.providerStatus,
                progress: outcome.progress,
              }
            : {}),
        ...(outcome.state === "failed" ? { error: outcome.error } : {}),
      });
    } catch (error: unknown) {
      // One stuck session must never stop the rest of the queue: record it and
      // keep going. The next run retries it.
      const message =
        error instanceof Error ? error.message : "Unknown error";
      results.push({ sessionId: session.id, state: "error", error: message.slice(0, 300) });
      console.error(`[bunny/auto-publish] ${session.id}:`, message);
    }
  }
  const published = results.filter((r) => r.state === "published");
  // Newly public videos must show up in the cached listings without waiting
  // for their own expiry.
  if (published.length) revalidatePublicTag("videos");
  return {
    checked: results.length,
    /** Sessions this run did not reach; the next run picks them up. */
    remaining: Math.max(0, sessions.length - results.length),
    published: published.length,
    processing: results.filter((r) => r.state === "processing").length,
    failed: results.filter((r) => r.state === "failed").length,
    errors: results.filter((r) => r.state === "error").length,
    slugs: published.map((r) => r.slug).filter(Boolean),
    results,
  };
}

async function handle(req: NextRequest) {
  try {
    await authorize(req);
    return NextResponse.json(await sweep(), { headers });
  } catch (e) {
    const status = e instanceof BunnyError ? e.status : errorStatusFrom(e);
    const message = errorMessageFrom(
      e,
      "The publish sweep could not run. Check the cron secret, the Bunny configuration and the database.",
    );
    return NextResponse.json({ error: message.slice(0, 300) }, { status, headers });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

/** POST lets an external scheduler or an uptime ping trigger the same sweep. */
export async function POST(req: NextRequest) {
  return handle(req);
}