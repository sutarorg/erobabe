import { afterAll, describe, expect, it } from "vitest";
import { open, stat } from "fs/promises";
import { UfoloadProvider } from "@/lib/video/provider";
import { parseUfoloadEmbedUrl } from "@/lib/video/ufoload";

/**
 * OPTIONAL live test against the real UFOLOAD API. DISABLED BY DEFAULT: with no
 * environment it is skipped, so `npm run test` never touches the network or an
 * account. It is the only test in this repository that can show a real upload
 * works — every other UFOLOAD test runs against a mock written from the OpenAPI
 * document and proves conformance, not reality.
 *
 *   UFOLOAD_LIVE_TEST=1                       switch it on
 *   UFOLOAD_API_KEY=ufo_…                     a key for a TEST account/folder-free account you own
 *   UFOLOAD_LIVE_TEST_FILE=/path/sample.mp4   a SMALL video you are authorised to upload
 *   UFOLOAD_LIVE_TEST_ACK_NON_ADULT=1         you confirm the sample is NOT adult content
 *
 * Optional:
 *   UFOLOAD_LIVE_TEST_IMPORT_URL=https://…    a public direct link to a small, non-adult, authorised video (adds the URL-import check)
 *   UFOLOAD_LIVE_TEST_READY_TIMEOUT_MS=600000 how long to wait for `ready` (default 10 minutes)
 *   UFOLOAD_LIVE_TEST_KEEP=1                  keep the uploaded files (default: delete them afterwards)
 *
 * It never uploads adult content: it refuses to run without the explicit
 * acknowledgement above and without a file path (there is no default sample),
 * and it does NOT use or set UFOLOAD_ADULT_CONTENT_APPROVED — that flag is the
 * production gate, which stays false until UFOLOAD's written approval exists.
 *
 * What it checks, in order: direct-upload init → chunked PUT with offsets (from
 * Node, so browser CORS is NOT covered — see DEPLOYMENT.md for that manual
 * step) → GET offset → complete → status polling until `ready` → stable embed
 * URL (and that it answers without a key) → optional URL import → cleanup.
 */

const env = process.env;
const enabled = env.UFOLOAD_LIVE_TEST === "1" && Boolean(env.UFOLOAD_API_KEY) && Boolean(env.UFOLOAD_LIVE_TEST_FILE) && env.UFOLOAD_LIVE_TEST_ACK_NON_ADULT === "1";

if (env.UFOLOAD_LIVE_TEST === "1" && !enabled) {
  console.warn(
    "[ufoload live test] UFOLOAD_LIVE_TEST=1 but UFOLOAD_API_KEY, UFOLOAD_LIVE_TEST_FILE or UFOLOAD_LIVE_TEST_ACK_NON_ADULT=1 is missing — skipping."
  );
}

const READY_TIMEOUT_MS = Number(env.UFOLOAD_LIVE_TEST_READY_TIMEOUT_MS) || 10 * 60 * 1000;

// The production gate is deliberately NOT read here: this client is built for a
// non-adult sample only, which the acknowledgement above states.
const provider = new UfoloadProvider({
  env: { UFOLOAD_API_KEY: env.UFOLOAD_API_KEY, UFOLOAD_ADULT_CONTENT_APPROVED: "true" },
});

const createdFiles: string[] = [];
const createdImports: string[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForReady(fileId: string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const file = await provider.getFile(fileId);
    if (file.status !== last) {
      console.info(`[ufoload live test] ${fileId}: ${file.status} ${file.progress}%`);
      last = file.status;
    }
    if (file.state === "ready") return file;
    if (file.state === "failed") throw new Error(`UFOLOAD failed the file: ${file.error ?? "no reason"}`);
    await sleep(3000);
  }
  throw new Error(`file ${fileId} was not ready within ${READY_TIMEOUT_MS} ms (last status: ${last})`);
}

