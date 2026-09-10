# P08 — Native processing packaging: not yet executed, harness prepared

Date: 2026-09-10 (updated after review). Status: **evidence still missing** — no
deployment was performed. The previous version of this note pointed at P54–P57
as a prerequisite, which created a circular dependency. That is corrected: P08
needs only a minimal isolated preview harness, not catalog ingestion.

## What is prepared now

`server/processing/probe.ts` (not mounted by the application, unit-tested in
`probe.test.ts`):

- `handleProcessProbe(body)` — function-shaped entry (`{ bytesBase64 }` → JSON):
  enforces the documented 4.5 MB request limit, runs the real
  `processAssetBytes`, and returns typed success/failure JSON.
- `probeStorageRoundTrip(client, bucket, path, bytes)` — upload → download →
  hash comparison → cleanup, against a narrow injectable Storage surface.
- `requireProbeEnv(env)` — requires **server-only** env names
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CATALOG_PROBE_BUCKET`); it
  refuses to fall back to `VITE_*` names so a probe cannot be built from
  browser-visible configuration.

## Exactly what the authorized preview must run

1. Deploy the current app to a preview with the three server-only env vars set
   and a private probe bucket created (no public policy).
2. Add a throwaway guarded route (secret header check) that calls
   `handleProcessProbe`; this is the only code that needs to exist for the
   packaging proof.
3. Send one fixture PNG and confirm: 200 JSON with matching dimensions; the
   version reports the expected libvips/sharp build; the invocation stays inside
   the configured memory/time limits.
4. Run `probeStorageRoundTrip` with a Storage client built from the same env and
   confirm `matches: true, removed: true`; inspect the bucket to confirm no
   probe object remains.
5. Record the deployment URL, runtime, memory/time configuration, function logs
   and the responses; then remove the temporary route.

## What must not happen

- No production publishing, no service key in `VITE_*`, logs, client bundles or
  committed files.
- Do not use this probe to accept real user uploads: authentication and the
  catalog job workflow belong to P54–P57 and are still unimplemented.
- Full ingestion work must not be considered unblocked by the existence of this
  harness; only by actual preview evidence.

## Current environment

```
vercel CLI      not installed
~/.vercel auth  not present
api/            does not exist
```

Local evidence that the same code path works on this machine is in
`proofs/p07-processing.md`.
