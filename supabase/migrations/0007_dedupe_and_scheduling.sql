-- ═══════════════════════════════════════════════════════════════
-- EroBabe — migration 0007: duplicate detection & scheduled publishing
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste all → Run
--   (Run 0001–0006 first. Safe to re-run.)
--
-- WHAT IT DOES
--   1. content_hash        — fingerprint of the ORIGINAL source file, so
--                            re-uploading the same video is detected.
--   2. scheduled_publish_at— when a draft should flip to published, used
--                            by the bulk-upload hourly release schedule.
--   3. bulk_batch          — groups videos uploaded in one bulk action.
-- ═══════════════════════════════════════════════════════════════

alter table public.videos add column if not exists content_hash         text;
alter table public.videos add column if not exists scheduled_publish_at timestamptz;
alter table public.videos add column if not exists bulk_batch           text;

-- Fingerprint lookups must be fast; duplicates are allowed to exist
-- (the admin may knowingly re-upload) so this is a plain index.
create index if not exists videos_content_hash_idx on public.videos (content_hash)
  where content_hash is not null;

create index if not exists videos_scheduled_idx on public.videos (scheduled_publish_at)
  where scheduled_publish_at is not null;

create index if not exists videos_bulk_batch_idx on public.videos (bulk_batch)
  where bulk_batch is not null;

-- Publish every draft whose scheduled time has arrived. Called by the
-- cron endpoint and, as a fallback, lazily from public API reads.
create or replace function public.publish_due_videos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.videos
  set status               = 'published',
      published_at         = coalesce(published_at, now()),
      scheduled_publish_at = null,
      updated_at           = now()
  where scheduled_publish_at is not null
    and scheduled_publish_at <= now()
    and status in ('draft', 'ready')
    and (video_url is not null or hls_url is not null);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.publish_due_videos() to anon;

-- Verify
select id, title, status, scheduled_publish_at, bulk_batch
from public.videos
where scheduled_publish_at is not null
order by scheduled_publish_at;
