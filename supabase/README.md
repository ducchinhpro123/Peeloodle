# Supabase catalog operations

The browser integration reads only public configuration (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_AUTH_ALLOWED_ORIGINS`) and a publishable key.
Service credentials never ship to the browser.

## Migrations

Apply `supabase/migrations/*.sql` in filename order (the Supabase CLI does this).
The catalog migrations are additive: the private sticker tables, their policies
and the existing `stickerlab-private` bucket are untouched.

| Migration                  | Adds                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `…_catalog_schema.sql`     | catalog tables, immutable version rows, published-pointer integrity |
| `…_catalog_policies.sql`   | `catalog_is_admin()`, row policies, the two private catalog buckets |
| `…_catalog_admin_rpcs.sql` | guarded draft create/edit plus publish/archive RPCs                 |

Verify them locally against a throwaway PostgreSQL cluster (no credentials or
network involved):

```bash
npm run test:catalog-sql
```

## Admin bootstrap and recovery

Admin membership is a **controlled SQL step**, not an endpoint. There is no
public bootstrap route, and `catalog_admins` has no RLS policies at all, so no
client (admin or not) can read, add or remove membership through the API.

Grant membership to an existing account (find its id under Authentication →
Users, or `select id, email from auth.users`):

```sql
insert into public.catalog_admins (user_id) values ('<user-uuid>')
on conflict (user_id) do nothing;
```

Recover access when an administrator is lost:

```sql
-- List current members and their accounts
select a.user_id, u.email, a.created_at
from public.catalog_admins a
left join auth.users u on u.id = a.user_id
order by a.created_at;

-- Remove a member (their next RPC call stops being an administrator)
delete from public.catalog_admins where user_id = '<user-uuid>';

-- Transfer by adding the replacement first, then removing the old member.
```

Deleting the `auth.users` row cascades to `catalog_admins`, so a removed account
loses catalog access immediately. Each guarded RPC verifies current membership on
every call; there is no cached role.

## Publication rules enforced by the database

- A version row is immutable; the server inserts it already validated (trusted
  processing), and nothing can edit its hashes afterwards.
- Publishing an asset requires a validated version and a published collection.
- Publishing a template requires a validated version whose pinned asset versions
  are the currently published ones.
- Archiving an asset or a collection is refused while a published template pins
  the asset's published version (`pinned_by_template`).
- Every catalog table grants `select` only. Draft edits, publish and archive go
  through security-definer RPCs that check `catalog_admins`, compare the expected
  revision and journal the outcome in `catalog_events`.
- Storage buckets are private. Derivatives become readable only while the
  immutable version that names them is the published one; sources and drafts
  never are.

## Validation endpoint

Asset validation is the app's only server-side feature: `POST /api/catalog/process` takes
`{ jobId }` plus the caller's Supabase access token, claims that job with a lease, downloads the
reserved source object, validates and derives it (`sharp` for PNG/static WebP, `resvg` for the
approved SVG subset), stores the immutable derivatives and finalizes the version.

- No service-role key is used or needed: every Supabase call runs as the administrator's own JWT, and
  the same row policies and `catalog_admins` membership checks apply.
- The endpoint needs the same public configuration as the app (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`) and a runtime that can execute Node modules. On a purely static
  host the route does not exist, so uploads can be stored but not validated or published.
- The administrator's browser still drives the queue (at most two files at a time), so closing the
  tab leaves the remaining jobs queued; reopening `/admin/uploads` reports exactly that.
