-- P67: attaching generated slide previews to a template draft version.
--
-- The rasterizer is the fixed-page renderer the PDF export and the library
-- thumbnails already share; this codebase has no server-side renderer, so the
-- administrator's browser draws each slide from the exact immutable document
-- and uploads the PNGs to the private derivative bucket under this version's
-- own path. This RPC is the commit point, not the renderer: it re-checks the
-- caller's membership, that the source is the newest pending version with the
-- expected document hash, and that every declared object exists with the
-- declared size and type before the successor version exists.
--
-- The successor carries the same document/hash/bytes/fonts and the same
-- dependency pins plus the preview manifest and cover, and it stays `pending`:
-- validation (P68) is what makes it publishable. The superseded version remains
-- pending forever, and a later draft edit appends yet another pending version,
-- which makes these previews ineligible for publication by construction.

create function public.catalog_admin_attach_template_previews(
  p_template_id uuid,
  p_version_id uuid,
  p_expected_revision bigint,
  p_document_sha256 text,
  p_cover_ordinal integer,
  p_previews jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  template_row public.catalog_templates;
  source public.catalog_template_versions;
  version_row public.catalog_template_versions;
  next_number integer;
  expected_count integer;
  distinct_ordinals integer;
  missing jsonb := '[]'::jsonb;
  cover_path text;
  cover_sha256 text;
begin
  -- Manifest shape before any cast, NULL-safe, so a malformed payload is a
  -- business refusal rather than a raised cast.
  if p_previews is null or jsonb_typeof(p_previews) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;
  expected_count := jsonb_array_length(p_previews);
  if expected_count < 1 or expected_count > 50 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_previews) preview
    where coalesce(preview->>'ordinal', '') !~ '^[0-9]{1,2}$'
      or coalesce(preview->>'sha256', '') !~ '^[a-f0-9]{64}$'
      or coalesce(preview->>'bytes', '') !~ '^[1-9][0-9]{0,7}$'
      or coalesce(preview->>'width', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(preview->>'height', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(preview->>'path', '') !~
         ('^templates/' || p_template_id::text || '/' || p_version_id::text
          || '/[A-Za-z0-9._-]{1,100}$')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  -- Ordinals are unique and exactly 0..n-1: the manifest order is the slide
  -- order, with no gap that could silently drop a slide from the preview list.
  select count(distinct (preview->>'ordinal')::integer)
  into distinct_ordinals
  from jsonb_array_elements(p_previews) preview;
  if distinct_ordinals <> expected_count
    or exists (
      select 1
      from generate_series(0, expected_count - 1) as ordinal
      where not exists (
        select 1 from jsonb_array_elements(p_previews) preview
        where (preview->>'ordinal')::integer = ordinal
      )
    )
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  if p_cover_ordinal is null or p_cover_ordinal < 0 or p_cover_ordinal >= expected_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  -- The row lock serializes concurrent commits; the second caller then reads
  -- the revision the first one wrote.
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
    values (actor, 'attach_previews', 'catalog_templates', p_template_id, 'rejected',
      jsonb_build_object('reason', 'revision_conflict'));
    return jsonb_build_object(
      'ok', false,
      'reason', 'revision_conflict',
      'detail', jsonb_build_object('template', to_jsonb(template_row))
    );
  end if;

  select * into source
  from public.catalog_template_versions v
  where v.id = p_version_id and v.template_id = p_template_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'version_not_found');
  end if;
  -- Only the newest pending version may gain previews: a superseded snapshot's
  -- previews could otherwise be attached after an edit and misrepresent it.
  if source.validation_state <> 'pending'
    or exists (
      select 1 from public.catalog_template_versions v
      where v.template_id = p_template_id and v.version_number > source.version_number
    )
  then
    return jsonb_build_object(
      'ok', false,
      'reason', 'version_not_pending',
      'detail', jsonb_build_object('version', to_jsonb(source))
    );
  end if;
  if source.document_sha256 <> p_document_sha256 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  -- The objects have to exist in Storage with the declared size and type; the
  -- manifest cannot point at a path that was never uploaded or at another
  -- object that happens to be readable.
  select coalesce(jsonb_agg(preview->>'path'), '[]'::jsonb)
  into missing
  from jsonb_array_elements(p_previews) preview
  left join storage.objects o
    on o.bucket_id = 'catalog-derivatives'
   and o.name = preview->>'path'
   and coalesce(o.metadata->>'size', '') = preview->>'bytes'
   and o.metadata->>'mimetype' = 'image/png'
  where o.name is null;
  if jsonb_array_length(missing) > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'media_missing',
      'detail', jsonb_build_object('paths', missing)
    );
  end if;

  select preview->>'path', preview->>'sha256'
  into cover_path, cover_sha256
  from jsonb_array_elements(p_previews) preview
  where (preview->>'ordinal')::integer = p_cover_ordinal;

  select coalesce(max(v.version_number), 0) + 1
  into next_number
  from public.catalog_template_versions v
  where v.template_id = p_template_id;

  insert into public.catalog_template_versions (
    template_id, version_number, document, document_sha256, document_bytes,
    cover_path, cover_sha256, slide_previews, font_requirements,
    validation_state, validation
  ) values (
    p_template_id, next_number, source.document, source.document_sha256, source.document_bytes,
    cover_path, cover_sha256, p_previews, source.font_requirements,
    'pending', jsonb_build_object(
      'created_by', actor,
      'previews_of', source.id,
      'cover_ordinal', p_cover_ordinal
    )
  ) returning * into version_row;

  insert into public.catalog_template_dependencies (
    template_version_id, asset_id, asset_version_id
  )
  select version_row.id, d.asset_id, d.asset_version_id
  from public.catalog_template_dependencies d
  where d.template_version_id = source.id;

  update public.catalog_templates t
  set revision = t.revision + 1, updated_at = now()
  where t.id = p_template_id
  returning * into template_row;

  insert into public.catalog_events (
    actor_id, operation, subject_table, subject_id, outcome, detail
  ) values (
    actor, 'attach_previews', 'catalog_templates', p_template_id, 'ok',
    jsonb_build_object('version_id', version_row.id, 'previews', expected_count)
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

revoke all on function public.catalog_admin_attach_template_previews(
  uuid, uuid, bigint, text, integer, jsonb
) from public, anon;
grant execute on function public.catalog_admin_attach_template_previews(
  uuid, uuid, bigint, text, integer, jsonb
) to authenticated;
