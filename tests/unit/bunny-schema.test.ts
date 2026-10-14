// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
describe("Bunny migration against all actual checked-in migrations", () => {
  it("applies 00–13 with Supabase auth/storage schema fixtures and completes a real-schema record", async () => {
    const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
    try {
      // Only Supabase-managed infrastructure is stubbed; application migrations are unmodified.
      await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth; create schema storage;
        create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
        create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
        create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
        create table storage.objects(id uuid primary key,bucket_id text,name text);
      `);
      const directory = path.resolve("supabase/migrations");
      for (const file of readdirSync(directory)
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await db.exec(readFileSync(path.join(directory, file), "utf8"));
      await db.exec(`insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','admin@example.com');
        update public.profiles set role='admin' where id='11111111-1111-4111-8111-111111111111';
        insert into public.bunny_uploads(id,created_by,title,original_name,mime_type,size_bytes,category_id,library_id,provider_id,thumbnail_path,state,provider_status)
          select '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Clip','clip.mp4','video/mp4',100,id,'123','44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111/frame.jpg','ready',4 from public.categories limit 1;`);
      const finish = `select public.finish_bunny_upload('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','https://iframe.mediadelivery.net/embed/123/44444444-4444-4444-8444-444444444444','https://cdn.example.com/frame.jpg',10)`;
      await db.query(finish);
      await db.query(finish);
      expect(
        (
          await db.query(
            "select provider,bunny_library_id,mime_type,size_bytes::int,status from public.videos",
          )
        ).rows,
      ).toEqual([
        {
          provider: "bunny",
          bunny_library_id: "123",
          mime_type: "video/mp4",
          size_bytes: 100,
          status: "published",
        },
      ]);
      expect(
        (await db.query("select count(*)::int count from public.upload_jobs"))
          .rows,
      ).toEqual([{ count: 1 }]);
    } finally {
      await db.close();
    }
  }, 30000);
});
