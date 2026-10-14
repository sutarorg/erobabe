// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const historical = readFileSync(
  new URL(
    "../../supabase/migrations/00000000000011_filekosh_uploads.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/00000000000012_bunny_stream_uploads.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("forward Bunny migration on PostgreSQL fixture", () => {
  it("preserves archived metadata, denies browser access, and publishes transactionally once", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role;
        create table profiles (id uuid primary key,role text,status text);
        create table categories(id uuid primary key);
        create table videos(id uuid primary key,slug text unique,title text,category_id uuid,provider text constraint videos_provider_check check(provider in ('streamtape','direct_url','embed')),provider_file_id text,provider_public_id text,embed_url text,playable_url text,thumbnail_url text,duration_seconds int,status text,visibility text,rights_status text,moderation_status text,provider_error text,published_at timestamptz,created_by uuid,updated_by uuid);
        create table upload_jobs(id bigint generated always as identity primary key,video_id uuid,file_name text,file_size bigint,provider text default 'streamtape',provider_file_id text,provider_upload_id text unique,status text,progress int,created_by uuid);
        insert into profiles values('11111111-1111-4111-8111-111111111111','admin','active');
        insert into categories values('33333333-3333-4333-8333-333333333333');
        insert into videos(id,provider,slug,title,status,thumbnail_url) values('99999999-9999-4999-8999-999999999999','streamtape','historic','Historic','published','https://example.com/old.jpg');`);
      await db.exec(historical);
      await db.exec(migration);
      expect(
        (
          await db.query(
            "select provider,slug,title,thumbnail_url,status,requires_reupload from videos",
          )
        ).rows,
      ).toEqual([
        {
          provider: "streamtape",
          slug: "historic",
          title: "Historic",
          thumbnail_url: "https://example.com/old.jpg",
          status: "unpublished",
          requires_reupload: true,
        },
      ]);
      await db.exec("set role anon");
      await expect(db.query("select * from bunny_uploads")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("select finish_bunny_upload(null,null,null,null,null)"),
      ).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
      await db.exec(`insert into bunny_uploads(id,created_by,title,original_name,mime_type,size_bytes,category_id,library_id,provider_id,thumbnail_path,state,provider_status)
        values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Clip','clip.mp4','video/mp4',5,'33333333-3333-4333-8333-333333333333','123','44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111/frame.jpg','processing',3);`);
      const finish = `select finish_bunny_upload('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','https://iframe.mediadelivery.net/embed/123/44444444-4444-4444-8444-444444444444','https://example.com/frame.jpg',10) result`;
      await expect(db.query(finish)).rejects.toThrow(/not confirmed/);
      await db.exec(
        "update bunny_uploads set state='ready',provider_status=null",
      );
      await expect(db.query(finish)).rejects.toThrow(/not confirmed/);
      await db.exec("update bunny_uploads set state='ready',provider_status=4");
      expect((await db.query(finish)).rows).toEqual(
        (await db.query(finish)).rows,
      );
      expect(
        (
          await db.query(
            "select count(*)::int count from videos where provider='bunny'",
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
      expect(
        (await db.query("select count(*)::int count from upload_jobs")).rows,
      ).toEqual([{ count: 1 }]);
      await expect(
        db.query(
          "update videos set status='published' where requires_reupload",
        ),
      ).rejects.toThrow(/Re-upload/);
      await db.exec("set role service_role");
      await expect(db.query("delete from filekosh_uploads")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.close();
    }
  }, 30000);
});
