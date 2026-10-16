/**
 * Server-side Bunny status reconciliation, shared by the browser confirmation
 * route and the background publisher.
 *
 * A Bunny upload finishes encoding long after the bytes were transferred, and
 * nothing about that wait requires the administrator's browser to stay open.
 * Everything the transition needs — the provider status, the stored thumbnail
 * and the session's owner — is server state, so the same steps run from an
 * administrator's request (`POST /api/videos/bunny/confirm`) and from the
 * scheduled sweep (`GET /api/cron/bunny-publish`). A video therefore publishes
 * exactly once, whichever side notices that encoding completed first: the
 * database RPCs are idempotent and refuse to republish a completed session.
 */

import "server-only";
import {
  BUNNY_STATUS,
  BunnyError,
  bunnyRequest,
  bunnyVideoSchema,
} from "./bunny";
import { bunnyEmbedUrl } from "./playback";
import { resolveThumbnailUrl, THUMBNAIL_BUCKET } from "./storage";
import type { ServiceClient } from "./publishing";

/** The `bunny_uploads` columns the status transition needs. */
export type EncodingSession = {
  id: string;
  created_by: string;
  library_id: string;
  provider_id: string | null;
  state: string;
  thumbnail_path?: string | null;
};

export type RemoteVideo = ReturnType<typeof bunnyVideoSchema.parse>;

/** A verified thumbnail: the stored path and the public URL it resolves to. */
export type StoredThumbnail = { path: string; url: string };

/** Nothing is published or staged without a frame that is really stored. */
function requireThumbnail(
  thumbnail?: StoredThumbnail | null,
): StoredThumbnail {
  if (!thumbnail?.path || !thumbnail.url)
    throw new BunnyError(
      "Thumbnail generation required. Select the same source file to retry; video bytes need not upload again.",
      409,
    );
  return thumbnail;
}

export type BunnyStatusOutcome =
  /** Encoding is done and the catalog row is public, or already was. */
  | { state: "published"; videoId: string; slug: string }
  /** Bunny is still working; the private processing row was refreshed. */
  | {
      state: "processing";
      slug: string | null;
      providerStatus: string;
      progress: number;
    }
  /** Bunny gave up on the file; nothing was published. */
  | { state: "failed"; providerStatus: string; error: string };

/**
 * Reads the provider's view of the file. Identity is verified against the
 * session, so a library reconfiguration can never be applied to a row that
 * belongs to another library.
 */
export async function readRemoteVideo(session: EncodingSession): Promise<RemoteVideo> {
  if (!session.provider_id)
    throw new BunnyError(
      "Creation unknown. Reconcile the session marker in Bunny before another upload.",
      409,
    );
  const remote = bunnyVideoSchema.parse(
    await bunnyRequest(`/${session.provider_id}`, "GET", undefined, session.library_id),
  );
  if (
    remote.guid !== session.provider_id ||
    String(remote.videoLibraryId) !== session.library_id
  )
    throw new BunnyError("Bunny returned mismatched video identity.");
  return remote;
}

/**
 * Resolves the session thumbnail and proves the signed upload really wrote an
 * object: a public URL on its own is no evidence that the frame was stored. The
 * path always belongs to the administrator who uploaded the file, even when
 * somebody else performs the check.
 */
export async function requireStoredThumbnail(
  service: ServiceClient,
  session: EncodingSession,
  thumbnailPath?: string | null,
): Promise<StoredThumbnail> {
  const path = thumbnailPath ?? session.thumbnail_path;
  let url: string | null;
  try {
    url = resolveThumbnailUrl(service, session.created_by, path);
  } catch {
    throw new BunnyError(
      "Thumbnail path does not belong to this upload session.",
      400,
    );
  }
  if (!url || !path)
    throw new BunnyError(
      "Thumbnail generation required. Select the same source file to retry; video bytes need not upload again.",
      409,
    );
  const { data: objects, error } = await service.storage
    .from(THUMBNAIL_BUCKET)
    .list(session.created_by, { search: path.split("/")[1], limit: 100 });
  if (
    error ||
    !objects?.some(
      (object: { name: string; metadata?: { size?: number } }) =>
        object.name === path.split("/")[1] && Number(object.metadata?.size) > 0,
    )
  )
    throw new BunnyError(
      "Thumbnail storage failed or object missing. Retry the thumbnail without re-uploading video.",
      409,
    );
  return { path, url };
}

