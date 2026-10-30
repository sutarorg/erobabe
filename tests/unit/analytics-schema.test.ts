// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readdirSync, readFileSync } from "node:fs";

/**
 * The analytics migration, exercised against a real PostgreSQL engine.
 *
 * Every aggregate the admin dashboard renders is defined in SQL, so the maths
 * is tested here against rows the way production writes them: sessions with
 * foreground time, pageviews, guest ad orders and their impressions/clicks.
 */

const VISITOR = "a".repeat(64);
const OTHER_VISITOR = "b".repeat(64);
const SESSION_1 = "11111111-1111-4111-8111-111111111111";
const SESSION_2 = "22222222-2222-4222-8222-222222222222";
const ADVERTISER = "33333333-3333-4333-8333-333333333333";
const ORDER_LIVE = "44444444-4444-4444-8444-444444444444";
const ORDER_UNVERIFIED = "55555555-5555-4555-8555-555555555555";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key, bucket_id text, name text);
  `);
  for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
}, 60000);

afterAll(async () => {
  await db?.close();
});

/** Records a pageview through the same function the collector calls. */
async function pageview(options: {
  session: string;
  visitor?: string;
  path: string | null;
  previousPath?: string | null;
  previousEngagedMs?: number;
  device?: string;
  browser?: string;
  os?: string;
  country?: string | null;
  referrerHost?: string | null;
  referrerPath?: string | null;
  utmSource?: string | null;
}) {
  await db.query(
    `select record_analytics_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      options.session,
      options.visitor ?? VISITOR,
      options.path,
      options.previousPath ?? null,
      options.previousEngagedMs ?? 0,
      options.referrerHost ?? null,
      options.referrerPath ?? null,
      options.device ?? "desktop",
      options.browser ?? "Chrome",
      options.os ?? "Windows",
      options.country ?? "US",
      "California",
      "Los Angeles",
      options.utmSource ?? null,
      null,
      null,
    ],
  );
}

