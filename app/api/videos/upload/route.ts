import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getVideoProvider } from "@/lib/video/provider";
import { z } from "zod";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB limit for streaming check

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Check admin role
    const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", user.id).single();
    if (!profile || profile.role !== "admin" || profile.status !== "active") {
      return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;
    const description = formData.get("description") as string | null;
    const categoryId = formData.get("categoryId") as string | null;
    const tags = formData.get("tags") as string | null;
    const rightsStatus = formData.get("rightsStatus") as string | null;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 2GB)" }, { status: 413 });
    if (!file.type.startsWith("video/")) return NextResponse.json({ error: "Only video files allowed" }, { status: 400 });
    if (!title || title.trim().length < 3) return NextResponse.json({ error: "Title required (min 3 chars)" }, { status: 400 });

    const service = createServiceClient();

    // Generate slug
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + "-" + Date.now().toString(36);

    // Create video record draft
    const { data: video, error: videoError } = await service
      .from("videos")
      .insert({
        slug,
        title: title.trim(),
        description: description?.trim() || null,
        category_id: categoryId || null,
        status: "processing",
        rights_status: rightsStatus || "pending",
        visibility: "private",
        moderation_status: "pending",
        created_by: user.id,
        updated_by: user.id,
        provider: process.env.VIDEO_PROVIDER || "internal",
      })
      .select()
      .single();

    if (videoError) throw videoError;

    // Create upload job
    const { data: job } = await service
      .from("upload_jobs")
      .insert({
        video_id: video.id,
        file_name: file.name,
        file_size: file.size,
        provider: process.env.VIDEO_PROVIDER || "internal",
        status: "uploading",
        progress: 0,
        created_by: user.id,
      })
      .select()
      .single();

    // Provider handling
    const providerName = process.env.VIDEO_PROVIDER || "internal";
    const provider = getVideoProvider(providerName);

    if (!provider.isEnabled()) {
      // If provider disabled (e.g., Uqload without approval), mark job failed with clear blocker
      await service.from("upload_jobs").update({
        status: "failed",
        error_message: `Provider ${providerName} disabled — adult content not approved. See DEPLOYMENT.md Uqload policy gate.`,
      }).eq("id", job.id);

      await service.from("videos").update({ status: "draft" }).eq("id", video.id);

      return NextResponse.json({
        error: "Video hosting provider disabled",
        details: `Provider ${providerName} is disabled due to policy restrictions. Production video hosting is blocked until written approval or replacement provider. See DEPLOYMENT.md`,
        videoId: video.id,
        jobId: job.id,
      }, { status: 503 });
    }

    // For internal provider, we would stream to Supabase Storage
    // For Uqload, we need to get upload server and upload
    try {
      if (providerName === "uqload") {
        const uploadServer = await provider.getUploadServer();
        const result = await provider.uploadFile(uploadServer, file, {
          fileName: file.name,
          fileSize: file.size,
          title: title.trim(),
          description: description?.trim(),
          tags: tags || undefined,
        });

        // Update video with provider file id
        await service.from("videos").update({
          provider_file_id: result.providerFileId,
          status: "processing",
        }).eq("id", video.id);

        await service.from("upload_jobs").update({
          provider_file_id: result.providerFileId,
          status: "processing",
          progress: 100,
        }).eq("id", job.id);

        // Audit log
        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_uploaded",
          target_type: "video",
          target_id: video.id,
          level: "info",
          metadata: { provider: providerName, fileName: file.name, fileSize: file.size },
        });

        return NextResponse.json({
          videoId: video.id,
          jobId: job.id,
          providerFileId: result.providerFileId,
          status: "processing",
        });
      } else {
        // Internal: simulate upload to storage (in production, stream to S3/Supabase Storage)
        // For now, we store placeholder and mark completed
        // In real implementation, you'd upload to Supabase Storage bucket
        const fakeProviderId = `internal-${video.id}`;
        await service.from("videos").update({
          provider_file_id: fakeProviderId,
          thumbnail_url: `https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png`, // placeholder until real thumbnail
          status: "pending_review",
          playable_url: null, // would be storage URL
        }).eq("id", video.id);

        await service.from("upload_jobs").update({
          provider_file_id: fakeProviderId,
          status: "completed",
          progress: 100,
        }).eq("id", job.id);

        await service.from("audit_logs").insert({
          actor_id: user.id,
          action: "video_uploaded_internal",
          target_type: "video",
          target_id: video.id,
          level: "info",
          metadata: { fileName: file.name },
        });

        return NextResponse.json({
          videoId: video.id,
          jobId: job.id,
          providerFileId: fakeProviderId,
          status: "pending_review",
          note: "Internal provider — video requires review and playable URL configuration",
        });
      }
    } catch (uploadError: any) {
      await service.from("upload_jobs").update({
        status: "failed",
        error_message: uploadError.message,
      }).eq("id", job.id);

      await service.from("videos").update({ status: "draft" }).eq("id", video.id);

      throw uploadError;
    }
  } catch (e: any) {
    console.error("upload error", e);
    return NextResponse.json({ error: "Upload failed", details: e.message }, { status: 500 });
  }
}
