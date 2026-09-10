# P08 — Native processing packaging: not yet executed, harness prepared

Date: 2026-09-10 (updated after review). Status: **evidence still missing** — no
deployment was performed. The previous version of this note pointed at P54–P57
as a prerequisite, which created a circular dependency. That is corrected: P08
needs only a minimal isolated preview harness, not catalog ingestion.

## What is prepared now

`server/processing/probe.ts` (not mounted by the application, unit-tested in
`probe.test.ts`):

- `handleStagedProcessProbe(body, deps)` — function-shaped entry that receives
  **only a Storage object reference** (`{ path }`), downloads the staged object
  inside the function, runs the real `processAssetBytes`, and writes the PNG
  derivative back to Storage. Image bytes never enter the request body, matching
  the real transport that P08 must prove. The body cap is a measured 64 KB JSON
  reference limit, not an image allowance.
- `probeStorageRoundTrip(client, bucket, path, bytes)` — client-side
  upload → download → hash comparison → cleanup, used to verify the derivative
  the function wrote.
- `probeStorageRoundTrip` uses a narrow injectable Storage surface, so the
  connected path is testable without credentials.
- `requireProbeEnv(env)` — requires **server-only** env names
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CATALOG_PROBE_BUCKET`); it
  refuses to fall back to `VITE_*` names so a probe cannot be built from
  browser-visible configuration.
- Bucket and path prefix come from the function's environment, never from the
  request; traversal, absolute paths and foreign prefixes are rejected.

## Exactly what the authorized preview must run

1. Deploy the current app to a preview with the three server-only env vars set
   and a private probe bucket created (no public policy).
2. Add a throwaway guarded route (secret header check) that calls
   `handleProcessProbe`; this is the only code that needs to exist for the
   packaging proof.
3. Send one request containing only `{ path: 'staging/<file>' }` and confirm:
   200 JSON with matching dimensions; the version reports the expected
   libvips/sharp build; the invocation stays inside the configured memory/time
   limits; a PNG derivative appears under `derivatives/`.
4. Download that derivative with `probeStorageRoundTrip` and confirm
   `matches: true, removed: true`.
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
