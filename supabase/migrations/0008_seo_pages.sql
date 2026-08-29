-- ═══════════════════════════════════════════════════════════════
-- EroBabe — migration 0008: per-page SEO overrides
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste all → Run
--   (Run 0001–0007 first. Safe to re-run.)
--
-- WHAT IT DOES
--   Stores admin-editable SEO metadata for individual pages. `path_key`
--   identifies the page: "home", "category:{slug}", "video:{idOrSlug}".
--   Every column is nullable — NULL means "use the smart default the
--   front-end generates from real content", so admins only override
--   what they actually want to change.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.seo_pages (
  id            uuid primary key default gen_random_uuid(),
  -- "home" | "category:{slug}" | "video:{id}" | custom path
  path_key      text not null unique,
  -- Human label shown in the CMS
  label         text,
  seo_title           text,
  meta_description    text,
  keywords            text,
  canonical_url       text,
  -- "index,follow" | "noindex,follow" | "index,nofollow" | "noindex,nofollow"
  robots              text,
  og_title            text,
  og_description      text,
  og_image            text,
  -- Extra JSON-LD, merged into the page's schema graph
  json_ld             text,
  -- When false the page is omitted from sitemap.xml
  in_sitemap          boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists seo_pages_path_key_idx on public.seo_pages (path_key);

alter table public.seo_pages enable row level security;

-- Only the service role (serverless admin API) may read or write these.
-- Anonymous visitors never query this table directly; the public API
-- merges overrides into its responses server-side.
drop policy if exists "seo_admin_only" on public.seo_pages;
create policy "seo_admin_only" on public.seo_pages
  for all using (false) with check (false);

-- Verify
select path_key, label, seo_title, in_sitemap from public.seo_pages;
