-- Guarded catalog operations (P50). Every mutation is a security-definer RPC:
-- the catalog tables grant no writes, so an ordinary (or even admin) client
-- cannot bypass revision checks, validation state, dependency pinning or event
-- logging by calling the REST API directly.
--
-- Result convention: `{ "ok": true, "item": {...} }`, or
-- `{ "ok": false, "reason": "...", "detail": {...} }`. Authorization failures
-- raise SQLSTATE 42501 instead of returning a reason, so they cannot be mistaken
-- for a business outcome. An expected revision that does not match returns the
-- current row in `detail.item`, which is what the admin UI needs to show a
-- conflict without discarding the user's edits.

create function public.catalog_require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.catalog_admins a where a.user_id = actor) then
    raise exception 'Catalog administrator membership required' using errcode = '42501';
  end if;
  return actor;
end;
$$;

create function public.catalog_admin_create_collection(
  name text, description text default '', tags text[] default '{}', sort_order integer default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
begin
  insert into public.catalog_collections (name, description, tags, sort_order)
  values (
    catalog_admin_create_collection.name,
    catalog_admin_create_collection.description,
    coalesce(catalog_admin_create_collection.tags, '{}'),
    coalesce(catalog_admin_create_collection.sort_order, 0)
  )
  returning to_jsonb(catalog_collections) into item;
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

create function public.catalog_admin_update_collection(
  id uuid, expected_revision bigint, name text, description text, tags text[], sort_order integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
begin
  update public.catalog_collections c
  set name = catalog_admin_update_collection.name,
      description = catalog_admin_update_collection.description,
      tags = coalesce(catalog_admin_update_collection.tags, c.tags),
      sort_order = coalesce(catalog_admin_update_collection.sort_order, c.sort_order),
      revision = c.revision + 1,
      updated_at = now()
  where c.id = catalog_admin_update_collection.id
    and c.revision = catalog_admin_update_collection.expected_revision
    and c.state <> 'archived'
  returning to_jsonb(c) into item;
  if item is not null then
    return jsonb_build_object('ok', true, 'item', item);
  end if;
  select to_jsonb(c) into current from public.catalog_collections c
  where c.id = catalog_admin_update_collection.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object(
    'ok', false,
    'reason', case when current->>'state' = 'archived' then 'archived' else 'revision_conflict' end,
    'detail', jsonb_build_object('item', current)
  );
end;
$$;

create function public.catalog_admin_publish_collection(id uuid, expected_revision bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
begin
  update public.catalog_collections c
  set state = 'published', published_at = now(), revision = c.revision + 1, updated_at = now()
  where c.id = catalog_admin_publish_collection.id
    and c.revision = catalog_admin_publish_collection.expected_revision
    and c.state <> 'archived'
  returning to_jsonb(c) into item;
  if item is not null then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome)
    values (actor, 'publish', 'catalog_collections', id, 'ok');
    return jsonb_build_object('ok', true, 'item', item);
  end if;
  select to_jsonb(c) into current from public.catalog_collections c
  where c.id = catalog_admin_publish_collection.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (
    actor, 'publish', 'catalog_collections', id, 'rejected',
    jsonb_build_object('reason', case when current->>'state' = 'archived' then 'archived' else 'revision_conflict' end)
  );
  return jsonb_build_object(
    'ok', false,
    'reason', case when current->>'state' = 'archived' then 'archived' else 'revision_conflict' end,
    'detail', jsonb_build_object('item', current)
  );
end;
$$;

create function public.catalog_admin_archive_collection(
  id uuid, expected_revision bigint, archive_items boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
  contained integer;
  pinned jsonb;
begin
  select to_jsonb(c) into current from public.catalog_collections c
  where c.id = catalog_admin_archive_collection.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (current->>'state') = 'archived' then
    return jsonb_build_object('ok', true, 'item', current);
  end if;
  if (current->>'revision')::bigint <> expected_revision then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'archive', 'catalog_collections', id, 'rejected', jsonb_build_object('reason', 'revision_conflict'));
    return jsonb_build_object(
      'ok', false, 'reason', 'revision_conflict', 'detail', jsonb_build_object('item', current)
    );
  end if;

  select count(*) into contained from public.catalog_assets a
  where a.collection_id = catalog_admin_archive_collection.id and a.state <> 'archived';
  if contained > 0 and not coalesce(archive_items, false) then
    return jsonb_build_object('ok', false, 'reason', 'contains_items',
      'detail', jsonb_build_object('count', contained));
  end if;

  -- A published template pins the exact asset version it was built with; the
  -- collection archive must not withdraw that dependency.
  select coalesce(jsonb_agg(distinct jsonb_build_object('id', t.id, 'title', t.title)), '[]'::jsonb)
  into pinned
  from public.catalog_assets a
  join public.catalog_template_dependencies d on d.asset_version_id = a.published_version_id
  join public.catalog_template_versions v on v.id = d.template_version_id
  join public.catalog_templates t
    on t.id = v.template_id and t.state = 'published' and t.published_version_id = v.id
  where a.collection_id = catalog_admin_archive_collection.id
    and a.state <> 'archived'
    and a.published_version_id is not null;
  if jsonb_array_length(pinned) > 0 then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'archive', 'catalog_collections', id, 'rejected',
      jsonb_build_object('reason', 'pinned_by_template', 'templates', pinned));
    return jsonb_build_object('ok', false, 'reason', 'pinned_by_template',
      'detail', jsonb_build_object('templates', pinned));
  end if;

  update public.catalog_collections c
  set state = 'archived', archived_at = now(), revision = c.revision + 1, updated_at = now()
  where c.id = catalog_admin_archive_collection.id
  returning to_jsonb(c) into item;
  update public.catalog_assets a
  set state = 'archived', archived_at = now(), revision = a.revision + 1, updated_at = now()
  where a.collection_id = catalog_admin_archive_collection.id and a.state <> 'archived';
  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'archive', 'catalog_collections', id, 'ok',
    jsonb_build_object('archived_items', contained));
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

