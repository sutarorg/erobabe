import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_KEEPALIVE_INTERVAL_MS,
  uploadFileInChunks,
  type ChunkTransport,
} from "@/src/utils/ufoloadUpload";

/**
 * Tests for the browser-side chunked transfer.
 *
 * The transport is injected, so the behaviour that decides whether a multi-
 * gigabyte video arrives intact — offsets, retries, resume, keep-alive,
 * cancellation, `max_bytes` — is verified without a browser or a network.
 */

type PutCall = { offset: number; length: number };

function fakeFile(size: number, name = "trip.mp4") {
  const blob = new Blob([new Uint8Array(size)], { type: "video/mp4" }) as Blob & { name: string };
  blob.name = name;
  return blob;
}

function createTransport(
  handlers: {
    put?: (call: PutCall, index: number) => void | Promise<void>;
    reconcile?: (index: number) => number | null | Promise<number | null>;
  } = {}
) {
  const puts: PutCall[] = [];
  let reconcileCalls = 0;
  const transport: ChunkTransport & { puts: PutCall[]; keepAlives: number; reconcileCalls: () => number } = {
    puts,
    keepAlives: 0,
    reconcileCalls: () => reconcileCalls,
    async putChunk(offset: number, chunk: Blob) {
      const call = { offset, length: chunk.size };
      puts.push(call);
      await handlers.put?.(call, puts.length - 1);
    },
    async reconcileOffset() {
      const index = reconcileCalls++;
      return (await handlers.reconcile?.(index)) ?? null;
    },
    async keepAlive() {
      transport.keepAlives += 1;
    },
  };
  return transport;
}

