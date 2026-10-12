import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StreamtapeProvider, streamtapeApprovalFlag, streamtapeCredentials } from "@/lib/video/streamtape";
import {
  StreamtapeError,
  assertAllowedUploadHost,
  mapFileInfoReadiness,
  parseNodeUploadResponse,
  redactSecrets,
  streamtapeEmbedUrl,
  type StreamtapeFileInfo,
} from "@/lib/video/streamtape-protocol";

/**
 * LIVE integration tests against the real Streamtape API.
 *
 * Skipped unless `LIVE_STREAMTAPE=1`. Nothing here is mocked. Read
 * `tests/live/README.md` first: the upload test creates a real file in the
 * account (deleted afterwards unless LIVE_STREAMTAPE_KEEP=1).
 *
 *   LIVE_STREAMTAPE=1 STREAMTAPE_LOGIN=... STREAMTAPE_API_KEY=... npm run test:live
 *
 * Optional:
 *   LIVE_STREAMTAPE_FILE=/abs/path/small.mp4    a cleared video you have rights to use
 *                                               (default: a synthetic ffmpeg test pattern)
 *   LIVE_STREAMTAPE_IMPORT_URL=https://.../v.mp4 enables the remote-upload test
 *   LIVE_STREAMTAPE_ORIGIN=https://staging.example  Origin header for the CORS probe
 *   LIVE_STREAMTAPE_KEEP=1                       keep created files (default: delete only those this run created)
 *   STREAMTAPE_FOLDER_ID=...                     upload into this folder
 *
 * Evidence (statuses, field-name result, node response *shape*, CORS headers —
 * never credentials) is written to test-results/streamtape-live-evidence.json.
 *
 * IMPORTANT: a Node-side CORS probe is only a hint. Browsers enforce CORS, so
 * the definitive proof is the gated Playwright acceptance spec.
 */

const enabled = process.env.LIVE_STREAMTAPE === "1";
const keep = process.env.LIVE_STREAMTAPE_KEEP === "1";
const importUrl = process.env.LIVE_STREAMTAPE_IMPORT_URL || "";
const probeOrigin = process.env.LIVE_STREAMTAPE_ORIGIN || "https://erobabe.com";
const describeLive = enabled ? describe : describe.skip;

const secrets = () => [streamtapeCredentials()?.key, streamtapeCredentials()?.login];
const safe = (text: string) => redactSecrets(text, secrets());

const evidence: Record<string, unknown> = { startedAt: new Date().toISOString() };
const createdFileIds: string[] = [];
const createdImportIds: string[] = [];
let provider: StreamtapeProvider;
let fixturePath = "";
let fixtureName = "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A short, non-explicit synthetic test pattern — no third-party content involved. */
function makeFixture(): { path: string; name: string } {
  if (process.env.LIVE_STREAMTAPE_FILE) {
    const path = process.env.LIVE_STREAMTAPE_FILE;
    return { path, name: path.split("/").pop() || "live-test.mp4" };
  }
  const name = `erobabe-live-test-${Date.now()}.mp4`;
  const path = join(tmpdir(), name);
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path],
      { stdio: "ignore" }
    );
  } catch {
    throw new Error("ffmpeg is not available. Install ffmpeg or set LIVE_STREAMTAPE_FILE to an absolute path of a small, cleared video.");
  }
  return { path, name };
}

async function waitForConverted(fileId: string, timeoutMs = 10 * 60 * 1000): Promise<StreamtapeFileInfo> {
  const deadline = Date.now() + timeoutMs;
  let last: StreamtapeFileInfo | null = null;
  const history: string[] = [];
  while (Date.now() < deadline) {
    last = await provider.fetchFileInfo(fileId);
    const state = last ? (mapFileInfoReadiness(last) === "ready" ? "converted" : `not-converted(status ${last.entryStatus})`) : "not-listed";
    if (history[history.length - 1] !== state) history.push(state);
    if (last && mapFileInfoReadiness(last) === "ready") {
      evidence.conversionStateHistory = history;
      return last;
    }
    const failed = (await provider.listFailedConverts()).find((entry) => entry.linkId === fileId);
    if (failed) throw new Error(`Streamtape reported a failed conversion (status "${failed.status}")`);
    await sleep(5000);
  }
  evidence.conversionStateHistory = history;
  throw new Error(`File ${fileId} was not converted within ${Math.round(timeoutMs / 1000)}s (history: ${history.join(" → ")})`);
}

