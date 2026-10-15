import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireActiveAdmin,
  getCategory,
  type ServiceClient,
} from "@/lib/video/publishing";
import {
  bunnyConfiguration,
  bunnyRequest,
  bunnyVideoListSchema,
  bunnyVideoSchema,
  createdVideoSchema,
  BUNNY_STATUS,
  BunnyError,
  providerError,
  signUpload,
  uploadConfiguration,
} from "@/lib/video/bunny";
import { sessionInput, validateVideo } from "@/lib/video/bunny-validation";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

type SessionInput = z.infer<typeof sessionInput>;
type DbError = { code?: string; message?: string } | null | undefined;
/** A `public.bunny_uploads` row (the service client is untyped). */
type UploadSession = {
  id: string;
  created_by: string;
  title: string;
  description?: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number | string;
  duration_seconds: number | null;
  category_id: string;
  library_id: string;
  provider_id: string | null;
  state: string;
  video_id: string | null;
  video_slug: string | null;
  created_at: string;
};
const DESCRIPTION_MIGRATION = "00000000000019_auto_publish_and_ai_metadata.sql";
/**
 * Bunny creation happens inside one request capped at `maxDuration` (60s), so a
 * reservation older than this can no longer be waiting for a create response.
 */
const CREATION_SETTLE_MS = 2 * 60 * 1000;
export async function GET(req?: NextRequest) {
  try {
    const { service, user } = await requireActiveAdmin();
    const requestedId = req?.nextUrl.searchParams.get("sessionId");
    if (requestedId) {
      if (!z.string().uuid().safeParse(requestedId).success)
        throw new BunnyError("Invalid recovery session identifier.", 400);
      const { data: session, error } = await service
        .from("bunny_uploads")
        .select(
          "id,title,original_name,mime_type,size_bytes,category_id,state,video_id,video_slug,provider_id,thumbnail_path,created_at,last_error,provider_status",
        )
        .eq("id", requestedId)
        .eq("created_by", user.id)
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ session }, { headers });
    }
    let policy = null,
      configurationError = null;
    try {
      policy = uploadConfiguration().policy;
    } catch (e) {
      configurationError = providerError(e).error;
    }
    const { data, error } = await service
      .from("bunny_uploads")
      .select(
        "id,title,original_name,mime_type,size_bytes,category_id,state,video_id,provider_id,thumbnail_path,created_at,last_error,provider_status",
      )
      .eq("created_by", user.id)
      .neq("state", "completed")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json(
      { policy, configurationError, sessions: data },
      { headers },
    );
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json({ error: r.error }, { status: r.status, headers });
  }
}
export async function POST(req: NextRequest) {
  try {
    const { service, user } = await requireActiveAdmin();
    const { policy } = uploadConfiguration();
    const parsed = sessionInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      throw new BunnyError(
        "Invalid title, filename, category, MIME, file size or session identifier.",
        400,
      );
    const input = parsed.data;
    const invalid = validateVideo(
      { type: input.mimeType, size: input.sizeBytes },
      policy,
    );
    if (invalid) throw new BunnyError(invalid, 400);
    try {
      await getCategory(service, input.categoryId);
    } catch {
      throw new BunnyError("Choose a valid category.", 400);
    }
    // Re-selecting a file (after a reload, failure or cancellation) arrives
    // with a new browser ID, but one administrator/filename/size/MIME may hold
    // only one session. Resume that session instead of inserting a conflict.
    // A session whose catalog video was deleted is cleared here, so the same
    // file can be uploaded again without renaming it.
    const lookup = await findSession(service, user.id, input);
    if (lookup.session)
      return await resumeSession(service, user.id, lookup.session, input);
    // A replacement never borrows the cleared session's identity: the new video
    // is published under a new ID and slug, so the deleted video keeps its own
    // catalog identity, public URL and media_retention records.
    const reservationInput =
      lookup.cleared?.id === input.sessionId
        ? { ...input, sessionId: crypto.randomUUID() }
        : input;
    const { libraryId } = bunnyConfiguration();
    const reservation = await reserveSession(
      service,
      user.id,
      reservationInput,
      libraryId,
    );
    if ("existing" in reservation)
      return await resumeSession(
        service,
        user.id,
        reservation.existing,
        reservationInput,
      );
    let remote;
    try {
      // A unique title marker permits reconciliation after a lost create response.
      remote = createdVideoSchema.parse(
        await bunnyRequest("", "POST", {
          title: `${reservationInput.title} [session:${reservationInput.sessionId}]`,
        }),
      );
    } catch (e) {
      if (e instanceof BunnyError && e.definitelyRejected)
        await service
          .from("bunny_uploads")
          .delete()
          .eq("id", reservationInput.sessionId)
          .eq("created_by", user.id);
      throw e;
    }
    const { error } = await service
      .from("bunny_uploads")
      .update({ provider_id: remote.guid, state: "uploading" })
      .eq("id", reservationInput.sessionId)
      .eq("created_by", user.id);
    if (error) throw error;
    // Both notices matter: an unapplied migration blocks AI descriptions, and a
    // re-armed file tells the administrator why a second transfer started.
    const cleared = lookup.cleared ?? reservation.cleared;
    const warning =
      [reservation.warning, cleared ? reuploadNotice(cleared) : undefined]
        .filter(Boolean)
        .join(" ") || undefined;
    return NextResponse.json(
      {
        ...signUpload(remote.guid),
        sessionId: reservationInput.sessionId,
        ...(warning ? { warning } : {}),
      },
      { status: 201, headers },
    );
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json(
      { error: r.error },
      {
        status: r.status,
        headers: {
          ...headers,
          ...(r.retryAfter ? { "Retry-After": String(r.retryAfter) } : {}),
        },
      },
    );
  }
}

