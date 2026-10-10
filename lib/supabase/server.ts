import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function createMockClient() {
  const mockData = { data: [], count: 0, error: null };
  const mockSingle = { data: null, error: null };
  const handler: any = {
    get(target: any, prop: string) {
      if (prop === "auth") {
        return {
          getUser: async () => ({ data: { user: null }, error: null }),
        };
      }
      if (prop === "then") return undefined; // to avoid being thenable
      // For any method, return a function that returns proxy for chaining, except final
      return (..._args: any[]) => {
        // If method is supposed to be terminal like single, limit, etc, return mock data
        if (["single", "maybeSingle"].includes(prop)) {
          return Promise.resolve(mockSingle);
        }
        if (["limit", "order", "select", "eq", "neq", "lte", "gte", "in", "ilike"].includes(prop)) {
          // Return proxy that continues chain
          return new Proxy({}, {
            get(_t, p: string) {
              if (p === "then") return undefined;
              if (["single", "maybeSingle"].includes(p)) {
                return () => Promise.resolve(mockSingle);
              }
              if (["limit", "order", "select", "eq", "neq", "lte", "gte", "in", "ilike"].includes(p)) {
                return (...__args: any[]) => new Proxy({}, {
                  get(__t, pp: string) {
                    if (pp === "then") {
                      // When awaited, resolve to mockData
                      return (resolve: any) => resolve(mockData);
                    }
                    if (pp === "single" || pp === "maybeSingle") {
                      return () => Promise.resolve(mockSingle);
                    }
                    return (...___args: any[]) => new Proxy({}, {
                      get(___t, ppp: string) {
                        if (ppp === "then") return (resolve: any) => resolve(mockData);
                        if (ppp === "single") return () => Promise.resolve(mockSingle);
                        return () => Promise.resolve(mockData);
                      }
                    });
                  }
                });
              }
              return () => Promise.resolve(mockData);
            }
          });
        }
        return Promise.resolve(mockData);
      };
    }
  };

  // Simpler: just return object where from() returns chainable that resolves to empty
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    from: () => {
      const chain: any = {};
      const methods = ["select", "eq", "neq", "lte", "gte", "in", "ilike", "order", "limit"];
      methods.forEach((m) => {
        chain[m] = () => chain;
      });
      chain.single = async () => ({ data: null, error: null });
      chain.maybeSingle = async () => ({ data: null, error: null });
      // Make chain thenable to return empty array when awaited directly
      chain.then = (resolve: any) => resolve({ data: [], count: 0, error: null });
      return chain;
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  } as any;
}

export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return createMockClient();
  }

  return createServerClient(
    url,
    key,
    {
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
    }
  );
}

// Service role client for server-only operations (payments, callbacks, admin tasks)
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY or URL");
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
