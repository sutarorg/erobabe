/**
 * Minimal in-memory stand-in for the Supabase service client.
 *
 * It implements just the subset of the PostgREST builder used by the
 * NOWPayments payment code (`select/insert/update`,
 * `eq/neq/is/in/lte/gte/limit/single/contains`) so the IPN verification logic
 * can be tested against real rows instead of a mocked return value per call.
 */

type Row = Record<string, any>;

export interface FakeDb {
  payments: Row[];
  payment_events: Row[];
  invoices: Row[];
  campaigns: Row[];
  ad_creatives: Row[];
  audit_logs: Row[];
  [table: string]: Row[];
}

type Filter =
  | { kind: "eq"; column: string; value: any }
  | { kind: "neq"; column: string; value: any }
  | { kind: "is"; column: string; value: any }
  | { kind: "in"; column: string; value: any[] }
  | { kind: "lte"; column: string; value: any }
  | { kind: "gte"; column: string; value: any }
  | { kind: "ilike"; column: string; value: string }
  | { kind: "like"; column: string; value: string }
  | { kind: "not_is"; column: string; value: any };

function matchesFilters(
  row: Row,
  filters: Filter[],
  contains: Array<[string, any]>,
): boolean {
  for (const filter of filters) {
    const actual = row[filter.column];
    switch (filter.kind) {
      case "eq":
        if (actual !== filter.value) return false;
        break;
      case "neq":
        if (actual === filter.value) return false;
        break;
      case "is":
        if (filter.value === null) {
          if (actual !== null && actual !== undefined) return false;
        } else if (actual !== filter.value) {
          return false;
        }
        break;
      case "in":
        if (!filter.value.includes(actual)) return false;
        break;
      case "lte":
        if (actual > filter.value) return false;
        break;
      case "gte":
        if (actual < filter.value) return false;
        break;
      case "ilike":
        if (String(actual ?? "").toLowerCase() !== filter.value.toLowerCase())
          return false;
        break;
      case "like": {
        // Supports the `%` wildcard only, which is all the app uses.
        const pattern = new RegExp(
          `^${filter.value
            .split("%")
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*")}$`,
        );
        if (typeof actual !== "string" || !pattern.test(actual)) return false;
        break;
      }
      case "not_is":
        if (actual === null || actual === undefined) return false;
        break;
    }
  }
  for (const [column, subset] of contains) {
    const value = row[column];
    if (!value || typeof value !== "object") return false;
    for (const [key, expected] of Object.entries(subset)) {
      if (value[key] !== expected) return false;
    }
  }
  return true;
}

class Query
  implements PromiseLike<{ data: any; error: any; count?: number | null }>
{
  private filters: Filter[] = [];
  private containsFilters: Array<[string, any]> = [];
  private limitCount: number | null = null;
  private singleRow = false;
  private action: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_columns?: string) {
    return this;
  }

  insert(payload: Row | Row[]) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  /** Treated as an insert for test purposes — conflicts are not modelled. */
  upsert(payload: Row | Row[], _options?: { onConflict?: string }) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  is(column: string, value: any) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push({ kind: "in", column, value: values });
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  like(column: string, value: string) {
    this.filters.push({ kind: "like", column, value });
    return this;
  }

  not(column: string, operator: string, value: any) {
    if (operator === "is") this.filters.push({ kind: "not_is", column, value });
    return this;
  }

  contains(column: string, subset: any) {
    this.containsFilters.push([column, subset]);
    return this;
  }

  ilike(column: string, pattern: string) {
    const literal = pattern.replace(/\\(.)/g, "$1").toLowerCase();
    this.filters.push({ kind: "ilike", column, value: literal });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleRow = true;
    this.limitCount = 1;
    return this;
  }

  maybeSingle() {
    return this.single();
  }

  order() {
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: any; error: any } {
    const rows = (this.db[this.table] ||= []);

    if (this.action === "insert") {
      const payloads = Array.isArray(this.payload)
        ? this.payload
        : [this.payload || {}];
      const inserted = payloads.map((entry) => {
        const row = {
          id: `fake-${this.table}-${rows.length + 1}`,
          created_at: new Date().toISOString(),
          ...entry,
        };
        rows.push(row);
        return row;
      });
      if (this.singleRow) return { data: inserted[0] ?? null, error: null };
      return { data: inserted, error: null };
    }

    const matching = rows.filter((row) =>
      matchesFilters(row, this.filters, this.containsFilters),
    );

    if (this.action === "update") {
      for (const row of matching) Object.assign(row, this.payload || {});
      if (this.singleRow) return { data: matching[0] ?? null, error: null };
      return { data: matching, error: null };
    }

    if (this.action === "delete") {
      const remaining = rows.filter(
        (row) => !matchesFilters(row, this.filters, this.containsFilters),
      );
      this.db[this.table] = remaining;
      return { data: matching, error: null };
    }

    const limited =
      this.limitCount === null ? matching : matching.slice(0, this.limitCount);
    if (this.singleRow) return { data: limited[0] ?? null, error: null };
    return { data: limited, error: null };
  }
}