type SessionLookup = {
  /** The session to resume, or null when a fresh reservation is required. */
  session: UploadSession | null;
  /** The completed session that was archived because its video was deleted. */
  cleared?: UploadSession;
};

/**
 * The requested session, else this administrator's session for the same source
 * file. A completed session whose catalog video was deleted is archived and
 * dropped instead of returned, so the same file can be uploaded again without
 * being renamed.
 */
async function findSession(
  service: ServiceClient,
  userId: string,
  input: SessionInput,
): Promise<SessionLookup> {
  let cleared: UploadSession | undefined;
  // Clearing a deleted session frees the file identity, and a concurrent
  // request may have reserved that file in the meantime, so look once more.
  for (let pass = 0; ; pass++) {
    const found = await readSession(service, userId, input);
    if (!found) return { session: null, ...(cleared ? { cleared } : {}) };
    const archived = await clearDeletedSession(service, userId, found);
    if (!archived) return { session: found, ...(cleared ? { cleared } : {}) };
    cleared = archived;
    if (pass >= 1) return { session: null, cleared };
  }
}

/** Reads the session by ID first, then by the source-file identity. */
async function readSession(
  service: ServiceClient,
  userId: string,
  input: SessionInput,
): Promise<UploadSession | null> {
  const { data: byId, error } = await service
    .from("bunny_uploads")
    .select("*")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (error) throw error;
  if (byId) {
    if (byId.created_by !== userId)
      throw new BunnyError("Upload session unavailable.", 403);
    return byId;
  }
  // Mirrors unique (created_by, original_name, size_bytes, mime_type).
  const { data: bySource, error: sourceError } = await service
    .from("bunny_uploads")
    .select("*")
    .eq("created_by", userId)
    .eq("original_name", input.originalName)
    .eq("size_bytes", input.sizeBytes)
    .eq("mime_type", input.mimeType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sourceError) throw sourceError;
  return bySource;
}

