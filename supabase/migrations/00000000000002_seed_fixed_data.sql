-- Seed fixed inventory: 10 ad slots, category taxonomy (12 categories), site settings

-- 10 fixed ad placements, $99/month = 9900 cents, 16:9
insert into public.ad_slots (id, name, side, position, price_cents, status, description) values
  (1, 'Left Sidebar Top', 'left', 1, 9900, 'available', 'Premium left rail top placement, 16:9'),
  (2, 'Left Sidebar 2', 'left', 2, 9900, 'available', 'Left rail second placement, 16:9'),
  (3, 'Left Sidebar 3', 'left', 3, 9900, 'available', 'Left rail third placement, 16:9'),
  (4, 'Left Sidebar 4', 'left', 4, 9900, 'available', 'Left rail fourth placement, 16:9'),
  (5, 'Left Sidebar Bottom', 'left', 5, 9900, 'available', 'Left rail bottom placement, 16:9'),
  (6, 'Right Sidebar Top', 'right', 1, 9900, 'available', 'Premium right rail top placement, 16:9'),
  (7, 'Right Sidebar 2', 'right', 2, 9900, 'available', 'Right rail second placement, 16:9'),
  (8, 'Right Sidebar 3', 'right', 3, 9900, 'available', 'Right rail third placement, 16:9'),
  (9, 'Right Sidebar 4', 'right', 4, 9900, 'available', 'Right rail fourth placement, 16:9'),
  (10, 'Right Sidebar Bottom', 'right', 5, 9900, 'available', 'Right rail bottom placement, 16:9')
on conflict (id) do update set
  name = excluded.name,
  side = excluded.side,
  position = excluded.position,
  price_cents = excluded.price_cents,
  description = excluded.description;

-- Category taxonomy (12 categories from original design, but without fake counts)
-- slug generation matches src/data/content.ts categorySlug logic
insert into public.categories (label, slug, icon) values
  ('Mature', 'mature', 'flame'),
  ('Amateur', 'amateur', 'camera'),
  ('POV', 'pov', 'eye'),
  ('Lesbian', 'lesbian', 'users'),
  ('Kinky', 'kinky', 'mask'),
  ('Mature 18+', 'mature-18plus', 'wine'),
  ('Couples', 'couples', 'heart'),
  ('Boudoir', 'boudoir', 'sparkles'),
  ('Romantic', 'romantic', 'heart'),
  ('Solo', 'solo', 'user'),
  ('Roleplay', 'roleplay', 'drama'),
  ('Massage', 'massage', 'flower')
on conflict (label) do update set
  slug = excluded.slug,
  icon = excluded.icon;

-- Site settings baseline (owner must provide real contact details before launch)
update public.site_settings set
  site_title = 'erobabe',
  tagline = 'Your destination for discovering premium adult entertainment. 18+ adults only.',
  slot_price_cents = 9900,
  support_email = 'support@erobabe.com',
  contact_email = 'contact@erobabe.com',
  brand_logo_url = 'https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png',
  maintenance_mode = false,
  mature_warning = true
where id = 1;
