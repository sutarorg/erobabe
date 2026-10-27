// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 26 must remove the upload pipeline without touching historical rows.
 *
 * PGlite runs the real SQL. The fixture below reproduces only the objects the
 * migration reads or rewrites: the `videos` provider check, the upload tables,
 * the guard trigger and the retention trigger added by migrations 12–16.
 */

const db = new PGlite();
const CATEGORY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VIDEO = "11111111-1111-4111-8111-111111111111";

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
      description text,
      category_id uuid references public.categories(id),
      thumbnail_url text,
      provider text not null default 'bunny'
        check (provider in ('uqload','bunny','cloudflare','internal','s3','filekosh','streamtape','ufoload')),
      provider_file_id text,
      bunny_library_id text,
      provider_progress int,
      provider_error text,
      requires_reupload boolean not null default false,
      playable_url text,
      embed_url text,
      duration_seconds int,
      status text not null default 'draft',
      visibility text not null default 'private',
      rights_status text not null default 'pending',
      moderation_status text not null default 'pending',
      view_count int not null default 0,
      published_at timestamptz,
      created_at timestamptz not null default now()
    );

    create unique index videos_bunny_identity_idx on public.videos(bunny_library_id) where bunny_library_id is not null;

    create table public.bunny_uploads (
      id uuid primary key default gen_random_uuid(),
      video_id uuid,
      state text
    );
    create table public.filekosh_uploads (
      id uuid primary key default gen_random_uuid(),
      video_id uuid,
      state text
    );
    create table public.upload_jobs (
      id uuid primary key default gen_random_uuid(),
      state text
    );

    create table public.media_retention (
      id uuid primary key default gen_random_uuid(),
      video_id uuid,
      provider text,
      provider_file_id text,
      bunny_library_id text,
      reason text,
      created_at timestamptz not null default now()
    );

    create function public.finish_bunny_upload(uuid, uuid, text, text, int) returns void language sql as $$ select $$;
    create function public.stage_bunny_upload(uuid, uuid, text, text, text, int, int) returns void language sql as $$ select $$;
    create function public.fail_bunny_upload(uuid, uuid, int) returns void language sql as $$ select $$;
    create function public.publish_reviewed_bunny(uuid, uuid, text, text) returns void language sql as $$ select $$;

    create function public.guard_archived_video() returns trigger language plpgsql as $$
    begin
      if new.bunny_library_id is null then
        raise exception 'archived videos must be re-uploaded';
      end if;
      return new;
    end $$;
    create trigger guard_archived_video before update on public.videos
      for each row when (old.provider = 'archived') execute function public.guard_archived_video();

    create function public.retain_deleted_media() returns trigger language plpgsql as $$
    begin
      insert into public.media_retention(video_id, provider, provider_file_id, bunny_library_id, reason)
      values (old.id, old.provider, old.provider_file_id, old.bunny_library_id, 'deleted');
      return old;
    end $$;
    create trigger retain_deleted_media before delete on public.videos
      for each row execute function public.retain_deleted_media();

    insert into public.categories(id, label, slug) values ('${CATEGORY}', 'Hardcore', 'hardcore');
    insert into public.videos(id, slug, title, category_id, provider, provider_file_id, bunny_library_id, playable_url, status, visibility, rights_status, moderation_status, published_at)
      values ('${VIDEO}', 'legacy-video', 'Legacy video', '${CATEGORY}', 'bunny', 'bunny-1', 'lib-1', 'https://iframe.mediadelivery.net/embed/1', 'published', 'public', 'cleared', 'approved', now());
  `);
  await db.exec(readFileSync("supabase/migrations/00000000000026_damplips_embeds.sql", "utf8"));
}, 60_000);

afterAll(() => db.close());

async function tableExists(name: string) {
  const { rows } = await db.query<{ exists: boolean }>(
    `select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = $1) as exists`,
    [name],
  );
  return rows[0].exists;
}

async function columnExists(table: string, column: string) {
  const { rows } = await db.query<{ exists: boolean }>(
    `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2) as exists`,
    [table, column],
  );
  return rows[0].exists;
}

describe("damplips embeds migration", () => {
  it("drops the upload pipeline", async () => {
    expect(await tableExists("bunny_uploads")).toBe(false);
    expect(await tableExists("filekosh_uploads")).toBe(false);
    expect(await tableExists("upload_jobs")).toBe(false);
    expect(await columnExists("videos", "bunny_library_id")).toBe(false);

    const { rows } = await db.query<{ proname: string }>(
      `select proname from pg_proc where pronamespace = 'public'::regnamespace`,
    );
    expect(rows.map((row) => row.proname)).not.toContain("finish_bunny_upload");
    expect(rows.map((row) => row.proname)).not.toContain("publish_reviewed_bunny");
    expect(rows.map((row) => row.proname)).not.toContain("guard_archived_video");
  });

  it("rewrites retention so deleting an embed keeps an operator record", async () => {
    await db.query("delete from public.videos where id = $1", [VIDEO]);
    const { rows } = await db.query<{ provider: string; provider_file_id: string; reason: string }>(
      "select provider, provider_file_id, reason from public.media_retention",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("bunny");
    expect(rows[0].provider_file_id).toBe("bunny-1");
    expect(rows[0].reason).toMatch(/retained/i);
  });

  it("accepts damplips rows and defaults new rows to damplips", async () => {
    const { rows } = await db.query<{ column_default: string }>(
      `select column_default from information_schema.columns where table_name = 'videos' and column_name = 'provider'`,
    );
    expect(rows[0].column_default).toContain("damplips");

    await db.query(
      `insert into public.videos(slug, title, category_id, provider, provider_file_id, source_name, source_url, playable_url, thumbnail_url, status, visibility, rights_status, moderation_status)
       values ('damplips-video', 'A damplips video', $1, 'damplips', '67284', 'damplips', 'https://www.damplips.com/p/67284/', 'https://video.damplips.com/videos/67284.mp4', 'https://video.damplips.com/pics/67284.jpg', 'published', 'public', 'cleared', 'approved')`,
      [CATEGORY],
    );
    const { rows: saved } = await db.query<{ provider: string; source_name: string }>(
      "select provider, source_name from public.videos where slug = 'damplips-video'",
    );
    expect(saved[0]).toEqual({ provider: "damplips", source_name: "damplips" });

    await expect(
      db.query(
        `insert into public.videos(slug, title, category_id, provider, provider_file_id)
         values ('damplips-video-dupe', 'Another', $1, 'damplips', '67284')`,
        [CATEGORY],
      ),
    ).rejects.toThrow();
  });

  it("keeps historical provider values valid so old rows are not rejected", async () => {
    await db.query(
      `insert into public.videos(slug, title, category_id, provider, provider_file_id)
       values ('historical', 'Historical row', $1, 'streamtape', 'legacy')`,
      [CATEGORY],
    );
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.videos where provider = 'streamtape'",
    );
    expect(rows[0].count).toBe(1);
  });

  it("reports how full each fixed category is", async () => {
    await db.query(
      `insert into public.videos(slug, title, category_id, provider, provider_file_id, playable_url, status, visibility, rights_status, moderation_status, requires_reupload)
       values ('counted', 'Counted video', $1, 'damplips', '90001', 'https://video.damplips.com/videos/90001.mp4', 'published', 'public', 'cleared', 'approved', false)`,
      [CATEGORY],
    );
    const { rows } = await db.query<{ label: string; published_count: number }>(
      "select label, published_count from public.damplips_category_counts order by label",
    );
    expect(rows).toEqual([{ label: "Hardcore", published_count: 2 }]);
  });
});