describe("analytics schema and collection functions", () => {
  it("creates the tables as service-role-only", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('analytics_sessions','analytics_pageviews','ad_order_events')
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "ad_order_events",
      "analytics_pageviews",
      "analytics_sessions",
    ]);

    await db.exec("set role anon");
    try {
      await expect(db.query("select * from analytics_pageviews")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select * from analytics_sessions")).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select record_analytics_activity(gen_random_uuid(),$1,'/',null)", [VISITOR]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("records a session, its pageviews and the time spent on each page", async () => {
    await pageview({ session: SESSION_1, path: "/", referrerHost: "google.com", referrerPath: "/search" });
    // The second beacon flushes 20 s on "/" and records "/latest".
    await pageview({
      session: SESSION_1,
      path: "/latest",
      previousPath: "/",
      previousEngagedMs: 20000,
      device: "mobile",
    });

    const session = (
      await db.query<any>("select * from analytics_sessions where id = $1", [SESSION_1])
    ).rows[0];
    expect(session.entry_path).toBe("/");
    expect(session.exit_path).toBe("/latest");
    expect(session.pageview_count).toBe(2);
    expect(session.engaged_ms).toBe(20000);
    // First write wins for the acquisition dimensions.
    expect(session.referrer_host).toBe("google.com");
    expect(session.device).toBe("desktop");

    const views = (
      await db.query<any>(
        "select path, engaged_ms from analytics_pageviews where session_id = $1 order by created_at",
        [SESSION_1],
      )
    ).rows;
    expect(views).toEqual([
      { path: "/", engaged_ms: 20000 },
      { path: "/latest", engaged_ms: 0 },
    ]);
  });

  it("flushes the last pageview's time without adding a pageview", async () => {
    await pageview({
      session: SESSION_1,
      path: null,
      previousPath: "/latest",
      previousEngagedMs: 5000,
    });
    const session = (
      await db.query<any>("select pageview_count, engaged_ms from analytics_sessions where id = $1", [
        SESSION_1,
      ])
    ).rows[0];
    expect(session.pageview_count).toBe(2);
    expect(Number(session.engaged_ms)).toBe(25000);
  });

  it("refuses to write into a session owned by another visitor", async () => {
    await db.query(
      `select record_analytics_activity($1,$2,'/hijack',null,0,null,null,'desktop',null,null,null,null,null,null,null,null)`,
      [SESSION_1, OTHER_VISITOR],
    );
    const rows = await db.query<any>(
      "select count(*)::int as count from analytics_pageviews where path = '/hijack'",
    );
    expect(rows.rows[0].count).toBe(0);
  });

  it("aggregates sessions, visitors, bounces and engagement for a range", async () => {
    // A second visitor bounces after a single short pageview.
    await pageview({ session: SESSION_2, visitor: OTHER_VISITOR, path: "/faq", device: "tablet" });

    const totals = (
      await db.query<any>(
        "select * from analytics_overview(now() - interval '1 day', now() + interval '1 minute')",
      )
    ).rows[0];
    expect(Number(totals.pageviews)).toBe(3);
    expect(Number(totals.sessions)).toBe(2);
    expect(Number(totals.visitors)).toBe(2);
    expect(Number(totals.engaged_sessions)).toBe(1);
    expect(Number(totals.bounces)).toBe(1);
    expect(Number(totals.engaged_seconds)).toBe(25);

    // A page-scoped overview only counts sessions that saw that page.
    const homeOnly = (
      await db.query<any>(
        "select * from analytics_overview(now() - interval '1 day', now() + interval '1 minute', '/')",
      )
    ).rows[0];
    expect(Number(homeOnly.pageviews)).toBe(1);
    expect(Number(homeOnly.sessions)).toBe(1);
  });

  it("fills every bucket of the requested series, including empty ones", async () => {
    const rows = (
      await db.query<any>(
        `select * from analytics_series(now() - interval '3 days', now(), 'day')`,
      )
    ).rows;
    expect(rows).toHaveLength(4);
    const total = rows.reduce((sum, row) => sum + Number(row.pageviews), 0);
    expect(total).toBe(3);
  });

  it("splits pageviews and sessions across the requested dimension", async () => {
    const paths = (
      await db.query<any>(
        `select * from analytics_dimensions(now() - interval '1 day', now() + interval '1 minute', 'path')`,
      )
    ).rows;
    expect(paths.map((row) => row.key).sort()).toEqual(["/", "/faq", "/latest"]);

    const devices = (
      await db.query<any>(
        `select * from analytics_dimensions(now() - interval '1 day', now() + interval '1 minute', 'device')`,
      )
    ).rows;
    expect(devices.map((row) => [row.key, Number(row.sessions)]).sort()).toEqual([
      ["desktop", 1],
      ["tablet", 1],
    ]);

    const referrers = (
      await db.query<any>(
        `select * from analytics_dimensions(now() - interval '1 day', now() + interval '1 minute', 'referrer_host')`,
      )
    ).rows;
    expect(referrers.map((row) => row.key).sort()).toEqual(["(not set)", "google.com"]);
  });

  it("reports page-level entries, exits and bounces", async () => {
    const page = (
      await db.query<any>(
        "select * from analytics_page_metrics(now() - interval '1 day', now() + interval '1 minute', '/')",
      )
    ).rows[0];
    expect(Number(page.pageviews)).toBe(1);
    expect(Number(page.sessions)).toBe(1);
    expect(Number(page.visitors)).toBe(1);
    expect(Number(page.entries)).toBe(1);
    expect(Number(page.exits)).toBe(0);
    expect(Number(page.engaged_seconds)).toBe(20);
  });

  it("rejects an unknown dimension, bucket or inverted range", async () => {
    await expect(
      db.query("select * from analytics_dimensions(now() - interval '1 day', now(), 'password')"),
    ).rejects.toThrow(/Invalid dimension/);
    await expect(
      db.query("select * from analytics_series(now() - interval '1 day', now(), 'minute')"),
    ).rejects.toThrow(/Invalid bucket/);
    await expect(db.query("select * from analytics_overview(now(), now())")).rejects.toThrow(
      /Invalid range/,
    );
  });
});

describe("guest ad measurement", () => {
  beforeAll(async () => {
    await db.query("insert into ad_slots(id,name,side,position,price_cents) values (1,'Left top','left',1,9900) on conflict do nothing");
    await db.query(
      `insert into auth.users(id, email) values ($1, 'acme@example.com') on conflict do nothing`,
      [ADVERTISER],
    );
    await db.query(
      `insert into profiles(id, role, email, status) values ($1, 'advertiser', 'acme@example.com', 'active')
       on conflict do nothing`,
      [ADVERTISER],
    );
    await db.query(
      `insert into advertiser_profiles(id, company_name) values ($1, 'Acme') on conflict do nothing`,
      [ADVERTISER],
    );
    await db.query(
      `insert into ad_orders (
         id, slot_id, ad_name, contact_name, email, about_advertiser, destination_url,
         image_url, image_path, file_size, file_type, dimensions, duration_months,
         amount_cents, payment_status, payment_verified_at, status, starts_at, ends_at
       ) values
         ($1, 1, 'Live ad', 'Ada', 'ada@example.com', 'about', 'https://example.com/offer',
          'https://cdn.example.com/ad.png', 'orders/live.png', 1024, 'image/png', '16:9', 1,
          9900, 'verified', now() - interval '2 days', 'live', now() - interval '2 days', now() + interval '7 days'),
         ($2, 1, 'Pending ad', 'Bo', 'bo@example.com', 'about', 'https://example.com/other',
          'https://cdn.example.com/pending.png', 'orders/pending.png', 1024, 'image/png', '16:9', 1,
          9900, 'unverified', null, 'in_review', null, null)`,
      [ORDER_LIVE, ORDER_UNVERIFIED],
    );
  });

  it("records impressions and clicks only for a live, paid order", async () => {
    const args = [ORDER_LIVE, 1, "impression", VISITOR];
    const [first, duplicate, wrongSlot, unverified] = await Promise.all([
      db.query<{ recorded: boolean }>("select record_ad_order_event(gen_random_uuid(),$1,$2,$3,$4) as recorded", args),
      db.query<{ recorded: boolean }>("select record_ad_order_event(gen_random_uuid(),$1,$2,$3,$4) as recorded", args),
      db.query<{ recorded: boolean }>(
        "select record_ad_order_event(gen_random_uuid(),$1,2,'impression',$2) as recorded",
        [ORDER_LIVE, VISITOR],
      ),
      db.query<{ recorded: boolean }>(
        "select record_ad_order_event(gen_random_uuid(),$1,1,$2,$3) as recorded",
        [ORDER_UNVERIFIED, "impression", VISITOR],
      ),
    ]);
    expect(first.rows[0].recorded).toBe(true);
    // Same visitor, same hour, same kind: counted once.
    expect(duplicate.rows[0].recorded).toBe(false);
    expect(wrongSlot.rows[0].recorded).toBe(false);
    expect(unverified.rows[0].recorded).toBe(false);

    await db.query(
      "select record_ad_order_event(gen_random_uuid(),$1,1,'click',$2)",
      [ORDER_LIVE, VISITOR],
    );
    await db.query(
      "select record_ad_order_event(gen_random_uuid(),$1,1,'impression',$2)",
      [ORDER_LIVE, OTHER_VISITOR],
    );

    const totals = (
      await db.query<any>("select * from analytics_ad_totals(now() - interval '1 day', now() + interval '1 minute')")
    ).rows[0];
    expect(Number(totals.impressions)).toBe(2);
    expect(Number(totals.clicks)).toBe(1);
    expect(Number(totals.visitors)).toBe(2);
  });

  it("lists all ten placements, including ones with no delivery", async () => {
    const placements = (
      await db.query<any>(
        "select * from analytics_ad_placements(now() - interval '1 day', now() + interval '1 minute')",
      )
    ).rows;
    expect(placements).toHaveLength(10);
    const first = placements.find((row) => Number(row.slot_id) === 1);
    expect(Number(first.impressions)).toBe(2);
    expect(Number(first.clicks)).toBe(1);
    const second = placements.find((row) => Number(row.slot_id) === 2);
    expect(Number(second.impressions)).toBe(0);
  });

  it("lists booked orders overlapping the range with their delivery", async () => {
    const orders = (
      await db.query<any>(
        "select * from analytics_ad_orders(now() - interval '30 days', now() + interval '1 minute')",
      )
    ).rows;
    expect(orders).toHaveLength(1);
    expect(orders[0].order_id).toBe(ORDER_LIVE);
    expect(Number(orders[0].impressions)).toBe(2);
    expect(Number(orders[0].clicks)).toBe(1);
    expect(orders[0].payment_status).toBe("verified");
  });

  it("returns a daily delivery series for one order", async () => {
    const rows = (
      await db.query<any>(
        `select * from analytics_ad_series(now() - interval '3 days', now(), $1)`,
        [ORDER_LIVE],
      )
    ).rows;
    expect(rows).toHaveLength(4);
    expect(rows.reduce((sum, row) => sum + Number(row.impressions), 0)).toBe(2);
  });

  it("removes delivery evidence with the deleted advertisement", async () => {
    await db.query("delete from ad_orders where id = $1", [ORDER_LIVE]);
    const rows = await db.query<any>("select count(*)::int as count from ad_order_events");
    expect(rows.rows[0].count).toBe(0);
  });
});