/**
 * Archives and drops a completed session whose catalog video was deleted
 * (deleting the video nulls `video_id`), because such a session can never
 * publish again while its file identity keeps blocking a new reservation.
 * Returns the archived row, or null when the session is still usable.
 *
 * The deleted video is never resurrected: clearing only lets the same file
 * start a genuinely new upload, with a new Bunny video and a new catalog
 * entry. The deleted video's provider bytes stay untouched, retained for
 * operator review by `media_retention`.
 */
async function clearDeletedSession(
  service: ServiceClient,
  userId: string,
  session: UploadSession,
): Promise<UploadSession | null> {
  if (session.state !== "completed" || session.video_id) return null;
  await assertNoCatalogVideo(service, session);
  await archiveDeletedSession(service, userId, session);
  const { data: cleared, error } = await service
    .from("bunny_uploads")
    .delete()
    .eq("id", session.id)
    .eq("created_by", userId)
    .eq("state", "completed")
    .is("video_id", null)
    .select("id");
  if (error) throw databaseError("clear the deleted upload session", error);
  // Nothing was deleted: a concurrent request re-linked or cleared it first.
  return cleared?.length ? session : null;
}

/** Refuses to discard a session that any catalog video still points at. */
async function assertNoCatalogVideo(
  service: ServiceClient,
  session: UploadSession,
) {
  const { data: byId, error } = await service
    .from("videos")
    .select("id")
    .eq("id", session.id)
    .maybeSingle();
  if (error) throw error;
  // finish_bunny_upload publishes the video under the session ID, so a live row
  // means the session is still linked and must be kept for audit.
  if (byId)
    throw new BunnyError(
      "This file's video is still in the video library, so its upload session is kept. Delete the video in Admin → Videos, then select the file again to upload it once more.",
      409,
    );
  if (!session.provider_id) return;
  const { data: byProvider, error: providerLookupError } = await service
    .from("videos")
    .select("id")
    .eq("provider_file_id", session.provider_id)
    .maybeSingle();
  if (providerLookupError) throw providerLookupError;
  if (byProvider)
    throw new BunnyError(
      "This file's Bunny video is still used by a video in the library, so its upload session is kept. Delete that video in Admin → Videos, then select the file again.",
      409,
    );
}

/**
 * Keeps the durable record of a cleared session: the audit log holds the file,
 * provider video and slug the deleted catalog entry was published under.
 */
async function archiveDeletedSession(
  service: ServiceClient,
  userId: string,
  session: UploadSession,
) {
  const { error } = await service.from("audit_logs").insert({
    actor_id: userId,
    action: "bunny_upload_session_cleared",
    target_type: "upload_session",
    target_id: session.id,
    level: "info",
    metadata: {
      reason:
        "Catalog video deleted; session cleared so the same file can be uploaded again",
      title: session.title,
      original_name: session.original_name,
      mime_type: session.mime_type,
      size_bytes: Number(session.size_bytes),
      duration_seconds: session.duration_seconds,
      category_id: session.category_id,
      library_id: session.library_id,
      provider_id: session.provider_id,
      video_slug: session.video_slug,
      session_created_at: session.created_at,
    },
  });
  // Fail closed: this row is the only surviving record of the deleted session.
  if (error) throw databaseError("archive the deleted upload session", error);
}

/** Tells the administrator why a file that was uploaded before transfers again. */
function reuploadNotice(cleared: UploadSession) {
  return `The video published from this file's earlier upload was deleted, so a new upload session was started for it. Its previous Bunny video (${cleared.provider_id || "unknown"}) stays in the library for retention review; delete it in the Bunny dashboard once it is no longer needed.`;
}

async function reserveSession(
  service: ServiceClient,
  userId: string,
  input: SessionInput,
  libraryId: string,
): Promise<
  { warning?: string; cleared?: UploadSession } | { existing: UploadSession }
