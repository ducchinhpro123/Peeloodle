-- Bulk upload batches, durable processing jobs and abandoned-upload cleanup
-- (P54, P55, P61).
--
-- The batch/job tables and the private buckets already exist (P46/P48). This
-- migration adds the guarded operations an upload dashboard drives:
--
--   1. create one draft asset, one job and one reserved source path per file;
--   2. claim a job with a lease — expired leases are reclaimable, attempts are
--      bounded, and the source object is re-checked at claim time;
--   3. complete with an immutable, validated version. The lease token is the
--      only writer allowed to finalize, so a stale worker cannot overwrite a
--      retry, and a replay with the same version id is idempotent;
--   4. fail, retry, cancel and close;
--   5. bounded orphan listing plus delete policies that can only ever remove
--      objects no version (and no published template) references.
--
-- The lease token is never part of a UI payload: `catalog_upload_status_payload`
-- and every job envelope strip it. Only the claim response carries it.

-- Files are ordered by their position in the request, not by `created_at`:
-- every row of a batch shares one transaction timestamp, so ties would make the
-- queue order arbitrary.
alter table public.catalog_upload_jobs
  add column position integer not null default 0 check (position >= 0);

create function public.catalog_upload_mime_extension(mime text) returns text
language sql immutable set search_path = '' as $$
  select case lower(trim(catalog_upload_mime_extension.mime))
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/jpeg' then 'jpg'
    when 'image/jpg' then 'jpg'
    when 'image/svg+xml' then 'svg'
    else null
  end;
$$;

-- `stored` is answered from Storage itself rather than from client bookkeeping:
-- a job is only claimable once its reserved object exists with the declared size
-- and a matching content type.
create function public.catalog_upload_status_payload(p_batch_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'batch', to_jsonb(b) - 'created_by' || jsonb_build_object(
      'counts', (
        select jsonb_build_object(
          'total', count(*),
          'queued', count(*) filter (where j.stage = 'queued'),
          'claimed', count(*) filter (where j.stage = 'claimed'),
          'ready', count(*) filter (where j.stage = 'ready'),
          'failed', count(*) filter (where j.stage = 'failed'),
          'cancelled', count(*) filter (where j.stage = 'cancelled')
        )
        from public.catalog_upload_jobs j where j.batch_id = b.id
      )
    ),
    'jobs', coalesce((
      select jsonb_agg(
        to_jsonb(j) - 'lease_token' || jsonb_build_object(
          'stored', exists (
            select 1 from storage.objects o
            where o.bucket_id = 'catalog-sources' and o.name = j.source_path
          ),
          'version_id', (
            select v.id from public.catalog_asset_versions v
            where v.asset_id = j.asset_id
            order by v.version_number desc limit 1
          )
        )
        order by j.position, j.id
      )
      from public.catalog_upload_jobs j where j.batch_id = b.id
    ), '[]'::jsonb)
  )
  from public.catalog_upload_batches b
  where b.id = p_batch_id;
$$;

