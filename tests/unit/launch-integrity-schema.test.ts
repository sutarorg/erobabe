// @vitest-environment node
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readdirSync, readFileSync } from "node:fs";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
const creative = "33333333-3333-4333-8333-333333333333",
  campaign = "44444444-4444-4444-8444-444444444444",
  payment = "55555555-5555-4555-8555-555555555555";
let db: PGlite;
async function user<T>(id: string, sql: string) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
  try {
    return await db.query<T>(sql);
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
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    `insert into auth.users(id,email) values('${a}','a@example.com'),('${b}','b@example.com');`,
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("all migrations: real SQL integrity (local PostgreSQL engine, not staging)", () => {
  it("blocks privilege escalation, self-unsuspension, payment forgery and private RPCs", async () => {
    await expect(
      user(a, `update profiles set role='admin' where id='${a}'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      user(a, `update advertiser_profiles set status='active' where id='${a}'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      user(
        a,
        `insert into payments(advertiser_id,external_id,amount_cents,payment_currency,chain,status) values('${a}','forged',9900,'USDT','ethereum','confirmed')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      user(
        a,
        `select settle_nowpayment('${payment}','123','confirmed','{"amount_verified":true}')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      user(
        a,
        `insert into ad_creatives(advertiser_id,slot_id,title,destination_url,status) values('${a}',1,'forged','https://example.com','approved')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("accepts only safe pending drafts, reprices from DB and rejects another advertiser on same dates", async () => {
    await user(
      a,
      `insert into ad_creatives(id,advertiser_id,slot_id,title,destination_url,image_url) values('${creative}','${a}',1,'Test','https://example.com','https://example.com/a.png')`,
    );
    await user(
      a,
      `insert into campaigns(id,advertiser_id,slot_id,creative_id,name,start_date,end_date,status,price_cents) values('${campaign}','${a}',1,'${creative}','Test',current_date,current_date+30,'pending_payment',1)`,
    );
    expect((await db.query("select price_cents from campaigns")).rows).toEqual([
      { price_cents: 9900 },
    ]);
    expect(
      (await user(b, `select * from campaigns where id='${campaign}'`)).rows,
    ).toEqual([]);
    expect(
      (
        await user(
          a,
          `update campaigns set status='active' where id='${campaign}' returning id`,
        )
      ).rows,
    ).toEqual([]);
    await user(
      b,
      `insert into ad_creatives(id,advertiser_id,slot_id,title,destination_url) values('66666666-6666-4666-8666-666666666666','${b}',1,'Other','https://example.com')`,
    );
    await expect(
      user(
        b,
        `insert into campaigns(advertiser_id,slot_id,creative_id,name,start_date,end_date,status,price_cents) values('${b}',1,'66666666-6666-4666-8666-666666666666','Conflict',current_date,current_date+30,'pending_payment',9900)`,
      ),
    ).rejects.toThrow(/Slot already reserved/);
  });
  it("creates payment with historical NOT NULL/unique external_id, claims before provider, rejects duplicate checkout", async () => {
    await db.exec(
      `insert into payments(id,advertiser_id,external_id,invoice_number,provider,amount_cents,payment_currency,chain,pay_currency) values('${payment}','${a}','nowpayments:fixture','INV-fixture','nowpayments',9900,'USDT','ethereum','usdterc20');`,
    );
    await db.query(
      `select claim_checkout('${payment}',array['${campaign}']::uuid[],'${a}',1)`,
    );
    expect(
      (
        await db.query(
          `select payment_id from campaigns where id='${campaign}'`,
        )
      ).rows,
    ).toEqual([{ payment_id: payment }]);
    await expect(
      db.query(
        `select claim_checkout('${payment}',array['${campaign}']::uuid[],'${a}',1)`,
      ),
    ).rejects.toThrow(/Campaign unavailable/);
    expect(
      (await db.query("select count(*)::int n from invoices")).rows,
    ).toEqual([{ n: 1 }]);
    expect((await db.query("select * from eligible_ads")).rows).toEqual([]);
  });
  it("settles atomically, rejects missing evidence, deduplicates and delivers only approved paid matching ads", async () => {
    await db.exec(
      `update payments set provider_payment_id='123',expected_amount='99',payment_address='exact' where id='${payment}';`,
    );
    await expect(
      db.query(`select settle_nowpayment('${payment}','123','confirmed','{}')`),
    ).rejects.toThrow(/Verification required/);
    await db.query(
      `select settle_nowpayment('${payment}','123','confirmed','{"amount_verified":true,"provider_status":"finished"}')`,
    );
    expect((await db.query("select status from campaigns")).rows).toEqual([
      { status: "pending_review" },
    ]);
    expect((await db.query("select status from invoices")).rows).toEqual([
      { status: "paid" },
    ]);
    expect((await db.query("select * from eligible_ads")).rows).toEqual([]);
    await db.exec(
      `update ad_creatives set status='approved' where id='${creative}';update campaigns set status='active' where id='${campaign}';`,
    );
    expect(
      (await db.query("select campaign_id from eligible_ads")).rows,
    ).toEqual([{ campaign_id: campaign }]);
    await Promise.all([
      db.query(
        `select settle_nowpayment('${payment}','123','confirmed','{"amount_verified":true,"provider_status":"finished"}')`,
      ),
      db.query(
        `select settle_nowpayment('${payment}','123','confirmed','{"amount_verified":true,"provider_status":"finished"}')`,
      ),
    ]);
    expect(
      (
        await db.query(
          "select count(*)::int n from payment_events where event_type='confirmed'",
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("real stored events increment portal counters once, reject wrong identity and enforce rate budget", async () => {
    const event = "77777777-7777-4777-8777-777777777777";
    const query = `select record_ad_event('${event}','${campaign}',1,'${creative}','impression','daily-hash') recorded`;
    expect((await db.query(query)).rows).toEqual([{ recorded: true }]);
    expect((await db.query(query)).rows).toEqual([{ recorded: false }]);
    expect(
      (
        await db.query(
          `select record_ad_event(gen_random_uuid(),'${campaign}',2,'${creative}','click','daily-hash') recorded`,
        )
      ).rows,
    ).toEqual([{ recorded: false }]);
    await db.query(
      `select record_ad_event(gen_random_uuid(),'${campaign}',1,'${creative}','click','daily-hash')`,
    );
    expect(
      (await user(a, "select impressions::int,clicks::int from campaigns"))
        .rows,
    ).toEqual([{ impressions: 1, clicks: 1 }]);
    await db.query(`select consume_request('fixture',1)`);
    expect(
      (await db.query(`select consume_request('fixture',1) allowed`)).rows,
    ).toEqual([{ allowed: false }]);
  });
  it("refund atomically pauses campaigns, refunds invoices, stops ads and ignores stale success", async () => {
    await db.query(
      `select settle_nowpayment('${payment}','123','refunded','{"provider_status":"refunded"}')`,
    );
    await db.query(
      `select settle_nowpayment('${payment}','123','confirmed','{"amount_verified":true,"provider_status":"finished"}')`,
    );
    expect((await db.query("select status from payments")).rows).toEqual([
      { status: "refunded" },
    ]);
    expect((await db.query("select status from invoices")).rows).toEqual([
      { status: "refunded" },
    ]);
    expect((await db.query("select status from campaigns")).rows).toEqual([
      { status: "paused" },
    ]);
    expect((await db.query("select * from eligible_ads")).rows).toEqual([]);
  });
  it("suspension denies direct account data and private tables have no anonymous write bypass", async () => {
    await db.exec(
      `update advertiser_profiles set status='suspended' where id='${a}'`,
    );
    expect((await user(a, "select id from payments")).rows).toEqual([]);
    await db.exec("set role anon");
    try {
      await expect(
        db.query(
          `insert into support_tickets(email,subject,message) values('x@example.com','bad','bypass')`,
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.exec("reset role");
    }
  });
});

it("rolls back payment and campaign together when invoice persistence fails", async () => {
  const p = "88888888-8888-4888-8888-888888888888";
  await db.exec(`insert into payments(id,advertiser_id,external_id,invoice_number,provider,provider_payment_id,amount_cents,payment_currency,chain) values('${p}','${b}','nowpayments:rollback','INV-rollback','nowpayments','456',9900,'USDT','ethereum');
    insert into invoices(number,advertiser_id,payment_id,amount_cents) values('INV-rollback','${b}','${p}',9900);
    create function fail_invoice_fixture() returns trigger language plpgsql as $$begin if new.number='INV-rollback' then raise exception 'fixture disk failure';end if;return new;end$$;
    create trigger fail_invoice_fixture before update on invoices for each row execute function fail_invoice_fixture();`);
  await expect(
    db.query(
      `select settle_nowpayment('${p}','456','confirmed','{"amount_verified":true,"provider_status":"finished"}')`,
    ),
  ).rejects.toThrow(/fixture disk failure/);
  expect(
    (await db.query(`select status from payments where id='${p}'`)).rows,
  ).toEqual([{ status: "pending" }]);
  expect(
    (await db.query(`select status from invoices where payment_id='${p}'`))
      .rows,
  ).toEqual([{ status: "pending" }]);
  await db.exec(
    "drop trigger fail_invoice_fixture on invoices;drop function fail_invoice_fixture();",
  );
  await db.query(
    `select settle_nowpayment('${p}','456','confirmed','{"amount_verified":true,"provider_status":"finished"}')`,
  );
  expect(
    (await db.query(`select status from invoices where payment_id='${p}'`))
      .rows,
  ).toEqual([{ status: "paid" }]);
});

describe("forward migration 18: recovery RPC authorization, idempotence and rollback", () => {
  const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const recovery = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const bind = (
    provider = "987",
    address = "fixture-address",
    amount = "99.5",
    actor = admin,
  ) =>
    `select bind_nowpayment('${actor}','${recovery}','${provider}','${address}','${amount}')`;
  async function asRole(role: string, sql: string) {
    await db.exec(`savepoint recovery_attempt; set local role ${role}`);
    try {
      return await db.query(sql);
    } catch (error) {
      await db.exec("rollback to savepoint recovery_attempt");
      throw error;
    } finally {
      await db.exec("reset role; release savepoint recovery_attempt");
    }
  }
  beforeEach(async () => {
    await db.exec(`begin;
      insert into auth.users(id,email) values('${admin}','recovery-admin@example.com'),('${owner}','recovery-owner@example.com');
      update profiles set role='admin' where id='${admin}';
      insert into payments(id,advertiser_id,external_id,invoice_number,provider,amount_cents,payment_currency,chain,pay_currency)
      values('${recovery}','${owner}','nowpayments:recovery-test','INV-recovery-test','nowpayments',9900,'USDT','ethereum','usdterc20');`);
  });
  afterEach(async () => {
    await db.exec("rollback");
  });

  it.each(["anon", "authenticated"])(
    "denies direct %s execution even with an active admin argument",
    async (role) => {
      await expect(asRole(role, bind())).rejects.toThrow(/permission denied/);
    },
  );
  it("removes the unaudited legacy RPC and rejects inactive/non-admin actors", async () => {
    expect(
      (
        await db.query(
          "select to_regprocedure('public.bind_nowpayment(uuid,text,text,text)') old",
        )
      ).rows,
    ).toEqual([{ old: null }]);
    await expect(
      asRole("service_role", bind("987", "fixture-address", "99.5", owner)),
    ).rejects.toThrow(/Active admin/);
    await db.exec(`update profiles set status='suspended' where id='${admin}'`);
    await expect(asRole("service_role", bind())).rejects.toThrow(
      /Active admin/,
    );
  });
  it.each(["0", "-1", "NaN", "Infinity", "1e2", "0.0000000000000000001"])(
    "rejects invalid amount %s without changing payment identity",
    async (amount) => {
      await expect(
        asRole("service_role", bind("987", "fixture-address", amount)),
      ).rejects.toThrow(/Invalid recovery/);
      expect(
        (
          await db.query(
            `select status,provider_payment_id from payments where id='${recovery}'`,
          )
        ).rows,
      ).toEqual([{ status: "pending", provider_payment_id: null }]);
    },
  );
  it("rejects invalid provider IDs and empty/whitespace addresses", async () => {
    for (const sql of [
      bind("../987"),
      bind("1".repeat(41)),
      bind("987", ""),
      bind("987", " "),
    ]) {
      await expect(asRole("service_role", sql)).rejects.toThrow(
        /Invalid recovery/,
      );
    }
  });
  it("binds once, records its actor, and leaves pending invoices unpaid", async () => {
    await db.exec(
      `insert into invoices(number,advertiser_id,payment_id,amount_cents) values('INV-recovery-test','${owner}','${recovery}',9900)`,
    );
    await asRole("service_role", bind());
    await asRole("service_role", bind("987", "fixture-address", "99.500"));
    expect(
      (
        await db.query(
          `select status,provider_payment_id,expected_amount from payments where id='${recovery}'`,
        )
      ).rows,
    ).toEqual([
      {
        status: "awaiting_confirmation",
        provider_payment_id: "987",
        expected_amount: "99.5",
      },
    ]);
    expect(
      (
        await db.query(
          `select status from invoices where payment_id='${recovery}'`,
        )
      ).rows,
    ).toEqual([{ status: "pending" }]);
    expect(
      (
        await db.query(
          `select actor_id,action from audit_logs where target_id='${recovery}'`,
        )
      ).rows,
    ).toEqual([{ actor_id: admin, action: "provider_identity_recovered" }]);
    expect(
      (
        await db.query(
          `select count(*)::int n from payment_events where payment_id='${recovery}' and event_type='provider_identity_recovered'`,
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("never replaces an already-bound provider, address or amount", async () => {
    await asRole("service_role", bind());
    for (const sql of [
      bind("123"),
      bind("987", "other-address"),
      bind("987", "fixture-address", "1"),
    ]) {
      await expect(asRole("service_role", sql)).rejects.toThrow(
        /cannot be rebound/,
      );
    }
    expect(
      (
        await db.query(
          `select provider_payment_id,payment_address,expected_amount from payments where id='${recovery}'`,
        )
      ).rows,
    ).toEqual([
      {
        provider_payment_id: "987",
        payment_address: "fixture-address",
        expected_amount: "99.5",
      },
    ]);
  });
  it("rolls identity and event back on audit failure; an identical retry succeeds", async () => {
    await db.exec(`create function fail_recovery_audit_fixture() returns trigger language plpgsql as $$begin if new.action='provider_identity_recovered' then raise exception 'fixture recovery audit failure';end if;return new;end$$;
      create trigger fail_recovery_audit_fixture before insert on audit_logs for each row execute function fail_recovery_audit_fixture();`);
    await expect(asRole("service_role", bind())).rejects.toThrow(
      /fixture recovery audit failure/,
    );
    expect(
      (
        await db.query(
          `select provider_payment_id,status from payments where id='${recovery}'`,
        )
      ).rows,
    ).toEqual([{ provider_payment_id: null, status: "pending" }]);
    expect(
      (
        await db.query(
          `select count(*)::int n from payment_events where payment_id='${recovery}'`,
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    await db.exec(
      "drop trigger fail_recovery_audit_fixture on audit_logs; drop function fail_recovery_audit_fixture()",
    );
    await asRole("service_role", bind());
    expect(
      (await db.query(`select status from payments where id='${recovery}'`))
        .rows,
    ).toEqual([{ status: "awaiting_confirmation" }]);
  });
});
