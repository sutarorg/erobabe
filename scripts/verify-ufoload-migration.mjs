#!/usr/bin/env node
/**
 * Runs the Supabase migrations against a REAL Postgres (PGlite — Postgres
 * compiled to WebAssembly, no Docker, no network, nothing to clean up) and
 * proves that `00000000000006_ufoload_video_provider.sql`:
 *
 *   1. applies cleanly on top of a database shaped like the one already
 *      deployed (migrations 00–05 with the Uqload-era schema);
 *   2. keeps every historical Uqload row exactly as it was — nothing deleted,
 *      nothing relabelled;
 *   3. allows 'ufoload' while still allowing the old providers, and still rejects
 *      anything else;
 *   4. changes the upload_jobs.provider default to 'ufoload';
 *   5. adds the provider id columns and their uniqueness rules;
 *   6. can be applied a second time without error or any further change;
 *   7. also yields the same result on a fresh install (00 → 06 in order).
 *
 * Usage (from the repository root):
 *
 *   npm install --no-save @electric-sql/pglite     # not a project dependency
 *   node scripts/verify-ufoload-migration.mjs
 *
 * Optional: `--baseline-ref <git-ref>` takes migration 00 from that ref (the
 * schema as it was before this change) instead of rewinding the new one:
 *
 *   node scripts/verify-ufoload-migration.mjs --baseline-ref main
 *
 * Supabase-only objects the migrations reference (the auth and storage schemas,
 * the anon / authenticated / service_role roles) are stubbed minimally: this
 * checks the SQL of this repository, not Supabase itself. Run the same
 * migrations on a Supabase branch database too (see DEPLOYMENT.md).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const migrationsDir = process.env.MIGRATIONS_DIR || fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const baselineIndex = process.argv.indexOf("--baseline-ref");
const baselineRef = baselineIndex > -1 ? process.argv[baselineIndex + 1] : null;

let pglite;
try {
  pglite = await import("@electric-sql/pglite");
} catch {
  console.error("This check needs PGlite, which is not a project dependency.\nInstall it without touching package.json:\n\n  npm install --no-save @electric-sql/pglite\n");
  process.exit(2);
}
const { PGlite } = pglite;
const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
const { uuid_ossp } = await import("@electric-sql/pglite/contrib/uuid_ossp");

const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const TARGET = "00000000000006_ufoload_video_provider.sql";
assert.ok(files.includes(TARGET), `${TARGET} is missing from ${migrationsDir}`);
assert.equal(files.at(-1), TARGET, "the UFOLOAD migration must be the last migration");

const read = (name) => readFileSync(path.join(migrationsDir, name), "utf8");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
`;

async function newDatabase() {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(SUPABASE_STUBS);
  return db;
}

/** The pre-change initial schema, taken from git when a baseline ref is given. */
function initialSchemaFor(name, { legacy }) {
  if (!legacy || !baselineRef || name !== files[0]) return read(name);
  const relative = path.relative(process.cwd(), path.join(migrationsDir, name)).split(path.sep).join("/");
  return execFileSync("git", ["show", `${baselineRef}:${relative}`], { encoding: "utf8" });
}

/**
 * Brings a database to the shape a deployed project has BEFORE this change:
 * migrations 00–05, with the Uqload-era provider check and upload_jobs default.
 * When no baseline ref is given, the new 00 is rewound to that shape.
 */
async function applyDeployedState(db) {
  for (const name of files.filter((file) => file < TARGET)) await db.exec(initialSchemaFor(name, { legacy: true }));
  if (baselineRef) return;
  await db.exec(`
    alter table public.upload_jobs drop column if exists provider_upload_id;
    alter table public.upload_jobs drop column if exists provider_import_task_id;
    alter table public.upload_jobs drop column if exists provider_status;
    alter table public.upload_jobs drop column if exists last_checked_at;
    alter table public.upload_jobs alter column provider set default 'uqload';
    alter table public.videos drop constraint videos_provider_check;
    alter table public.videos add constraint videos_provider_check
      check (provider in ('uqload', 'bunny', 'cloudflare', 'internal', 's3', 'embed'));
  `);
}

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push([true, name]);
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.push([false, name]);
    console.log(`  FAIL ${name}\n       ${String(error.message || error).split("\n").join("\n       ")}`);
  }
}

async function rows(db, sql) {
  return (await db.query(sql)).rows;
}

async function rejects(db, sql) {
  try {
    await db.exec(sql);
  } catch {
    return true;
  }
  return false;
}

const constraintDefinition = async (db) =>
  (await rows(db, "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.videos'::regclass and conname = 'videos_provider_check'"))[0]?.def;

