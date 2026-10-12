import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestedMetadata } from "@/lib/gemini/client";
import { createFakeSupabase } from "./helpers/fake-supabase";

/**
 * The upload pipeline must not be blocked by Gemini. When the AI suggestion
 * fails (malformed output, quota, missing key) the video is still created with
 * deterministic file-name metadata, and the reason is reported back so the
 * admin knows it needs reviewing.
 */

const geminiState = vi.hoisted(() => ({
  suggest: null as null | ((params: { fileName?: string; category?: string }) => Promise<SuggestedMetadata>),
  calls: 0,
}));

vi.mock("@/lib/gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/client")>();
  return {
    ...actual,
    suggestVideoMetadata: async (params: { fileName?: string; category?: string }) => {
      geminiState.calls += 1;
      if (!geminiState.suggest) throw new Error("suggestVideoMetadata not stubbed");
      return geminiState.suggest(params);
    },
  };
});

const dbState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => dbState.client,
  createServiceClient: () => dbState.client,
  isValidSupabaseUrl: () => true,
  isValidSupabaseKey: () => true,
  isSupabaseConfigured: () => true,
}));

import {
  assertPublicHttpUrl,
  completeUploadJob,
  createGeneratedVideo,
  createUploadJob,
  failUpload,
  httpErrorStatus,
  publishVideo,
  sourceNameFromUrl,
} from "@/lib/video/publishing";

const CATEGORY_ID = "cat-boudoir";

function seedDb() {
  const fake = createFakeSupabase({
    categories: [{ id: CATEGORY_ID, label: "Boudoir" }],
    videos: [],
    tags: [],
    video_tags: [],
  });
  dbState.client = fake.client;
  return fake;
}

function aiSuggestion(overrides: Partial<SuggestedMetadata> = {}): SuggestedMetadata {
  return {
    title: "Evening in Velvet",
    description: "An elegant, slow-paced portrait captured in soft cinematic light.",
    tags: ["mature", "boudoir", "4k"],
    category: "Boudoir",
    reasoning: "AI-generated suggestion, requires human review",
    ...overrides,
  };
}

beforeEach(() => {
  geminiState.suggest = null;
  geminiState.calls = 0;
  seedDb();
});

describe("createGeneratedVideo metadata", () => {
  it("uses the AI suggestion when Gemini answers", async () => {
    geminiState.suggest = async () => aiSuggestion();
    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(metadata.source).toBe("ai");
    expect(metadata.warning).toBeUndefined();
    expect(metadata.title).toBe("Evening in Velvet");
    expect(video.title).toBe("Evening in Velvet");
  });

  it("keeps publishing with file-name metadata when Gemini fails", async () => {
    geminiState.suggest = async () => {
      throw new Error("Gemini returned malformed JSON — its response could not be parsed as JSON");
    };

    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "evening_in_velvet_20240512.mov",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(geminiState.calls).toBe(1);
    expect(metadata.source).toBe("fallback");
    expect(metadata.warning).toMatch(/AI metadata unavailable/);
    expect(metadata.title).toBe("Evening In Velvet");
    expect(metadata.description).toMatch(/replace it before publishing/);
    expect(metadata.tags).toContain("boudoir");
    expect(video.title).toBe("Evening In Velvet");
  });

  it("attaches the fallback tags so the video is not left untagged", async () => {
    const fake = seedDb();
    geminiState.suggest = async () => {
      throw new Error("Gemini quota or rate limit exceeded");
    };

    const { video } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    const links = fake.db.video_tags.filter((row) => row.video_id === video.id);
    expect(links.length).toBeGreaterThan(0);
    expect(fake.db.tags.length).toBeGreaterThan(0);
  });

  it("skips a second Gemini call when metadata was prepared while the file was uploading", async () => {
    geminiState.suggest = async () => {
      throw new Error("suggestVideoMetadata should not run");
    };

    const prepared = {
      title: "Already Written",
      description: "Prepared while the bytes were in flight.",
      tags: ["mature", "4k"],
      source: "ai" as const,
    };
    const { video, metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "ufoload",
      prepared,
    });

    expect(geminiState.calls).toBe(0);
    expect(metadata.source).toBe("ai");
    expect(metadata.title).toBe("Already Written");
    expect(video.title).toBe("Already Written");
  });

  it("ignores prepared metadata that is not usable and asks Gemini instead", async () => {
    geminiState.suggest = async () => aiSuggestion();
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "ufoload",
      prepared: { title: "x", description: "", tags: [], source: "ai" },
    });

    expect(geminiState.calls).toBe(1);
    expect(metadata.title).toBe("Evening in Velvet");
  });

  it("falls back when Gemini returns an unusable field, such as a blank title", async () => {
    geminiState.suggest = async () => aiSuggestion({ title: "   " });
    const { metadata } = await createGeneratedVideo({
      service: dbState.client as never,
      userId: "admin-1",
      sourceName: "clip.mp4",
      categoryId: CATEGORY_ID,
      provider: "embed",
    });

    expect(metadata.source).toBe("fallback");
    expect(metadata.title.trim().length).toBeGreaterThan(0);
  });
});


