// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/00000000000011_filekosh_uploads.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("forward FileKosh migration on an embedded PostgreSQL schema fixture", () => {
  it("preserves legacy rows, restricts recovery data, and atomically finalizes once", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create table profiles (id uuid primary key);
        create table categories (id uuid primary key);
        create table videos (id uuid primary key, slug text unique, title text, category_id uuid,
          provider text check (provider in ('streamtape','direct_url','embed')), provider_file_id text,
          provider_public_id text, embed_url text, playable_url text, thumbnail_url text,
          duration_seconds int, status text, visibility text, rights_status text, moderation_status text,
          published_at timestamptz, created_by uuid, updated_by uuid);
        create table upload_jobs (id bigint generated always as identity primary key, video_id uuid,
          file_name text, file_size bigint, provider text default 'streamtape', provider_file_id text,
          provider_upload_id text unique, status text, progress int, created_by uuid);
        insert into profiles values ('11111111-1111-4111-8111-111111111111');
        insert into videos (id, provider, slug, title) values ('99999999-9999-4999-8999-999999999999', 'streamtape', 'historic', 'Historic');
      `);
      await db.exec(migration);
      expect(
        (await db.query("select provider, slug, title from videos")).rows,
      ).toEqual([
        { provider: "streamtape", slug: "historic", title: "Historic" },
      ]);
      await db.exec(`set role anon`);
      await expect(db.query("select * from filekosh_uploads")).rejects.toThrow(
        /permission denied/,
      );
      await db.exec("reset role");
      await db.exec(`insert into filekosh_uploads (id,created_by,title,original_name,mime_type,size_bytes,provider_id,provider_slug,state)
        values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Clip','clip.mp4','video/mp4',5,'provider','slug','uploading')`);
      const finish =
        "select finish_filekosh_upload('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','https://filekosh.com/embed/returned','https://filekosh.com/w/slug',null,10) as result";
      await expect(db.query(finish)).rejects.toThrow(/not confirmed/);
      await db.exec("update filekosh_uploads set state='confirming'");
      const first = await db.query(finish);
      const second = await db.query(finish);
      expect(first.rows).toEqual(second.rows);
      expect(
        (
          await db.query(
            "select count(*)::int as count from videos where provider='filekosh'",
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
      expect(
        (await db.query("select count(*)::int as count from upload_jobs")).rows,
      ).toEqual([{ count: 1 }]);
      expect(
        (await db.query("select state, upload_url from filekosh_uploads")).rows,
      ).toEqual([{ state: "completed", upload_url: null }]);
      expect(
        (
          await db.query(
            "select playable_url, status, visibility from videos where provider='filekosh'",
          )
        ).rows,
      ).toEqual([
        { playable_url: null, status: "published", visibility: "public" },
      ]);
    } finally {
      await db.close();
    }
  }, 30000);
});
