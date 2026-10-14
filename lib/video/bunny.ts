import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { thumbnailVisionEnabled } from "./thumbnail-ranking";
import type { UploadPolicy } from "./bunny-validation";

export class BunnyError extends Error {
  constructor(
    message: string,
    public status = 502,
    public retryAfter?: number,
    public definitelyRejected = false,
  ) {
    super(message);
  }
}
export function bunnyConfiguration() {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID || "";
  const apiKey = (process.env.BUNNY_STREAM_API_KEY || "").trim();
  if (
    !/^[1-9]\d*$/.test(libraryId) ||
    !Number.isSafeInteger(Number(libraryId)) ||
    !apiKey ||
    /\s/.test(apiKey)
  )
    throw new BunnyError(
      "Bunny Stream configuration missing or invalid. Set the selected library ID and Video Library API key. See DEPLOYMENT.md section D.",
      503,
    );
  return { libraryId, apiKey };
}
export function uploadConfiguration(): { policy: UploadPolicy } {
  bunnyConfiguration();
  return {
    policy: {
      mimeTypes: [
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "video/x-matroska",
        "video/x-msvideo",
        "video/mpeg",
      ],
      concurrency: 4,
      headers: {},
      visionRanking: thumbnailVisionEnabled(),
    },
  };
}
export const bunnyVideoSchema = z.object({
  guid: z.string().uuid(),
  videoLibraryId: z.number().int().positive(),
  status: z.number().int().min(0).max(8),
  length: z.number().int().nonnegative().max(2147483647),
  encodeProgress: z.number().min(0).max(100),
});
export const createdVideoSchema = z.object({ guid: z.string().uuid() });
export const BUNNY_STATUS = [
  "Created",
  "Uploaded",
  "Processing",
  "Transcoding",
  "Finished",
  "Error",
  "UploadFailed",
  "JitSegmenting",
  "JitPlaylistsCreated",
] as const;
/** GETs retry transient errors; non-idempotent creation is NEVER automatically replayed. */
export async function bunnyRequest(
  path: string,
  method = "GET",
  body?: unknown,
  library?: string,
): Promise<unknown> {
  const { libraryId, apiKey } = bunnyConfiguration();
  if (library && library !== libraryId)
    throw new BunnyError(
      "This session belongs to a different Stream library. Restore its library configuration before recovery.",
      409,
    );
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(
        `https://video.bunnycdn.com/library/${libraryId}/videos${path}`,
        {
          method,
          headers: {
            AccessKey: apiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
          cache: "no-store",
        },
      );
    } catch {
      throw new BunnyError(
        "Bunny Stream could not be reached. Creation may be uncertain; recover this session instead of creating another video.",
      );
    }
    const rawRetry = response.headers.get("retry-after");
    const seconds = rawRetry
      ? Number(rawRetry) || (Date.parse(rawRetry) - Date.now()) / 1000
      : 0;
    const retryAfter = Number.isFinite(seconds)
      ? Math.min(3600, Math.max(0, Math.ceil(seconds)))
      : 0;
    if (!response.ok) {
      if (
        method === "GET" &&
        attempt < 2 &&
        (response.status === 429 || response.status >= 500) &&
        retryAfter <= 2
      ) {
        await new Promise((r) =>
          setTimeout(r, Math.max(retryAfter * 1000, 500 * 2 ** attempt)),
        );
        continue;
      }
      throw new BunnyError(
        response.status === 401 || response.status === 403
          ? "Bunny Stream authentication failed. Check the Video Library API key and Library ID."
          : response.status === 429
            ? "Bunny Stream rate limit reached. Retry later."
            : "Bunny Stream rejected the request. Check the library and session in the provider dashboard.",
        response.status === 429 ? 429 : 502,
        retryAfter || undefined,
        [400, 401, 403, 404, 413, 415, 422, 429].includes(response.status),
      );
    }
    try {
      return await response.json();
    } catch {
      throw new BunnyError(
        "Bunny Stream returned an invalid response. Recover the existing session.",
      );
    }
  }
}
export function signUpload(
  videoId: string,
  library?: string,
  now = Date.now(),
) {
  z.string().uuid().parse(videoId);
  const { libraryId, apiKey } = bunnyConfiguration();
  if (library && library !== libraryId)
    throw new BunnyError("Session library does not match configuration.", 409);
  const expiration = Math.floor(now / 1000) + 86400;
  const signature = createHash("sha256")
    .update(`${libraryId}${apiKey}${expiration}${videoId}`)
    .digest("hex");
  return {
    videoId,
    expiration,
    uploadUrl: "https://video.bunnycdn.com/tusupload",
    headers: {
      AuthorizationSignature: signature,
      AuthorizationExpire: String(expiration),
      LibraryId: libraryId,
      VideoId: videoId,
    },
  };
}
export function providerError(error: unknown) {
  if (error instanceof BunnyError)
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
  return {
    error:
      "Could not finish this upload. Retry the existing session; check database migration and thumbnail storage. No new video is needed.",
    status: 502,
  };
}
