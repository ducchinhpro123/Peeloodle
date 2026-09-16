-- P65: saving a local presentation as a template draft.
--
-- A draft template version is a complete immutable document snapshot that has
-- no previews yet: P67 generates them from that snapshot, and P68 refuses to
-- publish anything but a version whose cover and slide previews agree with the
-- current document hash. The schema therefore keeps the cover fields nullable
-- for non-validated versions only, and requires the pair to be all-null or
-- all-present so a half-written cover cannot exist.
--
-- Draft creation is one security-definer transaction: the stable template, its
-- first immutable version and every dependency pin are inserted together, or
-- nothing is. Asset dependencies are verified against the exact derivative the
-- document claims (hash, bytes, MIME, width, height) before the template row
-- exists, so a document can never pin media that does not match it.

alter table public.catalog_template_versions
  alter column cover_path drop not null,
  alter column cover_sha256 drop not null;

alter table public.catalog_template_versions
  add constraint catalog_template_cover_pair check (
    (cover_path is null and cover_sha256 is null)
    or (cover_path is not null and cover_sha256 is not null)
  ),
  add constraint catalog_template_validated_cover check (
    validation_state <> 'validated'
    or (cover_path is not null and cover_sha256 is not null)
  );

create function public.catalog_admin_create_template_draft(
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

revoke all on function public.catalog_admin_create_template_draft(
  text, text, jsonb, text, bigint, text, text[], integer, jsonb
) from public, anon;
grant execute on function public.catalog_admin_create_template_draft(
  text, text, jsonb, text, bigint, text, text[], integer, jsonb
) to authenticated;
