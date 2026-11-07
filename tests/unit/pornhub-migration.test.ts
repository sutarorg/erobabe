// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 29 runs for real against PGlite.
 *
 * Two things have to be true on an existing database, not just on a fresh one:
 *
 *  1. historical rows survive untouched — the migration must not rewrite
 *     `provider` on rows imported from the previous source; and
 *  2. `provider = 'pornhub'` is accepted, and the viewkey unique index genuinely
 *     rejects a second row for the same video, because that index is what makes
 *     "no duplicates" a guarantee rather than a promise.
 *
 * The fixture reproduces only the objects the migration reads or replaces: the
 * `videos` provider check and the `categories` table the view joins.
 */

const db = new PGlite();
const MIGRATION = readFileSync(
  "supabase/migrations/00000000000029_pornhub_embeds.sql",
  "utf8",
);

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create table public.categories (
      id uuid primary key default gen_random_uuid(),
      label text not null,
      slug text not null
    );

    create table public.videos (
      id uuid primary key default gen_random_uuid(),
      slug text unique not null,
      title text not null,
      category_id uuid references public.categories(id),
      thumbnail_url text,
      provider text not null default 'damplips'
        check (provider in ('damplips','direct_url','embed','internal','s3','cloudflare','bunny','uqload','filekosh','streamtape','ufoload')),
      provider_file_id text,
      source_name text,
      source_url text,
      playable_url text,
      embed_url text,
      duration_seconds int,
      status text not null default 'draft',
      visibility text not null default 'private',
      rights_status text not null default 'pending',
      moderation_status text not null default 'pending',
      requires_reupload boolean not null default false,
      published_at timestamptz
    );

    insert into public.categories (id, label, slug)
    values ('11111111-1111-4111-8111-111111111111', 'Amateur', 'amateur');

    -- A row imported before this migration, exactly as it would exist today.
    insert into public.videos (slug, title, category_id, provider, provider_file_id, playable_url, status, visibility, rights_status, moderation_status, published_at)
    values (
      'legacy-damplips-video-1',
      'Legacy damplips video',
      '11111111-1111-4111-8111-111111111111',
      'damplips',
      '12345',
      'https://video.damplips.com/video7/717/79.mp4',
      'published', 'public', 'cleared', 'approved', now()
    );
  `);

  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

function insertPornhub(viewkey: string, slug = `pornhub-${viewkey}`) {
  return db.query(
    `insert into public.videos
       (slug, title, category_id, provider, provider_file_id, source_name, embed_url,
        status, visibility, rights_status, moderation_status, published_at)
     values ($1, $2, '11111111-1111-4111-8111-111111111111', 'pornhub', $3, 'pornhub', $4,
             'published', 'public', 'cleared', 'approved', now())`,
    [slug, `Pornhub ${viewkey}`, viewkey, `https://www.pornhub.com/embed/${viewkey}`],
  );
}

describe("migration 29: Pornhub embeds", () => {
  it("gives the operator view a published count per category", async () => {
    const { rows } = await db.query<{ label: string; published_count: number }>(
      "select label, published_count from public.pornhub_category_counts order by label",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Amateur");
    // The legacy damplips row is not a Pornhub row, so it does not count here.
    expect(Number(rows[0].published_count)).toBe(0);
  });

  it("leaves every historical row exactly as it was", async () => {
    const { rows } = await db.query<{ provider: string; provider_file_id: string; source_name: string | null }>(
      "select provider, provider_file_id, source_name from public.videos where slug = 'legacy-damplips-video-1'",
    );
    expect(rows[0]).toEqual({
      provider: "damplips",
      provider_file_id: "12345",
      source_name: null,
    });
  });

  it("accepts the new provider and refuses one that does not exist", async () => {
    await insertPornhub("key000000001");
    const { rows } = await db.query<{ provider: string }>(
      "select provider from public.videos where provider_file_id = 'key000000001'",
    );
    expect(rows[0].provider).toBe("pornhub");

    await expect(insertPornhub("key000000002", "bad-provider")).resolves.toBeTruthy();
    await expect(
      db.query(
        `insert into public.videos (slug, title, provider)
         values ('unknown-provider', 'x', 'not-a-provider')`,
      ),
    ).rejects.toThrow(/videos_provider_check/);
  });

  it("refuses a second row for the same viewkey", async () => {
    await expect(insertPornhub("key000000001", "duplicate-of-key-1")).rejects.toThrow(
      /videos_pornhub_identity_idx|duplicate key/,
    );

    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.videos where provider_file_id = 'key000000001'",
    );
    expect(rows[0].count).toBe(1);
  });

  it("still allows the same identity number under another provider", async () => {
    // The index is scoped to Pornhub rows, so historical providers that reused
    // `provider_file_id` cannot collide with an import.
    await db.query(
      `insert into public.videos (slug, title, provider, provider_file_id)
       values ('legacy-same-id', 'Legacy', 'streamtape', 'key000000001')`,
    );
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.videos where provider_file_id = 'key000000001'",
    );
    expect(rows[0].count).toBe(2);
  });

  it("defaults new rows to the Pornhub provider", async () => {
    const { rows } = await db.query<{ column_default: string }>(
      `select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'videos' and column_name = 'provider'`,
    );
    expect(rows[0].column_default).toContain("pornhub");
  });

  it("is safe to run twice (forward-only, idempotent guards)", async () => {
    // Every statement is either additive or guarded by `if not exists`; a second
    // application must not throw and must not change a single row.
    const before = await db.query<{ count: number }>(
      "select count(*)::int as count from public.videos where provider = 'pornhub'",
    );
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    const after = await db.query<{ count: number }>(
      "select count(*)::int as count from public.videos where provider = 'pornhub'",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