> {
  const values = {
    id: input.sessionId,
    created_by: userId,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    original_name: input.originalName,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    duration_seconds: input.durationSeconds ?? null,
    category_id: input.categoryId,
    library_id: libraryId,
  };
  // Clearing a deleted session frees this file's identity key, so one retry
  // after a conflict is enough to reserve it.
  let cleared: UploadSession | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error, warning } = await saveSession(
      (row) => service.from("bunny_uploads").insert(row),
      values,
    );
    if (!error) return { warning, ...(cleared ? { cleared } : {}) };
    if (error.code !== "23505")
      throw databaseError("reserve the upload session", error);
    // A concurrent request reserved this session or source first; resume it.
    const lookup = await findSession(service, userId, input);
    if (lookup.session) return { existing: lookup.session };
    if (!lookup.cleared)
      throw databaseError("reserve the upload session", error);
    cleared = lookup.cleared;
  }
  throw new BunnyError(
    "The upload session for this file changed while it was being reserved. Select the file again.",
    409,
  );
}

async function resumeSession(
  service: ServiceClient,
  userId: string,
  session: UploadSession,
  input: SessionInput,
) {
  if (
    session.original_name !== input.originalName ||
    Number(session.size_bytes) !== input.sizeBytes ||
    session.mime_type !== input.mimeType
  )
    throw new BunnyError(
      "Selected file does not match the reserved session.",
      409,
    );
  const resumed = session.id !== input.sessionId;
  if (session.state === "completed") {
    // finish_bunny_upload always links the video; deleting it nulls video_id,
    // and findSession archives and drops such a session before resuming. Only a
    // concurrent change can leave one here, and it must not publish anything.
    if (!session.video_id)
      throw new BunnyError(
        "This file's earlier upload is being replaced by a new session. Select the file again to start its new upload.",
        409,
      );
    return NextResponse.json(
      {
        completed: true,
        slug: session.video_slug,
        sessionId: session.id,
        ...(resumed ? { alreadyUploaded: true } : {}),
      },
      { headers },
    );
  }
  let providerId =
    session.provider_id ||
    (await reconcileCreation(service, userId, session, input.title));
  let status: number;
  try {
    const remote = bunnyVideoSchema.parse(
      await bunnyRequest(
        `/${providerId}`,
        "GET",
        undefined,
        session.library_id,
      ),
    );
    if (
      remote.guid !== providerId ||
      String(remote.videoLibraryId) !== session.library_id
    )
      throw new BunnyError("Provider session identity mismatch.");
    status = remote.status;
  } catch (e) {
    if (!(e instanceof BunnyError && e.providerStatus === 404)) throw e;
    providerId = await replaceMissingVideo(
      service,
      userId,
      session,
      input.title,
      providerId,
    );
    status = 0;
  }
  if (status === 5 || status === 6)
    throw new BunnyError(
      `Bunny could not process this file earlier (${BUNNY_STATUS[status]}). Inspect it in the Bunny dashboard; to upload the source again, rename the file and select it again.`,
      409,
    );
  // The latest title/category apply, and cancelling or failing only paused the
  // session (confirmation rejects cancelled sessions, so reactivate them).
  const changes: Record<string, unknown> = {};
  if (session.title !== input.title) changes.title = input.title;
  if (session.category_id !== input.categoryId)
    changes.category_id = input.categoryId;
  if (
    input.durationSeconds !== undefined &&
    session.duration_seconds !== input.durationSeconds
  )
    changes.duration_seconds = input.durationSeconds;
  if (input.description && session.description !== input.description)
    changes.description = input.description;
  if (["creating", "failed", "cancelled"].includes(session.state)) {
    changes.state = "uploading";
    changes.last_error = null;
  }
  let warning: string | undefined;
  if (Object.keys(changes).length) {
    const saved = await saveSession(
      (values) =>
        service
          .from("bunny_uploads")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("id", session.id)
          .eq("created_by", userId)
          .neq("state", "completed"),
      changes,
    );
    if (saved.error)
      throw databaseError("resume the upload session", saved.error);
    warning = saved.warning;
  }
  return NextResponse.json(
    {
      ...signUpload(providerId, session.library_id),
      transferred: status !== 0,
      sessionId: session.id,
      ...(resumed ? { resumed: true } : {}),
      ...(warning ? { warning } : {}),
    },
    { headers },
  );
}

