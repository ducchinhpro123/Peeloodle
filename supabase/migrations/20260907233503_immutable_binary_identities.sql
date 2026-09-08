-- A logical asset/mask key cannot be rebound, even across different projects.
create table public.binary_versions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('asset','mask')),
  logical_key text not null,
  hash text not null check (hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null,
  primary key (owner_id, kind, logical_key),
  unique (owner_id, kind, logical_key, hash)
);
insert into public.binary_versions select distinct owner_id, kind, logical_key, hash, metadata from public.project_binaries;
alter table public.binary_versions enable row level security;
create policy owner_read on public.binary_versions for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.binary_versions from anon, authenticated;
grant select on public.binary_versions to authenticated;
create function public.register_binary_version() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.binary_versions values (new.owner_id,new.kind,new.logical_key,new.hash,new.metadata) on conflict (owner_id,kind,logical_key) do nothing;
  if not exists(select 1 from public.binary_versions b where b.owner_id=new.owner_id and b.kind=new.kind and b.logical_key=new.logical_key and b.hash=new.hash and b.metadata=new.metadata) then
    raise exception 'Original asset and mask identities are immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.register_binary_version() from public, anon, authenticated;
create trigger register_binary_version before insert on public.project_binaries for each row execute function public.register_binary_version();
alter table public.project_binaries add constraint immutable_binary_reference foreign key(owner_id,kind,logical_key,hash) references public.binary_versions(owner_id,kind,logical_key,hash);
