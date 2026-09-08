-- Private local-first persistence. No public sharing or privileged browser keys.
create extension if not exists pg_jsonschema with schema extensions;

create function public.valid_sticker_document(body jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select extensions.jsonb_matches_schema('{
    "type":"object","additionalProperties":false,
    "required":["schemaVersion","id","title","artboard","layers","assetIds","createdAt","updatedAt","revision"],
    "properties":{
      "schemaVersion":{"const":1},"id":{"type":"string","minLength":1,"maxLength":200},"title":{"type":"string","maxLength":10000},
      "createdAt":{"type":"string","format":"date-time"},"updatedAt":{"type":"string","format":"date-time"},"revision":{"type":"integer","minimum":0},
      "artboard":{"const":{"width":1024,"height":1024,"background":"transparent"}},
      "assetIds":{"type":"array","maxItems":500,"uniqueItems":true,"items":{"type":"string","minLength":1}},
      "layers":{"type":"array","maxItems":500,"items":{
        "type":"object","additionalProperties":false,"required":["id","name","kind","transform","opacity","visible","locked"],
        "properties":{
          "id":{"type":"string","minLength":1},"name":{"type":"string"},"kind":{"enum":["image","text","shape"]},
          "transform":{"type":"object","additionalProperties":false,"required":["x","y","rotation","scaleX","scaleY"],"properties":{"x":{"type":"number"},"y":{"type":"number"},"rotation":{"type":"number"},"scaleX":{"type":"number"},"scaleY":{"type":"number"}}},
          "opacity":{"type":"number","minimum":0,"maximum":1},"visible":{"type":"boolean"},"locked":{"type":"boolean"},
          "assetId":{"type":"string","minLength":1},"maskKey":{"type":"string","minLength":1},
          "crop":{"type":"object","additionalProperties":false,"required":["x","y","width","height"],"properties":{"x":{"type":"number"},"y":{"type":"number"},"width":{"type":"number","exclusiveMinimum":0},"height":{"type":"number","exclusiveMinimum":0}}},
          "filters":{"type":"object","additionalProperties":false,"required":["brightness","contrast","saturation","grayscale"],"properties":{"brightness":{"type":"number","minimum":-100,"maximum":100},"contrast":{"type":"number","minimum":-100,"maximum":100},"saturation":{"type":"number","minimum":-100,"maximum":100},"grayscale":{"type":"number","minimum":0,"maximum":100}}},
          "outline":{"type":"object","additionalProperties":false,"required":["enabled","color","width"],"properties":{"enabled":{"type":"boolean"},"color":{"type":"string"},"width":{"type":"number","minimum":0,"maximum":40}}},
          "content":{"type":"string"},"fontFamily":{"type":"string","minLength":1},"fontSize":{"type":"number","exclusiveMinimum":0},"color":{"type":"string"},"shape":{"enum":["circle","rectangle"]},"fill":{"type":"string"}
        },
        "allOf":[
          {"if":{"properties":{"kind":{"const":"image"}}},"then":{"required":["assetId"]}},
          {"if":{"properties":{"kind":{"const":"text"}}},"then":{"required":["content","fontFamily","fontSize","color"]}},
          {"if":{"properties":{"kind":{"const":"shape"}}},"then":{"required":["shape","fill"]}}
        ]
      }}
    }
  }'::json, body)
  and (select count(*) = count(distinct layer->>'id') from jsonb_array_elements(body->'layers') layer)
  and not exists (select 1 from jsonb_array_elements(body->'layers') layer where layer->>'kind' = 'image' and not (body->'assetIds' ? (layer->>'assetId')));
$$;

create table public.projects (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  document jsonb not null check (public.valid_sticker_document(document) and document->>'id' = id),
  revision bigint not null default 1 check (revision > 0),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create table public.packs (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  document jsonb not null check (document->>'id' = id and extensions.jsonb_matches_schema('{
    "type":"object","additionalProperties":false,"required":["id","title","description","visibility","projectIds","createdAt","updatedAt"],
    "properties":{"id":{"type":"string","minLength":1},"title":{"type":"string","minLength":1,"maxLength":10000},"description":{"type":"string","maxLength":10000},"visibility":{"const":"private"},"projectIds":{"type":"array","maxItems":500,"uniqueItems":true,"items":{"type":"string","minLength":1}},"createdAt":{"type":"string","format":"date-time"},"updatedAt":{"type":"string","format":"date-time"}}
  }'::json, document)),
  revision bigint not null default 1 check (revision > 0),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create table public.pack_items (
  owner_id uuid not null,
  pack_id text not null,
  project_id text not null,
  position integer not null check (position >= 0),
  primary key (owner_id, pack_id, project_id),
  unique (owner_id, pack_id, position),
  foreign key (owner_id, pack_id) references public.packs(owner_id, id),
  foreign key (owner_id, project_id) references public.projects(owner_id, id)
);
create index pack_items_project on public.pack_items(owner_id, project_id);
create table public.project_binaries (
  owner_id uuid not null,
  project_id text not null,
  kind text not null check (kind in ('asset','mask')),
  logical_key text not null,
  hash text not null check (hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null,
  primary key (owner_id, project_id, kind, logical_key),
  foreign key (owner_id, project_id) references public.projects(owner_id, id)
);
create table public.cloud_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

alter table public.projects enable row level security;
alter table public.packs enable row level security;
alter table public.pack_items enable row level security;
alter table public.project_binaries enable row level security;
alter table public.cloud_operations enable row level security;
create policy owner_read on public.projects for select to authenticated using (owner_id = (select auth.uid()));
create policy owner_read on public.packs for select to authenticated using (owner_id = (select auth.uid()));
create policy owner_read on public.pack_items for select to authenticated using (owner_id = (select auth.uid()));
create policy owner_read on public.project_binaries for select to authenticated using (owner_id = (select auth.uid()));
-- Writes only through the authorized compare-and-set RPC; operation journal is not exposed.
revoke all on public.projects, public.packs, public.pack_items, public.project_binaries, public.cloud_operations from anon, authenticated;
grant select on public.projects, public.packs, public.pack_items, public.project_binaries to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stickerlab-private', 'stickerlab-private', false, 15728640, array['image/png','image/jpeg','image/webp']);
create policy stickerlab_binary_read on storage.objects for select to authenticated
using (bucket_id = 'stickerlab-private' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy stickerlab_binary_insert on storage.objects for insert to authenticated
with check (bucket_id = 'stickerlab-private' and name ~ ('^' || (select auth.uid())::text || '/[a-f0-9]{64}$'));
-- No update/delete policies: committed and uncertain-operation binaries are immutable.

create function public.commit_sticker_resource(
  operation_id uuid, resource_kind text, resource_id text, expected_revision bigint,
  body jsonb, binaries jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  old_body jsonb;
  old_revision bigint;
  old_deleted boolean;
  target_id text := resource_id;
  target_revision bigint;
  conflict boolean := false;
  original jsonb;
  resource jsonb;
  result jsonb;
  request jsonb := jsonb_build_object('kind',resource_kind,'id',resource_id,'base',expected_revision,'body',body,'binaries',binaries);
  prior public.cloud_operations%rowtype;
  item jsonb;
  table_name text;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if resource_kind not in ('project','pack') or resource_kind is null or resource_id is null or expected_revision is null or expected_revision < 0 or operation_id is null then raise exception 'Invalid operation'; end if;
  table_name := case resource_kind when 'project' then 'projects' else 'packs' end;
  -- ponytail: serialize commits per owner; use ordered resource locks if account throughput requires it.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into prior from public.cloud_operations o where o.owner_id = uid and o.operation_id = commit_sticker_resource.operation_id;
  if found then
    if prior.request <> request then raise exception 'Operation identity reused for different content'; end if;
    return prior.result;
  end if;
  execute format('select document, revision, deleted from public.%I where owner_id = $1 and id = $2', table_name)
    into old_body, old_revision, old_deleted using uid, resource_id;
  if body is not null and body->>'id' is distinct from resource_id then raise exception 'Document identity mismatch'; end if;
  if body is null and old_revision is null then raise exception 'Cannot delete unknown resource'; end if;
  conflict := coalesce(old_revision,0) <> expected_revision or coalesce(old_deleted,false);
  if old_revision is not null then
    original := jsonb_build_object('kind',resource_kind,'id',resource_id,'revision',old_revision,'deleted',old_deleted,'value',old_body);
  end if;
  if conflict and body is null then
    result := jsonb_build_object('resource',original,'conflict',true);
  else
    if conflict then
      target_id := operation_id::text;
      body := jsonb_set(jsonb_set(body,'{id}',to_jsonb(target_id)),'{title}',to_jsonb((body->>'title') || ' (conflict copy)'));
    end if;
    target_revision := case when conflict then 1 else coalesce(old_revision,0)+1 end;
    if body is null then
      -- A referenced sticker cannot disappear from a live pack without a pack revision change.
      if resource_kind = 'project' and exists(select 1 from public.pack_items i join public.packs p on p.owner_id=i.owner_id and p.id=i.pack_id where i.owner_id=uid and i.project_id=resource_id and not p.deleted) then raise exception 'Remove this sticker from its packs before deleting it'; end if;
      execute format('update public.%I set deleted=true, revision=$3, updated_at=now() where owner_id=$1 and id=$2',table_name) using uid,target_id,target_revision;
      resource := jsonb_build_object('kind',resource_kind,'id',target_id,'revision',target_revision,'deleted',true,'value',old_body);
    else
      if resource_kind = 'pack' then body := jsonb_set(body,'{visibility}','"private"'); end if;
      if conflict and exists(select 1 from public.projects where owner_id=uid and id=target_id union all select 1 from public.packs where owner_id=uid and id=target_id) then raise exception 'Conflict identity already exists'; end if;
      execute format('insert into public.%I(owner_id,id,document,revision) values($1,$2,$3,$4) on conflict(owner_id,id) do update set document=excluded.document,revision=excluded.revision,updated_at=now()', table_name) using uid,target_id,body,target_revision;
      if resource_kind = 'project' then
        if jsonb_typeof(binaries) <> 'array' or jsonb_array_length(binaries)>1000 then raise exception 'Invalid binaries'; end if;
        delete from public.project_binaries where owner_id=uid and project_id=target_id;
        for item in select * from jsonb_array_elements(binaries) loop
          if not exists(select 1 from storage.objects where bucket_id='stickerlab-private' and name=uid::text || '/' || (item->>'hash') and (metadata->>'size')::bigint between 1 and 15728640) then raise exception 'Required upload is missing'; end if;
          if item->>'kind' = 'asset' and not extensions.jsonb_matches_schema('{"type":"object","additionalProperties":false,"required":["id","mimeType","width","height","blobKey","provenance"],"properties":{"id":{"type":"string"},"mimeType":{"enum":["image/png","image/jpeg","image/webp"]},"width":{"type":"integer","minimum":1},"height":{"type":"integer","minimum":1},"blobKey":{"type":"string"},"provenance":{"type":"string"}}}'::json,item->'metadata') then raise exception 'Invalid asset metadata'; end if;
          if item->>'kind' = 'asset' and ((item->'metadata'->>'id') is distinct from (item->>'key') or (item->'metadata'->>'width')::bigint * (item->'metadata'->>'height')::bigint > 25000000) then raise exception 'Invalid asset dimensions or identity'; end if;
          insert into public.project_binaries values(uid,target_id,item->>'kind',item->>'key',item->>'hash',item->'metadata');
        end loop;
        if exists(select 1 from jsonb_array_elements_text(body->'assetIds') a where not exists(select 1 from public.project_binaries b where b.owner_id=uid and b.project_id=target_id and b.kind='asset' and b.logical_key=a))
          or exists(select 1 from jsonb_array_elements(body->'layers') l where l->>'kind'='image' and l ? 'maskKey' and not exists(select 1 from public.project_binaries b where b.owner_id=uid and b.project_id=target_id and b.kind='mask' and b.logical_key=l->>'maskKey')) then raise exception 'Incomplete binary references'; end if;
      else
        delete from public.pack_items where owner_id=uid and pack_id=target_id;
        if exists(select 1 from jsonb_array_elements_text(body->'projectIds') a where not exists(select 1 from public.projects p where p.owner_id=uid and p.id=a and not p.deleted)) then raise exception 'Pack references an unavailable sticker'; end if;
        insert into public.pack_items select uid,target_id,a.value,(a.ordinality-1)::integer from jsonb_array_elements_text(body->'projectIds') with ordinality a;
      end if;
      resource := jsonb_build_object('kind',resource_kind,'id',target_id,'revision',target_revision,'deleted',false,'value',body);
    end if;
    result := jsonb_build_object('resource',resource,'conflict',conflict);
    if conflict then result := result || jsonb_build_object('original',original); end if;
  end if;
  insert into public.cloud_operations values(uid,operation_id,request,result,now());
  return result;
end;
$$;
revoke all on function public.valid_sticker_document(jsonb) from public, anon, authenticated;
revoke all on function public.commit_sticker_resource(uuid,text,text,bigint,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.commit_sticker_resource(uuid,text,text,bigint,jsonb,jsonb) to authenticated;