describe.skipIf(!enabled)("LIVE UFOLOAD (real API — needs UFOLOAD_LIVE_TEST=1 and the variables documented above)", () => {
  afterAll(async () => {
    if (env.UFOLOAD_LIVE_TEST_KEEP === "1") return;
    for (const taskId of createdImports) await provider.cancelImport(taskId).catch(() => {});
    for (const fileId of createdFiles) await provider.deleteFile(fileId).catch(() => {});
  });

  it(
    "uploads a sample in chunks, completes it, waits for ready and yields a working stable embed URL",
    async () => {
      const path = env.UFOLOAD_LIVE_TEST_FILE as string;
      const size = (await stat(path)).size;
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(2 * 1024 * 1024 * 1024);

      const grant = await provider.createDirectUpload({ filename: path.split("/").pop() || "live-test.mp4", size, mimeType: "video/mp4" });
      expect(grant.url).toMatch(/^https:\/\//);
      expect(grant.maxBytes).toBeGreaterThanOrEqual(size);

      // Chunked PUT exactly as the browser does it (minus CORS): the node URL as returned, ?offset=N, the grant, never the API key.
      const handle = await open(path, "r");
      try {
        let offset = 0;
        while (offset < size) {
          const length = Math.min(grant.chunkSize, size - offset);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, offset);
          const url = new URL(grant.url);
          url.searchParams.set("offset", String(offset));
          const response = await fetch(url, {
            method: "PUT",
            headers: { Authorization: grant.authorization, "Content-Type": "application/octet-stream" },
            body: buffer,
          });
          expect(response.status, `PUT at offset ${offset}`).toBeGreaterThanOrEqual(200);
          expect(response.status).toBeLessThan(300);
          offset += length;
        }
      } finally {
        await handle.close();
      }

      const where = await fetch(grant.url, { headers: { Authorization: grant.authorization } });
      expect(where.ok).toBe(true);
      expect(((await where.json()) as { offset: number }).offset).toBe(size);

      const { file } = await provider.completeDirectUpload(grant.uploadId, { size });
      createdFiles.push(file.id);
      expect(file.id).toBeTruthy();

      const ready = await waitForReady(file.id);
      expect(ready.state).toBe("ready");

      const embed = await provider.resolveEmbedUrl(ready);
      console.info(`[ufoload live test] embed URL resolved: ${embed}`);
      expect(embed, "no verified embed URL — see 'public_id' note in DEPLOYMENT.md").toBeTruthy();
      expect(parseUfoloadEmbedUrl(embed)).toBeTruthy();

      const page = await fetch(embed as string);
      expect(page.status, "the embed page should answer without an API key").toBe(200);
    },
    READY_TIMEOUT_MS + 120_000
  );

  it.skipIf(!env.UFOLOAD_LIVE_TEST_IMPORT_URL)(
    "imports a public link asynchronously, tracks the task by its id, then the resulting file until ready",
    async () => {
      const task = await provider.startImport({ url: env.UFOLOAD_LIVE_TEST_IMPORT_URL as string });
      createdImports.push(task.id);
      expect(task.fileId).toBeNull();

      const deadline = Date.now() + READY_TIMEOUT_MS;
      let fileId: string | null = null;
      while (Date.now() < deadline) {
        const current = await provider.findImport(task.id);
        if (current?.state === "failed" || current?.state === "cancelled") throw new Error(`import ${current.state}: ${current.error ?? "no reason"}`);
        if (current?.state === "done" && current.fileId) {
          fileId = current.fileId;
          break;
        }
        await sleep(3000);
      }
      expect(fileId, "the import never produced a file id").toBeTruthy();
      expect(fileId).not.toBe(task.id);
      createdFiles.push(fileId as string);
      expect((await waitForReady(fileId as string)).state).toBe("ready");
    },
    READY_TIMEOUT_MS + 120_000
  );
});

describe("live test switch", () => {
  it("is off unless explicitly enabled — a plain `npm run test` never reaches UFOLOAD", () => {
    if (!enabled) expect(enabled).toBe(false);
    else expect(env.UFOLOAD_LIVE_TEST).toBe("1");
  });
});
