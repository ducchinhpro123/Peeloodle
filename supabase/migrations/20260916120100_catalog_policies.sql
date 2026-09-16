-- Catalog authorization (P47) and Storage policies (P48).
--
-- The rule the policies encode: anonymous and ordinary signed-in users may read
-- published metadata and the derivatives of the currently published version
-- only; admins may read drafts; nobody gets direct write access to catalog
-- tables — every mutation goes through a security-definer RPC. Admin membership
-- is backend-controlled (`catalog_admins` has no policies at all, so even an
-- admin cannot read or change the membership list through the client API), and
-- the bootstrap/recovery step is plain SQL documented in supabase/README.md.

create function public.catalog_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.catalog_admins a
    where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.catalog_is_admin() from public, anon;
grant execute on function public.catalog_is_admin() to authenticated;

alter table public.catalog_admins enable row level security;
alter table public.catalog_collections enable row level security;
alter table public.catalog_assets enable row level security;
alter table public.catalog_asset_versions enable row level security;
alter table public.catalog_templates enable row level security;
alter table public.catalog_template_versions enable row level security;
alter table public.catalog_template_dependencies enable row level security;
alter table public.catalog_upload_batches enable row level security;
alter table public.catalog_upload_jobs enable row level security;
alter table public.catalog_events enable row level security;

-- No policy on catalog_admins: membership is invisible to the client API.

create policy catalog_collections_published_read on public.catalog_collections
  for select to anon, authenticated using (state = 'published');
create policy catalog_collections_admin_read on public.catalog_collections
  for select to authenticated using (public.catalog_is_admin());

create policy catalog_assets_published_read on public.catalog_assets
  for select to anon, authenticated using (state = 'published');
create policy catalog_assets_admin_read on public.catalog_assets
  for select to authenticated using (public.catalog_is_admin());

create policy catalog_asset_versions_published_read on public.catalog_asset_versions
  for select to anon, authenticated using (
    exists (
      select 1 from public.catalog_assets a
      where a.id = catalog_asset_versions.asset_id
        and a.state = 'published'
        and a.published_version_id = catalog_asset_versions.id
    )
  );
create policy catalog_asset_versions_admin_read on public.catalog_asset_versions
  for select to authenticated using (public.catalog_is_admin());

create policy catalog_templates_published_read on public.catalog_templates
  for select to anon, authenticated using (state = 'published');
create policy catalog_templates_admin_read on public.catalog_templates
  for select to authenticated using (public.catalog_is_admin());

create policy catalog_template_versions_published_read on public.catalog_template_versions
  for select to anon, authenticated using (
    exists (
      select 1 from public.catalog_templates t
      where t.id = catalog_template_versions.template_id
        and t.state = 'published'
        and t.published_version_id = catalog_template_versions.id
    )
  );
create policy catalog_template_versions_admin_read on public.catalog_template_versions
  for select to authenticated using (public.catalog_is_admin());

create policy catalog_template_dependencies_published_read on public.catalog_template_dependencies
  for select to anon, authenticated using (
    exists (
      select 1 from public.catalog_template_versions v
      join public.catalog_templates t on t.id = v.template_id
      where v.id = catalog_template_dependencies.template_version_id
        and t.state = 'published'
        and t.published_version_id = v.id
    )
  );
create policy catalog_template_dependencies_admin_read on public.catalog_template_dependencies
  for select to authenticated using (public.catalog_is_admin());

create policy catalog_upload_batches_admin_read on public.catalog_upload_batches
  for select to authenticated using (public.catalog_is_admin());
create policy catalog_upload_jobs_admin_read on public.catalog_upload_jobs
  for select to authenticated using (public.catalog_is_admin());
create policy catalog_events_admin_read on public.catalog_events
  for select to authenticated using (public.catalog_is_admin());

-- Reads only: the guarded RPCs in the next migration own every write.
revoke all on public.catalog_admins, public.catalog_collections, public.catalog_assets,
  public.catalog_asset_versions, public.catalog_templates, public.catalog_template_versions,
  public.catalog_template_dependencies, public.catalog_upload_batches, public.catalog_upload_jobs,
  public.catalog_events from anon, authenticated;
grant select on public.catalog_collections, public.catalog_assets, public.catalog_asset_versions,
  public.catalog_templates, public.catalog_template_versions, public.catalog_template_dependencies
  to anon, authenticated;
grant select on public.catalog_upload_batches, public.catalog_upload_jobs, public.catalog_events
  to authenticated;

-- Private buckets: sources and drafts stay private; derivatives become readable
-- only while the immutable version that names them is the published one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('catalog-sources', 'catalog-sources', false, 20971520,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('catalog-derivatives', 'catalog-derivatives', false, 20971520,
    array['image/png', 'image/webp'])
on conflict (id) do nothing;

create policy catalog_sources_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'catalog-sources' and public.catalog_is_admin());
create policy catalog_sources_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalog-sources'
    and public.catalog_is_admin()
    and exists (
      select 1 from public.catalog_upload_batches b
      where b.id::text = (storage.foldername(name))[1]
        and b.created_by = (select auth.uid())
        and b.state = 'open'
    )
  );

create policy catalog_derivatives_published_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'catalog-derivatives'
    and (
      exists (
        select 1 from public.catalog_asset_versions v
        join public.catalog_assets a on a.id = v.asset_id
        where a.state = 'published' and a.published_version_id = v.id
          and (v.derivative_path = storage.objects.name or v.thumbnail_path = storage.objects.name)
      )
      or exists (
        select 1 from public.catalog_template_versions v
        join public.catalog_templates t on t.id = v.template_id
        where t.state = 'published' and t.published_version_id = v.id
          and (
            v.cover_path = storage.objects.name
            or exists (
              select 1 from jsonb_array_elements(v.slide_previews) preview
              where preview->>'path' = storage.objects.name
            )
          )
      )
    )
  );
create policy catalog_derivatives_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'catalog-derivatives' and public.catalog_is_admin());
create policy catalog_derivatives_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalog-derivatives'
    and public.catalog_is_admin()
    and storage.objects.name ~ '^(assets|templates)/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'
  );
-- No update/delete policies anywhere: uploaded sources and derivatives are
-- immutable, and replacing a derivative is a new version row, not an overwrite.