/**
 * Replaces a Bunny video that no longer exists (e.g. deleted in the Bunny
 * dashboard). Only sessions never saved to the catalog qualify: stage/finish
 * refuse to re-point an existing catalog video to a different provider video.
 */
async function replaceMissingVideo(
  service: ServiceClient,
  userId: string,
  session: UploadSession,
  title: string,
  missingId: string,
): Promise<string> {
  const { data: saved, error } = await service
    .from("videos")
    .select("id")
    .eq("id", session.id)
    .maybeSingle();
  if (error) throw error;
  if (saved)
    throw new BunnyError(
      "This file's Bunny video was deleted in the Bunny dashboard, but it is still listed in the video library. Delete it in Admin → Videos, then select the file again.",
      409,
    );
  const { guid } = createdVideoSchema.parse(
    await bunnyRequest(
      "",
      "POST",
      { title: `${title} [session:${session.id}]` },
      session.library_id,
    ),
  );
  // Only one request may swap in a replacement; a loser's empty video is inert.
  const { data, error: attachError } = await service
    .from("bunny_uploads")
    .update({
      provider_id: guid,
      provider_status: null,
      state: "uploading",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("created_by", userId)
    .eq("provider_id", missingId)
    .neq("state", "completed")
    .select("provider_id")
    .maybeSingle();
  if (attachError)
    throw databaseError("attach the replacement Bunny video", attachError);
  if (data?.provider_id) return data.provider_id;
  throw new BunnyError(
    "The upload session changed while it was being recovered. Retry.",
    409,
  );
}

/**
 * Attaches the Bunny video of a reservation whose create response was lost,
 * found by its unique `[session:<id>]` title marker. Creation is repeated only
 * after the original request can no longer be running and no marked video exists.
 */
async function reconcileCreation(
  service: ServiceClient,
  userId: string,
  session: UploadSession,
  title: string,
): Promise<string> {
  const waitMs =
    CREATION_SETTLE_MS - (Date.now() - Date.parse(session.created_at));
  if (!(waitMs <= 0))
    throw new BunnyError(
      "Bunny is still confirming the video for this file's previous attempt; no duplicate will be created.",
      409,
      Math.ceil((Number.isFinite(waitMs) ? waitMs : CREATION_SETTLE_MS) / 1000),
    );
  const marker = `[session:${session.id}]`;
  const listing = bunnyVideoListSchema.parse(
    await bunnyRequest(
      `?search=${encodeURIComponent(session.id)}&itemsPerPage=100`,
      "GET",
      undefined,
      session.library_id,
    ),
  );
  const matches = (listing.items ?? []).filter(
    (video) =>
      video.title?.includes(marker) &&
      String(video.videoLibraryId) === session.library_id,
  );
  if (matches.length > 1)
    throw new BunnyError(
      `Several Bunny videos carry the marker ${marker}. Delete the extra copies in the Bunny dashboard, then retry.`,
      409,
    );
  const guid =
    matches[0]?.guid ??
    createdVideoSchema.parse(
      await bunnyRequest(
        "",
        "POST",
        { title: `${title} ${marker}` },
        session.library_id,
      ),
    ).guid;
  // Only one request may attach a provider video to the reservation.
  const { data, error } = await service
    .from("bunny_uploads")
    .update({
      provider_id: guid,
      state: "uploading",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("created_by", userId)
    .is("provider_id", null)
    .select("provider_id")
    .maybeSingle();
  if (error)
    throw databaseError("attach the Bunny video to the upload session", error);
  if (data?.provider_id) return data.provider_id;
  const { data: latest, error: readError } = await service
    .from("bunny_uploads")
    .select("provider_id")
    .eq("id", session.id)
    .maybeSingle();
  if (readError) throw readError;
  if (latest?.provider_id) return latest.provider_id;
  throw new BunnyError(
    "The upload session changed while it was being recovered. Retry.",
    409,
  );
}

/**
 * Writes `bunny_uploads` values. Databases without migration 19 lack the
 * `description` column; the optional AI description must not block uploads.
 */
async function saveSession(
  write: (values: Record<string, unknown>) => PromiseLike<{ error: DbError }>,
  values: Record<string, unknown>,
): Promise<{ error: DbError; warning?: string }> {
  const { error } = await write(values);
  if (!error || !("description" in values) || !missingDescriptionColumn(error))
    return { error };
  console.warn(
    `[bunny] bunny_uploads.description is missing; apply supabase/migrations/${DESCRIPTION_MIGRATION}. Saving the upload without its AI description.`,
  );
  const withoutDescription = { ...values };
  delete withoutDescription.description;
  const retry = await write(withoutDescription);
  if (retry.error) return { error: retry.error };
  return {
    error: null,
    warning: `Database migration ${DESCRIPTION_MIGRATION} has not been applied, so AI descriptions are not saved and finished videos wait in the video library for manual publishing. Run that migration in the Supabase SQL Editor.`,
  };
}

function missingDescriptionColumn(error: DbError) {
  return (
    (error?.code === "PGRST204" || error?.code === "42703") &&
    /description/i.test(error.message || "")
  );
}

/** Explains a database failure instead of masking it as a retryable conflict. */
function databaseError(action: string, error: DbError) {
  console.error(`[bunny] Could not ${action}:`, error);
  const code = error?.code || "unknown";
  const reason =
    code === "42501"
      ? "permission denied. Check that SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY holds the service-role key."
      : code === "42P01" || code === "PGRST205"
        ? "the bunny_uploads table is missing. Apply the Supabase migrations (see DEPLOYMENT.md)."
        : code === "PGRST204" || code === "42703"
          ? `${error?.message || "a column is missing"}. Apply the pending Supabase migrations (see DEPLOYMENT.md).`
          : code === "23503"
            ? "the selected category or your administrator profile no longer exists. Reload the page and choose a category again."
            : code === "23505"
              ? "this file already has an upload session that could not be resumed. Reload the page and select the file again."
              : error?.message || "the database did not respond.";
  return new BunnyError(
    `Could not ${action}: ${reason} (database code ${code})`,
    code === "23503" ? 400 : code === "23505" ? 409 : 503,
  );
}

/** Browser lifecycle reports are diagnostic only, never proof of provider readiness. */
export async function PATCH(req: NextRequest) {
  try {
    const { service, user } = await requireActiveAdmin();
    const parsed = z
      .object({
        sessionId: z.string().uuid(),
        reason: z.enum(["upload_failed", "thumbnail_failed", "user_cancelled"]),
      })
      .strict()
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      throw new BunnyError("Invalid upload lifecycle report.", 400);
    const messages = {
      upload_failed:
        "Browser reported upload or persistence failure. Retry the existing session.",
      thumbnail_failed:
        "Thumbnail generation/storage failed. Retry thumbnail without transferring video again.",
      user_cancelled:
        "Administrator paused the transfer. Reselect the same file to resume.",
    };
    const { data, error } = await service
      .from("bunny_uploads")
      .update({
        state: parsed.data.reason === "user_cancelled" ? "cancelled" : "failed",
        last_error: messages[parsed.data.reason],
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.sessionId)
      .eq("created_by", user.id)
      .neq("state", "completed")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new BunnyError("Incomplete upload session not found.", 404);
    return NextResponse.json({ recorded: true }, { headers });
  } catch (e) {
    const r = providerError(e);
    return NextResponse.json({ error: r.error }, { status: r.status, headers });
  }
}
