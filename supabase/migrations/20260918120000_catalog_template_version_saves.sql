-- P66: saving a new immutable template draft version from the shared editor.
--
-- A template draft is edited in the same presentation editor as a local deck; its
-- save creates the next immutable pending version and advances the stable
-- template's compare-and-set revision in one transaction. The document shape and
-- dependency checks are the same ones P65 used to create the first draft, so they
-- live in one helper that both RPCs call: a version can never pin media that does
-- not match it, and a refusal writes nothing.
--
-- The row lock (`for update`) serializes two concurrent saves of the same
-- template: the second sees the advanced revision and is refused as
-- `revision_conflict` instead of writing a version the other edit never saw.

create function public.catalog_validate_template_document(
  p_document jsonb,
  p_font_requirements jsonb
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  unavailable jsonb := '[]'::jsonb;
begin
  -- Shape before casts: a NULL argument, a missing assets key, a malformed UUID
  -- or a malformed byteLength/width/height must be a business refusal, not a
  -- raised cast or not-null error. Every predicate is NULL-safe (explicit NULL
  -- checks plus coalesce) so SQL three-valued logic cannot skip it.
  if p_document is null
    or jsonb_typeof(p_document) <> 'object'
    or p_document->'assets' is null
    or jsonb_typeof(p_document->'assets') <> 'array'
    or p_font_requirements is null
    or jsonb_typeof(p_font_requirements) <> 'array'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_document->'assets') asset
    where coalesce(asset->'provenance'->>'source', '') <> 'catalog'
      or coalesce(asset->'provenance'->>'catalogItemId', '')
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(asset->'provenance'->>'catalogVersionId', '')
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(asset->>'byteLength', '') !~ '^[1-9][0-9]{0,8}$'
      or coalesce(asset->>'width', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(asset->>'height', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(asset->>'sha256', '') !~ '^[a-f0-9]{64}$'
      or coalesce(asset->>'mimeType', '') not in ('image/png', 'image/webp')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  -- Every referenced asset must already be a validated catalog version whose
  -- derivative is byte-for-byte the media the document carries.
  select coalesce(jsonb_agg(distinct asset->'provenance'->>'catalogItemId'), '[]'::jsonb)
  into unavailable
  from jsonb_array_elements(p_document->'assets') asset
  left join public.catalog_asset_versions version
    on version.id = (asset->'provenance'->>'catalogVersionId')::uuid
   and version.asset_id = (asset->'provenance'->>'catalogItemId')::uuid
  where version.id is null
     or version.validation_state <> 'validated'
     or version.derivative_sha256 <> asset->>'sha256'
     or version.derivative_bytes <> (asset->>'byteLength')::bigint
     or version.derivative_mime <> asset->>'mimeType'
     or version.derivative_width <> (asset->>'width')::integer
     or version.derivative_height <> (asset->>'height')::integer;

  if jsonb_array_length(unavailable) > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'dependency_unavailable',
      'detail', jsonb_build_object('assetIds', unavailable)
    );
  end if;

  return null;
end;
$$;

-- P65's draft RPC keeps its signature and semantics; it now calls the shared
-- validator instead of carrying its own copy of the rules.
create or replace function public.catalog_admin_create_template_draft(
  p_title text,
  p_use_case text,
  p_document jsonb,
  p_document_sha256 text,
  p_document_bytes bigint,
  p_description text default '',
  p_tags text[] default '{}',
  p_sort_order integer default 0,
  p_font_requirements jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  template_row public.catalog_templates;
  version_row public.catalog_template_versions;
  refusal jsonb;
begin
  refusal := public.catalog_validate_template_document(p_document, p_font_requirements);
  if refusal is not null then return refusal; end if;

  insert into public.catalog_templates (title, use_case, description, tags, sort_order)
  values (p_title, p_use_case, p_description, coalesce(p_tags, '{}'), coalesce(p_sort_order, 0))
  returning * into template_row;

  insert into public.catalog_template_versions (
    template_id, version_number, document, document_sha256, document_bytes,
    cover_path, cover_sha256, slide_previews, font_requirements,
    validation_state, validation
  ) values (
    template_row.id, 1, p_document, p_document_sha256, p_document_bytes,
    null, null, '[]'::jsonb, p_font_requirements,
    'pending', jsonb_build_object('created_by', actor)
  ) returning * into version_row;

  insert into public.catalog_template_dependencies (
    template_version_id, asset_id, asset_version_id
  )
  select distinct
    version_row.id,
    (asset->'provenance'->>'catalogItemId')::uuid,
    (asset->'provenance'->>'catalogVersionId')::uuid
  from jsonb_array_elements(p_document->'assets') asset;

  insert into public.catalog_events (
    actor_id, operation, subject_table, subject_id, outcome, detail
  ) values (
    actor, 'create_draft', 'catalog_templates', template_row.id, 'ok',
    jsonb_build_object('version_id', version_row.id)
  );

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'template', to_jsonb(template_row),
      'version', to_jsonb(version_row)
    )
  );
