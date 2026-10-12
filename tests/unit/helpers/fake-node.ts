/**
 * A scripted stand-in for UFOLOAD's upload node, written from the OpenAPI
 * description of `POST /api/v1/files/uploads`:
 *
 *   PUT {url}?offset=N   with `Authorization: UfoGrant …`; the offset must equal
 *                        what the node has already accepted
 *   GET {url}            → {"offset": N}
 *
 * ⚠ A MOCK of the documented protocol — it proves the browser code follows the
 * contract, not that a real node accepts the request (CORS, real grants and
 * real limits are covered by the live smoke test in DEPLOYMENT.md).
 */

import { vi } from "vitest";

export type NodeBehavior =
  | { type: "ok" }
  | { type: "ok-offset"; offset: number }
  /** Applies the chunk but answers `{offset: <where the chunk started>}` — the docs do not define the PUT body. */
  | { type: "ok-start-offset" }
  | { type: "status"; status: number }
  | { type: "network" }
  /** The node stores the chunk, then the connection drops before the response (the nasty one). */
  | { type: "applied-then-network" }
  | { type: "hang" };

export interface NodeRequest {
  method: string;
  url: string;
  offsetParam: number | null;
  headers: Record<string, string>;
  size: number | null;
}

export interface FakeNodeOptions {
  /** The grant the node accepts. */
  authorization?: string;
  /** Bytes already held (a resumed upload). */
  accepted?: number;
  /** `ok` answers carry `{offset}` in the body when true (the docs do not say whether the node echoes it). */
  echoOffset?: boolean;
  /** How many `onprogress` events each PUT emits before its response. */
  progressSteps?: number;
  /**
   * When set, only requests to this host are treated as node traffic; PUTs to any
   * other host (a Supabase signed thumbnail upload, say) succeed and are recorded
   * in `node.passthrough`.
   */
  nodeHost?: string;
}

export function createFakeNode(options: FakeNodeOptions = {}) {
  const node = {
    authorization: options.authorization ?? "UfoGrant test-grant",
    accepted: options.accepted ?? 0,
    echoOffset: options.echoOffset ?? false,
    progressSteps: options.progressSteps ?? 2,
    nodeHost: options.nodeHost ?? null,
    /** Non-node PUTs (when `nodeHost` is set). */
    passthrough: [] as Array<{ method: string; url: string }>,
    requests: [] as NodeRequest[],
    /** Offsets of the PUTs the node actually applied, in order. */
    applied: [] as Array<{ offset: number; length: number }>,
    queue: [] as NodeBehavior[],
    getQueue: [] as Array<{ status: number } | { network: true }>,
    /** Progress events seen by the page, per PUT, as reported by the XHR. */
    xhrInstances: [] as any[],
  };

  function authorizedHeader(headers: Record<string, string>) {
    return headers.authorization === node.authorization;
  }

  class FakeNodeXhr {
    upload: { onprogress: null | ((event: any) => void) } = { onprogress: null };
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    onabort: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    status = 0;
    responseText = "";
    withCredentials = false;
    method = "";
    url = "";
    headersSet: Array<[string, string]> = [];
    aborted = false;
    private timers: Array<ReturnType<typeof setTimeout>> = [];

    constructor() {
      node.xhrInstances.push(this);
    }

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headersSet.push([name, value]);
    }

    get headers(): Record<string, string> {
      return Object.fromEntries(this.headersSet.map(([name, value]) => [name.toLowerCase(), value]));
    }

    abort() {
      if (this.aborted) return;
      this.aborted = true;
      for (const timer of this.timers) clearTimeout(timer);
      queueMicrotask(() => this.onabort?.());
    }

    send(body: { size: number }) {
      if (node.nodeHost && new URL(this.url).host !== node.nodeHost) {
        node.passthrough.push({ method: this.method, url: this.url });
        this.timers.push(setTimeout(() => !this.aborted && this.respond(200, ""), 1));
        return;
      }
      const offsetParam = Number(new URL(this.url).searchParams.get("offset"));
      node.requests.push({
        method: this.method,
        url: this.url,
        offsetParam: Number.isFinite(offsetParam) ? offsetParam : null,
        headers: this.headers,
        size: body.size,
      });

      const behavior = node.queue.shift() ?? { type: "ok" as const };
      const size = body.size;

      const finish = () => {
        if (this.aborted) return;
        if (!authorizedHeader(this.headers)) return this.respond(401, "");
        if (behavior.type === "hang") return;
        if (behavior.type === "network") return void this.onerror?.();
        if (behavior.type === "status") return this.respond(behavior.status, JSON.stringify({ error: "scripted" }));

        // From here the node would really store the bytes (when the offset lines up).
        if (offsetParam !== node.accepted) return this.respond(409, JSON.stringify({ offset: node.accepted }));
        node.applied.push({ offset: offsetParam, length: size });
        node.accepted += size;
        if (behavior.type === "applied-then-network") return void this.onerror?.();
        if (behavior.type === "ok-start-offset") return this.respond(200, JSON.stringify({ offset: offsetParam }));
        if (behavior.type === "ok-offset") {
          // A node that accepts only part of the chunk.
          node.accepted = behavior.offset;
          return this.respond(200, JSON.stringify({ offset: behavior.offset }));
        }
        return this.respond(200, node.echoOffset ? JSON.stringify({ offset: node.accepted }) : "");
      };

      // Emit upload progress, then the response, each on its own task.
      const steps = Math.max(1, node.progressSteps);
      for (let step = 1; step <= steps; step++) {
        this.timers.push(
          setTimeout(() => {
            if (this.aborted) return;
            this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor((size * step) / steps), total: size });
          }, step)
        );
      }
      this.timers.push(setTimeout(finish, steps + 1));
    }

    private respond(status: number, text: string) {
      this.status = status;
      this.responseText = text;
      this.onload?.();
    }
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit | undefined).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    node.requests.push({ method: (init?.method || "GET").toUpperCase(), url, offsetParam: null, headers, size: null });

    const scripted = node.getQueue.shift();
    if (scripted && "network" in scripted) throw new TypeError("Failed to fetch");
    if (scripted) return new Response(JSON.stringify({ error: "scripted" }), { status: scripted.status });
    if (!authorizedHeader(headers)) return new Response("", { status: 401 });
    return new Response(JSON.stringify({ offset: node.accepted }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  return {
    node,
    Xhr: FakeNodeXhr,
    createXhr: () => new FakeNodeXhr() as unknown as XMLHttpRequest,
    fetch: fetchMock as unknown as typeof fetch,
    fetchMock,
    /** Script the next PUTs. */
    script(...behaviors: NodeBehavior[]) {
      node.queue.push(...behaviors);
    },
    /** Script the next `GET {url}` offset queries. */
    scriptGet(...replies: Array<{ status: number } | { network: true }>) {
      node.getQueue.push(...replies);
    },
    puts: () => node.requests.filter((request) => request.method === "PUT"),
    gets: () => node.requests.filter((request) => request.method === "GET"),
  };
}

export type FakeNode = ReturnType<typeof createFakeNode>;

/** A file that reports a huge size without allocating it: the uploader only needs `size` and `slice`. */
export function virtualFile(size: number): { size: number; slice(start: number, end: number): Blob } {
  return {
    size,
    slice(start: number, end: number) {
      return { size: Math.max(0, Math.min(end, size) - start) } as unknown as Blob;
    },
  };
}