describe("uploadFileInChunks", () => {
  it("sends the whole file in exact, contiguous chunks and reports 100% at the end", async () => {
    const transport = createTransport();
    const progress: Array<[number, number, number]> = [];

    const result = await uploadFileInChunks({
      file: fakeFile(100, "clip.mp4"),
      chunkSize: 40,
      transport,
      retryDelayMs: 0,
      onProgress: (uploaded, total, percent) => progress.push([uploaded, total, percent]),
    });

    expect(transport.puts).toEqual([
      { offset: 0, length: 40 },
      { offset: 40, length: 40 },
      { offset: 80, length: 20 },
    ]);
    expect(result).toEqual({ uploadedBytes: 100, totalBytes: 100, resumedFrom: null });
    expect(progress).toEqual([
      [0, 100, 0],
      [40, 100, 40],
      [80, 100, 80],
      [100, 100, 100],
      [100, 100, 100],
    ]);
    // Monotonic: the bar never jumps backwards between chunks.
    const percents = progress.map(([, , percent]) => percent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  it("retries a transient chunk failure at the same offset", async () => {
    const transport = createTransport({
      put: (_call, index) => {
        if (index === 0) throw new Error("The upload node did not accept the bytes");
      },
      reconcile: () => null, // node could not report an offset
    });

    const result = await uploadFileInChunks({
      file: fakeFile(50),
      chunkSize: 25,
      transport,
      retryDelayMs: 0,
      onProgress: () => {},
    });

    expect(transport.puts.map((call) => call.offset)).toEqual([0, 0, 25]);
    expect(transport.reconcileCalls()).toBe(1);
    expect(result.uploadedBytes).toBe(50);
  });

  it("resumes from the offset the node actually accepted", async () => {
    // The node kept the first 12 of the 40 bytes we sent, then the connection died.
    const transport = createTransport({
      put: (call) => {
        if (call.offset === 40) throw new Error("connection reset");
      },
      reconcile: () => 25,
    });
    const resumes: Array<[number, string]> = [];

    const result = await uploadFileInChunks({
      file: fakeFile(100),
      chunkSize: 40,
      transport,
      retryDelayMs: 0,
      onProgress: () => {},
      onResume: (offset, reason) => resumes.push([offset, reason]),
    });

    expect(resumes).toEqual([[25, "connection reset"]]);
    expect(transport.puts.map((call) => [call.offset, call.length])).toEqual([
      [0, 40],
      [40, 40],
      [25, 40],
      [65, 35],
    ]);
    expect(result.resumedFrom).toBe(25);
    expect(result.uploadedBytes).toBe(100);
  });

  it("skips the remaining chunks when the node reports the whole file was accepted", async () => {
    const transport = createTransport({
      put: (call) => {
        if (call.offset === 40) throw new Error("timeout");
      },
      reconcile: () => 100,
    });

    const result = await uploadFileInChunks({
      file: fakeFile(100),
      chunkSize: 40,
      transport,
      retryDelayMs: 0,
      onProgress: () => {},
    });

    expect(result.uploadedBytes).toBe(100);
    expect(transport.puts.map((call) => call.offset)).toEqual([0, 40]);
  });

  it("gives up after the configured number of attempts and surfaces the last error", async () => {
    const transport = createTransport({
      put: () => {
        throw new Error("network unreachable");
      },
      reconcile: () => null,
    });

    await expect(
      uploadFileInChunks({
        file: fakeFile(30),
        chunkSize: 10,
        transport,
        attempts: 3,
        retryDelayMs: 0,
        onProgress: () => {},
      })
    ).rejects.toThrow("network unreachable");

    // Three attempts at the same offset; no offset drift, no duplicate progress.
    expect(transport.puts).toEqual([
      { offset: 0, length: 10 },
      { offset: 0, length: 10 },
      { offset: 0, length: 10 },
    ]);
  });

  it("keeps the upload slot alive during a long transfer", async () => {
    const transport = createTransport();
    let clock = 0;
    const result = await uploadFileInChunks({
      file: fakeFile(150),
      chunkSize: 50,
      transport,
      retryDelayMs: 0,
      keepAliveIntervalMs: 100,
      now: () => (clock += 1000),
      onProgress: () => {},
    });

    // The provider frees an idle slot after 15 minutes; three chunks each a
    // second apart must each be preceded by a ping.
    expect(transport.keepAlives).toBe(3);
    expect(result.uploadedBytes).toBe(150);
  });

  it("does not ping inside the documented window", async () => {
    const transport = createTransport();
    let clock = 0;
    await uploadFileInChunks({
      file: fakeFile(100),
      chunkSize: 50,
      transport,
      retryDelayMs: 0,
      keepAliveIntervalMs: DEFAULT_KEEPALIVE_INTERVAL_MS,
      now: () => (clock += 1000),
      onProgress: () => {},
    });
    expect(transport.keepAlives).toBe(0);
  });

  it("stops immediately when the admin cancels", async () => {
    const controller = new AbortController();
    const transport = createTransport({
      put: (call) => {
        if (call.offset === 50) {
          controller.abort();
          throw new Error("network error");
        }
      },
      reconcile: () => 0,
    });

    await expect(
      uploadFileInChunks({
        file: fakeFile(150),
        chunkSize: 50,
        transport,
        signal: controller.signal,
        retryDelayMs: 0,
        onProgress: () => {},
      })
    ).rejects.toThrow(/cancelled/i);

    // Nothing else was sent after the cancel.
    expect(transport.puts).toEqual([
      { offset: 0, length: 50 },
      { offset: 50, length: 50 },
    ]);
  });

  it("never starts a transfer that was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = createTransport();

    await expect(
      uploadFileInChunks({
        file: fakeFile(100),
        chunkSize: 50,
        transport,
        signal: controller.signal,
        retryDelayMs: 0,
        onProgress: () => {},
      })
    ).rejects.toThrow(/cancelled/i);
    expect(transport.puts).toHaveLength(0);
  });

  it("refuses to send more than the provider's max_bytes and says how far it got", async () => {
    const transport = createTransport();
    await expect(
      uploadFileInChunks({
        file: fakeFile(100),
        chunkSize: 40,
        maxBytes: 50,
        transport,
        retryDelayMs: 0,
        onProgress: () => {},
      })
    ).rejects.toThrow(/Only 50 of 100 bytes/);

    expect(transport.puts.map((call) => [call.offset, call.length])).toEqual([
      [0, 40],
      [40, 10],
    ]);
  });

  it("completes a zero-byte file without sending anything", async () => {
    const transport = createTransport();
    const result = await uploadFileInChunks({
      file: fakeFile(0),
      chunkSize: 10,
      transport,
      retryDelayMs: 0,
      onProgress: () => {},
    });
    expect(transport.puts).toHaveLength(0);
    expect(result.uploadedBytes).toBe(0);
  });

  it("survives a node that cannot answer the resume probe", async () => {
    const transport = createTransport({
      put: (call) => {
        if (call.offset === 0) throw new Error("chunk rejected");
      },
    });
    const reconcile = vi.spyOn(transport, "reconcileOffset").mockRejectedValue(new Error("probe unavailable"));

    await expect(
      uploadFileInChunks({
        file: fakeFile(20),
        chunkSize: 10,
        transport,
        attempts: 2,
        retryDelayMs: 0,
        onProgress: () => {},
      })
    ).rejects.toThrow("chunk rejected");

    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(transport.puts.map((call) => call.offset)).toEqual([0, 0]);
  });
});