describe("publishVideo", () => {
  function seedVideo(status = "processing") {
    const fake = seedDb();
    fake.db.videos.push({ id: "vid-1", slug: "v-1", title: "V", status, visibility: "private", created_by: "admin-1" });
    return fake;
  }

  it("publishes with the provider facts and clears any playable URL", async () => {
    const fake = seedVideo();
    const result = await publishVideo({
      service: dbState.client as never,
      videoId: "vid-1",
      userId: "admin-1",
      providerFileId: "01JFILE",
      playableUrl: null,
      embedUrl: "https://ufoload.com/e/abcDEF12345",
      details: { durationSeconds: 90, resolution: "1920x1080", quality: "HD" },
    });
    expect(result).toMatchObject({ id: "vid-1" });
    expect(fake.db.videos[0]).toMatchObject({
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
      provider_file_id: "01JFILE",
      playable_url: null,
      embed_url: "https://ufoload.com/e/abcDEF12345",
      duration_seconds: 90,
      resolution: "1920x1080",
      quality: "HD",
      updated_by: "admin-1",
    });
  });

  it("is a compare-and-set when expectStatus is given: only a processing video is published", async () => {
    const fake = seedVideo("draft");
    const lost = await publishVideo({ service: dbState.client as never, videoId: "vid-1", userId: "admin-1", expectStatus: "processing" });
    expect(lost).toBeNull();
    expect(fake.db.videos[0].status).toBe("draft");

    fake.db.videos[0].status = "processing";
    const won = await publishVideo({ service: dbState.client as never, videoId: "vid-1", userId: "admin-1", expectStatus: "processing" });
    expect(won).toMatchObject({ id: "vid-1" });
    expect(fake.db.videos[0].status).toBe("published");

    // A second racer loses.
    expect(await publishVideo({ service: dbState.client as never, videoId: "vid-1", userId: "admin-1", expectStatus: "processing" })).toBeNull();
  });

  it("without expectStatus a missing video is an error, not a silent null", async () => {
    seedDb();
    await expect(publishVideo({ service: dbState.client as never, videoId: "ghost", userId: "admin-1" })).rejects.toThrow(/no longer exists/);
  });
});

describe("upload jobs", () => {
  it("keeps the upload session, the import task and the file in separate columns", async () => {
    const fake = seedDb();
    const direct = await createUploadJob({ service: dbState.client as never, userId: "admin-1", fileName: "a.mp4", fileSize: 10, providerUploadId: "upl_1" });
    const imported = await createUploadJob({ service: dbState.client as never, videoId: "vid-1", userId: "admin-1", fileName: "b.mp4", providerImportTaskId: "imp_1", providerStatus: "import:queued" });

    expect(direct).toMatchObject({ provider: "ufoload", status: "uploading", provider_upload_id: "upl_1", video_id: null, file_size: 10 });
    expect(direct.provider_file_id).toBeUndefined();
    expect(imported).toMatchObject({ provider: "ufoload", provider_import_task_id: "imp_1", provider_status: "import:queued", video_id: "vid-1" });
    expect(imported.provider_file_id).toBeUndefined();
    expect(fake.db.upload_jobs).toHaveLength(2);
  });

  it("completing an upload records the file id and leaves it processing — never completed", async () => {
    const fake = seedDb();
    const job = await createUploadJob({ service: dbState.client as never, userId: "admin-1", fileName: "a.mp4", providerUploadId: "upl_1" });
    await completeUploadJob(dbState.client as never, job.id, "01JFILE", { videoId: "vid-9", progress: 5, providerStatus: "queued" });
    expect(fake.db.upload_jobs[0]).toMatchObject({ provider_file_id: "01JFILE", status: "processing", progress: 5, video_id: "vid-9", provider_status: "queued", error_message: null });
  });

  it("failing resets the video to a private draft and records the reason; a cancelled job is cancelled", async () => {
    const fake = seedDb();
    fake.db.videos.push({ id: "vid-1", status: "processing", visibility: "public" });
    const job = await createUploadJob({ service: dbState.client as never, videoId: "vid-1", userId: "admin-1", fileName: "a.mp4" });
    await failUpload({ service: dbState.client as never, videoId: "vid-1", jobId: job.id, message: "UFOLOAD said no" });
    expect(fake.db.upload_jobs[0]).toMatchObject({ status: "failed", error_message: "UFOLOAD said no" });
    expect(fake.db.videos[0]).toMatchObject({ status: "draft", visibility: "private" });

    await failUpload({ service: dbState.client as never, jobId: job.id, message: "stopped", status: "cancelled" });
    expect(fake.db.upload_jobs[0].status).toBe("cancelled");
  });
});

