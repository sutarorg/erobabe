import { StreamtapeError, streamtapeEmbedUrl } from "@/lib/video/streamtape-protocol";

/**
 * Controllable stand-in for the `@/lib/video/streamtape` module.
 *
 * Route tests must not touch the network, but they must still exercise the real
 * flow code (`lib/video/streamtape-flow.ts`) and the real HTTP contract of the
 * routes. The fake keeps the same *class* shape the routes construct
 * (`new StreamtapeProvider()`); each provider method answers from a handler the
 * test installs — including failing exactly like Streamtape would.
 *
 * Nothing here is a substitute for `tests/live/streamtape.live.test.ts`.
 */

type Handler = (...args: any[]) => any;

export const streamtapeMock = {
  enabled: true,
  disabledReason: null as string | null,
  relay: "https://relay.example.com" as string | null,
  handlers: {} as Record<string, Handler>,
  calls: [] as Array<{ method: string; args: any[] }>,
};

export function resetStreamtapeMock(): void {
  streamtapeMock.enabled = true;
  streamtapeMock.disabledReason = null;
  streamtapeMock.relay = "https://relay.example.com";
  streamtapeMock.handlers = {};
  streamtapeMock.calls = [];
}

export function onProvider(method: string, handler: Handler): void {
  streamtapeMock.handlers[method] = handler;
}

export function providerCalls(method: string): any[][] {
  return streamtapeMock.calls.filter((call) => call.method === method).map((call) => call.args);
}

const METHODS = [
  "getUploadUrl",
  "fetchFileInfo",
  "getFileInfo",
  "listFolder",
  "listRunningConverts",
  "listFailedConverts",
  "getSplashUrl",
  "renameFile",
  "deleteFile",
  "addRemoteUpload",
  "getRemoteStatus",
  "removeRemoteUpload",
  "checkAccount",
];

export function buildStreamtapeMockModule() {
  class StreamtapeProvider {
    name = "streamtape";

    isEnabled(): boolean {
      return streamtapeMock.enabled;
    }

    disabledReason(): string | null {
      return streamtapeMock.enabled ? null : streamtapeMock.disabledReason || "Streamtape is not configured";
    }

    assertEnabled(): void {
      if (streamtapeMock.enabled) return;
      throw new StreamtapeError(streamtapeMock.disabledReason || "Streamtape is not configured", {
        status: 503,
        code: "missing_credentials",
      });
    }

    assertRelayConfigured(): string {
      if (streamtapeMock.relay) return streamtapeMock.relay;
      throw new StreamtapeError("STREAMTAPE_RELAY_URL is not set", { status: 503, code: "missing_relay" });
    }

    getEmbedUrl(fileId: string): string {
      return streamtapeEmbedUrl(fileId);
    }

    getPlayableUrl(fileId: string): string {
      return streamtapeEmbedUrl(fileId);
    }
  }

  for (const method of METHODS) {
    (StreamtapeProvider.prototype as any)[method] = function (...args: any[]) {
      streamtapeMock.calls.push({ method, args });
      const handler = streamtapeMock.handlers[method];
      if (handler) return handler(...args);
      if (method === "renameFile" || method === "removeRemoteUpload") return Promise.resolve(true);
      if (method === "listFolder" || method === "listRunningConverts" || method === "listFailedConverts") return Promise.resolve([]);
      if (method === "getSplashUrl") return Promise.resolve(null);
      return Promise.resolve(undefined);
    };
  }

  return {
    StreamtapeProvider,
    requireStreamtapeProvider: () => new StreamtapeProvider(),
    streamtapeApprovalFlag: () => true,
    streamtapeCredentials: () => ({ login: "login-test-abcdef", key: "key-test-0123456789" }),
    streamtapeMaxUploadBytes: () => 5 * 1024 * 1024 * 1024,
    streamtapeFolderId: () => null,
    streamtapeRelayUrl: () => streamtapeMock.relay,
    streamtapeRelaySecret: () => "relay-secret-0123456789abcdef",
    extraUploadHostSuffixes: () => [],
    DEFAULT_MAX_UPLOAD_BYTES: 15 * 1024 * 1024 * 1024,
  };
}
