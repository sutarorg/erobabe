import { UfoloadError, ufoloadEmbedUrl, ufoloadWatchUrl } from "@/lib/video/ufoload-protocol";

/**
 * Controllable stand-in for the `@/lib/video/ufoload` module.
 *
 * Route tests must not touch the network, but they must still exercise the real
 * flow code (`lib/video/ufoload-flow.ts`) and the real HTTP contract of the
 * routes. The fake therefore keeps the same *class* shape the routes construct
 * (`new UfoloadProvider()`), and each provider method answers from a handler the
 * test installs — including the ability to fail exactly like UFOLOAD would.
 */

type Handler = (...args: any[]) => any;

export const ufoloadMock = {
  /** `isEnabled()` / `assertEnabled()` answer. */
  enabled: true,
  disabledReason: null as string | null,
  /** Per-method answers; anything not installed resolves to `undefined`. */
  handlers: {} as Record<string, Handler>,
  /** Every provider call, in order. */
  calls: [] as Array<{ method: string; args: any[] }>,
};

export function resetUfoloadMock(): void {
  ufoloadMock.enabled = true;
  ufoloadMock.disabledReason = null;
  ufoloadMock.handlers = {};
  ufoloadMock.calls = [];
}

/** Installs the answer for one provider method. */
export function onProvider(method: string, handler: Handler): void {
  ufoloadMock.handlers[method] = handler;
}

/** The recorded arguments of every call to one provider method. */
export function providerCalls(method: string): any[][] {
  return ufoloadMock.calls.filter((call) => call.method === method).map((call) => call.args);
}

const METHODS = [
  "initDirectUpload",
  "getUploadState",
  "completeDirectUpload",
  "cancelDirectUpload",
  "getFile",
  "getFileWithLinks",
  "getFileInfo",
  "deleteFile",
  "renameFile",
  "listFiles",
  "createImport",
  "listImports",
  "findImport",
  "cancelImport",
];

export function buildUfoloadMockModule() {
  class UfoloadProvider {
    name = "ufoload";

    isEnabled(): boolean {
      return ufoloadMock.enabled;
    }

    disabledReason(): string | null {
      return ufoloadMock.enabled ? null : ufoloadMock.disabledReason || "UFOLOAD is not configured";
    }

    assertEnabled(): void {
      if (ufoloadMock.enabled) return;
      throw new UfoloadError(ufoloadMock.disabledReason || "UFOLOAD is not configured", {
        status: 503,
        code: "missing_api_key",
      });
    }

    getEmbedUrl(identifier: string): string {
      return ufoloadEmbedUrl(identifier);
    }

    getPlayableUrl(identifier: string): string {
      return ufoloadWatchUrl(identifier);
    }
  }

  for (const method of METHODS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (UfoloadProvider.prototype as any)[method] = function (...args: any[]) {
      ufoloadMock.calls.push({ method, args });
      const handler = ufoloadMock.handlers[method];
      if (handler) return handler(...args);
      // Sensible defaults for the best-effort calls the flow makes.
      if (method === "renameFile" || method === "cancelDirectUpload" || method === "cancelImport") {
        return Promise.resolve(true);
      }
      return Promise.resolve(undefined);
    };
  }

  return {
    UfoloadProvider,
    requireUfoloadProvider: () => new UfoloadProvider(),
    ufoloadApprovalFlag: () => true,
    ufoloadApiKey: () => "ufo_test_key_0123456789",
    ufoloadDisabledReason: () => ufoloadMock.disabledReason,
    UFOLOAD_REQUEST_TIMEOUT_MS: 15_000,
  };
}
