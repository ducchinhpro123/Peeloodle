-- Claim a specific job, so a processing request that carries a job ID can only
-- ever act on that job. `p_job_id` is optional: the dashboard may still ask for
-- "the next queued job" when resuming a batch.
--
-- This replaces the function from the previous migration because PostgreSQL
-- cannot add a parameter to an existing function. `catalog_admin_claim_upload_job`
-- is referenced by the adapter as an RPC only, so dropping and recreating it is
-- invisible to callers that pass `lease_seconds`.
drop function public.catalog_admin_claim_upload_job(integer);

create function public.catalog_admin_claim_upload_job(
  p_lease_seconds integer default 300, p_job_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  job_id uuid;
  claimed jsonb;
  token uuid := gen_random_uuid();
  v_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
begin
  select j.id into job_id
  from public.catalog_upload_jobs j
  join public.catalog_upload_batches b on b.id = j.batch_id
  where b.state = 'open'
    and b.created_by = actor
    and (p_job_id is null or j.id = p_job_id)
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

revoke execute on function public.catalog_admin_claim_upload_job(integer, uuid) from public, anon, authenticated;
grant execute on function public.catalog_admin_claim_upload_job(integer, uuid) to authenticated;