beforeAll(() => {
  if (!enabled) return;
  expect(streamtapeCredentials(), "STREAMTAPE_LOGIN and STREAMTAPE_API_KEY must be set").not.toBeNull();
  provider = new StreamtapeProvider();
});

afterAll(async () => {
  if (!enabled) return;
  evidence.finishedAt = new Date().toISOString();
  evidence.createdFileIds = createdFileIds;
  evidence.kept = keep;
  if (!keep) {
    // Only files THIS run created — never a blanket delete.
    for (const id of createdFileIds) await provider.deleteFile(id).catch(() => false);
    for (const id of createdImportIds) await provider.removeRemoteUpload(id).catch(() => false);
  }
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/streamtape-live-evidence.json", safe(JSON.stringify(evidence, null, 2)));
});

describeLive("Streamtape live API", () => {
  it("authenticates against /account/info without exposing the credentials", async () => {
    const result = await provider.checkAccount();
    evidence.accountCheck = { ok: result.ok, latencyMs: result.latencyMs };
    if (!result.ok) throw new Error(`account/info failed: ${safe(result.error)}`);
    expect(result.ok).toBe(true);
  });

  it("reports the content-policy gate state (informational)", () => {
    evidence.policyGateOpen = streamtapeApprovalFlag();
    expect(typeof evidence.policyGateOpen).toBe("boolean");
  });

  it("rejects bad credentials with an actionable, redacted error", async () => {
    const original = { login: process.env.STREAMTAPE_LOGIN, key: process.env.STREAMTAPE_API_KEY };
    process.env.STREAMTAPE_LOGIN = "invalidlogin000000";
    process.env.STREAMTAPE_API_KEY = "invalidkey000000000";
    try {
      const result = await new StreamtapeProvider().checkAccount();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).not.toContain("invalidkey000000000");
        evidence.badCredentialsMessage = result.error.slice(0, 160);
      }
    } finally {
      process.env.STREAMTAPE_LOGIN = original.login;
      process.env.STREAMTAPE_API_KEY = original.key;
    }
  });

  it("obtains an upload URL on an allowed host", async () => {
    const result = await provider.getUploadUrl();
    expect(() => assertAllowedUploadHost(result.url)).not.toThrow();
    const parsed = new URL(result.url);
    evidence.uploadUrl = { host: parsed.host, pathShape: parsed.pathname.replace(/[A-Za-z0-9_-]{6,}/g, "<id>"), validUntil: result.validUntil };
  });

  it("probes CORS on the upload node (Node-side hint only — the browser spec is authoritative)", async () => {
    const url = (await provider.getUploadUrl()).url;
    const response = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: probeOrigin, "Access-Control-Request-Method": "POST" },
    }).catch((error) => ({ error: String(error) }));
    if ("error" in response) {
      evidence.corsProbe = { error: safe(response.error) };
      return;
    }
    evidence.corsProbe = {
      origin: probeOrigin,
      status: response.status,
      allowOrigin: response.headers.get("access-control-allow-origin"),
      allowMethods: response.headers.get("access-control-allow-methods"),
      conclusion:
        response.headers.get("access-control-allow-origin") === "*" || response.headers.get("access-control-allow-origin") === probeOrigin
          ? "node sent a matching Allow-Origin; still verify in a real browser (response readability)"
          : "NO matching Access-Control-Allow-Origin — browsers cannot read the node response; keep using the relay",
    };
  });

  it("uploads a small real video, captures the node response and a confirmed file id", async () => {
    const fixture = makeFixture();
    fixturePath = fixture.path;
    fixtureName = fixture.name;
    const bytes = await readFile(fixturePath);
    // Which multipart field name does the node accept? The docs' example is
    // `file1`; wrappers use `file`. Every attempt gets a fresh single-use URL.
    const attempts: Array<{ field: string; status: number; shape: string }> = [];
    let accepted: { field: string; body: string } | null = null;
    for (const field of ["file1", "file"]) {
      const { url } = await provider.getUploadUrl();
      const form = new FormData();
      form.append(field, new Blob([bytes], { type: "video/mp4" }), fixtureName);
      const response = await fetch(url, { method: "POST", body: form }).catch(() => null);
      if (!response) {
        attempts.push({ field, status: 0, shape: "network error" });
        continue;
      }
      const body = await response.text();
      attempts.push({ field, status: response.status, shape: safe(body).replace(/[A-Za-z0-9_-]{10,}/g, "<id>").slice(0, 200) });
      if (response.ok) {
        accepted = { field, body };
        break;
      }
    }
    evidence.uploadAttempts = attempts;
    expect(accepted, `node rejected every attempted field name: ${JSON.stringify(attempts)}`).not.toBeNull();
    evidence.acceptedFieldName = accepted!.field;

    const node = parseNodeUploadResponse(accepted!.body);
    evidence.nodeResponseShape = { hasCandidateId: Boolean(node.fileId), status: node.status, sample: safe(accepted!.body).replace(/[A-Za-z0-9_-]{10,}/g, "<id>").slice(0, 200) };

    // Confirm the id server-side exactly like the app does.
    let fileId: string | null = null;
    for (let attempt = 0; attempt < 12 && !fileId; attempt++) {
      if (node.fileId) {
        const info = await provider.fetchFileInfo(node.fileId).catch(() => null);
        if (info && info.sizeBytes === bytes.length) fileId = node.fileId;
      }
      if (!fileId) {
        const files = await provider.listFolder();
        const matches = files.filter((file) => file.name === fixtureName && file.sizeBytes === bytes.length && file.linkId);
        if (matches.length === 1) fileId = matches[0].linkId;
      }
      if (!fileId) await sleep(5000);
    }
    expect(fileId, "could not confirm a file id from the node response or the folder listing").not.toBeNull();
    createdFileIds.push(fileId!);
    evidence.fileId = fileId;
    evidence.idSource = node.fileId === fileId ? "node-response (confirmed via /file/info)" : "folder-listing";

    const info = await waitForConverted(fileId!);
    expect(info.converted).toBe(true);
    evidence.embedUrl = streamtapeEmbedUrl(fileId!);

    const splash = await provider.getSplashUrl(fileId!);
    evidence.splashUrl = splash;
    expect(splash === null || splash.startsWith("https://")).toBe(true);

    const embed = await fetch(streamtapeEmbedUrl(fileId!), { redirect: "follow" });
    evidence.embedHttpStatus = embed.status;
    evidence.embedFrameHeaders = {
      xFrameOptions: embed.headers.get("x-frame-options"),
      csp: embed.headers.get("content-security-policy"),
    };
    expect(embed.status).toBe(200);
  });

  it.runIf(Boolean(importUrl))("imports a public URL through remotedl and follows it to a converted file", async () => {
    const task = await provider.addRemoteUpload(importUrl, { name: `erobabe-live-import-${Date.now()}.mp4` });
    createdImportIds.push(task.id);
    const states: string[] = [];
    const deadline = Date.now() + 10 * 60 * 1000;
    let finished = false;
    while (Date.now() < deadline && !finished) {
      const status = await provider.getRemoteStatus(task.id);
      const label = status?.status || "not-listed";
      if (states[states.length - 1] !== label) states.push(label);
      finished = Boolean(status && ((typeof status.url === "string" && status.url) || (typeof status.extid === "string" && status.extid)));
      if (!finished) await sleep(5000);
    }
    evidence.remoteStatusVocabulary = states;
    expect(finished, `remote task did not finish (states: ${states.join(" → ")})`).toBe(true);
  });

  it("never prints credentials in provider errors", async () => {
    const error = await provider.fetchFileInfo("doesnotexist0000").catch((e) => e);
    if (error instanceof StreamtapeError) {
      const creds = streamtapeCredentials()!;
      expect(error.message).not.toContain(creds.key);
      expect(error.message).not.toContain(creds.login);
    }
  });
});
