create table if not exists public.multi_site_product_sources (
  id uuid primary key default gen_random_uuid(),
  site_key text not null check (site_key in ('transport','safari')),
  source_product_id bigint not null,
  source_title text not null,
  source_slug text not null default '',
  source_url text not null default '',
  source_description text not null default '',
  source_short_description text not null default '',
  source_price_reference text not null default '',
  source_categories jsonb not null default '[]'::jsonb,
  source_image_url text not null default '',
  source_data jsonb not null default '{}'::jsonb,
  linked_draft_id uuid references public.multi_site_product_drafts(id) on delete set null,
  generation_attempts integer not null default 0,
  last_generation_error text not null default '',
  last_generation_attempt_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(site_key, source_product_id)
);
create index if not exists multi_site_product_sources_site_title_idx
  on public.multi_site_product_sources(site_key, source_title);
create index if not exists multi_site_product_sources_unprocessed_idx
  on public.multi_site_product_sources(site_key, linked_draft_id) where linked_draft_id is null;
alter table public.multi_site_product_sources enable row level security;
drop policy if exists "Authenticated users can read multi-site product sources" on public.multi_site_product_sources;
create policy "Authenticated users can read multi-site product sources"
  on public.multi_site_product_sources for select to authenticated using (true);
revoke all on public.multi_site_product_sources from anon;
grant select on public.multi_site_product_sources to authenticated;
