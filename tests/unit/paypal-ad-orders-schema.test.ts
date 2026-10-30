// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readdirSync, readFileSync } from "node:fs";

const admin = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
let orderId = "";

async function asAuthenticated(id: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text);`);
  for (const file of readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec(`insert into auth.users(id,email) values('${admin}','admin@example.com');update profiles set role='admin',status='active' where id='${admin}';`);
}, 30000);

afterAll(async () => db?.close());

describe("guest PayPal ad-order schema", () => {
  it("does not expose orders or submit/review RPCs to browser roles", async () => {
    await expect(asAuthenticated(admin, "select * from ad_orders")).rejects.toThrow(/permission denied/);
    await expect(asAuthenticated(admin, "select submit_ad_order(1,1,'Ad','Contact','','a@example.com','About','https://example.com','https://example.com/a.png','orders/a.png',100,'image/png','1200x675','')")).rejects.toThrow(/permission denied/);
  });

  it("prices from the slot, blocks duplicate reservations, and requires payment before going live", async () => {
    const submitted = await db.query<{ submit_ad_order: string }>(`select submit_ad_order(1,1,'Summer launch','Alex','Example Brand','ALEX@example.com','Independent retailer','https://example.com/offer','https://cdn.example.com/banner.png','orders/banner.png',1200,'image/png','1200x675','PAYPAL-123')`);
    orderId = submitted.rows[0]!.submit_ad_order;
    const initial = await db.query(`select status,payment_status,amount_cents,email from ad_orders where id='${orderId}'`);
    expect(initial.rows[0]).toMatchObject({ status: "in_review", payment_status: "unverified", amount_cents: 9900, email: "alex@example.com" });

    await expect(db.query(`select submit_ad_order(1,1,'Other','Other','','other@example.com','Other advertiser','https://example.com','https://cdn.example.com/other.png','orders/other.png',1200,'image/png','1200x675','')`)).rejects.toThrow(/reserved|unavailable/);
    await expect(db.query(`select admin_review_ad_order('${admin}','${orderId}','make_live')`)).rejects.toThrow(/Confirm the PayPal payment/);

    await db.query(`select admin_review_ad_order('${admin}','${orderId}','verify_payment')`);
    const verified = await db.query(`select status,payment_status from ad_orders where id='${orderId}'`);
    expect(verified.rows[0]).toMatchObject({ status: "in_review", payment_status: "verified" });

    await db.query(`select admin_review_ad_order('${admin}','${orderId}','make_live')`);
    const live = await db.query(`select status,payment_status,starts_at,ends_at,reviewed_by from ad_orders where id='${orderId}'`);
    expect(live.rows[0]).toMatchObject({ status: "live", payment_status: "verified", reviewed_by: admin });
    expect(live.rows[0]).toHaveProperty("starts_at");
    expect(live.rows[0]).toHaveProperty("ends_at");
  });

  it("stores the framing an advertiser chose, for a GIF of any shape", async () => {
    await db.query(`select admin_review_ad_order('${admin}','${orderId}','delete_ad')`).catch(() => undefined);
    await db.query(`delete from ad_orders where slot_id = 2`);
    const submitted = await db.query<{ submit_ad_order: string }>(
      `select submit_ad_order(2,1,'Loop launch','Sam','','sam@example.com','Advertiser','https://example.com','https://cdn.example.com/loop.gif','orders/loop.gif',2400,'image/gif','600x900',null,20,80,1.8)`,
    );
    const row = await db.query(
      `select file_type, dimensions, focus_x, focus_y, focus_zoom from ad_orders where id='${submitted.rows[0]!.submit_ad_order}'`,
    );
    expect(row.rows[0]).toMatchObject({
      file_type: "image/gif",
      dimensions: "600x900",
      focus_x: "20.00",
      focus_y: "80.00",
      focus_zoom: "1.80",
    });
  });

  it("refuses framing outside the frame, at the database as well as the route", async () => {
    await expect(
      db.query(
        `select submit_ad_order(3,1,'Bad','Bad','','bad@example.com','Advertiser','https://example.com','https://cdn.example.com/bad.png','orders/bad.png',1200,'image/png','1200x675',null,400,50,1)`,
      ),
    ).rejects.toThrow(/Invalid creative framing/);
    await expect(
      db.query(
        `select submit_ad_order(3,1,'Bad','Bad','','bad@example.com','Advertiser','https://example.com','https://cdn.example.com/bad.png','orders/bad.png',1200,'image/png','1200x675',null,50,50,9)`,
      ),
    ).rejects.toThrow(/Invalid creative framing/);
  });
});
