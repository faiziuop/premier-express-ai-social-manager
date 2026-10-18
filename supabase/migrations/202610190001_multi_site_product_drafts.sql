create table if not exists public.multi_site_product_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  site_key text not null check (site_key in ('transport','safari')),
  target_site text not null check (target_site in ('https://transport.dubaipremiertourism.com','https://safari.dubaipremiertourism.com')),
  product_title text not null, product_type text not null, focus_keyphrase text not null,
  related_keyphrases jsonb not null default '[]'::jsonb, verified_facts text not null,
  audience text not null default '', notes text not null default '',
  seo_title text not null default '', meta_description text not null default '',
  focus_synonyms jsonb not null default '[]'::jsonb, related_keyphrase_synonyms jsonb not null default '[]'::jsonb,
  short_description text not null default '', content_html text not null default '', faq_json jsonb not null default '[]'::jsonb,
  status text not null default 'DRAFT_REVIEW' check (status in ('DRAFT_REVIEW','NEEDS_FACTS','APPROVED_FOR_PUBLISH','PUBLISHED','REJECTED')),
  content_score integer, seo_score integer,
  generation_model text not null default 'gemini-2.5-flash',
  duplicate_check_status text not null default 'NOT_RUN' check (duplicate_check_status in ('NOT_RUN','PASSED','FAILED','REVIEW_REQUIRED')),
  publication_authorized boolean not null default false check (publication_authorized = false or status in ('APPROVED_FOR_PUBLISH','PUBLISHED')),
  published_product_id bigint, published_url text, review_notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists multi_site_product_drafts_site_created_idx on public.multi_site_product_drafts(site_key, created_at desc);
create index if not exists multi_site_product_drafts_owner_idx on public.multi_site_product_drafts(created_by, created_at desc);
alter table public.multi_site_product_drafts enable row level security;
drop policy if exists "Users can read own multi-site drafts" on public.multi_site_product_drafts;
create policy "Users can read own multi-site drafts" on public.multi_site_product_drafts for select to authenticated using (auth.uid() = created_by);
drop policy if exists "Users can update own multi-site drafts" on public.multi_site_product_drafts;
create policy "Users can update own multi-site drafts" on public.multi_site_product_drafts for update to authenticated using (auth.uid() = created_by) with check (auth.uid() = created_by and publication_authorized = false and status in ('DRAFT_REVIEW','NEEDS_FACTS','REJECTED'));
revoke all on public.multi_site_product_drafts from anon;
grant select, update on public.multi_site_product_drafts to authenticated;
