import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { removeThumbnailObject, resolveImageValue } from "@/lib/video/storage";
import { revalidatePublicTag } from "@/lib/public/revalidate";
import { z } from "zod";

/** The image URL currently stored for a category (used to clean up replaced files). */
async function loadStoredImage(service: ReturnType<typeof createServiceClient>, id: string): Promise<string | null> {
  const { data } = await service.from("categories").select("image_url").eq("id", id).single();
  return (data as { image_url?: string | null } | null)?.image_url || null;
}

const text = (max: number) => z.string().trim().max(max);
const createSchema = z.object({
  label: text(80).min(2),
  slug: text(100).optional(),
  description: text(500).optional().nullable(),
  icon: text(80).optional().nullable(),
  /**
   * Category card thumbnail. Either the public URL returned when the image was
   * uploaded to storage, or the storage object path (`<owner>/<uuid>.<ext>`)
   * the upload endpoint handed the browser. `null`/"" removes the thumbnail.
   */
  image_url: text(600).optional().nullable(),
});
const updateSchema = createSchema.partial().extend({ id: z.string().uuid() }).refine(
  (value) =>
    value.label !== undefined ||
    value.slug !== undefined ||
    value.description !== undefined ||
    value.icon !== undefined ||
    value.image_url !== undefined,
  { message: "No category changes were provided" }
);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

type AdminAuth = { user: { id: string } } | { error: NextResponse };

async function requireAdmin(): Promise<AdminAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin" || profile.status !== "active") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user: { id: user.id } };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid category", details: parsed.error.flatten() }, { status: 400 });

    const slug = slugify(parsed.data.slug || parsed.data.label);
    if (!slug) return NextResponse.json({ error: "Category slug is required" }, { status: 400 });

    const service = createServiceClient();
    const imageUrl = resolveImageValue(service, parsed.data.image_url);
    const { data: category, error } = await service
      .from("categories")
      .insert({
        label: parsed.data.label,
        slug,
        description: parsed.data.description || null,
        icon: parsed.data.icon || null,
        image_url: imageUrl,
      })
      .select()
      .single();
    if (error) {
      const status = error.code === "23505" ? 409 : 500;
      return NextResponse.json({ error: status === 409 ? "A category with that label or slug already exists" : error.message }, { status });
    }

    await service.from("audit_logs").insert({
      actor_id: auth.user.id,
      action: "category_created",
      target_type: "category",
      target_id: category.id,
      level: "info",
      metadata: { label: category.label, slug: category.slug, has_image: Boolean(imageUrl) },
    });

    revalidatePublicTag("categories");
    return NextResponse.json({ category }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unable to create category" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid category", details: parsed.error.flatten() }, { status: 400 });

    const { id, ...changes } = parsed.data;
    const update: Record<string, string | null> = {};
    if (changes.label !== undefined) update.label = changes.label;
    if (changes.slug !== undefined) {
      const slug = slugify(changes.slug);
      if (!slug) return NextResponse.json({ error: "Category slug is required" }, { status: 400 });
      update.slug = slug;
    }
    if (changes.description !== undefined) update.description = changes.description || null;
    if (changes.icon !== undefined) update.icon = changes.icon || null;

    const service = createServiceClient();
    // A storage path is resolved to its public URL; an existing URL is kept.
    const previousImage = changes.image_url !== undefined ? await loadStoredImage(service, id) : null;
    if (changes.image_url !== undefined) update.image_url = resolveImageValue(service, changes.image_url);

    const { data: category, error } = await service
      .from("categories")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      const status = error.code === "23505" ? 409 : 500;
      return NextResponse.json({ error: status === 409 ? "A category with that label or slug already exists" : error.message }, { status });
    }

    // A replaced or removed thumbnail leaves the old object behind — delete it
    // after the row is saved, and never let cleanup failure fail the request.
    if (changes.image_url !== undefined && previousImage && previousImage !== (category as any).image_url) {
      await removeThumbnailObject(service, previousImage);
    }

    await service.from("audit_logs").insert({
      actor_id: auth.user.id,
      action: "category_updated",
      target_type: "category",
      target_id: category.id,
      level: "info",
      metadata: {
        label: category.label,
        slug: category.slug,
        ...(changes.image_url !== undefined ? { has_image: Boolean((category as any).image_url) } : {}),
      },
    });

    revalidatePublicTag("categories");
    return NextResponse.json({ category });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unable to update category" }, { status: 500 });
  }
}
