import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeDb } from "./fake-supabase";

/**
 * Shared setup for the video-route tests: an in-memory Supabase service client,
 * a fake signed-in admin, and helpers to build requests.
 */

export const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
export const CATEGORY_ID = "cat-boudoir";

export interface Harness {
  db: FakeDb;
  service: any;
  auth: any;
  fake: ReturnType<typeof createFakeSupabase>;
}

/** Adds the bits of the Supabase client the video routes use. */
export function withExtras(client: any, db: FakeDb, userId = ADMIN_ID) {
  client.storage = {
    from: (bucket: string) => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.com/${bucket}/${path}` } }),
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `signed://${path}` }, error: null }),
      remove: async () => ({ data: [], error: null }),
    }),
  };
  // `transit_prefix`-style helpers read the current user id from the row prefix.
  client.__userId = userId;
  return client;
}

/** A fresh DB with one active admin and one category, plus a signed-in session. */
export function createHarness(overrides: Partial<FakeDb> = {}): Harness {
  const fake = createFakeSupabase({
    profiles: [{ id: ADMIN_ID, role: "admin", status: "active" }],
    categories: [{ id: CATEGORY_ID, label: "Boudoir" }],
    videos: [],
    tags: [],
    video_tags: [],
    upload_jobs: [],
    audit_logs: [],
    ...overrides,
  });
  const service = withExtras(fake.client, fake.db);
  const auth = {
    auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID } } }) },
    from: fake.client.from,
  };
  return { db: fake.db, service, auth, fake };
}

export function jsonRequest(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

export function multipartRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: "------x\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nbytes\r\n------x--",
    headers: { "content-type": "multipart/form-data; boundary=----x" },
  });
}

export function getRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: "GET" });
}