import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `createClient()` reads cookies via next/headers — stub it for unit tests.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

import {
  createClient,
  createServiceClient,
  tryCreateServiceClient,
  isValidSupabaseUrl,
  isValidSupabaseKey,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const original: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) original[key] = process.env[key];

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  clearEnv();
});

describe("supabase env validation", () => {
  it("rejects missing, placeholder and malformed urls", () => {
    expect(isValidSupabaseUrl(undefined)).toBe(false);
    expect(isValidSupabaseUrl("")).toBe(false);
    expect(isValidSupabaseUrl("not-a-url")).toBe(false);
    expect(isValidSupabaseUrl("https://your-project.supabase.co")).toBe(false);
    expect(isValidSupabaseUrl("https://placeholder.supabase.co")).toBe(false);
    expect(isValidSupabaseUrl("https://abcdefghij.supabase.co")).toBe(true);
  });

  it("rejects missing and placeholder keys", () => {
    expect(isValidSupabaseKey(undefined)).toBe(false);
    expect(isValidSupabaseKey("short")).toBe(false);
    expect(isValidSupabaseKey("sb_publishable_xxxxxxxxxxxxxxxx")).toBe(false);
    expect(isValidSupabaseKey("sb_publishable_1234567890abcdefghij")).toBe(true);
  });

  it("reports configuration state from env", () => {
    expect(isSupabaseConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghij.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1234567890abcdefghij";
    expect(isSupabaseConfigured()).toBe(true);
  });
});

describe("createClient fallback", () => {
  it("never throws when Supabase is not configured", async () => {
    const supabase = await createClient();
    expect(supabase).toBeTruthy();
    expect(supabase.auth).toBeTruthy();
  });

  it("supports every query shape used by the app without throwing", async () => {
    const supabase = await createClient();

    const list = await supabase.from("videos").select("*").eq("status", "published");
    expect(list).toMatchObject({ data: [], error: null });

    const row = await supabase.from("videos").select("*").eq("slug", "x").single();
    expect(row).toMatchObject({ data: null, error: null });

    const maybe = await supabase.from("categories").select("*").eq("slug", "x").maybeSingle();
    expect(maybe).toMatchObject({ data: null, error: null });

    await expect(supabase.from("video_events").insert({ video_id: "1" })).resolves.toBeTruthy();
    await expect(
      supabase
        .from("videos")
        .select("*")
        .order("published_at", { ascending: false })
        .limit(50)
        .ilike("title", "%a%")
        .gte("x", 1)
        .lte("y", 2)
        .neq("z", 3)
        .in("id", [1, 2])
        .filter("a", "eq", 1)
    ).resolves.toMatchObject({ data: [], error: null });

    await expect(supabase.auth.getUser()).resolves.toMatchObject({ data: { user: null } });
    await expect(supabase.storage.from("videos").upload()).resolves.toBeTruthy();
    expect(supabase.storage.from("videos").getPublicUrl()).toBeTruthy();
  });

  it("also falls back for placeholder env values (broken Vercel config)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://your-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xxxxxxxxxxxxxxxx";
    const supabase = await createClient();
    await expect(supabase.from("ad_slots").select("*")).resolves.toMatchObject({ data: [] });
  });
});

describe("service client", () => {
  it("throws for missing service credentials and is wrapped by tryCreate", () => {
    expect(() => createServiceClient()).toThrow();
    expect(tryCreateServiceClient()).toBeNull();
  });
});
