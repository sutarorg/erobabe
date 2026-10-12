import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * Static guards on the UFOLOAD migration. They run everywhere (no database
 * needed) and pin the properties the migration promises: additive, idempotent,
 * no history touched. The same SQL is executed against a real Postgres by
 * `scripts/verify-ufoload-migration.mjs` (see DEPLOYMENT.md).
 */

const dir = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
const NAME = "00000000000006_ufoload_video_provider.sql";
const sql = readFileSync(path.join(dir, NAME), "utf8");
/** The statements only — comments are prose. */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();
const initial = readFileSync(path.join(dir, files[0]), "utf8");

describe("migration 00000000000006_ufoload_video_provider.sql", () => {
  it("exists, with the agreed name, as the newest migration", () => {
    expect(files).toContain(NAME);
    expect(files.at(-1)).toBe(NAME);
    expect(files.slice(0, 6)).toEqual([
      "00000000000000_initial_schema.sql",
      "00000000000001_rls_policies.sql",
      "00000000000002_seed_fixed_data.sql",
      "00000000000003_admin_publishing_and_profile_security.sql",
      "00000000000004_video_transit_storage.sql",
      "00000000000005_nowpayments.sql",
    ]);
  });

  it("allows ufoload and keeps every earlier provider value, including uqload", () => {
    const match = code.match(/check \(provider in \(([^)]*)\)\)/);
    expect(match).toBeTruthy();
    const allowed = (match as RegExpMatchArray)[1].split(",").map((value) => value.trim().replace(/'/g, ""));
    expect(allowed).toEqual(expect.arrayContaining(["uqload", "ufoload", "bunny", "cloudflare", "internal", "s3", "embed"]));
  });

  it("only replaces the provider check when it does not already allow ufoload (so a second run changes nothing)", () => {
    expect(code).toMatch(/not like '%ufoload%'/);
    expect(code).toMatch(/drop constraint if exists videos_provider_check/);
  });

  it("makes ufoload the default provider for new upload jobs", () => {
    expect(code).toMatch(/alter table public\.upload_jobs alter column provider set default 'ufoload'/);
  });

  it("adds the import-task column separately from provider_file_id — idempotently", () => {
    expect(code).toMatch(/add column if not exists provider_import_task_id text/);
    expect(code).toMatch(/add column if not exists provider_upload_id text/);
    expect(code).toMatch(/add column if not exists provider_status text/);
    expect(code).toMatch(/add column if not exists last_checked_at timestamptz/);
    // Nothing re-types or re-purposes the existing file id column.
    expect(code).not.toMatch(/alter column provider_file_id/);
    expect(code).not.toMatch(/add column if not exists provider_file_id/);
  });

  it("creates every index with IF NOT EXISTS", () => {
    const creates = code.match(/create (unique )?index [^;]*/g) || [];
    expect(creates.length).toBeGreaterThanOrEqual(4);
    for (const statement of creates) expect(statement).toMatch(/if not exists/);
  });

  it("never deletes, updates or relabels existing rows, and drops no table or column", () => {
    expect(code).not.toMatch(/\bdelete\s+from\b/);
    expect(code).not.toMatch(/\btruncate\b/);
    expect(code).not.toMatch(/\bupdate\s+public\./);
    expect(code).not.toMatch(/\bdrop\s+table\b/);
    expect(code).not.toMatch(/\bdrop\s+column\b/);
    expect(code).not.toMatch(/\binsert\s+into\b/);
    // The one DROP is the guarded constraint swap above.
    expect((code.match(/\bdrop\s+\w+/g) || []).every((drop) => /drop constraint/.test(drop))).toBe(true);
    expect(sql).not.toMatch(/set provider\s*=\s*'ufoload'/i);
  });

  it("documents itself: why, what stays untouched, and how it was made safe to repeat", () => {
    expect(sql).toMatch(/NEVER deleted or relabelled/);
    expect(sql).toMatch(/safe to run twice/i);
    expect(sql).toMatch(/RLS/);
  });
});

describe("initial schema for fresh installs", () => {
  it("allows ufoload on videos.provider", () => {
    expect(initial).toMatch(/check \(provider in \('uqload','ufoload','bunny','cloudflare','internal','s3'\)\)/);
  });

  it("defaults upload_jobs to ufoload and carries the new columns", () => {
    const table = initial.slice(initial.indexOf("create table public.upload_jobs"), initial.indexOf("-- Functions for updated_at"));
    expect(table).toMatch(/provider text not null default 'ufoload'/);
    for (const column of ["provider_upload_id text", "provider_import_task_id text", "provider_status text", "last_checked_at timestamptz"]) {
      expect(table).toContain(column);
    }
    expect(table).toContain("provider_file_id text,");
  });

  it("left the other migrations as history", () => {
    const three = readFileSync(path.join(dir, "00000000000003_admin_publishing_and_profile_security.sql"), "utf8");
    expect(three).toMatch(/\('uqload', 'bunny', 'cloudflare', 'internal', 's3', 'embed'\)/);
    expect(three).not.toMatch(/ufoload/);
  });
});