process.on("unhandledRejection", (error) => {
  console.error(`\nUnexpected error: ${String(error?.message || error).slice(0, 500)}`);
  process.exit(1);
});

// ---------------------------------------------------------------------------
console.log(`Migrations found: ${files.length} (target: ${TARGET})${baselineRef ? `, baseline schema from ${baselineRef}` : ", baseline = new schema rewound to its deployed shape"}\n`);

console.log("Upgrade of a deployed database");
const db = await newDatabase();
await applyDeployedState(db);

// Historical data a deployed project already has.
await db.exec(`
  insert into public.videos (id, slug, title, category_id, provider, provider_file_id, embed_url, playable_url, status, visibility, rights_status, moderation_status)
  values
   ('00000000-0000-0000-0000-000000000a01', 'old-uqload', 'Old Uqload video', (select id from public.categories order by label limit 1), 'uqload', 'u9150wqzvhxj', 'https://uqload.vc/embed-u9150wqzvhxj.html', 'https://uqload.vc/u9150wqzvhxj.html', 'published', 'public', 'cleared', 'approved'),
   ('00000000-0000-0000-0000-000000000a02', 'old-embed', 'Old embed', (select id from public.categories order by label limit 1), 'embed', null, 'https://player.example.com/embed/abc', null, 'published', 'public', 'cleared', 'approved'),
   ('00000000-0000-0000-0000-000000000a03', 'old-draft', 'Old draft', null, 'internal', null, null, null, 'draft', 'private', 'pending', 'pending');
  insert into public.upload_jobs (id, video_id, file_name, file_size, provider, provider_file_id, status, progress)
  values
   ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', 'old.mp4', 1234, 'uqload', 'u9150wqzvhxj', 'completed', 100),
   ('00000000-0000-0000-0000-000000000b02', null, 'stuck.mp4', 99, 'uqload', null, 'processing', 40);
`);
const snapshot = async () => ({
  videos: await rows(db, "select * from public.videos order by id"),
  jobs: await rows(
    db,
    "select id, video_id, file_name, file_size, provider, provider_file_id, status, progress, error_message, created_by, created_at, updated_at from public.upload_jobs order by id"
  ),
});
const before = await snapshot();
const oldDefinition = await constraintDefinition(db);

await check("the deployed provider check does not yet allow ufoload", async () => {
  assert.ok(!oldDefinition.includes("ufoload"), oldDefinition);
  assert.ok(await rejects(db, "insert into public.videos (slug, title, provider) values ('x1', 'x', 'ufoload')"));
});

await db.exec(read(TARGET));

await check("applies cleanly and changes no historical row", async () => {
  const after = await snapshot();
  assert.deepEqual(after.videos, before.videos);
  assert.deepEqual(after.jobs, before.jobs);
  assert.equal(after.videos.length, 3);
  assert.equal(after.jobs.length, 2);
});

await check("historical Uqload rows keep provider 'uqload' and their stored playback URLs", async () => {
  const [row] = await rows(db, "select provider, provider_file_id, embed_url, playable_url, status, visibility from public.videos where slug = 'old-uqload'");
  assert.deepEqual(row, {
    provider: "uqload",
    provider_file_id: "u9150wqzvhxj",
    embed_url: "https://uqload.vc/embed-u9150wqzvhxj.html",
    playable_url: "https://uqload.vc/u9150wqzvhxj.html",
    status: "published",
    visibility: "public",
  });
  const [job] = await rows(db, "select provider, provider_file_id from public.upload_jobs where id = '00000000-0000-0000-0000-000000000b01'");
  assert.deepEqual(job, { provider: "uqload", provider_file_id: "u9150wqzvhxj" });
});

await check("the provider check now allows ufoload and every earlier provider, and still rejects others", async () => {
  const definition = await constraintDefinition(db);
  for (const provider of ["uqload", "ufoload", "bunny", "cloudflare", "internal", "s3", "embed"]) {
    assert.ok(definition.includes(`'${provider}'`), `${provider} missing from: ${definition}`);
    await db.exec(`insert into public.videos (slug, title, provider) values ('ok-${provider}', 'ok', '${provider}')`);
  }
  assert.ok(await rejects(db, "insert into public.videos (slug, title, provider) values ('bad', 'bad', 'vimeo')"), "an unknown provider was accepted");
  await db.exec("delete from public.videos where slug like 'ok-%'");
});

await check("upload_jobs.provider now defaults to ufoload; existing rows are untouched", async () => {
  await db.exec("insert into public.upload_jobs (id, file_name) values ('00000000-0000-0000-0000-000000000b09', 'new.mp4')");
  const [row] = await rows(db, "select provider, status from public.upload_jobs where id = '00000000-0000-0000-0000-000000000b09'");
  assert.deepEqual(row, { provider: "ufoload", status: "pending" });
  await db.exec("delete from public.upload_jobs where id = '00000000-0000-0000-0000-000000000b09'");
});