/**
 * Applies Bunny's status to the catalog through the same security-definer RPCs
 * the interactive flow uses, with the session's owner as the acting
 * administrator — so a background sweep can never publish under an identity the
 * RPCs would refuse.
 */
export async function applyProviderStatus(
  service: ServiceClient,
  session: EncodingSession,
  remote: RemoteVideo,
  /** Absent only for provider statuses 5/6, which never publish. */
  thumbnail?: StoredThumbnail | null,
): Promise<BunnyStatusOutcome> {
  const providerStatus = BUNNY_STATUS[remote.status];
  const embed = bunnyEmbedUrl(session.library_id, session.provider_id!);

  if (remote.status === 5 || remote.status === 6) {
    const { data, error } = await service.rpc("fail_bunny_upload", {
      p_session: session.id,
      p_admin: session.created_by,
      p_provider_status: remote.status,
    });
    if (error) throw error;
    if (data?.state === "completed")
      return {
        state: "published",
        videoId: String(data.videoId),
        slug: String(data.slug),
      };
    return {
      state: "failed",
      providerStatus,
      error: `Bunny ${providerStatus}: inspect the library dashboard. The video has not been published.`,
    };
  }

  if (remote.status !== 4) {
    const { path, url } = requireThumbnail(thumbnail);
    const { data, error } = await service.rpc("stage_bunny_upload", {
      p_session: session.id,
      p_admin: session.created_by,
      p_embed: embed,
      p_thumbnail_path: path,
      p_thumbnail: url,
      p_provider_status: remote.status,
      p_progress: Math.floor(remote.encodeProgress),
    });
    if (error || !data)
      throw error || new BunnyError("Upload could not be staged.");
    if (data.state === "completed")
      return {
        state: "published",
        videoId: String(data.videoId),
        slug: String(data.slug),
      };
    return {
      state: "processing",
      slug: data.slug ? String(data.slug) : null,
      providerStatus,
      progress: Math.min(99, Math.floor(remote.encodeProgress)),
    };
  }

  const { path, url } = requireThumbnail(thumbnail);
  const { error: readyError } = await service
    .from("bunny_uploads")
    .update({
      thumbnail_path: path,
      provider_status: 4,
      state: "ready",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  if (readyError) throw readyError;
  const { data, error } = await service.rpc("finish_bunny_upload", {
    p_session: session.id,
    p_admin: session.created_by,
    p_embed: embed,
    p_thumbnail: url,
    p_duration: remote.length,
  });
  if (error || !data)
    throw error ||
      new BunnyError(
        "Bunny Finished, but database persistence failed. Retry confirmation without re-uploading video.",
      );
  return { state: "published", videoId: String(data.videoId), slug: String(data.slug) };
}

/**
 * One full pass for a single session: read the provider status, then stage,
 * publish or fail it.
 *
 * A provider failure is applied even when the thumbnail never reached storage —
 * a file Bunny rejected will never encode, so it must not keep occupying the
 * session forever. Every other path needs a verified thumbnail, because a video
 * is never published without its real frame.
 */
export async function reconcileBunnySession(
  service: ServiceClient,
  session: EncodingSession,
  options: { thumbnailPath?: string | null } = {},
): Promise<BunnyStatusOutcome> {
  const remote = await readRemoteVideo(session);
  if (remote.status === 5 || remote.status === 6)
    return applyProviderStatus(service, session, remote, null);
  const thumbnail = await requireStoredThumbnail(
    service,
    session,
    options.thumbnailPath,
  );
  return applyProviderStatus(service, session, remote, thumbnail);
}