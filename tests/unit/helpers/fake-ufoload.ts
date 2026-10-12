/**
 * An in-memory stand-in for the UFOLOAD REST API (and the one papi call the app
 * makes), written from UFOLOAD's published OpenAPI contract
 * (https://ufoload.com/api/openapi.json, https://ufoload.com/api/openapi-papi.json).
 *
 * ⚠ This is a MOCK. Every response shape here comes from the OpenAPI schemas and
 * examples, not from a live capture, so tests that use it prove the app follows
 * the documented contract — they are not proof that a real upload, encode and
 * playback works. That is what the live smoke test in DEPLOYMENT.md is for.
 */

import { vi } from "vitest";

export const TEST_API_KEY = "ufo_TESTKEY_never_a_real_key_0123456789abcdef";

/** The papi `FileInfo` example from the OpenAPI document. */
export const PAPI_EXAMPLE = {
  filecode: "gi4o0tlro01",
  protected_embed: "https://ufoload.com/e/gi4o0tlro01",
  protected_dl: "https://ufoload.com/dl/gi4o0tlro01",
};

export interface RecordedCall {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export interface FakeFile {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "queued" | "processing" | "ready" | "failed";
  progress: number;
  error?: string | null;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  max_quality?: number | null;
  /** When set, the REST file object carries it (the OpenAPI does not list it). */
  public_id?: string;
  /** What papi `file/info` returns as `filecode` (omit to make papi answer 404). */
  papiFilecode?: string;
}

export interface FakeUpload {
  id: string;
  filename: string;
  size: number;
  state: "pending" | "completing" | "completed" | "failed" | "aborted";
  fileId?: string;
}

export interface FakeImport {
  id: string;
  url: string;
  name: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  error?: string;
  file_id?: string;
}

type Reply = { status: number; json?: unknown; text?: string; headers?: Record<string, string>; delayMs?: number; hang?: boolean };

interface Override {
  match: (call: RecordedCall) => boolean;
  reply: Reply | (() => Reply);
  times: number;
}

export interface FakeUfoloadOptions {
  chunkSize?: number;
  maxBytes?: number;
  maxActiveImports?: number;
  nodeUrl?: (uploadId: string) => string;
}

export function createFakeUfoload(options: FakeUfoloadOptions = {}) {
  const calls: RecordedCall[] = [];
  const overrides: Override[] = [];
  const files = new Map<string, FakeFile>();
  const uploads = new Map<string, FakeUpload>();
  const imports: FakeImport[] = [];
  let counter = 0;

  const chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024 * 1024;
  const maxActiveImports = options.maxActiveImports ?? 10;
  const nodeUrl = options.nodeUrl ?? ((id: string) => `https://upload.ufoload.com/07/_node/v1/ingest/${id}`);

  const nextId = (prefix: string) => `${prefix}${String(++counter).padStart(4, "0")}`;
  const ulid = () => `01J9ZQ8W5N3X7K2M4P${String(++counter).padStart(8, "0")}`.slice(0, 26);

  function json(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
    return { status, json: body, headers };
  }
  function error(status: number, code: string, message: string, headers: Record<string, string> = {}): Reply {
    return json(status, { error: { code, message, request_id: "req_test" } }, headers);
  }

  function restFile(file: FakeFile) {
    return {
      id: file.id,
      name: file.name,
      size: file.size,
      mime_type: "video/mp4",
      status: file.status,
      visibility: "public",
      progress: file.progress,
      duration_ms: file.duration_ms ?? null,
      width: file.width ?? null,
      height: file.height ?? null,
      max_quality: file.max_quality ?? null,
      views: 0,
      error: file.error ?? null,
      // Signed, expiring link: the app must never store this.
      poster: `https://cdn.ufoload.com/p/${file.id}.jpg?sig=EXPIRING_SIGNATURE&exp=1`,
      folder_id: null,
      created_at: "2026-10-12T10:00:00Z",
      updated_at: "2026-10-12T10:00:01Z",
      ...(file.public_id ? { public_id: file.public_id } : {}),
    };
  }

  function importBody(task: FakeImport) {
    return {
      id: task.id,
      url: task.url,
      name: task.name,
      status: task.status,
      progress: task.progress,
      ...(task.error ? { error: task.error } : {}),
      ...(task.file_id ? { file_id: task.file_id } : {}),
      created_at: "2026-10-12T10:00:00Z",
    };
  }

  function route(call: RecordedCall): Reply {
    const { method, path, host } = call;
    const bearer = call.headers.authorization;
    if (!bearer || bearer !== `Bearer ${TEST_API_KEY}`) {
      return host === "api.ufoload.com" ? json(401, { msg: "Invalid API key", status: 401 }) : error(401, "unauthorized", "Missing or invalid API key");
    }

    // ---- papi: GET /file/info?file_code=
    if (host === "api.ufoload.com") {
      if (method === "GET" && path === "/file/info") {
        const code = new URL(call.url).searchParams.get("file_code") || "";
        const file = files.get(code);
        if (!file || !file.papiFilecode) return json(404, { msg: "File not found", status: 404 });
        return json(200, {
          msg: "OK",
          status: 200,
          result: [
            {
              filecode: file.papiFilecode,
              title: file.name,
              status: file.status,
              canplay: file.status === "ready",
              protected_embed: `https://ufoload.com/e/${file.papiFilecode}`,
              protected_dl: `https://ufoload.com/dl/${file.papiFilecode}`,
            },
          ],
        });
      }
      return json(404, { msg: "Unknown papi route", status: 404 });
    }

    // ---- REST v1
    if (method === "POST" && path === "/api/v1/files/uploads") {
      const body = call.body || {};
      if (typeof body.filename !== "string" || !Number.isInteger(body.size)) return error(400, "invalid", "filename and size are required");
      if (body.size > maxBytes) return error(413, "too_large", "File too large for the plan");
      const id = nextId("upl_");
      uploads.set(id, { id, filename: body.filename, size: body.size, state: "pending" });
      return json(201, {
        upload_id: id,
        url: nodeUrl(id),
        grant: `grant_${id}`,
        authorization: `UfoGrant grant_${id}`,
        chunk_size: chunkSize,
        max_bytes: maxBytes,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }

    let match = path.match(/^\/api\/v1\/files\/uploads\/([^/]+)\/complete$/);
    if (match && method === "POST") {
      const upload = uploads.get(match[1]);
      if (!upload) return error(404, "not_found", "Upload not found");
      if (upload.fileId) return json(200, { file: restFile(files.get(upload.fileId) as FakeFile), duplicate: false });
      const expectedSize = call.body?.size;
      if (expectedSize !== undefined && expectedSize !== upload.size) return error(409, "size_mismatch", "Received size differs");
      const file: FakeFile = { id: ulid(), name: upload.filename, size: upload.size, status: "queued", progress: 0 };
      files.set(file.id, file);
      upload.state = "completed";
      upload.fileId = file.id;
      return json(201, { file: restFile(file), duplicate: false });
    }
    match = path.match(/^\/api\/v1\/files\/uploads\/([^/]+)$/);
    if (match) {
      const upload = uploads.get(match[1]);
      if (!upload) return error(404, "not_found", "Upload not found");
      if (method === "GET") return json(200, { state: upload.state, ...(upload.fileId ? { file_id: upload.fileId } : {}) });
      if (method === "DELETE") {
        if (upload.state === "completed" || upload.state === "completing") return error(409, "conflict", "Upload is finishing");
        upload.state = "aborted";
        return { status: 204 };
      }
    }

    if (method === "POST" && path === "/api/v1/files/import") {
      const body = call.body || {};
      if (typeof body.url !== "string") return error(400, "invalid_url", "Bad link");
      const active = imports.filter((task) => task.status === "queued" || task.status === "running").length;
      if (active >= maxActiveImports) return error(409, "too_many_imports", "Too many active imports");
      const task: FakeImport = {
        id: nextId("imp_"),
        url: body.url,
        name: body.name || body.url.split("/").pop() || "video",
        status: "queued",
        progress: 0,
      };
      imports.push(task);
      return json(202, { import: importBody(task) });
    }
    if (method === "GET" && path === "/api/v1/files/import") {
      return json(200, { items: imports.map(importBody) });
    }
    match = path.match(/^\/api\/v1\/files\/import\/([^/]+)$/);
    if (match && method === "DELETE") {
      const task = imports.find((candidate) => candidate.id === match![1]);
      if (!task) return error(404, "not_found", "Import not found");
      if (task.status === "queued" || task.status === "running") task.status = "cancelled";
      return { status: 204 };
    }

    match = path.match(/^\/api\/v1\/files\/([^/]+)$/);
    if (match) {
      const file = files.get(match[1]);
      if (method === "GET") {
        if (!file) return error(404, "not_found", "File not found");
        return json(200, {
          file: restFile(file),
          links: {
            playback: `https://cdn.ufoload.com/h/${file.id}/master.m3u8?sig=EXPIRING_SIGNATURE&exp=1`,
            poster: `https://cdn.ufoload.com/p/${file.id}.jpg?sig=EXPIRING_SIGNATURE&exp=1`,
            expires_at: "2026-10-12T16:00:00Z",
          },
        });
      }
      if (method === "DELETE") {
        if (!file) return error(404, "not_found", "File not found");
        files.delete(file.id);
        return { status: 204 };
      }
    }
    return error(404, "not_found", `No route for ${method} ${path}`);
  }

  async function handle(input: unknown, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit | undefined).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    let body: any = undefined;
    if (typeof init.body === "string" && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { method: (init.method || "GET").toUpperCase(), url: url.toString(), host: url.host, path: url.pathname, headers, body };
    calls.push(call);

    const overrideIndex = overrides.findIndex((entry) => entry.match(call));
    let reply: Reply;
    if (overrideIndex >= 0) {
      const entry = overrides[overrideIndex];
      reply = typeof entry.reply === "function" ? entry.reply() : entry.reply;
      entry.times -= 1;
      if (entry.times <= 0) overrides.splice(overrideIndex, 1);
    } else {
      reply = route(call);
    }

    if (reply.hang) {
      // Never answers; only the caller's AbortSignal can end it (this is how timeouts are tested).
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    }

    const text = reply.text ?? (reply.json !== undefined ? JSON.stringify(reply.json) : "");
    return new Response(reply.status === 204 ? null : text, {
      status: reply.status,
      headers: { "Content-Type": "application/json", ...(reply.headers || {}) },
    });
  }

  const fetchMock = vi.fn(handle);

  return {
    fetch: fetchMock as unknown as typeof fetch,
    fetchMock,
    calls,
    files,
    uploads,
    imports,
    /** Answers the next `times` calls matching `match` with `reply` instead of the normal route. */
    respondOnce(match: (call: RecordedCall) => boolean, reply: Reply | (() => Reply), times = 1) {
      overrides.push({ match, reply, times });
    },
    /** Convenience: fail the next call to `METHOD path-substring`. */
    failNext(methodAndPath: string, reply: Reply, times = 1) {
      const [method, fragment] = methodAndPath.split(" ");
      overrides.push({ match: (call) => call.method === method && call.url.includes(fragment), reply, times });
    },
    addFile(file: Partial<FakeFile> & { id: string }): FakeFile {
      const full: FakeFile = { name: "video.mp4", size: 1000, status: "queued", progress: 0, ...file };
      files.set(full.id, full);
      return full;
    },
    addImport(task: Partial<FakeImport> & { id: string }): FakeImport {
      const full: FakeImport = { url: "https://cdn.example.com/video.mp4", name: "video.mp4", status: "queued", progress: 0, ...task };
      imports.push(full);
      return full;
    },
    error,
    json,
  };
}

export type FakeUfoload = ReturnType<typeof createFakeUfoload>;