create function public.catalog_admin_create_upload_batch(
  p_collection_id uuid, p_files jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  batch_id uuid;
  file_row record;
  file_count integer;
  v_position integer;
  v_name text;
  v_title text;
  v_mime text;
  v_bytes bigint;
  v_ext text;
  v_asset_id uuid;
  collection_state text;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_file', 'detail', jsonb_build_object('message', 'files must be an array'));
  end if;
  file_count := jsonb_array_length(p_files);
  if file_count < 1 or file_count > 100 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_files', 'detail', jsonb_build_object('count', file_count));
  end if;

  -- Validate every file before writing anything: a half-created batch would
  -- promise work that can never be uploaded.
  for file_row in select * from jsonb_array_elements(p_files) with ordinality as t(value, index) loop
    v_name := nullif(trim(coalesce(file_row.value->>'name', '')), '');
    if v_name is null or length(v_name) > 300 or file_row.value->>'name' like '%/%' or file_row.value->>'name' like '%\%' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_file', 'detail', jsonb_build_object('name', file_row.value->>'name'));
    end if;
    if public.catalog_upload_mime_extension(coalesce(file_row.value->>'mime', '')) is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_file', 'detail', jsonb_build_object('name', v_name, 'message', 'Unsupported content type'));
    end if;
    v_bytes := coalesce((file_row.value->>'bytes')::bigint, 0);
    if v_bytes < 1 or v_bytes > 20971520 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_file', 'detail', jsonb_build_object('name', v_name, 'message', 'File size is outside the accepted range'));
    end if;
  end loop;

  if p_collection_id is not null then
    select c.state into collection_state from public.catalog_collections c
    where c.id = p_collection_id;
    if collection_state is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if collection_state = 'archived' then
      return jsonb_build_object('ok', false, 'reason', 'collection_archived');
    end if;
  end if;

  insert into public.catalog_upload_batches (created_by) values (actor) returning id into batch_id;

  for file_row in select * from jsonb_array_elements(p_files) with ordinality as t(value, index) loop
    v_name := trim(coalesce(file_row.value->>'name', ''));
    v_position := file_row.index - 1;
    v_mime := lower(trim(coalesce(file_row.value->>'mime', '')));
    v_mime := case when v_mime = 'image/jpg' then 'image/jpeg' else v_mime end;
    v_ext := public.catalog_upload_mime_extension(v_mime);
    v_bytes := (file_row.value->>'bytes')::bigint;
    v_title := nullif(trim(regexp_replace(v_name, '\.[A-Za-z0-9]{1,8}$', '')), '');
    v_title := left(coalesce(v_title, v_name), 200);

    insert into public.catalog_assets (collection_id, name, kind, provenance)
    values (
      p_collection_id,
      v_title,
      case when v_ext = 'svg' then 'svg' else 'raster' end,
      jsonb_build_object('original_name', v_name, 'source', 'upload')
    )
    returning id into v_asset_id;

    insert into public.catalog_upload_jobs (
      batch_id, asset_id, source_path, original_name, claimed_mime, claimed_bytes, position
    )
    values (
      batch_id, v_asset_id, batch_id::text || '/' || gen_random_uuid()::text || '.' || v_ext,
      v_name, v_mime, v_bytes, v_position
    );
  end loop;

  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'upload_batch_create', 'catalog_upload_jobs', null, 'ok',
    jsonb_build_object('batch_id', batch_id, 'files', file_count));

  return jsonb_build_object('ok', true, 'item', public.catalog_upload_status_payload(batch_id));
end;
$$;