export function createFakeSupabase(seed: Partial<FakeDb> = {}) {
  const db: FakeDb = {
    payments: [],
    payment_events: [],
    invoices: [],
    campaigns: [],
    ad_creatives: [],
    audit_logs: [],
    ...seed,
  };

  return {
    db,
    client: {
      from: (table: string) => new Query(db, table),
      // Route-test boundary only. Real SQL/role/transaction behavior is tested
      // independently in launch-integrity-schema.test.ts using all migrations.
      rpc: async (name: string, args: Row) => {
        const p = db.payments.find((p) => p.id === args.p_payment);
        if (!p) return { data: null, error: new Error("Payment not found") };
        if (name === "bind_nowpayment") {
          const admin = db.profiles?.find((row) => row.id === args.p_admin);
          if (admin?.role !== "admin" || admin.status !== "active")
            return { error: new Error("Active admin required") };
          if (p.provider !== "nowpayments")
            return { error: new Error("Payment not found") };
          if (p.provider_payment_id) {
            return p.provider_payment_id === args.p_provider &&
              p.payment_address === args.p_address &&
              Number(p.expected_amount) === Number(args.p_amount)
              ? { data: null, error: null }
              : { error: new Error("Payment cannot be rebound") };
          }
          if (p.status !== "pending")
            return { error: new Error("Payment cannot be recovered") };
          p.provider_payment_id = args.p_provider;
          p.payment_address = args.p_address;
          p.expected_amount = args.p_amount;
          p.status = "awaiting_confirmation";
          db.payment_events.push({
            payment_id: p.id,
            event_type: "provider_identity_recovered",
            payload: {
              actor_id: args.p_admin,
              provider_payment_id: args.p_provider,
            },
          });
          db.audit_logs.push({
            actor_id: args.p_admin,
            action: "provider_identity_recovered",
            target_id: p.id,
          });
        } else if (name === "claim_checkout") {
          const campaigns = db.campaigns.filter((c) =>
            args.p_campaigns.includes(c.id),
          );
          if (
            campaigns.length !== args.p_campaigns.length ||
            campaigns.some((c) => c.payment_id)
          )
            return { error: new Error("Claim failed") };
          const invoice = {
            id: `invoice-${db.invoices.length + 1}`,
            payment_id: p.id,
            number: p.invoice_number,
            status: "pending",
            amount_cents: p.amount_cents,
          };
          db.invoices.push(invoice);
          campaigns.forEach((c) => {
            c.payment_id = p.id;
            c.invoice_id = invoice.id;
          });
        } else if (name === "settle_nowpayment") {
          if (p.provider_payment_id !== args.p_provider)
            return { error: new Error("Identity mismatch") };
          if (
            ["refunded", "failed", "expired"].includes(p.status) ||
            (p.status === "confirmed" && args.p_status !== "refunded")
          )
            return { data: null, error: null };
          if (
            args.p_status === "confirmed" &&
            !args.p_evidence?.amount_verified
          )
            return { error: new Error("Verification required") };
          p.status = args.p_status;
          p.provider_response = args.p_evidence;
          p.provider_status = args.p_evidence.provider_status;
          if (p.status === "confirmed")
            p.confirmed_at = new Date().toISOString();
          for (const i of db.invoices.filter(
            (i) => i.payment_id === p.id || i.number === p.invoice_number,
          )) {
            i.status =
              p.status === "confirmed"
                ? "paid"
                : ["underpaid", "overpaid"].includes(p.status)
                  ? "pending"
                  : p.status;
            if (p.status === "confirmed") i.paid_at = p.confirmed_at;
          }
          for (const c of db.campaigns.filter((c) => c.payment_id === p.id)) {
            if (p.status === "confirmed" && c.status === "pending_payment")
              c.status =
                db.ad_creatives.find((a) => a.id === c.creative_id)?.status ===
                "approved"
                  ? "active"
                  : "pending_review";
            else if (
              ["failed", "expired"].includes(p.status) &&
              c.status === "pending_payment"
            )
              c.status = "cancelled";
            else if (
              ["refunded", "underpaid", "overpaid"].includes(p.status) &&
              ["active", "pending_review"].includes(c.status)
            )
              c.status = "paused";
          }
          db.payment_events.push({
            payment_id: p.id,
            event_type: p.status,
            payload: args.p_evidence,
          });
        } else return { error: new Error(`Unknown RPC ${name}`) };
        return { data: null, error: null };
      },
    },
  };
}

export function makePayment(overrides: Row = {}): Row {
  return {
    id: "payment-1",
    advertiser_id: "advertiser-1",
    invoice_number: "INV-1",
    provider: "nowpayments",
    provider_payment_id: "5730453421",
    provider_status: "waiting",
    amount_cents: 9900,
    currency: "USD",
    payment_currency: "USDT",
    pay_currency: "usdterc20",
    chain: "ethereum",
    payment_address: "0x72E4CF05e4A6b123623B7443fBF8C83BD14182f1",
    expected_amount: "99.5",
    transaction_id: null,
    status: "awaiting_confirmation",
    provider_response: null,
    bcon_response: null,
    confirmed_at: null,
    expires_at: null,
    ...overrides,
  };
}
