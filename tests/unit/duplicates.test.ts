import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { describeDuplicate, fileNameOf, findDuplicateVideos, sourceKeyOf } from "@/lib/video/duplicates";

describe("sourceKeyOf / fileNameOf", () => {
  it("drops scheme, www, query, fragment, and lower-cases", () => {
    expect(sourceKeyOf("https://WWW.Cdn.example.com/Media/Clip.MP4?token=abc#t=3")).toBe("cdn.example.com/media/clip.mp4");
    expect(sourceKeyOf("http://cdn.example.com/a.mp4")).toBe("cdn.example.com/a.mp4");
  });

  it("returns the decoded last path segment as the file name", () => {
    expect(fileNameOf("https://a.example/x/Evening%20Velvet.mp4?x=1")).toBe("evening velvet.mp4");
    expect(fileNameOf("https://a.example/")).toBe("");
  });
});

describe("findDuplicateVideos", () => {
  const seed = () =>
    createFakeSupabase({
      videos: [
        {
          id: "v1",
          slug: "evening-in-velvet",
          title: "Evening in Velvet",
          source_key: sourceKeyOf("https://cdn.example.com/media/evening.mp4?sig=1"),
        },
        { id: "v2", slug: "other", title: "Other", source_key: "mirror.example.net/files/solo-night.mp4" },
      ],
    });

  it("matches the same link regardless of query string or case", async () => {
    const { client } = seed();
    const result = await findDuplicateVideos(client as any, ["HTTPS://cdn.example.com/media/evening.mp4?sig=999"]);
    const match = result.get("HTTPS://cdn.example.com/media/evening.mp4?sig=999");
    expect(match).toMatchObject({ videoId: "v1", slug: "evening-in-velvet", reason: "same_link" });
  });

  it("flags the same file name published from another host", async () => {
    const { client } = seed();
    const link = "https://other-host.example.org/clips/solo-night.mp4";
    const result = await findDuplicateVideos(client as any, [link]);
    expect(result.get(link)).toMatchObject({ videoId: "v2", reason: "same_file_name" });
  });

  it("reports nothing for a new link", async () => {
    const { client } = seed();
    const result = await findDuplicateVideos(client as any, ["https://new.example.com/brand-new-clip.mp4"]);
    expect(result.size).toBe(0);
  });

  it("returns an empty map for an empty list without querying", async () => {
    const { client } = seed();
    expect((await findDuplicateVideos(client as any, [])).size).toBe(0);
  });

  it("describes the duplicate for the admin", () => {
    expect(describeDuplicate({ videoId: "v1", slug: "s", title: "T", reason: "same_link" })).toMatch(/same link.*“T”/);
  });
});
