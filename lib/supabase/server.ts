import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Environment validation helpers.
 *
 * These guard against partially-filled or placeholder configuration (e.g. the
 * values from `.env.example`) being deployed: instead of throwing at render
 * time — which surfaces as "Application error: a server-side exception has
 * occurred" — we degrade to a safe, empty read-only client.
 */

const PLACEHOLDER_PATTERNS =
  /(your-project|your_project|placeholder|example\.com|xxxx|\bxxx\b|changeme|todo|<.+>)/i;

export function isValidSupabaseUrl(url?: string | null): url is string {
  if (!url) return false;
  if (PLACEHOLDER_PATTERNS.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function isValidSupabaseKey(key?: string | null): key is string {
  if (!key) return false;
  if (PLACEHOLDER_PATTERNS.test(key)) return false;
  // Supabase publishable keys (sb_publishable_…) and legacy anon JWTs.
  return key.length >= 20;
}

export function isSupabaseConfigured(): boolean {
  return (
    isValidSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    isValidSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );
}

type MockResult = {
  data: any;
  error: null;
  count: number | null;
  status: number;
  statusText: string;
};

const EMPTY_LIST: MockResult = { data: [], error: null, count: 0, status: 200, statusText: "OK" };
const EMPTY_ROW: MockResult = { data: null, error: null, count: null, status: 200, statusText: "OK" };

/**
 * A chainable, awaitable stand-in for a PostgREST query builder. Every method
 * returns another builder and every `await` resolves to an empty result, so no
 * call site can crash when Supabase is not configured.
 */
function createMockQuery(row = false): any {
  const result = row ? EMPTY_ROW : EMPTY_LIST;

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (onFulfilled?: any, onRejected?: any) =>
            Promise.resolve(result).then(onFulfilled, onRejected);
        }
        if (prop === "catch") {
          return (onRejected?: any) => Promise.resolve(result).catch(onRejected);
        }
        if (prop === "finally") {
          return (onFinally?: any) => Promise.resolve(result).finally(onFinally);
        }
        if (prop === "single" || prop === "maybeSingle") return () => createMockQuery(true);
        if (prop === "csv" || prop === "geojson" || prop === "explain") {
          return () => Promise.resolve(result);
        }
        if (typeof prop !== "string") return undefined;
        // Any other builder method simply continues the chain.
        return () => createMockQuery(row);
      },
    }
  );
}

function createMockStorageBucket() {
  return {
    upload: async () => ({ data: null, error: null }),
    update: async () => ({ data: null, error: null }),
    remove: async () => ({ data: [], error: null }),
    list: async () => ({ data: [], error: null }),
    createSignedUrl: async () => ({ data: null, error: null }),
    getPublicUrl: () => ({ data: { publicUrl: "" } }),
  };
}

function createMockClient() {
  const noOpSubscription = { data: { subscription: { unsubscribe() {} } } };

  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: "Supabase is not configured" },
      }),
      signUp: async () => ({
        data: { user: null, session: null },
        error: { message: "Supabase is not configured" },
      }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({
        data: null,
        error: { message: "Supabase is not configured" },
      }),
      updateUser: async () => ({
        data: { user: null },
        error: { message: "Supabase is not configured" },
      }),
      onAuthStateChange: () => noOpSubscription,
    },
    from: () => createMockQuery(),
    rpc: () => createMockQuery(),
    storage: { from: () => createMockStorageBucket() },
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
      unsubscribe() {
        return Promise.resolve("ok");
      },
    }),
    removeChannel: () => Promise.resolve("ok"),
  } as any;
}

let warnedAboutConfig = false;

function warnOnce(message: string) {
  if (warnedAboutConfig) return;
  warnedAboutConfig = true;
  console.warn(message);
}

export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!isValidSupabaseUrl(url) || !isValidSupabaseKey(key)) {
    warnOnce(
      "[supabase] Missing or placeholder NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — serving empty data. Set real values in the Vercel project environment variables."
    );
    return createMockClient();
  }

  try {
    return createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: any[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: any) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    });
  } catch (error) {
    // Never let a bad configuration take a page down.
    warnOnce(`[supabase] Failed to create server client — serving empty data. ${String(error)}`);
    return createMockClient();
  }
}

// Service role client for server-only operations (payments, callbacks, admin tasks)
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isValidSupabaseUrl(url) || !isValidSupabaseKey(serviceKey)) {
    throw new Error(
      "Missing or invalid SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL"
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function tryCreateServiceClient() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}
