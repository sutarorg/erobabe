import { describe, it, expect } from "vitest";
import {
  DEFAULT_LINK_BYTES_PER_SECOND,
  clampLinkRate,
  estimateTransferFraction,
  formatBytesPerSecond,
  formatEta,
  ratePerActiveUpload,
  readRememberedLinkRate,
  rememberLinkRate,
} from "@/src/utils/uploadProgress";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

describe("link rate memory", () => {
  it("reports nothing until this browser has measured an upload", () => {
    expect(readRememberedLinkRate(memoryStorage())).toBeNull();
    expect(readRememberedLinkRate(null)).toBeNull();
  });

  it("remembers a measurement for the next upload", () => {
    const storage = memoryStorage();
    expect(rememberLinkRate(4 * 1024 * 1024, storage)).toBe(4 * 1024 * 1024);
    expect(readRememberedLinkRate(storage)).toBe(4 * 1024 * 1024);
  });

  it("smooths a new measurement into the stored one instead of replacing it", () => {
    const storage = memoryStorage();
    rememberLinkRate(2 * 1024 * 1024, storage);
    // 50/50 average: one very fast run cannot move the estimate onto its own.
    expect(rememberLinkRate(10 * 1024 * 1024, storage)).toBe(6 * 1024 * 1024);
    expect(readRememberedLinkRate(storage)).toBe(6 * 1024 * 1024);
  });

  it("ignores impossible measurements and clamped nonsense in storage", () => {
    const storage = memoryStorage();
    expect(rememberLinkRate(0, storage)).toBeNull();
    expect(rememberLinkRate(Number.NaN, storage)).toBeNull();
    storage.setItem("erobabe:upload-link-bytes-per-second", "not-a-number");
    expect(readRememberedLinkRate(storage)).toBeNull();
    storage.setItem("erobabe:upload-link-bytes-per-second", "-5");
    expect(readRememberedLinkRate(storage)).toBeNull();
  });

  it("keeps a rate inside the range a real uplink can be", () => {
    expect(clampLinkRate(0)).toBe(DEFAULT_LINK_BYTES_PER_SECOND);
    expect(clampLinkRate(50)).toBe(128 * 1024);
    expect(clampLinkRate(1024 * 1024 * 1024 * 1024)).toBe(250 * 1024 * 1024);
  });
});

describe("estimated transfer progress", () => {
  it("starts at zero and rises with time", () => {
    const expected = 10_000;
    expect(estimateTransferFraction(0, expected)).toBe(0);
    const a = estimateTransferFraction(1_000, expected);
    const b = estimateTransferFraction(4_000, expected);
    const c = estimateTransferFraction(9_000, expected);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("is about 85% when the expected duration is up, and never claims to be finished", () => {
    expect(estimateTransferFraction(10_000, 10_000)).toBeCloseTo(0.85, 2);
    // Well past the estimate the bar creeps, but a stalled transfer stays short
    // of the end instead of pretending the file is uploaded.
    expect(estimateTransferFraction(600_000, 10_000)).toBeLessThanOrEqual(0.985);
    expect(estimateTransferFraction(600_000, 10_000)).toBeGreaterThan(0.85);
  });

  it("treats missing or nonsensical durations as nothing sent", () => {
    expect(estimateTransferFraction(-1, 1000)).toBe(0);
    expect(estimateTransferFraction(1000, 0)).toBe(0);
    expect(estimateTransferFraction(1000, Number.NaN)).toBe(0);
  });
});

describe("parallel transfers share one uplink", () => {
  it("gives each of the simultaneous uploads an equal share", () => {
    expect(ratePerActiveUpload(6 * 1024 * 1024, 3)).toBe(2 * 1024 * 1024);
    expect(ratePerActiveUpload(6 * 1024 * 1024, 1)).toBe(6 * 1024 * 1024);
    // Never divides by zero or by a fraction of a transfer.
    expect(ratePerActiveUpload(6 * 1024 * 1024, 0)).toBe(6 * 1024 * 1024);
  });
});

describe("upload wording", () => {
  it("formats throughput for humans", () => {
    expect(formatBytesPerSecond(2 * 1024 * 1024)).toBe("2.0 MB/s");
    expect(formatBytesPerSecond(24 * 1024 * 1024)).toBe("24 MB/s");
    expect(formatBytesPerSecond(512 * 1024)).toBe("512 KB/s");
    expect(formatBytesPerSecond(0)).toBe("—");
  });

  it("formats remaining time for humans", () => {
    expect(formatEta(45)).toBe("45s");
    expect(formatEta(200)).toBe("3m 20s");
    expect(formatEta(3900)).toBe("1h 05m");
    expect(formatEta(-1)).toBe("—");
  });
});