create function public.catalog_admin_create_asset(
  collection_id uuid, name text, kind text, description text default '',
  tags text[] default '{}', provenance jsonb default '{}'::jsonb, sort_order integer default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  collection_state text;
  item jsonb;
begin
  if collection_id is not null then
    select c.state into collection_state from public.catalog_collections c
    where c.id = catalog_admin_create_asset.collection_id;
    if collection_state is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if collection_state = 'archived' then return jsonb_build_object('ok', false, 'reason', 'collection_archived'); end if;
  end if;
  insert into public.catalog_assets (collection_id, name, kind, description, tags, provenance, sort_order)
  values (
    catalog_admin_create_asset.collection_id, catalog_admin_create_asset.name, catalog_admin_create_asset.kind,
    catalog_admin_create_asset.description, coalesce(catalog_admin_create_asset.tags, '{}'),
    coalesce(catalog_admin_create_asset.provenance, '{}'::jsonb), coalesce(catalog_admin_create_asset.sort_order, 0)
  )
  returning to_jsonb(catalog_assets) into item;
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

create function public.catalog_admin_update_asset(
  id uuid, expected_revision bigint, name text, description text, tags text[],
  collection_id uuid, sort_order integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
  collection_state text;
begin
  if catalog_admin_update_asset.collection_id is not null then
    select c.state into collection_state from public.catalog_collections c
    where c.id = catalog_admin_update_asset.collection_id;
    if collection_state is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if collection_state = 'archived' then return jsonb_build_object('ok', false, 'reason', 'collection_archived'); end if;
  end if;
  update public.catalog_assets a
  set name = coalesce(catalog_admin_update_asset.name, a.name),
      description = coalesce(catalog_admin_update_asset.description, a.description),
      tags = coalesce(catalog_admin_update_asset.tags, a.tags),
      collection_id = catalog_admin_update_asset.collection_id,
      sort_order = coalesce(catalog_admin_update_asset.sort_order, a.sort_order),
      revision = a.revision + 1,
      updated_at = now()
  where a.id = catalog_admin_update_asset.id
    and a.revision = catalog_admin_update_asset.expected_revision
    and a.state <> 'archived'
  returning to_jsonb(a) into item;
  if item is not null then
    return jsonb_build_object('ok', true, 'item', item);
  end if;
  select to_jsonb(a) into current from public.catalog_assets a where a.id = catalog_admin_update_asset.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object(
    'ok', false,
    'reason', case when current->>'state' = 'archived' then 'archived' else 'revision_conflict' end,
    'detail', jsonb_build_object('item', current)
  );
end;
$$;

create function public.catalog_admin_publish_asset(
  id uuid, version_id uuid, expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
  version jsonb;
  collection_state text;
  reason text;
begin
  select to_jsonb(a) into current from public.catalog_assets a where a.id = catalog_admin_publish_asset.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (current->>'revision')::bigint <> expected_revision then
    return jsonb_build_object('ok', false, 'reason', 'revision_conflict', 'detail', jsonb_build_object('item', current));
  end if;
  if (current->>'state') = 'archived' then
    return jsonb_build_object('ok', false, 'reason', 'archived', 'detail', jsonb_build_object('item', current));
  end if;
  select to_jsonb(v) into version from public.catalog_asset_versions v
  where v.id = catalog_admin_publish_asset.version_id and v.asset_id = catalog_admin_publish_asset.id;
  if version is null then
    reason := 'version_not_found';
  elsif (version->>'validation_state') <> 'validated' then
    reason := 'version_not_validated';
  else
    if (current->>'collection_id') is not null then
      select c.state into collection_state from public.catalog_collections c
      where c.id = (current->>'collection_id')::uuid;
      if collection_state is distinct from 'published' then reason := 'collection_not_published'; end if;
    end if;
  end if;
  if reason is not null then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'publish', 'catalog_assets', id, 'rejected', jsonb_build_object('reason', reason));
    return jsonb_build_object('ok', false, 'reason', reason,
      'detail', jsonb_build_object('version', version));
  end if;
  update public.catalog_assets a
  set state = 'published', published_version_id = catalog_admin_publish_asset.version_id,
      published_at = coalesce(a.published_at, now()), revision = a.revision + 1, updated_at = now()
  where a.id = catalog_admin_publish_asset.id
  returning to_jsonb(a) into item;
  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'publish', 'catalog_assets', id, 'ok',
    jsonb_build_object('version_id', catalog_admin_publish_asset.version_id));
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

create function public.catalog_admin_archive_asset(id uuid, expected_revision bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
  pinned jsonb;
begin
  select to_jsonb(a) into current from public.catalog_assets a where a.id = catalog_admin_archive_asset.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (current->>'state') = 'archived' then return jsonb_build_object('ok', true, 'item', current); end if;
  if (current->>'revision')::bigint <> expected_revision then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'archive', 'catalog_assets', id, 'rejected', jsonb_build_object('reason', 'revision_conflict'));
    return jsonb_build_object('ok', false, 'reason', 'revision_conflict', 'detail', jsonb_build_object('item', current));
  end if;
  -- A published template keeps its pinned asset version readable; withdrawing
  -- the asset from the published catalog must not silently break that template.
  select coalesce(jsonb_agg(distinct jsonb_build_object('id', t.id, 'title', t.title)), '[]'::jsonb)
  into pinned
  from public.catalog_template_dependencies d
  join public.catalog_template_versions v on v.id = d.template_version_id
  join public.catalog_templates t
    on t.id = v.template_id and t.state = 'published' and t.published_version_id = v.id
  where d.asset_version_id = (current->>'published_version_id')::uuid;
  if jsonb_array_length(pinned) > 0 then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'archive', 'catalog_assets', id, 'rejected',
      jsonb_build_object('reason', 'pinned_by_template', 'templates', pinned));
    return jsonb_build_object('ok', false, 'reason', 'pinned_by_template',
      'detail', jsonb_build_object('templates', pinned));
  end if;
  update public.catalog_assets a
  set state = 'archived', archived_at = now(), revision = a.revision + 1, updated_at = now()
  where a.id = catalog_admin_archive_asset.id
  returning to_jsonb(a) into item;
  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome)
  values (actor, 'archive', 'catalog_assets', id, 'ok');
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