end;
$$;

create function public.catalog_admin_save_template_version(
  p_template_id uuid,
  p_expected_revision bigint,
  p_document jsonb,
  p_document_sha256 text,
  p_document_bytes bigint,
  p_font_requirements jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  template_row public.catalog_templates;
  version_row public.catalog_template_versions;
  refusal jsonb;
  previous_number integer;
  next_number integer;
begin
  refusal := public.catalog_validate_template_document(p_document, p_font_requirements);
  if refusal is not null then return refusal; end if;

  -- The row lock is what makes the compare-and-set safe under concurrency: a
  -- second save waits here, then reads the revision the first one wrote.
  select * into template_row
  from public.catalog_templates t
  where t.id = p_template_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if template_row.state = 'archived' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'archived',
      'detail', jsonb_build_object('template', to_jsonb(template_row))
    );
  end if;
  if template_row.revision <> p_expected_revision then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'save_version', 'catalog_templates', p_template_id, 'rejected',
      jsonb_build_object('reason', 'revision_conflict'));
    return jsonb_build_object(
      'ok', false,
      'reason', 'revision_conflict',
      'detail', jsonb_build_object('template', to_jsonb(template_row))
    );
  end if;

  select coalesce(max(v.version_number), 0), coalesce(max(v.version_number), 0) + 1
  into previous_number, next_number
  from public.catalog_template_versions v
  where v.template_id = p_template_id;

  -- A new pending version starts without previews: any earlier previews bind to
  -- their own document hash and are ineligible for this document (P67/P68).
  insert into public.catalog_template_versions (
    template_id, version_number, document, document_sha256, document_bytes,
    cover_path, cover_sha256, slide_previews, font_requirements,
    validation_state, validation
  ) values (
    p_template_id, next_number, p_document, p_document_sha256, p_document_bytes,
    null, null, '[]'::jsonb, p_font_requirements,
    'pending', jsonb_build_object('created_by', actor, 'previous_version_number', previous_number)
  ) returning * into version_row;

  insert into public.catalog_template_dependencies (
    template_version_id, asset_id, asset_version_id
  )
  select distinct
    version_row.id,
    (asset->'provenance'->>'catalogItemId')::uuid,
    (asset->'provenance'->>'catalogVersionId')::uuid
  from jsonb_array_elements(p_document->'assets') asset;

  update public.catalog_templates t
  set revision = t.revision + 1, updated_at = now()
  where t.id = p_template_id
  returning * into template_row;

  insert into public.catalog_events (
    actor_id, operation, subject_table, subject_id, outcome, detail
  ) values (
    actor, 'save_version', 'catalog_templates', p_template_id, 'ok',
    jsonb_build_object('version_id', version_row.id)
  );

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'template', to_jsonb(template_row),
      'version', to_jsonb(version_row)
    )
  );
end;
$$;

revoke all on function public.catalog_validate_template_document(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.catalog_admin_save_template_version(
  uuid, bigint, jsonb, text, bigint, jsonb
) from public, anon;
grant execute on function public.catalog_admin_save_template_version(
  uuid, bigint, jsonb, text, bigint, jsonb
) to authenticated;
