-- Admin catalog schema: collections, immutable asset versions, templates, upload
-- bookkeeping and an audit journal. Additive — the private sticker tables and
-- their policies are untouched, and the migration applies on top of them.
--
-- Invariants this file owns (P46):
--   * every version row is immutable after insert (trigger);
--   * a published pointer must reference a version of the same item (trigger);
--   * published state cannot exist without a published pointer (check);
--   * template dependencies pin an exact immutable asset version (composite FK);
--   * revisions are bigint compare-and-set counters for guarded admin edits.
-- Published/archived timestamps and the guard RPCs live in the policy/RPC
-- migrations that follow.

create table public.catalog_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.catalog_collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '' check (length(description) <= 10000),
  tags text[] not null default '{}' check (array_length(tags, 1) is null or array_length(tags, 1) <= 50),
  sort_order integer not null default 0,
  state text not null default 'draft' check (state in ('draft', 'published', 'archived')),
  revision bigint not null default 1 check (revision > 0),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'published' or published_at is not null),
  check (state <> 'archived' or archived_at is not null)
);
create index catalog_collections_browse on public.catalog_collections (state, sort_order, id);

create table public.catalog_assets (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references public.catalog_collections(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '' check (length(description) <= 10000),
  tags text[] not null default '{}' check (array_length(tags, 1) is null or array_length(tags, 1) <= 50),
  kind text not null check (kind in ('raster', 'svg')),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  sort_order integer not null default 0,
  state text not null default 'draft' check (state in ('draft', 'published', 'archived')),
  revision bigint not null default 1 check (revision > 0),
  published_version_id uuid,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'published' or published_version_id is not null),
  check (state <> 'archived' or archived_at is not null)
);
create index catalog_assets_browse on public.catalog_assets (state, collection_id, sort_order, id);
create index catalog_assets_collection on public.catalog_assets (collection_id);

create table public.catalog_asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.catalog_assets(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  source_path text not null check (length(source_path) between 1 and 500),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_bytes bigint not null check (source_bytes between 1 and 20971520),
  source_mime text not null check (length(source_mime) between 3 and 100),
  derivative_path text not null check (length(derivative_path) between 1 and 500),
  derivative_sha256 text not null check (derivative_sha256 ~ '^[a-f0-9]{64}$'),
  derivative_bytes bigint not null check (derivative_bytes between 1 and 20971520),
  derivative_mime text not null check (derivative_mime in ('image/png', 'image/webp')),
  derivative_width integer not null check (derivative_width between 1 and 4096),
  derivative_height integer not null check (derivative_height between 1 and 4096),
  thumbnail_path text check (thumbnail_path is null or length(thumbnail_path) between 1 and 500),
  thumbnail_sha256 text check (thumbnail_sha256 is null or thumbnail_sha256 ~ '^[a-f0-9]{64}$'),
  validation_state text not null default 'pending' check (validation_state in ('pending', 'validated', 'rejected')),
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  created_at timestamptz not null default now(),
  unique (asset_id, version_number),
  -- Redundant with the primary key, required as the target of the template
  -- dependency foreign key so an asset cannot be paired with a foreign version.
  unique (id, asset_id)
);
create index catalog_asset_versions_asset on public.catalog_asset_versions (asset_id, version_number desc);
create index catalog_asset_versions_source on public.catalog_asset_versions (source_sha256);

create table public.catalog_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  use_case text not null check (length(trim(use_case)) between 1 and 100),
  description text not null default '' check (length(description) <= 10000),
  tags text[] not null default '{}' check (array_length(tags, 1) is null or array_length(tags, 1) <= 50),
  sort_order integer not null default 0,
  state text not null default 'draft' check (state in ('draft', 'published', 'archived')),
  revision bigint not null default 1 check (revision > 0),
  published_version_id uuid,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'published' or published_version_id is not null),
  check (state <> 'archived' or archived_at is not null)
);
create index catalog_templates_browse on public.catalog_templates (state, use_case, sort_order, id);

create table public.catalog_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.catalog_templates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  document_bytes bigint not null check (document_bytes between 1 and 10485760),
  cover_path text not null check (length(cover_path) between 1 and 500),
  cover_sha256 text not null check (cover_sha256 ~ '^[a-f0-9]{64}$'),
  slide_previews jsonb not null default '[]'::jsonb
    check (jsonb_typeof(slide_previews) = 'array' and jsonb_array_length(slide_previews) <= 50),
  font_requirements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(font_requirements) = 'array' and jsonb_array_length(font_requirements) <= 32),
  validation_state text not null default 'pending' check (validation_state in ('pending', 'validated', 'rejected')),
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  created_at timestamptz not null default now(),
  unique (template_id, version_number),
  unique (id, template_id)
);
create index catalog_template_versions_template on public.catalog_template_versions (template_id, version_number desc);

