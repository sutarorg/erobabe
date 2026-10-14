import "server-only";
import { z } from "zod";
import { secureProviderUrl, type UploadPolicy } from "./filekosh-validation";

export class FileKoshError extends Error {
  constructor(
    message: string,
    public status = 502,
    public retryAfter?: number,
    public definitelyRejected = false,
  ) {
    super(message);
  }
}
const configurationMessage =
  "FileKosh uploads are not configured: verify the confirmation contract, upload headers, accepted formats, size policy and browser CORS first. See DEPLOYMENT.md.";
/** No guessed confirmation schema or guessed provider limits. This gate is intentional. */
export function uploadConfiguration(): {
  policy: UploadPolicy;
  confirmationTemplate: unknown;
} {
  try {
    if (
      !process.env.FILEKOSH_API_KEY ||
      process.env.FILEKOSH_BROWSER_UPLOAD_VERIFIED !== "true" ||
      process.env.FILEKOSH_CONTRACT_VERIFIED !== "true"
    )
      throw new Error();
    const mimeTypes = String(process.env.FILEKOSH_ALLOWED_MIME_TYPES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const maxBytes = Number(process.env.FILEKOSH_MAX_UPLOAD_BYTES);
    const headers = z
      .record(z.string())
      .parse(JSON.parse(process.env.FILEKOSH_UPLOAD_HEADERS_JSON || ""));
    if (
      Object.keys(headers).some((h) =>
        /^(authorization|cookie|host|content-length)$/i.test(h),
      ) ||
      Object.values(headers).some((v) =>
        v.includes(process.env.FILEKOSH_API_KEY!),
      )
    )
      throw new Error();
    if (
      !process.env.FILEKOSH_UPLOAD_HOSTS?.split(",").every(
        (host) => /^[a-z0-9.-]+$/i.test(host.trim()) && host.includes("."),
      )
    )
      throw new Error();
    const confirmationTemplate = JSON.parse(
      process.env.FILEKOSH_CONFIRM_BODY_TEMPLATE || "",
    );
    if (
      !confirmationTemplate ||
      typeof confirmationTemplate !== "object" ||
      !JSON.stringify(confirmationTemplate).includes('"{{id}}"')
    )
      throw new Error();
    if (
      !mimeTypes.length ||
      mimeTypes.some((m) => !/^video\/[a-z0-9.+-]+$/i.test(m)) ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0
    )
      throw new Error();
    return {
      policy: {
        mimeTypes,
        maxBytes,
        headers,
        concurrency: Math.floor(
          Math.min(
            3,
            Math.max(1, Number(process.env.FILEKOSH_UPLOAD_CONCURRENCY) || 2),
          ),
        ),
      },
      confirmationTemplate,
    };
  } catch {
    throw new FileKoshError(configurationMessage, 503);
  }
}
export function confirmationBody(template: unknown, id: string): unknown {
  if (template === "{{id}}") return id;
  if (Array.isArray(template))
    return template.map((v) => confirmationBody(v, id));
  if (template && typeof template === "object")
    return Object.fromEntries(
      Object.entries(template).map(([k, v]) => [k, confirmationBody(v, id)]),
    );
  return template;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** POST create is deliberately NOT retried: the API does not document idempotency. */
export async function filekoshRequest(
  path: string,
  method = "GET",
  body?: unknown,
  retrySafe = method === "GET",
): Promise<unknown> {
  const key = process.env.FILEKOSH_API_KEY;
  if (!key) throw new FileKoshError(configurationMessage, 503);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://filekosh.com/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
    } catch {
      throw new FileKoshError(
        "Could not reach FileKosh. The request outcome may be unknown; retry confirmation, not a new upload.",
      );
    }
    const rawRetry = response.headers.get("retry-after");
    const seconds = rawRetry
      ? Number(rawRetry) ||
        Math.max(0, (Date.parse(rawRetry) - Date.now()) / 1000)
      : 0;
    const retryAfter = Number.isFinite(seconds) ? Math.ceil(seconds) : 0;
    if (!response.ok) {
      if (
        retrySafe &&
        attempt < 2 &&
        (response.status === 429 || response.status >= 500) &&
        retryAfter <= 3
      ) {
        await sleep(
          Math.max(retryAfter * 1000, 500 * 2 ** attempt + Math.random() * 200),
        );
        continue;
      }
      throw new FileKoshError(
        response.status === 401 || response.status === 403
          ? "FileKosh authentication failed. Ask an administrator to check the server API key."
          : response.status === 429
            ? "FileKosh rate limit reached. Wait before retrying."
            : "FileKosh rejected the request. Check the provider account and verified API contract.",
        response.status === 429 ? 429 : 502,
        retryAfter || undefined,
        [400, 401, 403, 413, 415, 422, 429].includes(response.status),
      );
    }
    try {
      return await response.json();
    } catch {
      throw new FileKoshError("FileKosh returned an invalid response.");
    }
  }
}
export const createdVideo = z.object({
  id: z.string().min(1).max(240),
  slug: z.string().min(1).max(240),
  uploadUrl: z.string().transform((raw) => {
    const url = secureProviderUrl(raw);
    if (
      !process.env.FILEKOSH_UPLOAD_HOSTS?.split(",")
        .map((h) => h.trim().toLowerCase())
        .includes(new URL(url).hostname.toLowerCase())
    )
      throw new FileKoshError("FileKosh returned an unverified upload host.");
    return url;
  }),
});
export const readyVideo = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  platform: z.literal("WEB"),
  status: z.literal("READY"),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().int().nonnegative().max(2147483647).optional(),
  url: z.string().transform(secureProviderUrl),
  embedUrl: z.string().transform((raw) => {
    const url = secureProviderUrl(raw);
    if (new URL(url).origin !== "https://filekosh.com")
      throw new FileKoshError("FileKosh returned an unverified embed origin.");
    return url;
  }),
});
export function providerError(error: unknown) {
  if (error instanceof FileKoshError)
    return {
      error: error.message,
      status: error.status,
      retryAfter: error.retryAfter,
    };
  if (error instanceof Error && /^(Unauthorized|Forbidden)/.test(error.message))
    return {
      error: error.message,
      status: error.message === "Unauthorized" ? 401 : 403,
    };
  console.error(
    JSON.stringify({
      event: "filekosh_upload_error",
      kind:
        error instanceof z.ZodError ? "validation" : "persistence_or_contract",
    }),
  );
  return {
    error:
      "Could not finish this upload. Retry the existing session; do not create a new upload. Check database migrations and the verified provider response contract.",
    status: 502,
  };
}
