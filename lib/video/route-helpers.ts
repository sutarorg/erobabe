import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { ProviderApiError, RouteError, VideoProviderConfigError } from "@/lib/video/errors";
import { httpErrorStatus, type ServiceClient } from "@/lib/video/publishing";
import type { UploadJobRow } from "@/lib/video/processing";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** JSON response that must never be cached (grants, job state). */
export function noStoreJson(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { ...NO_STORE, ...(init.headers || {}) } });
}

/** HTTP status a provider failure is reported to the admin browser with. */
function providerStatus(error: ProviderApiError): number {
  if (error.code === "direct_upload_unavailable") return 503;
  switch (error.status) {
    case 401:
    case 403:
      return 503; // the server's own credentials are wrong — the admin cannot fix that
    case 400:
      return 400;
    case 402:
      return 402;
    case 404:
      return 404;
    case 409:
      return 409;
    case 413:
      return 413;
    case 429:
      return 429;
    default:
      return error.code === "timeout" ? 504 : 502;
  }
}

/** Supabase errors are plain `{ message, code }` objects, not `Error` instances. */
function messageOf(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return null;
}

/**
 * What a database that has NOT had migration 00000000000006 applied says when the
 * app writes `provider = 'ufoload'` or one of the new `upload_jobs` columns.
 */
const MISSING_MIGRATION = /videos_provider_check|provider_upload_id|provider_import_task_id|upload_jobs[^\n]*(provider_status|last_checked_at)|(provider_status|last_checked_at)[^\n]*upload_jobs/i;

/**
 * One place that turns every failure into a response whose message is safe and
 * useful to show to an admin. Provider and configuration errors carry their own
 * wording (they never contain the API key); anything else keeps the existing
 * `httpErrorStatus` behaviour.
 */
export function errorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof RouteError) {
    return noStoreJson(
      { error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}), ...(error.extra || {}) },
      { status: error.status }
    );
  }
  if (error instanceof VideoProviderConfigError) {
    return noStoreJson({ error: error.message, code: error.code, details: error.details, retryable: false }, { status: 503 });
  }
  if (error instanceof ProviderApiError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
    return noStoreJson(
      {
        error: error.message,
        code: error.status === 401 || error.status === 403 ? "provider_auth_failed" : error.code,
        retryable: error.retryable,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
      { status: providerStatus(error), headers }
    );
  }
  const message = messageOf(error) ?? fallbackMessage;
  if (MISSING_MIGRATION.test(message)) {
    return noStoreJson(
      {
        error:
          "The database is missing migration 00000000000006_ufoload_video_provider.sql. Apply it (DEPLOYMENT.md section D.10), then try again.",
        code: "migration_missing",
        retryable: false,
      },
      { status: 500 }
    );
  }
  return noStoreJson({ error: message }, { status: httpErrorStatus(message) });
}

/** The job exists, belongs to this admin and is a UFOLOAD job — otherwise a 404 (never a hint it exists). */
export async function loadOwnUploadJob(service: ServiceClient, jobId: unknown, userId: string): Promise<UploadJobRow> {
  const id = typeof jobId === "string" ? jobId.trim() : "";
  if (!id || id.length > 64) throw new RouteError(400, "jobId is required");
  const { data } = await service.from("upload_jobs").select("*").eq("id", id).maybeSingle();
  const job = data as UploadJobRow | null;
  if (!job || job.provider !== "ufoload" || job.created_by !== userId) throw new RouteError(404, "Upload not found");
  return job;
}

/**
 * True when the request carries `Authorization: Bearer $CRON_SECRET`.
 *
 * Fails closed: with no secret configured, or one shorter than 16 characters,
 * header authentication is simply off and only an admin session can call the
 * reconcile route. Compared in constant time via digests.
 */
export function isSchedulerRequest(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const match = /^Bearer\s+(\S+)$/i.exec((headers.get("authorization") || "").trim());
  if (!match) return false;
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