create function public.catalog_admin_upload_status(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := public.catalog_require_admin();
  payload jsonb;
  owner uuid;
begin
  select b.created_by into owner from public.catalog_upload_batches b where b.id = p_batch_id;
  if owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if owner <> caller then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  payload := public.catalog_upload_status_payload(p_batch_id);
  return jsonb_build_object('ok', true, 'item', payload);
end;
$$;

create function public.catalog_admin_list_upload_batches(
  p_limit integer default 10, p_before timestamptz default null, p_before_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  rows jsonb;
  more boolean;
  next_created timestamptz;
  next_id uuid;
begin
  select
    coalesce(jsonb_agg(item order by created_at desc, id desc), '[]'::jsonb),
    count(*) > v_limit,
    min(created_at) filter (where rn = v_limit),
    min(id) filter (where rn = v_limit)
  into rows, more, next_created, next_id
  from (
    select b.created_at, b.id, row_number() over (order by b.created_at desc, b.id desc) as rn,
      to_jsonb(b) - 'created_by' || jsonb_build_object(
        'counts', (
          select jsonb_build_object(
            'total', count(*),
            'queued', count(*) filter (where j.stage = 'queued'),
            'claimed', count(*) filter (where j.stage = 'claimed'),
            'ready', count(*) filter (where j.stage = 'ready'),
            'failed', count(*) filter (where j.stage = 'failed'),
            'cancelled', count(*) filter (where j.stage = 'cancelled')
          )
          from public.catalog_upload_jobs j where j.batch_id = b.id
        )
      ) as item
    from public.catalog_upload_batches b
    where b.created_by = actor
      and (
        p_before is null
        or (b.created_at, b.id) < (p_before, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
      )
    order by b.created_at desc, b.id desc
    limit v_limit + 1
  ) ranked;

  return jsonb_build_object(
    'ok', true,
    'items', rows,
    'next', case when more then jsonb_build_object('created_at', next_created, 'id', next_id) else null end
  );
end;
$$;

create function public.catalog_admin_claim_upload_job(lease_seconds integer default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  job_id uuid;
  claimed jsonb;
  token uuid := gen_random_uuid();
  v_seconds integer := least(greatest(coalesce(lease_seconds, 300), 30), 3600);
begin
  select j.id into job_id
  from public.catalog_upload_jobs j
  join public.catalog_upload_batches b on b.id = j.batch_id
  where b.state = 'open'
    and b.created_by = actor
    and j.attempts < 10
    and j.stage in ('queued', 'claimed')
    and (j.stage = 'queued' or j.lease_expires_at < now())
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'catalog-sources'
        and o.name = j.source_path
        and lower(coalesce(o.metadata->>'mimetype', '')) = j.claimed_mime
        and (o.metadata->>'size')::bigint = j.claimed_bytes
    )
  order by j.created_at, j.position, j.id
  limit 1
  for update of j skip locked;

  if job_id is null then
    return jsonb_build_object('ok', false, 'reason', 'none_pending');
  end if;

  update public.catalog_upload_jobs j
  set stage = 'claimed', lease_token = token,
      lease_expires_at = now() + make_interval(secs => v_seconds),
      attempts = j.attempts + 1, progress = 0,
      error_code = null, error_message = null, updated_at = now()
  where j.id = job_id
  returning to_jsonb(j) - 'lease_token' into claimed;

  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'job_claim', 'catalog_upload_jobs', job_id, 'ok',
    jsonb_build_object('attempts', claimed->'attempts'));

  return jsonb_build_object(
    'ok', true,
    'item', claimed,
    'lease', jsonb_build_object('token', token, 'expires_at', claimed->'lease_expires_at')
  );
end;
$$;

-- Every report field is validated here: the worker is trusted to have run the
-- checks, but a malformed or contradictory report must not become a version row.
create function public.catalog_admin_complete_upload_job(
  p_job_id uuid, p_lease_token uuid, p_report jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  job jsonb;
  asset uuid;
  version_id uuid;
  version jsonb;
  v_number integer;
  derivative text;
  thumbnail text;
begin
  select to_jsonb(j) - 'lease_token' into job from public.catalog_upload_jobs j
  where j.id = p_job_id;
  if job is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  asset := (job->>'asset_id')::uuid;

  if p_report is null or jsonb_typeof(p_report) <> 'object'
    or coalesce(p_report->>'version_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_report->>'source_sha256', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_report->>'derivative_sha256', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_report->>'derivative_mime', '') not in ('image/png', 'image/webp')
    or coalesce((p_report->>'source_bytes')::bigint, 0) not between 1 and 20971520
    or coalesce((p_report->>'derivative_bytes')::bigint, 0) not between 1 and 20971520
    or coalesce((p_report->>'derivative_width')::integer, 0) not between 1 and 4096
    or coalesce((p_report->>'derivative_height')::integer, 0) not between 1 and 4096
    or length(coalesce(p_report->>'source_mime', '')) not between 3 and 100
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_report');
  end if;
  version_id := (p_report->>'version_id')::uuid;
  derivative := p_report->>'derivative_path';
  thumbnail := p_report->>'thumbnail_path';

  -- Derivative objects are path-bound to this asset and version, so a p_report can
  -- never point at another item's media.
  if derivative is null or length(derivative) > 500
    or derivative !~ ('^assets/' || asset::text || '/' || version_id::text || '/[A-Za-z0-9._-]{1,120}$')
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_report',
      'detail', jsonb_build_object('message', 'derivative_path must be assets/<asset>/<version>/<name>'));
  end if;
  if thumbnail is not null and (
    length(thumbnail) > 500
    or thumbnail !~ ('^assets/' || asset::text || '/' || version_id::text || '/[A-Za-z0-9._-]{1,120}$')
    or coalesce(p_report->>'thumbnail_sha256', '') !~ '^[a-f0-9]{64}$'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_report', 'detail', jsonb_build_object('message', 'thumbnail_path is not valid'));
  end if;

  -- A completed attempt answers an idempotent replay with its own version.
  if (job->>'stage') = 'ready' then
    select to_jsonb(v) into version from public.catalog_asset_versions v
    where v.id = version_id and v.asset_id = asset;
    if version is not null then
      return jsonb_build_object('ok', true, 'item', job, 'version', version, 'replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_complete', 'detail', jsonb_build_object('item', job));
  end if;

  if (job->>'stage') <> 'claimed'
    or p_lease_token is null
    or (job->>'lease_expires_at') is null
    or (job->>'lease_expires_at')::timestamptz < now()
    or not exists (
      select 1 from public.catalog_upload_jobs j
      where j.id = p_job_id and j.lease_token = p_lease_token
    )
  then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'job_complete', 'catalog_upload_jobs', p_job_id, 'rejected',
      jsonb_build_object('reason', 'lease_lost'));
    return jsonb_build_object('ok', false, 'reason', 'lease_lost', 'detail', jsonb_build_object('item', job));
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'catalog-derivatives' and o.name = derivative
      and (o.metadata->>'size')::bigint = (p_report->>'derivative_bytes')::bigint
  ) then
    return jsonb_build_object('ok', false, 'reason', 'media_missing',
      'detail', jsonb_build_object('message', 'The derivative object has not been stored'));
  end if;
  if thumbnail is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'catalog-derivatives' and o.name = thumbnail
      and (o.metadata->>'size')::bigint = (p_report->>'thumbnail_bytes')::bigint
  ) then
    return jsonb_build_object('ok', false, 'reason', 'media_missing',
      'detail', jsonb_build_object('message', 'The thumbnail object has not been stored'));
  end if;

  select coalesce(max(v.version_number), 0) + 1 into v_number
  from public.catalog_asset_versions v where v.asset_id = asset;

  insert into public.catalog_asset_versions (
    id, asset_id, version_number, source_path, source_sha256, source_bytes, source_mime,
    derivative_path, derivative_sha256, derivative_bytes, derivative_mime,
    derivative_width, derivative_height, thumbnail_path, thumbnail_sha256,
    validation_state, validation
  )
  values (
    version_id, asset, v_number, job->>'source_path', p_report->>'source_sha256',
    (p_report->>'source_bytes')::bigint, p_report->>'source_mime',
    derivative, p_report->>'derivative_sha256', (p_report->>'derivative_bytes')::bigint,
    p_report->>'derivative_mime', (p_report->>'derivative_width')::integer,
    (p_report->>'derivative_height')::integer, thumbnail, p_report->>'thumbnail_sha256',
    'validated',
    coalesce(p_report->'validation', '{}'::jsonb)
      || jsonb_build_object('renderer', coalesce(p_report->>'renderer', 'unknown'), 'job_id', p_job_id)
  )
  returning to_jsonb(catalog_asset_versions) into version;

  update public.catalog_upload_jobs j
  set stage = 'ready', progress = 100, lease_token = null, lease_expires_at = null,
      error_code = null, error_message = null, updated_at = now()
  where j.id = p_job_id
  returning to_jsonb(j) - 'lease_token' into job;

  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'job_complete', 'catalog_upload_jobs', p_job_id, 'ok',
    jsonb_build_object('asset_id', asset, 'version_id', version_id, 'version_number', v_number));

  return jsonb_build_object('ok', true, 'item', job, 'version', version);
