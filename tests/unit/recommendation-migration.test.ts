// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const VIDEO = "11111111-1111-4111-8111-111111111111";
const CATEGORY = "22222222-2222-4222-8222-222222222222";
const VIEWER = "a".repeat(64);
const CORRELATION = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.categories(id uuid primary key);
    insert into categories values ('${CATEGORY}');
    create table public.videos(
      id uuid primary key, category_id uuid references categories(id), status text, visibility text,
      rights_status text, moderation_status text, requires_reupload boolean, playable_url text,
      embed_url text, provider text, provider_file_id text, bunny_library_id text, like_count bigint not null default 0,
      published_at timestamptz
    );
    insert into videos(id,category_id,status,visibility,rights_status,moderation_status,requires_reupload,playable_url,embed_url,provider,provider_file_id,bunny_library_id) values ('${VIDEO}','${CATEGORY}','published','public','cleared','approved',false,null,'https://player.example/embed/1','embed','1',null);
    create table public.video_tags(video_id uuid, tag_id uuid);
  `);
  await db.exec(readFileSync("supabase/migrations/00000000000024_recommendations.sql", "utf8"));
}, 30000);
afterAll(() => db.close());

describe("recommendation data migration and RLS", () => {
  it("keeps profile, feedback, and event tables private to trusted server code", async () => {
    await db.exec("set role anon");
    try { await expect(db.query("select * from recommendation_events")).rejects.toThrow(/permission denied/); }
    finally { await db.exec("reset role"); }
    await db.exec("set role authenticated");
    try { await expect(db.query("insert into recommendation_feedback(viewer_hash,video_id,feedback) values($1,$2,'interested')", [VIEWER, VIDEO])).rejects.toThrow(/permission denied|row-level security/); }
    finally { await db.exec("reset role"); }
  });

  it("enforces consent and eligible playable video requirements in trusted feedback writes", async () => {
    await expect(db.query("select set_recommendation_feedback($1,$2,$3)", [VIEWER, VIDEO, "interested"])).rejects.toThrow(/consent required/);
    await db.query("insert into recommendation_preferences(viewer_hash) values($1)", [VIEWER]);
    await db.query("select set_recommendation_feedback($1,$2,$3)", [VIEWER, VIDEO, "interested"]);
    await db.query("select set_recommendation_feedback($1,$2,$3)", [VIEWER, VIDEO, "not_interested"]);
    expect((await db.query("select feedback from recommendation_feedback where viewer_hash=$1", [VIEWER])).rows).toEqual([{ feedback: "not_interested" }]);
    await db.query("update videos set visibility='private' where id=$1", [VIDEO]);
    await expect(db.query("select set_recommendation_feedback($1,$2,$3)", [VIEWER, VIDEO, "interested"])).rejects.toThrow(/unavailable/);
  });

  it("records idempotently and enforces event surface, type, and correlation context", async () => {
    await db.query("insert into recommendation_preferences(viewer_hash) values($1) on conflict do nothing", [VIEWER]);
    await db.query("update videos set visibility='public' where id=$1", [VIDEO]);
    const args = [VIEWER, VIDEO, "impression", "recommended", 0, "erobabe-rec-v1", CORRELATION, "impression-key-1"];
    expect((await db.query<{ recorded: boolean }>("select record_recommendation_event($1,$2,$3,$4,$5,$6,$7,$8) as recorded", args)).rows[0].recorded).toBe(true);
    expect((await db.query<{ recorded: boolean }>("select record_recommendation_event($1,$2,$3,$4,$5,$6,$7,$8) as recorded", args)).rows[0].recorded).toBe(false);
    expect((await db.query<{ count: number }>("select count(*)::int as count from recommendation_events")).rows[0].count).toBe(1);
  });
});
