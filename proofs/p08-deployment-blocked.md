# P08 — Native processing packaging on a preview deployment: BLOCKED

Date: 2026-09-10. Status: **not executed** — the required environment and
prerequisites are unavailable in this workspace. No deployment, publish or
purchase was attempted (AGENTS.md and the implementation plan both prohibit
publishing without authorization).

## What the task requires

Evidence that sharp/resvg native modules package and run in an authorized
preview deployment, that image bytes bypass the function request body via
direct-to-Storage upload, and that a job invocation works. That needs:

1. An authorized Vercel account/project with `sharp` and `@resvg/resvg-js`
   native binaries for the Node runtime.
2. The `api/` processing endpoint and Supabase Storage integration, which are
   scheduled for P54–P57 (Milestone 4/5), not yet implemented.
3. Server-only credentials (`SUPABASE_SERVICE_ROLE_KEY`, storage bucket setup)
   which are intentionally absent from this repository (only placeholders in
   `.env.example`) and which I must not invent or request.

Environment checks performed:

```
vercel CLI      not installed
~/.vercel auth  not present
git remote      git@github.com:ducchinhpro123/Peeloodle.git
api/            does not exist yet
```

## What was verified instead (local, same code path)

- `server/processing` runs on Node 24.21.0 with the exact production-native
  libraries (sharp 0.35.4/libvips 8.18.6, resvg 2.6.2) — see `p07-processing.md`.
- `npm run typecheck` now covers `server/**` via `tsconfig.server.json`.
- The Vite production build does **not** include sharp/resvg: server code is not
  imported by `src/`; the bundle check is recorded in the Milestone 0 handoff.
- Vercel's documented 4.5 MB function body limit is respected by design:
  processing receives a job id, not image bytes (architecture §Bulk upload).

## Remaining work

- Implement `api/` and Storage access (P54–P57), then run this task in a
  preview deployment with the owner's authorization.
- Record the deployed runtime, configured memory/time limits, actual cold-start
  behavior and one-job invocation evidence.
- Until then, the admin ingestion gate stays closed: do not advertise or use
  catalog uploads based on local-only proof.