end;
$$;

create function public.catalog_admin_fail_upload_job(
  p_job_id uuid, p_lease_token uuid, p_error_code text, p_error_message text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  job jsonb;
begin
  select to_jsonb(j) - 'lease_token' into job from public.catalog_upload_jobs j
  where j.id = p_job_id;
  if job is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (job->>'stage') not in ('claimed', 'queued') then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost', 'detail', jsonb_build_object('item', job));
  end if;
  if (job->>'stage') = 'claimed' and (
    p_lease_token is null
    or not exists (
      select 1 from public.catalog_upload_jobs j
      where j.id = p_job_id and j.lease_token = p_lease_token
    )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost', 'detail', jsonb_build_object('item', job));
  end if;

  update public.catalog_upload_jobs j
  set stage = 'failed', lease_token = null, lease_expires_at = null,
      error_code = left(coalesce(p_error_code, 'processing_failed'), 100),
      error_message = left(coalesce(p_error_message, 'Processing failed'), 2000),
      updated_at = now()
  where j.id = p_job_id
  returning to_jsonb(j) - 'lease_token' into job;

  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'job_fail', 'catalog_upload_jobs', p_job_id, 'failed',
    jsonb_build_object('code', job->>'p_error_code', 'attempts', job->'attempts'));

  return jsonb_build_object('ok', true, 'item', job);
end;
$$;

create function public.catalog_admin_retry_upload_job(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  job jsonb;
  batch_state text;
begin
  select to_jsonb(j) - 'lease_token', b.state into job, batch_state
  from public.catalog_upload_jobs j
  join public.catalog_upload_batches b on b.id = j.batch_id
  where j.id = p_job_id;
  if job is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if batch_state <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'batch_not_open', 'detail', jsonb_build_object('item', job));
  end if;
  if (job->>'stage') = 'ready' then
    return jsonb_build_object('ok', false, 'reason', 'already_complete', 'detail', jsonb_build_object('item', job));
  end if;
  -- The attempt limit is reported even for a queued job: such a job can never be
  -- claimed again, and saying `ok` would promise work that will not happen.
  if (job->>'attempts')::integer >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'attempts_exhausted', 'detail', jsonb_build_object('item', job));
  end if;
  if (job->>'stage') in ('queued', 'claimed') then
    return jsonb_build_object('ok', true, 'item', job);
  end if;

  update public.catalog_upload_jobs j
  set stage = 'queued', lease_token = null, lease_expires_at = null,
      error_code = null, error_message = null, progress = 0, updated_at = now()
  where j.id = p_job_id
  returning to_jsonb(j) - 'lease_token' into job;

  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'job_retry', 'catalog_upload_jobs', p_job_id, 'ok', jsonb_build_object('attempts', job->'attempts'));

  return jsonb_build_object('ok', true, 'item', job);
