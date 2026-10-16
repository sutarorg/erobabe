import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => {
  const tables: Record<string, any[]> = {
    videos: [],
    video_comments: [],
    anonymous_comment_profiles: [],
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const client = {
    from(table: string) {
      const filters: Array<{ column: string; op: "eq" | "gt"; value: unknown }> = [];
      let action: "select" | "insert" = "select";
      let payload: Record<string, unknown> = {};

      const execute = (single: boolean) => {
        const rows = tables[table] || (tables[table] = []);
        if (action === "insert") {
          const duplicate = table === "anonymous_comment_profiles" && rows.some((row) =>
            row.visitor_hash === payload.visitor_hash ||
            String(row.profile_name).toLowerCase() === String(payload.profile_name).toLowerCase(),
          );
          if (duplicate) return { data: null, error: { code: "23505", message: "duplicate key" } };
          const inserted = { created_at: new Date().toISOString(), ...payload };
          rows.push(inserted);
          return { data: inserted, error: null };
        }

        const matches = rows.filter((row) => filters.every(({ column, op, value }) =>
          op === "eq" ? row[column] === value : (row[column] as any) > (value as any),
        ));
        return { data: single ? matches[0] || null : matches, error: null };
      };

      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push({ column, op: "eq", value }); return query; },
        gt: (column: string, value: unknown) => { filters.push({ column, op: "gt", value }); return query; },
        limit: () => query,
        insert: (value: Record<string, unknown>) => { action = "insert"; payload = value; return query; },
        maybeSingle: () => Promise.resolve(execute(true)),
        single: () => Promise.resolve(execute(true)),
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "post_video_comment") {
        tables.video_comments.push({
          id: `comment-${tables.video_comments.length + 1}`,
          video_id: args.p_video,
          profile_name: args.p_name,
          body: args.p_body,
          visitor_hash: args.p_visitor,
          created_at: new Date().toISOString(),
        });
      }
      return { data: null, error: null };
    },
  };

  const reset = () => {
    for (const rows of Object.values(tables)) rows.splice(0, rows.length);
    tables.videos.push({
      id: "11111111-1111-4111-8111-111111111111",
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
      requires_reupload: false,
    });
    rpcCalls.splice(0, rpcCalls.length);
  };

  return { tables, rpcCalls, client, reset };
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => state.client,
}));

const { POST } = await import("@/app/api/community/route");
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const VISITOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_VISITOR_ID = "33333333-3333-4333-8333-333333333333";

function request(body: Record<string, unknown>, ip = "192.0.2.1") {
  return new NextRequest("https://erobabe.test/api/community", {
    method: "POST",
    headers: {
      origin: "https://erobabe.test",
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  state.reset();
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-supabase-secret");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "Professor Picklewhiskers" } }] }),
  }));
});

describe("community comments API", () => {
  it("creates a unique AI username once per visitor and returns it for local storage", async () => {
    const firstResponse = await POST(request({
      videoId: VIDEO_ID,
      visitorId: VISITOR_ID,
      // A client-supplied name is ignored; the server owns the username.
      name: "Somebody Else 123456ABCDEF",
      body: "A first comment",
    }));
    const first = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(first.name).toMatch(/^Professor Picklewhiskers [0-9A-F]{12}$/);
    expect(state.tables.anonymous_comment_profiles).toHaveLength(1);
    expect(state.tables.anonymous_comment_profiles[0].visitor_hash).not.toBe(VISITOR_ID);
    expect(state.tables.video_comments[0].profile_name).toBe(first.name);
    expect(fetch).toHaveBeenCalledOnce();

    const repeatResponse = await POST(request({ videoId: VIDEO_ID, visitorId: VISITOR_ID, body: "Another comment" }, "192.0.2.2"));
    const repeat = await repeatResponse.json();
    expect(repeatResponse.status).toBe(200);
    expect(repeat.name).toBe(first.name);
    expect(fetch).toHaveBeenCalledOnce();

    const otherResponse = await POST(request({ videoId: VIDEO_ID, visitorId: OTHER_VISITOR_ID, body: "A different visitor" }, "192.0.2.3"));
    const other = await otherResponse.json();
    expect(otherResponse.status).toBe(200);
    expect(other.name).not.toBe(first.name);
    expect(state.tables.anonymous_comment_profiles).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not invoke AI for anonymous likes", async () => {
    const response = await POST(request({ videoId: VIDEO_ID, visitorId: VISITOR_ID, liked: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(state.rpcCalls[0].name).toBe("set_video_like");
  });
});
