// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { FIXED_CATEGORIES } from "@/lib/public/fixed-categories";
const db = new PGlite();
const video = "11111111-1111-4111-8111-111111111111";
beforeAll(async () => {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table categories(id uuid primary key default gen_random_uuid(), label text unique not null, slug text unique not null, icon text, description text, image_url text);
 create table videos(id uuid primary key, category_id uuid references categories(id) on delete set null, status text, visibility text, rights_status text, moderation_status text, requires_reupload boolean, published_at timestamptz);
 create table bunny_uploads(id uuid primary key default gen_random_uuid(), category_id uuid not null references categories(id), state text, last_error text);
 create table filekosh_uploads(id uuid primary key default gen_random_uuid(), category_id uuid references categories(id));
 insert into categories(label,slug,icon,image_url) values('Amateur','amateur','camera','kept.png'),('Retired','retired','heart',null);
 insert into bunny_uploads(category_id,state) select id,'processing' from categories where slug='retired';
 insert into filekosh_uploads(category_id) select id from categories where slug='retired';
 insert into videos values('${video}',(select id from categories where slug='retired'),'published','public','cleared','approved',false,now());`);
 await db.exec(readFileSync('supabase/migrations/00000000000021_fixed_categories_and_community.sql', 'utf8'));
 await db.exec(readFileSync('supabase/migrations/00000000000022_unique_anonymous_comment_profiles.sql', 'utf8'));
}, 30000);
afterAll(() => db.close());
describe('fixed categories and community SQL', () => {
 it('seeds exactly the requested taxonomy and preserves existing thumbnails', async () => {
  const { rows } = await db.query<{ slug: string }>('select slug from categories');
  expect(rows.map(r => r.slug).sort()).toEqual(FIXED_CATEGORIES.map(c => c.slug).sort());
  expect((await db.query<{image_url:string}>("select image_url from categories where slug='amateur'")).rows[0].image_url).toBe('kept.png');
  expect((await db.query<{category_id:null}>('select category_id from videos')).rows[0].category_id).toBeNull();
 });
 it('preserves upload history and cancels sessions using retired categories', async () => {
  expect((await db.query('select category_id,state from bunny_uploads')).rows[0]).toEqual({category_id:null,state:'cancelled'});
  expect((await db.query('select category_id from filekosh_uploads')).rows[0]).toEqual({category_id:null});
 });
 it('blocks creation, deletion and identity changes but allows thumbnails', async () => {
  await expect(db.exec("insert into categories(label,slug) values('Extra','extra')")).rejects.toThrow('fixed');
  await expect(db.exec("delete from categories where slug='amateur'")).rejects.toThrow('fixed');
  await expect(db.exec("update categories set icon='heart' where slug='amateur'")).rejects.toThrow('fixed');
  await db.exec("update categories set image_url='new.png', description='New description' where slug='amateur'");
 });
 it('persists comments and enforces the posting cooldown', async () => {
  await db.query('select post_video_comment($1,$2,$3,$4)', [video, 'DiscoPanda1234', 'Hello', 'visitor']);
  await expect(db.query('select post_video_comment($1,$2,$3,$4)', [video, 'DiscoPanda1234', 'Again', 'visitor'])).rejects.toThrow('30 seconds');
 });
 it('stores one stable username per visitor and rejects case-insensitive duplicates', async () => {
  await db.query('insert into anonymous_comment_profiles(visitor_hash,profile_name) values($1,$2)', ['a'.repeat(64), 'Professor Picklewhiskers ABCDEF123456']);
  await expect(db.query('insert into anonymous_comment_profiles(visitor_hash,profile_name) values($1,$2)', ['b'.repeat(64), 'professor picklewhiskers abcdef123456'])).rejects.toThrow('duplicate key value');
  await expect(db.query('insert into anonymous_comment_profiles(visitor_hash,profile_name) values($1,$2)', ['a'.repeat(64), 'Another Funny Name 123456ABCDEF'])).rejects.toThrow('duplicate key value');
 });
 it('likes are idempotent and unlikes never make the count negative', async () => {
  for (const liked of [true,true]) await db.query('select set_video_like($1,$2,$3)', [video,'visitor',liked]);
  expect((await db.query<{like_count:number}>('select like_count from videos')).rows[0].like_count).toBe(1);
  for (const liked of [false,false]) await db.query('select set_video_like($1,$2,$3)', [video,'visitor',liked]);
  expect((await db.query<{like_count:number}>('select like_count from videos')).rows[0].like_count).toBe(0);
 });
 it('rejects comments on unavailable videos', async () => {
  await db.exec(`update videos set visibility='private' where id='${video}'`);
  await expect(db.query('select post_video_comment($1,$2,$3,$4)', [video, 'DiscoPanda1234', 'Hidden', 'other'])).rejects.toThrow('unavailable');
 });
});