end;
$$;

-- Cancelling the batch cancels every job that has not finished. A worker holding
-- a lease on a cancelled job can no longer complete it: the lease is cleared
-- here, so its finalize call is refused as `lease_lost`.
create function public.catalog_admin_cancel_upload_batch(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  cancelled integer;
  batch jsonb;
begin
  update public.catalog_upload_batches b
  set state = 'cancelled', updated_at = now()
  where b.id = p_batch_id and b.state = 'open' and b.created_by = actor
  returning to_jsonb(b) - 'created_by' into batch;
  if batch is null then
    select to_jsonb(b) - 'created_by' into batch from public.catalog_upload_batches b
    where b.id = p_batch_id and b.created_by = actor;
    if batch is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    return jsonb_build_object('ok', false, 'reason', 'batch_not_open', 'detail', jsonb_build_object('item', batch));
  end if;

  update public.catalog_upload_jobs j
  set stage = 'cancelled', lease_token = null, lease_expires_at = null, updated_at = now()
  where j.batch_id = p_batch_id and j.stage in ('queued', 'claimed');
  get diagnostics cancelled = row_count;

  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'upload_batch_cancel', 'catalog_upload_jobs', null, 'ok',
    jsonb_build_object('batch_id', p_batch_id, 'cancelled', cancelled));

  return jsonb_build_object('ok', true, 'item', public.catalog_upload_status_payload(p_batch_id));
end;
$$;