describe("assertPublicHttpUrl (SSRF guard for URL import and iframe sources)", () => {
  it.each([
    "https://cdn.example.com/video.mp4",
    "http://videos.example.org:8080/a/b.mkv?x=1",
    "https://fdn.example.com/clip.mp4", // hostnames starting with fd/fc are ordinary names
    "https://fcbayern.example/clip.mp4",
    "http://93.184.216.34/v.mp4",
    "http://[2606:4700:4700::1111]/v.mp4",
  ])("accepts %s", (url) => {
    expect(assertPublicHttpUrl(url)).toBeTruthy();
  });

  it.each([
    ["localhost", "http://localhost/v.mp4"],
    ["a .localhost name", "http://app.localhost/v.mp4"],
    ["a .local name", "http://printer.local/v.mp4"],
    ["a .internal name", "http://db.internal/v.mp4"],
    ["loopback", "http://127.0.0.1/v.mp4"],
    ["loopback in short form", "http://127.1/v.mp4"],
    ["loopback in hex", "http://0x7f.0.0.1/v.mp4"],
    ["loopback as one decimal", "http://2130706433/v.mp4"],
    ["0.0.0.0", "http://0.0.0.0/v.mp4"],
    ["10.0.0.0/8", "http://10.1.2.3/v.mp4"],
    ["172.16.0.0/12", "http://172.20.0.1/v.mp4"],
    ["192.168.0.0/16", "http://192.168.0.1/v.mp4"],
    ["link-local / cloud metadata", "http://169.254.169.254/latest/meta-data"],
    ["carrier-grade NAT", "http://100.64.0.1/v.mp4"],
    ["multicast", "http://224.0.0.1/v.mp4"],
    ["IPv6 loopback", "http://[::1]/v.mp4"],
    ["IPv6 unspecified", "http://[::]/v.mp4"],
    ["IPv6 unique-local", "http://[fd00::1]/v.mp4"],
    ["IPv6 link-local", "http://[fe80::1]/v.mp4"],
    ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/v.mp4"],
    ["a single-label host", "http://intranet/v.mp4"],
  ])("refuses %s", (_label, url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(/public host/);
  });

  it("refuses other schemes, credentials and garbage", () => {
    expect(() => assertPublicHttpUrl("ftp://cdn.example.com/v.mp4")).toThrow(/http or https/);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/http or https/);
    expect(() => assertPublicHttpUrl("javascript:alert(1)")).toThrow(/http or https/);
    expect(() => assertPublicHttpUrl("https://user:pw@cdn.example.com/v.mp4")).toThrow(/credentials/);
    expect(() => assertPublicHttpUrl("not a url")).toThrow(/valid http or https URL/);
    expect(() => assertPublicHttpUrl("")).toThrow(/valid http or https URL/);
  });

  it("uses the given label in its messages", () => {
    expect(() => assertPublicHttpUrl("http://localhost/x", "Remote video URL")).toThrow("Remote video URL must point to a public host");
  });
});

describe("small helpers", () => {
  it("derives a display name from a link, tolerating malformed escapes", () => {
    expect(sourceNameFromUrl("https://cdn.example.com/a/My%20Trip.mp4")).toBe("My Trip.mp4");
    expect(sourceNameFromUrl("https://cdn.example.com/bad%ZZname.mp4")).toBe("bad%ZZname.mp4");
    expect(sourceNameFromUrl("https://cdn.example.com/")).toBe("remote-video");
  });

  it("maps admin mistakes to 4xx and everything else to 500", () => {
    expect(httpErrorStatus("Unauthorized")).toBe(401);
    expect(httpErrorStatus("Forbidden — admin only")).toBe(403);
    expect(httpErrorStatus("Choose a valid category")).toBe(400);
    expect(httpErrorStatus("That thumbnail path is not a valid upload for this account")).toBe(400);
    expect(httpErrorStatus("something exploded")).toBe(500);
  });
});
