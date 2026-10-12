import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeDb } from "./fake-supabase";

export const ADMIN_ID = "admin-1";
export const OTHER_ADMIN_ID = "admin-2";
export const CATEGORY_ID = "cat-1";

type Row = Record<string, any>;

export interface HarnessOptions {
  /** `null` = anonymous. */
  user?: { id: string } | null;
  profile?: Row | null;
  seed?: Partial<FakeDb> & Record<string, Row[]>;
}

/**
 * An in-memory database plus the two Supabase clients the video routes use:
 * the cookie-bound auth client (`createClient`) and the service-role client
 * (`createServiceClient`). Storage is stubbed just enough for thumbnails.
 */
export function createVideoHarness(options: HarnessOptions = {}) {
  const user = options.user === undefined ? { id: ADMIN_ID } : options.user;
  const profile =
    options.profile === undefined ? { id: ADMIN_ID, role: "admin", status: "active" } : options.profile;

  const fake = createFakeSupabase({
    profiles: [
      ...(profile ? [profile] : []),
      { id: OTHER_ADMIN_ID, role: "admin", status: "active" },
    ],
    categories: [{ id: CATEGORY_ID, label: "Mature" }],
    videos: [],
    upload_jobs: [],
    tags: [],
    video_tags: [],
    ...(options.seed || {}),
  });

  const storage = {
    from: (bucket: string) => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      remove: async () => ({ data: [], error: null }),
    }),
  };

  /** Make inserts into a table fail, to exercise cleanup paths. */
  const failing = new Map<string, unknown>();
  const service = {
    storage,
    from: (table: string) => {
      const query: any = fake.client.from(table);
      if (failing.has(table)) {
        const failure: any = {
          select: () => failure,
          single: () => failure,
          maybeSingle: () => failure,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: failing.get(table) ?? new Error(`insert into ${table} failed`) }).then(resolve),
        };
        query.insert = () => failure;
      }
      return query;
    },
  };

  const authFor = (userId: string | null) => ({
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from: (table: string) => fake.client.from(table),
  });
  const auth = authFor(user ? user.id : null);

  return {
    db: fake.db,
    fake,
    service,
    auth,
    authFor,
    failInserts(table: string, error?: unknown) {
      failing.set(table, error);
    },
    jobs: () => fake.db.upload_jobs as Row[],
    videos: () => fake.db.videos as Row[],
  };
}

export type VideoHarness = ReturnType<typeof createVideoHarness>;

export function jsonRequest(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(url, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
