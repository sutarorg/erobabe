import { describe, it, expect } from "vitest";
import { expectedTitlesFor, normalizeTitle, pickConfirmedUpload, type LibraryFile } from "@/lib/video/uqload-match";

function file(fileCode: string, title: string, uploaded: string): LibraryFile {
  return { fileCode, title, uploaded };
}

describe("normalizeTitle", () => {
  it("folds underscores, dots, dashes, pluses and whitespace", () => {
    expect(normalizeTitle("Naked_Girls-Naked.Women+And  Girls")).toBe("naked girls naked women and girls");
  });

  it("strips a video extension", () => {
    expect(normalizeTitle("my trip.mp4")).toBe("my trip");
    expect(normalizeTitle("My_Trip_1_.MKV")).toBe("my trip 1");
  });

  it("handles empty and non-string input", () => {
    expect(normalizeTitle(undefined)).toBe("");
    expect(normalizeTitle("   ")).toBe("");
  });
});

describe("expectedTitlesFor", () => {
  it("returns the normalized title and file name, de-duplicated", () => {
    expect(expectedTitlesFor({ title: "My Trip", fileName: "my_trip.mp4" })).toEqual(["my trip"]);
    expect(expectedTitlesFor({ title: "My Trip", fileName: "other-name.mp4" })).toEqual(["my trip", "other name"]);
  });
});

describe("pickConfirmedUpload", () => {
  it("prefers a new code whose title matches, even when several files are new", () => {
    const picked = pickConfirmedUpload({
      files: [file("aaa", "Unrelated", "2026-10-11 09:58:00"), file("bbb", "My_Trip", "2026-10-11 09:57:00")],
      knownFileCodes: [],
      expectedTitles: ["my trip"],
    });
    expect(picked).toEqual({ fileCode: "bbb", uploaded: "2026-10-11 09:57:00", matchedBy: "title" });
  });

  it("matches the expected title with a duplicate suffix, newest first", () => {
    const picked = pickConfirmedUpload({
      files: [file("first", "My Trip", "2026-10-09 18:57:04"), file("second", "My Trip_1_", "2026-10-09 19:05:10")],
      knownFileCodes: [],
      expectedTitles: ["my trip"],
    });
    expect(picked?.fileCode).toBe("second");
  });

  it("does not treat a longer title as a prefix match", () => {
    const picked = pickConfirmedUpload({
      files: [file("aaa", "444", "2026-10-11 09:58:00"), file("bbb", "Unrelated", "2026-10-11 09:57:00")],
      knownFileCodes: [],
      expectedTitles: ["44"],
      finalAttempt: false,
    });
    // Two new files, no title match, deadline not reached → no guess.
    expect(picked).toBeNull();
  });

  it("returns the only new code even without a title match", () => {
    const picked = pickConfirmedUpload({
      files: [file("old", "Existing", "2026-10-11 09:00:00"), file("new", "Renamed by someone", "2026-10-11 09:58:00")],
      knownFileCodes: ["old"],
      expectedTitles: ["my trip"],
    });
    expect(picked).toEqual({ fileCode: "new", uploaded: "2026-10-11 09:58:00", matchedBy: "only-new" });
  });

  it("falls back to the newest new code at the deadline only with a readable snapshot", () => {
    const files = [file("older", "One", "2026-10-11 09:57:00"), file("newer", "Two", "2026-10-11 09:58:00")];

    expect(
      pickConfirmedUpload({ files, knownFileCodes: [], expectedTitles: ["my trip"], finalAttempt: true })
    ).toEqual({ fileCode: "newer", uploaded: "2026-10-11 09:58:00", matchedBy: "newest-new" });

    expect(
      pickConfirmedUpload({ files, knownFileCodes: null, expectedTitles: ["my trip"], finalAttempt: true })
    ).toBeNull();
  });

  it("returns null when nothing is new", () => {
    expect(
      pickConfirmedUpload({
        files: [file("aaa", "My Trip", "2026-10-11 09:58:00")],
        knownFileCodes: ["aaa"],
        expectedTitles: ["my trip"],
        finalAttempt: true,
      })
    ).toBeNull();
  });

  it("never treats an unreadable snapshot as an empty library", () => {
    // Only one file is listed, but without a baseline it may be an old upload —
    // the title does not match, so nothing may be claimed.
    expect(
      pickConfirmedUpload({
        files: [file("old", "Some other video", "2026-10-11 09:58:00")],
        knownFileCodes: null,
        expectedTitles: ["my trip"],
        finalAttempt: true,
      })
    ).toBeNull();

    // A title match is still trusted without a baseline.
    expect(
      pickConfirmedUpload({
        files: [file("match", "My_Trip", "2026-10-11 09:58:00")],
        knownFileCodes: null,
        expectedTitles: ["my trip"],
      })?.fileCode
    ).toBe("match");
  });
});