create function public.catalog_admin_create_template(
  title text, use_case text, description text default '', tags text[] default '{}', sort_order integer default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
begin
  insert into public.catalog_templates (title, use_case, description, tags, sort_order)
  values (
    catalog_admin_create_template.title,
    catalog_admin_create_template.use_case,
    catalog_admin_create_template.description,
    coalesce(catalog_admin_create_template.tags, '{}'),
    coalesce(catalog_admin_create_template.sort_order, 0)
  )
  returning to_jsonb(catalog_templates) into item;
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

create function public.catalog_admin_update_template(
  id uuid, expected_revision bigint, title text, use_case text, description text, tags text[], sort_order integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
begin
  update public.catalog_templates t
  set title = coalesce(catalog_admin_update_template.title, t.title),
      use_case = coalesce(catalog_admin_update_template.use_case, t.use_case),
      description = coalesce(catalog_admin_update_template.description, t.description),
      tags = coalesce(catalog_admin_update_template.tags, t.tags),
      sort_order = coalesce(catalog_admin_update_template.sort_order, t.sort_order),
      revision = t.revision + 1,
      updated_at = now()
  where t.id = catalog_admin_update_template.id
    and t.revision = catalog_admin_update_template.expected_revision
    and t.state <> 'archived'
  returning to_jsonb(t) into item;
  if item is not null then
    return jsonb_build_object('ok', true, 'item', item);
  end if;
  select to_jsonb(t) into current from public.catalog_templates t
  where t.id = catalog_admin_update_template.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object(
    'ok', false,
    'reason', case when current->>'state' = 'archived' then 'archived' else 'revision_conflict' end,
    'detail', jsonb_build_object('item', current)
  );
end;
$$;

create function public.catalog_admin_publish_template(
  id uuid, version_id uuid, expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
  version jsonb;
  unavailable jsonb := '[]'::jsonb;
  reason text;
begin
  select to_jsonb(t) into current from public.catalog_templates t where t.id = catalog_admin_publish_template.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (current->>'revision')::bigint <> expected_revision then
    return jsonb_build_object('ok', false, 'reason', 'revision_conflict', 'detail', jsonb_build_object('item', current));
  end if;
  if (current->>'state') = 'archived' then
    return jsonb_build_object('ok', false, 'reason', 'archived', 'detail', jsonb_build_object('item', current));
  end if;
  select to_jsonb(v) into version from public.catalog_template_versions v
  where v.id = catalog_admin_publish_template.version_id and v.template_id = catalog_admin_publish_template.id;
  if version is null then
    reason := 'version_not_found';
  elsif (version->>'validation_state') <> 'validated' then
    reason := 'version_not_validated';
  else
    -- Every pinned asset version must still be the published one, or students
    -- cloning the template could not fetch its media.
    select coalesce(jsonb_agg(distinct d.asset_id), '[]'::jsonb) into unavailable
    from public.catalog_template_dependencies d
    left join public.catalog_assets a on a.id = d.asset_id
    where d.template_version_id = catalog_admin_publish_template.version_id
      and (a.id is null or a.state <> 'published' or a.published_version_id is distinct from d.asset_version_id);
    if jsonb_array_length(unavailable) > 0 then reason := 'dependency_unavailable'; end if;
  end if;
  if reason is not null then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'publish', 'catalog_templates', id, 'rejected', jsonb_build_object('reason', reason));
    return jsonb_build_object('ok', false, 'reason', reason,
      'detail', jsonb_build_object('version', version, 'assetIds', unavailable));
  end if;
  update public.catalog_templates t
  set state = 'published', published_version_id = catalog_admin_publish_template.version_id,
      published_at = coalesce(t.published_at, now()), revision = t.revision + 1, updated_at = now()
  where t.id = catalog_admin_publish_template.id
  returning to_jsonb(t) into item;
  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'publish', 'catalog_templates', id, 'ok',
    jsonb_build_object('version_id', catalog_admin_publish_template.version_id));
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

create function public.catalog_admin_archive_template(id uuid, expected_revision bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  item jsonb;
  current jsonb;
begin
  select to_jsonb(t) into current from public.catalog_templates t where t.id = catalog_admin_archive_template.id;
  if current is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (current->>'state') = 'archived' then return jsonb_build_object('ok', true, 'item', current); end if;
  if (current->>'revision')::bigint <> expected_revision then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'archive', 'catalog_templates', id, 'rejected', jsonb_build_object('reason', 'revision_conflict'));
    return jsonb_build_object('ok', false, 'reason', 'revision_conflict', 'detail', jsonb_build_object('item', current));
  end if;
  update public.catalog_templates t
  set state = 'archived', archived_at = now(), revision = t.revision + 1, updated_at = now()
  where t.id = catalog_admin_archive_template.id
  returning to_jsonb(t) into item;
  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome)
  values (actor, 'archive', 'catalog_templates', id, 'ok');
  return jsonb_build_object('ok', true, 'item', item);