create function public.catalog_admin_close_upload_batch(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  batch jsonb;
begin
  update public.catalog_upload_batches b
  set state = 'closed', updated_at = now()
  where b.id = p_batch_id and b.state = 'open' and b.created_by = actor
  returning to_jsonb(b) - 'created_by' into batch;
  if batch is not null then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'upload_batch_close', 'catalog_upload_jobs', null, 'ok', jsonb_build_object('batch_id', p_batch_id));
    return jsonb_build_object('ok', true, 'item', batch);
  end if;
  select to_jsonb(b) - 'created_by' into batch from public.catalog_upload_batches b
  where b.id = p_batch_id and b.created_by = actor;
  if batch is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'item', batch);
end;
$$;

-- Bounded dry run for P61: only objects that no version references are listed,
-- and only for this batch's reserved sources and its assets' derivatives. The
-- delete policies below enforce the same predicate again, so the listing can
-- never authorize removing live or pinned media.
create function public.catalog_admin_list_orphan_media(p_batch_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  owner uuid;
  sources jsonb;
  source_total integer;
  derivatives jsonb;
  derivative_total integer;
begin
  select b.created_by into owner from public.catalog_upload_batches b where b.id = p_batch_id;
  if owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if owner <> actor then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select count(*) into source_total
  from storage.objects o
  where o.bucket_id = 'catalog-sources'
    and (storage.foldername(o.name))[1] = p_batch_id::text
    and not exists (select 1 from public.catalog_asset_versions v where v.source_path = o.name);

  select coalesce(jsonb_agg(jsonb_build_object('path', o.name, 'bytes', coalesce((o.metadata->>'size')::bigint, 0)) order by o.name), '[]'::jsonb)
  into sources
  from (
    select o.name, o.metadata from storage.objects o
    where o.bucket_id = 'catalog-sources'
      and (storage.foldername(o.name))[1] = p_batch_id::text
      and not exists (select 1 from public.catalog_asset_versions v where v.source_path = o.name)
    order by o.name
    limit v_limit
  ) o;

  select count(*) into derivative_total
  from storage.objects o
  where o.bucket_id = 'catalog-derivatives'
    and (storage.foldername(o.name))[1] = 'assets'
    and (storage.foldername(o.name))[2] in (
      select j.asset_id::text from public.catalog_upload_jobs j
      where j.batch_id = p_batch_id and j.asset_id is not null
    )
    and not exists (
      select 1 from public.catalog_asset_versions v
      where v.derivative_path = o.name or v.thumbnail_path = o.name
    );

  select coalesce(jsonb_agg(jsonb_build_object('path', o.name, 'bytes', coalesce((o.metadata->>'size')::bigint, 0)) order by o.name), '[]'::jsonb)
  into derivatives
  from (
    select o.name, o.metadata from storage.objects o
    where o.bucket_id = 'catalog-derivatives'
      and (storage.foldername(o.name))[1] = 'assets'
      and (storage.foldername(o.name))[2] in (
        select j.asset_id::text from public.catalog_upload_jobs j
        where j.batch_id = p_batch_id and j.asset_id is not null
      )
      and not exists (
        select 1 from public.catalog_asset_versions v
        where v.derivative_path = o.name or v.thumbnail_path = o.name
      )
    order by o.name
    limit v_limit
  ) o;

  return jsonb_build_object('ok', true, 'item', jsonb_build_object(
    'sources', sources,
    'derivatives', derivatives,
    'source_total', source_total,
    'derivative_total', derivative_total,
    'truncated', source_total > v_limit or derivative_total > v_limit
  ));
end;
$$;

-- The journal entry for a cleanup run. Deletion itself is a Storage API call;
-- these policies are what make it safe.
create function public.catalog_admin_record_upload_cleanup(p_batch_id uuid, p_paths text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  owner uuid;
  path text;
  referenced text[] := '{}';
begin
  select b.created_by into owner from public.catalog_upload_batches b where b.id = p_batch_id;
  if owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if owner <> actor then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_paths is null or array_length(p_paths, 1) is null or array_length(p_paths, 1) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_report',
      'detail', jsonb_build_object('message', 'paths must contain 1..200 entries'));
  end if;

  foreach path in array p_paths loop
    if length(path) > 500 then
      referenced := referenced || path;
      continue;
    end if;
    if exists (
      select 1 from public.catalog_asset_versions v
      where v.source_path = path or v.derivative_path = path or v.thumbnail_path = path
    ) or exists (
      select 1 from public.catalog_template_versions t
      where t.cover_path = path
        or exists (
          select 1 from jsonb_array_elements(t.slide_previews) preview
          where preview->>'path' = path
        )
    ) then
      referenced := referenced || path;
    end if;
  end loop;

  if array_length(referenced, 1) is not null then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'upload_cleanup', 'catalog_upload_jobs', null, 'rejected',
      jsonb_build_object('batch_id', p_batch_id, 'referenced', to_jsonb(referenced)));
    return jsonb_build_object('ok', false, 'reason', 'media_referenced',
      'detail', jsonb_build_object('paths', to_jsonb(referenced)));
  end if;

  insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
  values (actor, 'upload_cleanup', 'catalog_upload_jobs', null, 'ok',
    jsonb_build_object('batch_id', p_batch_id, 'removed', to_jsonb(p_paths)));

  return jsonb_build_object('ok', true, 'item', jsonb_build_object('removed', array_length(p_paths, 1)));
