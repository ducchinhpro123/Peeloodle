# Production release plan

This is the owner checklist for enabling private cloud on the deployed site. **Do not treat local test success as production acceptance.** Real magic-link delivery remains an acceptance gate.

## Release revision

**Git SHA: `ff7b35fa6d364aa592f3b342bc5612ac184f0223`**

Checkout this revision for the authorized production build. Vite embeds `VITE_*` values at build time; setting Vercel environment variables without rebuilding from this SHA does not enable cloud on an existing deployment.

Product at this revision includes: local-first editor (Back to Home, title/save chrome, Adjust inspector), artwork-bounded PNG/ZIP export, one-shot cloud test seeding, A→B isolation waits, and pack membership restore on rejected stale deletes.

## What is already true

- Supabase project `ckmeozlmyvhjrzliwllz` (Singapore) is provisioned; committed migrations are applied.
- The SPA is hosted at `https://stickerlab-eta.vercel.app` (Vercel project `stickerlab` under `ducchinhpro123s-projects`).
- Without the three public Vite variables below, the live site stays local-only and shows “Cloud saving is not configured for this site.”
- `npm run test:cloud` uses dedicated ordinary test accounts and synthetic sessions. It does **not** prove inbox delivery.

## 1. Production build inputs (Vercel Production)

Set these on the Vercel project **Production** environment only. Never add a service-role key, SMTP password, or database URL to frontend env.

```dotenv
VITE_SUPABASE_URL=https://ckmeozlmyvhjrzliwllz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<enabled publishable or anon key; never service-role>
VITE_AUTH_ALLOWED_ORIGINS=https://stickerlab-eta.vercel.app
```

`VITE_AUTH_ALLOWED_ORIGINS` is an exact origin match (`src/features/auth/client.ts`). If you also serve a `*.vercel.app` alias, add that origin explicitly or cloud stays off there.

After the variables exist, **rebuild and deploy this SHA** (`npx vercel --prod` from this commit, or Git production deploy of this commit). A previous Ready deployment will not pick up new `VITE_*` values.

## 2. Supabase Auth URLs

In Supabase Dashboard → Authentication → URL Configuration:

| Setting | Value |
| --- | --- |
| Site URL | `https://stickerlab-eta.vercel.app` |
| Redirect allow list | `https://stickerlab-eta.vercel.app/auth/callback` |

Keep local callbacks for development if you still use them (`http://localhost:5173/auth/callback`, `http://127.0.0.1:4173/auth/callback`, `http://127.0.0.1:4174/auth/callback`). The app requests `emailRedirectTo = ${origin}/auth/callback` and strips unknown `next` targets.

## 3. SMTP (required for production magic links)

[Supabase default mail](https://supabase.com/docs/guides/auth/auth-smtp) only delivers to project team addresses and is rate-limited (~2/hour). It is **not** a production delivery path.

Owner must configure **custom SMTP** in Authentication → SMTP (or Emails) before claiming sign-in works for ordinary users:

1. Choose an SMTP provider the owner already operates or is willing to set up (examples: Resend, Postmark, Amazon SES, a Google Workspace SMTP relay). This document does not purchase a plan or create a provider account.
2. Use a sender domain the owner controls. Add the provider’s SPF and DKIM records; wait until they verify.
3. In Supabase, set host, port (typically 587 with STARTTLS), SMTP username, SMTP password, sender email, and sender name (for example `StickerLab <noreply@your-domain>`).
4. Send a test from the dashboard to an **owner-controlled inbox**. Confirm the message is not only in spam, and that the From address matches the authenticated domain.
5. Do not put SMTP credentials in Vercel frontend env, the repo, `.env.example`, or logs.

Until this is done, the UI may still say a link was requested; that is not delivery.

## 4. Deploy sequence (after owner approval)

1. Set the three Vercel Production variables in §1.
2. Confirm §2 Site URL and redirect allow list.
3. Confirm §3 custom SMTP test mail arrived in the owner inbox.
4. Deploy **this SHA** to production (rebuild required).
5. Open `https://stickerlab-eta.vercel.app`, Guest account: the dialog must offer email sign-in, not “Cloud saving is not configured.”

## 5. Magic-link acceptance gate (not optional)

On the **deployed** origin, with an owner-controlled inbox:

1. Request a sign-in link.
2. Confirm the email arrives (same browser session is required for PKCE).
3. Open the newest link in that browser.
4. Land on `/auth/callback`, finish sign-in, reach an authenticated workspace.
5. Create or reopen a sticker, save until “Saved to cloud”, reopen in a second browser/profile, export PNG.

Failures (expired link, used link, wrong browser) must show the existing recoverable callback copy. Do not mark cloud production-complete until this path succeeds.

Invalid-callback UI is already covered in `e2e/cloud.spec.ts`. Successful PKCE + inbox delivery is **not**.

## 6. Out of bounds for this release

- Service-role keys in the browser or Vercel `VITE_*` variables
- Enabling paid Supabase features without a separate owner decision
- Public sharing, native WhatsApp/Telegram install, billing
- Treating `npm run test:cloud` as magic-link verification
