import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Shared authorization and validation retained by video, metadata and payment administration. */
export type ServiceClient = ReturnType<typeof createServiceClient>;

export async function requireActiveAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "admin" || profile.status !== "active") throw new Error("Forbidden — admin only");

  return { user, service: createServiceClient() };
}

export function httpErrorStatus(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message.startsWith("Forbidden")) return 403;
  return 500;
}

/**
 * Maps a thrown error onto the HTTP status our routes answer with.
 */
export function errorStatusFrom(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  return httpErrorStatus(message);
}

/** The message an admin should see, with no secrets and no stack traces. */
export function errorMessageFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function getCategory(service: ServiceClient, categoryId: string) {
  const { data: category, error } = await service
    .from("categories")
    .select("id, label")
    .eq("id", categoryId)
    .single();
  if (error || !category) throw new Error("Choose a valid category");
  return category as { id: string; label: string };
}

export function assertPublicHttpUrl(value: string, label = "URL"): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid http or https URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  if (url.username || url.password) throw new Error(`${label} cannot include credentials`);

  const host = url.hostname.toLowerCase();
  const blockedHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("169.254.") ||
    host.startsWith("fc") ||
    host.startsWith("fd");
  if (blockedHost) throw new Error(`${label} must point to a public host`);
  return url.toString();
}