end;
$$;

-- Cleanup is only possible for a batch that is no longer uploading, and only for
-- objects no version references. There is still no update policy: sources and
-- derivatives are immutable, and replacing a derivative is a new version row.
create policy catalog_sources_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'catalog-sources'
    and public.catalog_is_admin()
    and exists (
      select 1 from public.catalog_upload_batches b
      where b.id::text = (storage.foldername(storage.objects.name))[1]
        and b.created_by = (select auth.uid())
        and b.state in ('closed', 'cancelled')
    )
    and not exists (
      select 1 from public.catalog_asset_versions v
      where v.source_path = storage.objects.name
    )
  );
create policy catalog_derivatives_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'catalog-derivatives'
    and public.catalog_is_admin()
    and not exists (
      select 1 from public.catalog_asset_versions v
      where v.derivative_path = storage.objects.name or v.thumbnail_path = storage.objects.name
    )
    and not exists (
      select 1 from public.catalog_template_versions t
      where t.cover_path = storage.objects.name
        or exists (
          select 1 from jsonb_array_elements(t.slide_previews) preview
          where preview->>'path' = storage.objects.name
        )
    )
  );

revoke execute on function public.catalog_upload_status_payload(uuid) from public, anon, authenticated;
revoke execute on function
  public.catalog_admin_create_upload_batch(uuid, jsonb),
  public.catalog_admin_upload_status(uuid),
  public.catalog_admin_list_upload_batches(integer, timestamptz, uuid),
  public.catalog_admin_claim_upload_job(integer),
  public.catalog_admin_complete_upload_job(uuid, uuid, jsonb),
  public.catalog_admin_fail_upload_job(uuid, uuid, text, text),
  public.catalog_admin_retry_upload_job(uuid),
  public.catalog_admin_cancel_upload_batch(uuid),
  public.catalog_admin_close_upload_batch(uuid),
  public.catalog_admin_list_orphan_media(uuid, integer),
  public.catalog_admin_record_upload_cleanup(uuid, text[])
  from public, anon, authenticated;
grant execute on function
  public.catalog_admin_create_upload_batch(uuid, jsonb),
  public.catalog_admin_upload_status(uuid),
  public.catalog_admin_list_upload_batches(integer, timestamptz, uuid),
  public.catalog_admin_claim_upload_job(integer),
  public.catalog_admin_complete_upload_job(uuid, uuid, jsonb),
  public.catalog_admin_fail_upload_job(uuid, uuid, text, text),
  public.catalog_admin_retry_upload_job(uuid),
  public.catalog_admin_cancel_upload_batch(uuid),
  public.catalog_admin_close_upload_batch(uuid),
  public.catalog_admin_list_orphan_media(uuid, integer),
  public.catalog_admin_record_upload_cleanup(uuid, text[])
to authenticated;
