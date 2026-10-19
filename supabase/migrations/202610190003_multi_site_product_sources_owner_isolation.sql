-- Scope the shared product-source catalogue to the signed-in owner.
-- The source/draft tables were verified empty before this migration.
alter table public.multi_site_product_sources
  add column if not exists created_by uuid references auth.users(id) on delete cascade;

alter table public.multi_site_product_sources
  alter column created_by set not null;

alter table public.multi_site_product_sources
  drop constraint if exists multi_site_product_sources_site_key_source_product_id_key;

drop index if exists public.multi_site_product_sources_site_key_source_product_id_key;

create unique index if not exists multi_site_product_sources_owner_site_product_unique_idx
  on public.multi_site_product_sources(site_key, source_product_id, created_by);

drop policy if exists "Authenticated users can read multi-site product sources" on public.multi_site_product_sources;
drop policy if exists "Users can read own multi-site product sources" on public.multi_site_product_sources;
create policy "Users can read own multi-site product sources"
  on public.multi_site_product_sources for select to authenticated
  using (auth.uid() = created_by);

drop policy if exists "Users can insert own multi-site product sources" on public.multi_site_product_sources;
create policy "Users can insert own multi-site product sources"
  on public.multi_site_product_sources for insert to authenticated
  with check (auth.uid() = created_by and site_key in ('transport','safari'));

drop policy if exists "Users can update own multi-site product sources" on public.multi_site_product_sources;
create policy "Users can update own multi-site product sources"
  on public.multi_site_product_sources for update to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by and site_key in ('transport','safari'));

revoke all on public.multi_site_product_sources from anon;
grant select, insert, update on public.multi_site_product_sources to authenticated;

drop policy if exists "Users can insert own multi-site drafts" on public.multi_site_product_drafts;
create policy "Users can insert own multi-site drafts"
  on public.multi_site_product_drafts for insert to authenticated
  with check (
    auth.uid() = created_by
    and publication_authorized = false
    and status in ('DRAFT_REVIEW','NEEDS_FACTS','REJECTED')
  );

revoke all on public.multi_site_product_drafts from anon;
grant select, insert, update on public.multi_site_product_drafts to authenticated;