create table public.catalog_template_dependencies (
  template_version_id uuid not null references public.catalog_template_versions(id) on delete cascade,
  asset_id uuid not null,
  asset_version_id uuid not null,
  primary key (template_version_id, asset_version_id),
  foreign key (asset_version_id, asset_id) references public.catalog_asset_versions(id, asset_id) on delete restrict
);
create index catalog_template_dependencies_asset on public.catalog_template_dependencies (asset_version_id);

create table public.catalog_upload_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  state text not null default 'open' check (state in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_upload_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.catalog_upload_batches(id) on delete cascade,
  asset_id uuid references public.catalog_assets(id) on delete set null,
  source_path text not null check (length(source_path) between 1 and 500),
  original_name text not null check (length(original_name) between 1 and 300),
  claimed_mime text not null check (length(claimed_mime) between 3 and 100),
  claimed_bytes bigint not null check (claimed_bytes between 1 and 20971520),
  stage text not null default 'queued' check (stage in ('queued', 'claimed', 'ready', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0 check (attempts between 0 and 10),
  lease_token uuid,
  lease_expires_at timestamptz,
  error_code text check (error_code is null or length(error_code) between 1 and 100),
  error_message text check (error_message is null or length(error_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_path),
  check (stage <> 'claimed' or (lease_token is not null and lease_expires_at is not null))
);
create index catalog_upload_jobs_batch on public.catalog_upload_jobs (batch_id, created_at);
create index catalog_upload_jobs_stage on public.catalog_upload_jobs (stage, lease_expires_at);

create table public.catalog_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  operation text not null check (length(operation) between 1 and 100),
  subject_table text not null check (
    subject_table in (
      'catalog_collections', 'catalog_assets', 'catalog_asset_versions',
      'catalog_templates', 'catalog_template_versions', 'catalog_upload_jobs'
    )
  ),
  subject_id uuid,
  outcome text not null check (outcome in ('ok', 'rejected', 'failed')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index catalog_events_subject on public.catalog_events (subject_table, subject_id, created_at desc);

-- First published-pointer foreign keys, now that the version tables exist.
alter table public.catalog_assets
  add constraint catalog_assets_published_version
  foreign key (published_version_id) references public.catalog_asset_versions(id) on delete restrict;
alter table public.catalog_templates
  add constraint catalog_templates_published_version
  foreign key (published_version_id) references public.catalog_template_versions(id) on delete restrict;

-- A pointer may only name a version of its own item, and published state may not
-- survive a cleared pointer. These triggers make both true for every writer,
-- including security-definer RPCs.
create function public.catalog_check_published_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.published_version_id is null then return new; end if;
  if tg_table_name = 'catalog_assets' then
    if not exists (
      select 1 from public.catalog_asset_versions v
      where v.id = new.published_version_id and v.asset_id = new.id
    ) then
      raise exception 'published_version_id must name a version of the same asset' using errcode = '23514';
    end if;
  elsif tg_table_name = 'catalog_templates' then
    if not exists (
      select 1 from public.catalog_template_versions v
      where v.id = new.published_version_id and v.template_id = new.id
    ) then
      raise exception 'published_version_id must name a version of the same template' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger catalog_assets_published_version_check
  before insert or update of published_version_id on public.catalog_assets
  for each row execute function public.catalog_check_published_version();
create trigger catalog_templates_published_version_check
  before insert or update of published_version_id on public.catalog_templates
  for each row execute function public.catalog_check_published_version();

-- Version rows are write-once: content, hashes and validation are inserted
-- together by trusted processing and never edited.
create function public.catalog_forbid_version_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Catalog version rows are immutable' using errcode = '55000';
end;
$$;
create trigger catalog_asset_versions_immutable
  before update or delete on public.catalog_asset_versions
  for each row execute function public.catalog_forbid_version_mutation();
create trigger catalog_template_versions_immutable
  before update or delete on public.catalog_template_versions
  for each row execute function public.catalog_forbid_version_mutation();
create trigger catalog_template_dependencies_immutable
  before update or delete on public.catalog_template_dependencies
  for each row execute function public.catalog_forbid_version_mutation();
