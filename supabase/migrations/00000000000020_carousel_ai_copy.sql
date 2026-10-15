-- AI-written homepage carousel copy.
--
-- The homepage hero card is a thumbnail with two short lines of text, so the
-- listing title (written for search) is the wrong text to print there. When an
-- admin puts a video into a carousel slot (1-3), the admin API asks the AI for a
-- headline of at most 5 words and a teaser of at most 10 words and stores them
-- here. The public card reads these columns; the word budget is enforced in
-- code (lib/metadata/carousel-copy.ts), never in the database, so an existing
-- row can never block the page.
--
-- Additive, forward-only, and repeatable: existing rows keep NULL and keep
-- rendering their listing title and description, trimmed to the card budget.
-- Clearing a video's carousel slot clears both columns.

alter table public.videos
  add column if not exists carousel_title text,
  add column if not exists carousel_description text;

comment on column public.videos.carousel_title is
  'AI-written homepage carousel headline for this video, generated when the admin assigns a carousel slot. Max 5 words. NULL means the card falls back to the listing title, trimmed to the same budget.';

comment on column public.videos.carousel_description is
  'AI-written homepage carousel teaser for this video, generated when the admin assigns a carousel slot. Max 10 words. NULL means the card falls back to the listing description, trimmed to the same budget.';