await check("adds the provider id columns as nullable text/timestamptz, null for every historical row", async () => {
  const columns = await rows(
    db,
    "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'upload_jobs' and column_name in ('provider_upload_id','provider_import_task_id','provider_status','last_checked_at') order by column_name"
  );
  assert.deepEqual(columns, [
    { column_name: "last_checked_at", data_type: "timestamp with time zone", is_nullable: "YES" },
    { column_name: "provider_import_task_id", data_type: "text", is_nullable: "YES" },
    { column_name: "provider_status", data_type: "text", is_nullable: "YES" },
    { column_name: "provider_upload_id", data_type: "text", is_nullable: "YES" },
  ]);
  const [counts] = await rows(db, "select count(*)::int as n, count(provider_upload_id)::int as upl, count(provider_import_task_id)::int as imp from public.upload_jobs");
  assert.deepEqual(counts, { n: 2, upl: 0, imp: 0 });
});

await check("an import task id lives in its own column, separate from provider_file_id", async () => {
  await db.exec(`insert into public.upload_jobs (id, file_name, provider_import_task_id, provider_status) values ('00000000-0000-0000-0000-000000000b10', 'imp.mp4', 'imp_01', 'import:queued')`);
  const [row] = await rows(db, "select provider_file_id, provider_import_task_id from public.upload_jobs where id = '00000000-0000-0000-0000-000000000b10'");
  assert.deepEqual(row, { provider_file_id: null, provider_import_task_id: "imp_01" });
});

await check("a UFOLOAD upload session / import task can belong to only one job (NULLs may repeat)", async () => {
  await db.exec("insert into public.upload_jobs (id, file_name, provider_upload_id) values ('00000000-0000-0000-0000-000000000b11', 'a.mp4', 'upl_1')");
  assert.ok(await rejects(db, "insert into public.upload_jobs (file_name, provider_upload_id) values ('b.mp4', 'upl_1')"), "duplicate provider_upload_id accepted");
  assert.ok(await rejects(db, "insert into public.upload_jobs (file_name, provider_import_task_id) values ('c.mp4', 'imp_01')"), "duplicate provider_import_task_id accepted");
  await db.exec("insert into public.upload_jobs (file_name) values ('n1.mp4'), ('n2.mp4')");
  await db.exec("delete from public.upload_jobs where id in ('00000000-0000-0000-0000-000000000b10','00000000-0000-0000-0000-000000000b11') or file_name in ('n1.mp4','n2.mp4')");
});

await check("creates the lookup indexes", async () => {
  const names = (await rows(db, "select indexname from pg_indexes where schemaname = 'public' and indexname like any (array['idx_upload_jobs_%','idx_videos_provider_file_id'])")).map((row) => row.indexname).sort();
  assert.deepEqual(names, ["idx_upload_jobs_provider_import_task_id", "idx_upload_jobs_provider_upload_id", "idx_upload_jobs_unfinished", "idx_videos_provider_file_id"]);
});

await check("can be applied a second time: no error, same constraint, same data", async () => {
  const definition = await constraintDefinition(db);
  const snap = await snapshot();
  await db.exec(read(TARGET));
  await db.exec(read(TARGET));
  assert.equal(await constraintDefinition(db), definition);
  assert.deepEqual(await snapshot(), snap);
});

// ---------------------------------------------------------------------------
console.log("\nFresh install (00 → 06 in order)");
const fresh = await newDatabase();
for (const name of files) await fresh.exec(read(name));

await check("every migration applies in order", async () => {
  assert.equal((await rows(fresh, "select count(*)::int as n from public.categories"))[0].n >= 0, true);
});
await check("the schema has the same result as an upgraded database", async () => {
  const freshDefinition = await constraintDefinition(fresh);
  assert.equal(freshDefinition, await constraintDefinition(db));
  const columnList = (database) =>
    rows(database, "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'upload_jobs' order by column_name");
  assert.deepEqual(await columnList(fresh), await columnList(db));
});
await check("a fresh install accepts ufoload rows and defaults upload_jobs to ufoload", async () => {
  await fresh.exec("insert into public.videos (slug, title, provider) values ('fresh', 'fresh', 'ufoload')");
  await fresh.exec("insert into public.upload_jobs (file_name, provider_upload_id) values ('f.mp4', 'upl_x')");
  const [row] = await rows(fresh, "select provider from public.upload_jobs where provider_upload_id = 'upl_x'");
  assert.equal(row.provider, "ufoload");
});

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
