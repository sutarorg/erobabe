import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let thumbnailBundle: string;
let tusBundle: string;
let dir: string;
let clip: string;
test.beforeAll(async () => {
  const thumbnail = await build({
    entryPoints: ["src/utils/localVideoThumbnail.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "thumbnailPipeline",
    platform: "browser",
  });
  thumbnailBundle = thumbnail.outputFiles[0].text;
  const tus = await build({
    entryPoints: ["src/utils/bunnyUpload.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "bunnyPipeline",
    platform: "browser",
  });
  tusBundle = tus.outputFiles[0].text;
  dir = mkdtempSync(path.join(tmpdir(), "erobabe-browser-"));
  clip = path.join(dir, "actual.webm");
  execFileSync(require("@ffmpeg-installer/ffmpeg").path, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=black:s=320x180:d=0.5:r=10",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=10:duration=1.5",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "libvpx",
    "-b:v",
    "400k",
    "-threads",
    "1",
    "-y",
    clip,
  ]);
});
test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function isolatedBrowser(page: Page) {
  await page.route("**/__bunny_fixture", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><html><body><input type="file" id="source"></body></html>',
    }),
  );
  await page.goto("/__bunny_fixture");
}

test("actual local frames produce a nonblack 1280x720 JPEG without network requests", async ({
  page,
}) => {
  await isolatedBrowser(page);
  await page.setContent('<input type="file" id="source">');
  await page.addScriptTag({ content: thumbnailBundle });
  await page.locator("#source").setInputFiles(clip);
  const result = await page.evaluate(async () => {
    const pipeline = (window as any).thumbnailPipeline;
    const file = (document.querySelector("#source") as HTMLInputElement)
      .files![0];
    const output = await pipeline.localVideoThumbnail(file);
    if (!output.thumbnail) return { warning: output.warning };
    const bytes = new Uint8Array(await output.thumbnail.arrayBuffer());
    const bitmap = await createImageBitmap(output.thumbnail);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const rgb = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let brightness = 0;
    for (let i = 0; i < rgb.length; i += 4)
      brightness += rgb[i] + rgb[i + 1] + rgb[i + 2];
    bitmap.close();
    return {
      width: canvas.width,
      height: canvas.height,
      type: output.thumbnail.type,
      jpeg: bytes[0] === 255 && bytes[1] === 216,
      brightness: brightness / (canvas.width * canvas.height * 3),
      duration: output.duration,
    };
  });
  expect(result).toMatchObject({
    width: 1280,
    height: 720,
    type: "image/jpeg",
    jpeg: true,
  });
  expect(result.brightness).toBeGreaterThan(20);
  expect(result.duration).toBeGreaterThan(1);
});

test("corrupt local source fails clearly and does not return a placeholder thumbnail", async ({
  page,
}) => {
  await isolatedBrowser(page);
  await page.addScriptTag({ content: thumbnailBundle });
  const result = await page.evaluate(async () =>
    (window as any).thumbnailPipeline.localVideoThumbnail(
      new File(["not a video"], "corrupt.mp4", { type: "video/mp4" }),
    ),
  );
  expect(result.thumbnail).toBeNull();
  expect(result.warning).toContain("Retry thumbnail");
});

test("maintained TUS client sends direct headers/metadata/progress and resumes after pause (mock protocol)", async ({
  page,
}) => {
  await isolatedBrowser(page);
  await page.addScriptTag({ content: tusBundle });
  let offset = 0;
  let posts = 0;
  let heads = 0;
  let firstPatch = true;
  const auth: string[] = [];
  await page.route("https://video.bunnycdn.com/**", async (route) => {
    const req = route.request();
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers":
        "Location,Upload-Offset,Upload-Length,Tus-Resumable",
      "Tus-Resumable": "1.0.0",
    };
    auth.push(req.headers()["authorizationsignature"] || "");
    if (req.method() === "POST") {
      posts++;
      expect(req.headers()["upload-metadata"]).toContain("filetype");
      await route.fulfill({
        status: 201,
        headers: {
          ...headers,
          Location: "https://video.bunnycdn.com/tusupload/mock",
        },
      });
    } else if (req.method() === "HEAD") {
      heads++;
      await route.fulfill({
        status: 200,
        headers: {
          ...headers,
          "Upload-Offset": String(offset),
          "Upload-Length": String(9 * 1024 * 1024),
        },
      });
    } else if (req.method() === "PATCH") {
      offset += req.postDataBuffer()?.length || 0;
      if (firstPatch) {
        firstPatch = false;
        await page.evaluate(() => (window as any).pauseUpload.abort());
      }
      await route.fulfill({
        status: 204,
        headers: { ...headers, "Upload-Offset": String(offset) },
      });
    } else await route.fulfill({ status: 204, headers });
  });
  const result = await page.evaluate(async () => {
    const file = new File([new Uint8Array(9 * 1024 * 1024)], "actual.mp4", {
      type: "video/mp4",
      lastModified: 123,
    });
    const target = {
      videoId: "44444444-4444-4444-8444-444444444444",
      uploadUrl: "https://video.bunnycdn.com/tusupload",
      expiration: 9999999999,
      headers: {
        AuthorizationSignature: "scoped-test-signature",
        AuthorizationExpire: "9999999999",
        LibraryId: "123",
        VideoId: "44444444-4444-4444-8444-444444444444",
      },
    };
    const controller = new AbortController();
    (window as any).pauseUpload = controller;
    let cancelled = false;
    const progress: number[] = [];
    try {
      await (window as any).bunnyPipeline.uploadBunnyVideo(target, file, {
        title: "Actual",
        signal: controller.signal,
      });
    } catch (e) {
      cancelled = (e as Error).message === "Upload cancelled";
    }
    await (window as any).bunnyPipeline.uploadBunnyVideo(target, file, {
      title: "Actual",
      onProgress: (p: { percent: number }) => progress.push(p.percent),
    });
    return { cancelled, progress };
  });
  expect(result.cancelled).toBe(true);
  expect(result.progress.at(-1)).toBe(100);
  expect(heads).toBeGreaterThan(0);
  expect(posts).toBe(1);
  expect(offset).toBe(9 * 1024 * 1024);
  expect(auth.every((a) => a === "scoped-test-signature")).toBe(true);
});

test("Bunny API surface requires authenticated administrator", async ({
  request,
}) => {
  expect((await request.get("/api/videos/bunny/sessions")).status()).toBe(401);
  expect(
    (await request.patch("/api/videos/bunny/sessions", { data: {} })).status(),
  ).toBe(401);
  for (const route of ["sessions", "confirm", "thumbnail-rank"])
    expect(
      (await request.post(`/api/videos/bunny/${route}`, { data: {} })).status(),
    ).toBe(401);
});