end;
$$;

revoke all on function public.catalog_require_admin() from public, anon, authenticated;
revoke all on function public.catalog_is_admin() from public, anon, authenticated;
grant execute on function public.catalog_is_admin() to authenticated;
revoke all on function
  public.catalog_admin_create_collection(text, text, text[], integer),
  public.catalog_admin_update_collection(uuid, bigint, text, text, text[], integer),
  public.catalog_admin_publish_collection(uuid, bigint),
  public.catalog_admin_archive_collection(uuid, bigint, boolean),
  public.catalog_admin_create_asset(uuid, text, text, text, text[], jsonb, integer),
  public.catalog_admin_update_asset(uuid, bigint, text, text, text[], uuid, integer),
  public.catalog_admin_publish_asset(uuid, uuid, bigint),
  public.catalog_admin_archive_asset(uuid, bigint),
  public.catalog_admin_create_template(text, text, text, text[], integer),
  public.catalog_admin_update_template(uuid, bigint, text, text, text, text[], integer),
  public.catalog_admin_publish_template(uuid, uuid, bigint),
  public.catalog_admin_archive_template(uuid, bigint)
  from public, anon, authenticated;
grant execute on function
  public.catalog_admin_create_collection(text, text, text[], integer),
  public.catalog_admin_update_collection(uuid, bigint, text, text, text[], integer),
  public.catalog_admin_publish_collection(uuid, bigint),
  public.catalog_admin_archive_collection(uuid, bigint, boolean),
  public.catalog_admin_create_asset(uuid, text, text, text, text[], jsonb, integer),
  public.catalog_admin_update_asset(uuid, bigint, text, text, text[], uuid, integer),
  public.catalog_admin_publish_asset(uuid, uuid, bigint),
  public.catalog_admin_archive_asset(uuid, bigint),
  public.catalog_admin_create_template(text, text, text, text[], integer),
  public.catalog_admin_update_template(uuid, bigint, text, text, text, text[], integer),
  public.catalog_admin_publish_template(uuid, uuid, bigint),
  public.catalog_admin_archive_template(uuid, bigint)
  to authenticated;
