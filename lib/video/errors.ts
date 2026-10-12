/**
 * Error types for the video-hosting layer.
 *
 * Two families, because routes answer them differently:
 *
 *  - {@link VideoProviderConfigError}: the *deployment* is not set up to use a
 *    provider (unknown `VIDEO_PROVIDER`, missing `UFOLOAD_API_KEY`, adult-content
 *    approval not recorded). Always HTTP 503 with an actionable message — the
 *    admin cannot fix it from the browser, the operator can from the server
 *    environment.
 *  - {@link ProviderApiError}: the provider answered (or failed to answer) a
 *    request. Carries the HTTP status, a machine code, whether a retry can help
 *    and any `Retry-After`.
 *
 * Neither type ever stores a request header, a URL with credentials or the API
 * key, so their messages are safe to return to the browser and to log.
 */

export type ProviderConfigCode =
  | "provider_unknown"
  | "provider_legacy_unsupported"
  | "api_key_missing"
  | "api_key_malformed"
  | "adult_content_not_approved";

export class VideoProviderConfigError extends Error {
  readonly code: ProviderConfigCode;
  /** Every code lists what the operator has to change. */
  readonly details: string;
  readonly status = 503;

  constructor(code: ProviderConfigCode, message: string, details?: string) {
    super(message);
    this.name = "VideoProviderConfigError";
    this.code = code;
    this.details = details || message;
  }
}

export type ProviderErrorCode =
  | "unauthorized"
  | "forbidden"
  | "payment_required"
  | "not_found"
  | "conflict"
  | "upload_busy"
  | "too_many_imports"
  | "payload_too_large"
  | "rate_limited"
  | "direct_upload_unavailable"
  | "bad_request"
  | "upstream_error"
  | "timeout"
  | "network"
  | "invalid_response"
  | (string & {});

export class ProviderApiError extends Error {
  readonly provider: string;
  readonly operation: string;
  /** HTTP status; `0` when no response was received (network error, timeout). */
  readonly status: number;
  readonly code: ProviderErrorCode;
  readonly retryAfterSeconds: number | null;
  /** True when repeating the same request later can succeed. */
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor(init: {
    provider: string;
    operation: string;
    status: number;
    code: ProviderErrorCode;
    message: string;
    retryAfterSeconds?: number | null;
    retryable?: boolean;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = "ProviderApiError";
    this.provider = init.provider;
    this.operation = init.operation;
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId ?? null;
  }
}

/** A request the admin got wrong (bad input, not found, conflict) — carries its HTTP status. */
export class RouteError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, message: string, options: { code?: string; details?: string; extra?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "RouteError";
    this.status = status;
    this.code = options.code;
    this.details = options.details;
    this.extra = options.extra;
  }
}
