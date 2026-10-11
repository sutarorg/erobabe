/**
 * Minimal in-memory stand-in for the Supabase service client.
 *
 * It implements just the subset of the PostgREST builder used by the Bcon
 * payment code (`select/insert/update`, `eq/in/limit/single/contains`) so the
 * callback verification logic can be tested against real rows instead of a
 * mocked return value per call.
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

function matchesFilters(row: Row, filters: Array<[string, any]>, contains: Array<[string, any]>): boolean {
  for (const [column, value] of filters) {
    if (Array.isArray(value)) {
      if (!value.includes(row[column])) return false;
    } else if (row[column] !== value) {
      return false;
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

class Query implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private filters: Array<[string, any]> = [];
  private containsFilters: Array<[string, any]> = [];
  private limitCount: number | null = null;
  private singleRow = false;
  private action: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(_columns?: string) {
    return this;
  }

  insert(payload: Row) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push([column, value]);
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push([column, values]);
    return this;
  }

  contains(column: string, subset: any) {
    this.containsFilters.push([column, subset]);
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
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: any; error: any } {
    const rows = (this.db[this.table] ||= []);

    if (this.action === "insert") {
      const row = { id: `fake-${this.table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...(this.payload || {}) };
      rows.push(row);
      if (this.singleRow) return { data: row, error: null };
      return { data: [row], error: null };
    }

    const matching = rows.filter((row) => matchesFilters(row, this.filters, this.containsFilters));

    if (this.action === "update") {
      for (const row of matching) Object.assign(row, this.payload || {});
      return { data: matching, error: null };
    }

    const limited = this.limitCount === null ? matching : matching.slice(0, this.limitCount);
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
    },
  };
}

export function makePayment(overrides: Row = {}): Row {
  return {
    id: "payment-1",
    advertiser_id: "advertiser-1",
    invoice_number: "INV-1",
    external_id: "EABC1234",
    amount_cents: 9900,
    currency: "USD",
    payment_currency: "USDT",
    chain: "ethereum",
    payment_address: "0x72E4CF05e4A6b123623B7443fBF8C83BD14182f1",
    expected_amount: "99.00000000",
    transaction_id: null,
    status: "awaiting_confirmation",
    bcon_response: null,
    confirmed_at: null,
    expires_at: null,
    ...overrides,
  };
}
