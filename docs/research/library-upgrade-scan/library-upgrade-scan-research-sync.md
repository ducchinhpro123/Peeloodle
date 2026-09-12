# Research: persistence, local-first sync, collaboration, history — StickerLab

**Dimension:** (a) local-first sync engines, (b) storage adapters, (c) undo/history tooling,
(d) blob/asset management, (e) conflict detection + schema-version migration + backup/restore.
**Explicitly out of scope here:** UI libraries, canvas/image libraries, editor SDKs
(`docs/editor-library-research.md` already settled those — not re-opened).

## READ THIS FIRST — sourcing limitation (material to how you should read this file)

This subagent ran with **only** `read` / `write` / `contact_supervisor` available: **no web fetch,
no `source_check`, no registry query**. The assignment's normal rules ("verify every URL resolves",
"verify versions and licences or omit them") therefore **cannot be satisfied for any
third-party library fact**. Rather than invent numbers, this file is split:

- **Part 1 / Part 3** — architectural fit against *locally read, first-party repo evidence*. Every
  claim cites a repo path + symbol (and an exact line number where I pinned one). This is my real
  contribution and it does not need the internet.
- **Part 2** — the candidate table. **Every externally-sourced cell is literally `TODO-VERIFY`.**
  Empty/honest beats plausible. No version, licence, date, maintenance statistic, or benchmark
  appears anywhere in this file unless it was read from a file in this repository.
- Any statement about a third-party library's *internals* (not its role) is labelled
  **`Inference`** and carries no confidence weight. Library names and their broad category are the
  only external facts asserted, and even those are flagged where a redesign makes my prior
  knowledge potentially stale.

**Consequence for the parent/synthesis pass:** Parts 1 and 3 stand on their own. Part 2 is a
work-list for a session that has web tools.

---

## 1. Sources

All sources are first-party repository files, read directly in this session. Library docs, repos,
npm pages and licences were **not** fetched (no web tool), so they are deliberately **absent** from
this list rather than cited from memory. No wall-clock date is available to this subagent; the
newest in-repo timestamp I read is `HANDOFF.md` "Updated 2026-09-11" [S3].

- **[S1]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/repository.ts` — repository file (first-party). The `StickerLabRepository` interface, `MemoryRepository`, `IdbRepository`, the outbox (`enqueue`), `cacheRemote`, `acknowledge`.
- **[S2]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/idb.ts` — repository file. Raw IndexedDB plumbing: DB name, version 5, store names, `runTransaction`, `blobToArrayBuffer`.
- **[S3]** `/home/vdc/Projects/Peeloodle/HANDOFF.md` — repository file. Current increment, guardrails (additive IDB rule; never reuse `ProjectDocument`).
- **[S4]** `/home/vdc/Projects/Peeloodle/AGENTS.md` — repository file. Product invariants: one document schema, blobs separate from JSON, owner RLS, guest→account migration idempotency, conflict copy, no secrets in frontend.
- **[S5]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/document.ts` — repository file. Hand-rolled validators, `PersistenceErrorCode` (includes `revision_conflict`, `unsupported_schema`), `parseProjectDocument`.
- **[S6]** `/home/vdc/Projects/Peeloodle/src/features/editor/store.ts` — repository file. Zustand store, `HISTORY_LIMIT = 50`, `beginGesture`/`commitGesture`, `undo`/`redo`, `assetsFor`/`masksFor`.
- **[S7]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/cloud.ts` — repository file. `CloudRepository extends IdbRepository`, `sync()`/`drain()`, conflict handling, remote hydration, `importGuest`.
- **[S8]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/cloudRemote.ts` — repository file. `CloudRemote` interface, `binaryHash` (SHA-256), `SupabaseRemote` (private bucket, upload verify, `commit_sticker_resource` RPC).
- **[S9]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/syncTypes.ts` — repository file. `SyncEntry`, `RemoteResource`, `CommitResult`, `BinaryReference`.
- **[S10]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/presentations/repository.ts` — repository file. `PresentationRepository`, `SavePresentationOptions.baseRevision`, immutable-media checks.
- **[S11]** `/home/vdc/Projects/Peeloodle/src/lib/persistence/presentations/idb.ts` — repository file. Additive v5 stores, atomic document+media save inside one transaction, revision checks.
- **[S12]** `/home/vdc/Projects/Peeloodle/package.json` — repository file. Exact direct dependency set at HEAD (konva, zustand, fflate, @supabase/supabase-js, pptxgenjs, pdf-lib, sharp…; **no zod, no dexie, no idb, no immer, no yjs, no zundo**).
- **[S13]** `/home/vdc/Projects/Peeloodle/docs/slides-implementation-plan.md` — repository file. P19/P25/P41/P42 acceptance checks; "simultaneous editing" listed as **deferred**.
- **[S14]** `/home/vdc/Projects/Peeloodle/CONTEXT.md` — repository file. Glossary: draft saving, presentation backup, personal sticker snapshot.
- **[S15]** `/home/vdc/Projects/Peeloodle/docs/editor-library-research.md` — repository file. Prior research; covers canvas engines / editor SDKs only, and explicitly makes no persistence-sync recommendation (so this file does not duplicate it).

**Rejected as sources:** none available — I could not consult any external source, and I will not cite
one I did not read.

---

## Part 1 — Architectural fit against the existing repository

### 1.1 What the repo already is (the baseline every candidate is judged against)

| # | Repo-verified fact | Evidence |
|---|---|---|
| B1 | Storage is behind **typed repository interfaces**, not raw IndexedDB: `StickerLabRepository` (projects/assets/packs/masks/sync) and a separate `PresentationRepository` for the second document kind. | [S1] interface `StickerLabRepository`; [S10] interface `PresentationRepository` |
| B2 | A save of a document **plus its binaries is one IDB transaction** and aborts as a unit; a failed save leaves the previous save intact. | [S1] `IdbRepository.saveProjectWithAssets` (opens `[PROJECTS, ASSETS, MASKS, SYNC]` readwrite); [S11] `IdbPresentationRepository.savePresentation` (documents + presentationMedia in one `runTransaction`) |
| B3 | Documents hold **references only** (`assetIds`, `layer.maskKey`); bytes live in separate stores; write-time referential integrity is enforced and missing references are a hard error. | [S1] `assertAssetsResolvable`, `PersistenceError('missing_asset'…)`, `missing_mask`; [S5] `parseProjectDocument` checks image-layer `assetId ∈ assetIds` |
| B4 | Media is **immutable per identity**: replacing an asset/mask with different bytes, or re-declaring a stored MIME type, is refused. | [S1] `parseStoredAsset`/`restoreBlob`; [S10] `bytesEqual` + "Refusing to replace media … with different bytes"; [S11] same rule re-checked inside the transaction |
| B5 | An **outbox** (`sync` store) holds `SyncEntry { key, kind, id, baseRevision, pending }`, deliberately bounded to at most two snapshots, with a stable head `operationId` that survives replays. | [S9] `SyncEntry`; [S1] `enqueue` at **repository.ts:359-370** (comment: "bounding the queue to two snapshots" at :366) |
| B6 | Sync is **foreground-only and non-polling**; failures keep local work and surface text instead of retrying forever. | [S7] `CloudRepository.sync()` + `drain()` at **cloud.ts:137**; error copy "Your local edits are kept" |
| B7 | Conflict handling is **optimistic concurrency on an explicit revision**, resolved by keeping a **conflict copy** rather than overwriting: the server RPC takes `expected_revision` and returns `{resource, original, conflict}`. | [S8] `SupabaseRemote.commit` RPC call at **cloudRemote.ts:104**; [S1] `acknowledge` writes `notice` = "Conflict copy saved: …" |
| B8 | Blobs are **content-addressed by SHA-256 via Web Crypto** with post-upload re-download verification, and downloads are hash-verified and re-validated for size/format before being cached. | [S8] `binaryHash` at **cloudRemote.ts:19-24**; upload verify at **cloudRemote.ts:101**; `download` re-checks hash, metadata vs bytes, and document/binary races |
| B9 | Guest→account import is **idempotent by construction**: target IDs are `import-${sha256(ownerId, kind, id)}` and existing sync entries are skipped; guest originals are retained until cloud writes confirm. | [S7] `CloudRepository.importGuest` / `copyGuest` |
| B10 | Storage is **one DB, one additive version chain** (`stickerlab-local`, `STICKERLAB_DB_VERSION = 5`), shared by both document kinds; sticker rows must never be rewritten by an upgrade. | [S2] header comment 1-9, **idb.ts:15**, `STORE_NAMES`; [S3] guardrail "IndexedDB stays additive" |
| B11 | Documents are **strict hand-rolled validators**, not a schema library; unknown `schemaVersion` and malformed shapes are hard failures with typed error codes (there is **no migration path**, only rejection). | [S5] `parseProjectDocument` + `requiredString/requiredRange/…`; `PersistenceErrorCode` union; [S12] no `zod` dependency |
| B12 | Undo is **document snapshots with explicit gesture boundaries and a 50-entry bound**, and history entries also **pin the asset/mask records they reference**. | [S6] `HISTORY_LIMIT = 50` at **store.ts:11**; `beginGesture`/`commitGesture` at **store.ts:242-269**; `withHistory` → `assetsFor`/`masksFor` |
| B13 | **View state never dirties the document**; save status is truthful; `markSaved(revision)` only clears `dirty` when the revision still matches. | [S6] `setViewport`/`selectLayer`/`setTool` never touch `dirty`; `markSaved`; [S4] invariant list |
| B14 | Real-time co-editing is **deferred by product decision**, not merely unimplemented. | [S13] "Deferred: … simultaneous editing, public sharing" |

**Reading of the baseline (Inference):** this is not a project that lacks a persistence layer. It is a
project that has already implemented the *hard* part of a local-first sync system — outbox,
idempotent operation identity, content-addressed binaries, optimistic concurrency, conflict copies,
idempotent account migration — on top of plain IndexedDB and Supabase. The realistic candidate
question is therefore not "which engine should replace this" but "is any engine worth *relocating*
these guarantees into".

### 1.2 Sync engines, judged on the six criteria the supervisor specified

Legend for each row: **Server?** = requires a server component or hosted service · **Offline?** =
usable with no network and no credentials · **vs explicit doc + baseRevision?** = does it conflict
with B5/B7 (serializable document + `savedRevision`/`baseRevision` + conflict copy) · **vs guest
migration?** = does it fight B9 · **vs JSON/blob split?** = does it blur B2/B3/B4 ·
**Replaces** = how much of `src/lib/persistence/**` it would displace.

Every row's library-internal property is **`Inference`** (no source fetched this run). Repo-side
columns cite [S#].

| Engine | Server? | Offline? | vs explicit doc + baseRevision? | vs guest migration | vs JSON/blob split | Replaces |
|---|---|---|---|---|---|---|
| **ElectricSQL** `Inference` | Yes — a Postgres-fronting sync service you must run/self-host alongside the Supabase DB | Yes on the read path; the write path is the open question (its architecture changed across major lines, so *whether writes are local-first* is decision-relevant and **must be re-verified, TODO-VERIFY**) | Fights it: sync becomes "Postgres shapes", so `expected_revision` + `original` conflict copy ([S8] `commit_sticker_resource`, **cloudRemote.ts:104**) has no counterpart and would be dropped or reimplemented | Fights it: "copy my guest rows into this account" is a wirable API in the current design ([S7] `copyGuest`) but an ownership/data-movement problem in a Postgres-replication model | Blurs it: binaries would want to live in whatever the engine replicates; the current immutable-AEAD-free asset/mask stores ([S1] `saveProjectWithAssets`) are outside its model | Entire `sync` outbox, `CloudRepository`, and the RPC layer; the typed interfaces ([S1], [S10]) survive only as a shim |
| **PowerSync** `Inference` | Yes — PowerSync service (self-host or hosted) **plus** a backend connector you write | Yes (client DB + upload queue is its core promise) | Partly compatible in spirit (upload queue + server-side conflict handling) but it would own `pending`/revision; the repo's two-snapshot bound and stable head `operationId` ([S1] **repository.ts:359-370**) have no equivalent, so replay-safety reasoning has to be redone | Neutral-to-fighting: still your connector's job, but the idempotency argument ([S7] `import-${hash}`) would need re-proving against the new queue | Blurs it: client-side SQL store becomes truth for binaries too; the doc/binary transaction boundary (B2) moves into their engine | Replaces `idb.ts` + `repository.ts` + `cloud.ts` + `cloudRemote.ts` in substance; violates [S4] "do not add a separate backend without a concrete requirement" |
| **RxDB replication** `Inference` | Not for storage; **yes for replication** (its Supabase replication plugin, or your own endpoint) | Yes — but "offline-first" here means *RxDB's own collection model* is the local truth | Fights it: RxDB wants a per-collection JSON schema and its own revision/conflict semantics; your document is validated by `parseProjectDocument` ([S5]) and revisioned server-side — two revision systems would coexist | Fights it: guest→account becomes "replicate collection A into B", and idempotency would rest on RxDB's replication state rather than an auditable `import-<hash>` id | Blurs it unless you keep attachments outside RxDB — attachments are its own concept, and immutability/atomic-with-document is your invariant (B4), not its | `idb.ts` + most of `repository.ts`; the sync half too. Effort of the port is larger than the code it removes |
| **TinyBase** `Inference` | No | Yes (in-browser store; IndexedDB/CRDT persistence modules optional) | Fights it: TinyBase is a reactive *table store*, i.e. a second state container next to Zustand ([S6]) and a second persistence model next to the repositories ([S1]) — exactly the "one store / one document schema" rule in [S4]/[S3] | No opinion (would have to be rewritten) | Neutral (TinyBase can hold any values) — but it does not model "bytes committed atomically with the doc" (B2), so it would not simplify the split | Nothing it should replace: it would *add* a parallel store |
| **Jazz** `Inference` | Yes — hosted sync (with self-host option) | Yes (local-first is its design centre) | Fights it: Jazz owns the data model (its own schema/CoValues) and the sync protocol; the serializable `ProjectDocument` + `assetIds`/`maskKey` ([S1], [S5]) would become Jazz objects, i.e. the document model is no longer yours (violates [S4]) | Fights it: guest→owner migration becomes Jazz account/ownership semantics | Blurs it: binaries become Jazz file/CoValue blobs managed by the engine | Replaces documents, validation, persistence **and** the Supabase backend that [S4] fixes as the stack |
| **InstantDB** `Inference` | Yes — hosted backend (self-host option) | Yes (local-first reads/writes with a sync loop) | Fights it: provides its own schema DSL, permissions and query language; optimistic concurrency is theirs, `expected_revision`/conflict-copy ([S8], [S1] `acknowledge`) is incompatible in shape | Fights it: identity/ownership is InstantDB's | Fails it: no notion of "immutable binary committed atomically with this document" | Replaces Supabase Auth/Postgres/Storage entirely — a stack change, not a library addition ([S4]) |
| **Triplit** `Inference` | Yes — Triplit server or hosted cloud | Yes (client-side DB + subscriptions) | Fights it: its own schema, queries and sync protocol; the outbox in [S1] and the RPC contract in [S8] are replaced by its protocol | Fights it | Blurs it | Replaces `repository.ts`+`idb.ts`+`cloud.ts`+`cloudRemote.ts` and adds a second backend |
| **Zero (Rocicorp)** `Inference` | Yes — a `zero-cache` server in front of Postgres; mutators are server-defined | Partial: designed for instant reads with a server in the loop; not a no-server offline store | Fights it: query-shaped sync + server mutators replace the client-side outbox and the CAS upload path ([S8] **cloudRemote.ts:101**); conflict policy becomes server policy, so the "conflict copy instead of overwrite" rule ([S4], [S1] `notice`) has to be rebuilt on their side | Fights it | Blurs it: binaries would be handled outside its model anyway, so you keep two systems | Replaces the sync half; the storage half (IDB, `saveProjectWithAssets`) stays — i.e. you run **both** |
| **Liveblocks** `Inference` | Yes — hosted service; API key + an auth endpoint on a server | No meaningful offline-first document store (rooms/presence/storage are session-oriented) | Fights it: presence/room semantics do not carry a revisioned serializable document with conflict copies | Fights it | Neutral/fails it: not a blob-commit store | Adds a dependency and a second source of truth; would not replace `src/lib/persistence/**` at all |
| **Yjs / Loro / Automerge** `Inference` | No for the core library; **yes in practice** — each needs a provider/adapter (websocket relay, `y-indexeddb`-style persistence, or `automerge-repo` storage/network adapters) | Yes on the read side; but CRDT updates are **not a validated document** | **Hard conflict**: a CRDT's merged output is a state, not a `ProjectDocument`. Every field would need a total mapping to the schema, and the strict validator ([S5]) would reject or silently drop anything unmapped. Revision numbers and the conflict-copy rule ([S7]/[S1]) have no CRDT analogue | Fights it: "merge this guest CRDT into the account's" is a merge-semantics question with no defined answer for `revision`/`updatedAt` | **Fails it outright**: CRDTs carry text/JSON structure, not the immutable-binary-atomic-with-document invariant (B2/B4) — you would keep IDB asset/mask stores anyway and gain a second persistence system | Replaces the document *shape* (worst case), and nothing in `src/lib/persistence/**` is simplified by it |
| **Supabase Realtime** `Inference` | Yes (already part of the fixed stack) — but it is a **notification channel**, not storage | No — it delivers changes to *online* subscribers; it does not store queued local work | Does not solve it: no durable pending operations, no stable operation identity, no conflict object. Realtime can only *trigger* `CloudRepository.sync()` ([S7] **cloud.ts:137**), which is a listener of a few lines — the sync logic stays identical | Neutral (n/a) | Neutral (it would carry a "something changed" signal, not bytes) | Replaces **nothing**. This is the one genuinely useful change in this row: an optional subscription that wakes the existing drain instead of requiring a manual Account → "Refresh cloud" |

**Net effect of Part 1 (repo-evidenced conclusion):** every offline-first engine above is built around
*its own* local model and *its own* sync protocol. Adopting one does not delete the sticker-specific
work; it deletes the *current* implementations of B5–B9 and requires re-proving them on someone
else's semantics — while B1/B2/B3/B4/B10 (the typed interfaces, atomic doc+binary commits,
referential integrity, immutable media, additive single-DB schema) are not things those engines
provide and would have to be kept anyway. Only two rows produce a *positive* architectural argument
rather than a cost: **Supabase Realtime as a wake-up signal** (not a storage change) and — with
caveats — the *shape* of PowerSync's upload queue, which is the closest match to the existing outbox
but still displaces it.

### 1.3 Non-sync, non-collaboration candidates

- **Dexie (+ dexie-react-hooks)** `Inference` for library internals: would replace B2/B10's plumbing
  (`openStickerLabDatabase`, `idbRequest`, `transactionDone`, `runTransaction` in [S2]) with a typed
  table API and declarative `version().stores()` upgrades, plus `<useLiveQuery>` for list rendering.
  **But** B10 is a written guardrail naming the exact constant that must stay authoritative
  ([S3]: "`STICKERLAB_DB_VERSION` lives in `src/lib/persistence/idb.ts`"); Dexie moves the upgrade
  chain into Dexie's own version table. It gives **nothing** for B3/B4/B7 (referential integrity,
  media immutability, conflict copies) — those are app logic in [S1]/[S10]/[S11].
- **idb** `Inference`: a thin promise wrapper. Would collapse ~40 lines of [S2] into imports and touch
  nothing else. Lowest-risk, lowest-value port in the whole list.
- **OPFS** `Inference`: interesting for *large* binary payloads, but the current design stores asset
  bytes and masks in the **same transaction** as the document (B2), and OPFS has no participation in
  an IDB transaction. Moving bytes to OPFS buys faster/larger blob I/O and pays with a loss of
  atomicity between document and binaries — a direct trade against [S1]
  `saveProjectWithAssets`/`cacheRemote` and [S11] `savePresentation`.
- **wa-sqlite / sqlite-wasm** `Inference`: would replace the whole of [S2] with SQL — real
  transactions, indices, migrations, and a query language for library listings. Local evidence of the
  *actual* need: listings today are `getAll()` + in-JS filter/sort ([S1] `listProjects`/`listPacks`,
  [S11] `listPresentations`), which is entirely adequate for a personal sticker/presentation library
  (tens to hundreds of rows). Cost: WASM payload, worker plumbing, OPFS-VFS/COOP-COEP considerations,
  and a full rewrite of every repository method **plus** the memory adapters that tests depend on
  ([S1] `MemoryRepository`, [S10] `MemoryPresentationRepository`).
- **zundo / immer patches / use-undo / redux-undo** — see Part 3.3; the binding constraint is B12's
  coupled media retention, not the undo mechanics.
- **Content hashing / CAS / blob managers**: already implemented ([S8] **cloudRemote.ts:19-24**, :101;
  CAS path `${ownerId}/${hash}` with `upsert:false` and 409 tolerance). No library needed; the only
  visible local inefficiency is that `binaryHash` is computed twice per uploaded binary (once to
  name it, once to verify the re-download at :101) and again on every download.
- **Schema-version migration tooling**: B11 is the real gap — the repo *rejects* unknown
  `schemaVersion` rather than migrating. No library supplies the missing piece (a stepwise
  `v(n) → v(n+1)` transform for two document kinds in one DB); it is ~1 small in-repo module keyed by
  `schemaVersion`. Evidence that this matters: [S13] P41/P42 require portable backups that must
  restore, and [S4] requires invalid/unsupported versions to be a *recoverable* error.
- **Backup/restore**: `fflate` is already a direct dependency ([S12]) and the ZIP/backup code exists
  per [S13]; nothing to add.

---

## Part 2 — Candidate shortlist (external facts left for a web-enabled pass)

**Every cell under Licence / Latest version + date / Maintenance / React 18 / Bundle cost is
`TODO-VERIFY`.** Do not fill these from memory — a wrong licence or a stale major version is exactly
the failure mode this table exists to prevent. `Effort` and `What it does in THIS repo` are
local-evidence judgments (see Part 1) and may be used without further verification.

| Library | Licence | Latest ver + date | Maintenance signal | React 18 | Bundle cost | What it replaces/adds in THIS repo | Effort | Risk / caveats |
|---|---|---|---|---|---|---|---|---|
| ElectricSQL | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces the `sync` outbox + RPC commit path ([S9], [S8] `commit_sticker_resource`) | L | **TODO-VERIFY its current major's write path** — whether client writes are local-first or go via Postgres is decision-critical and changed across majors; drops `expected_revision` conflict semantics |
| PowerSync | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces `idb.ts`+`repository.ts`+`cloud.ts`; closest documented analogue to the existing upload queue | L | Requires a service **and** a backend connector; [S4] forbids a new backend without a concrete requirement |
| RxDB (replication) | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces the local adapter and imposes its own collection schemas | L | Two revision systems; guest-import idempotency ([S7]) no longer auditable; **TODO-VERIFY which storage engines are free vs paid** |
| TinyBase | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Adds a second reactive store beside Zustand | M | Violates "one store, one document schema" ([S4], [S3]) |
| Jazz | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces documents + backend | L | Owns the data model and identity; replaces Supabase, which [S4] fixes |
| InstantDB | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces Supabase Auth/DB/Storage | L | Stack change, not a library addition |
| Triplit | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces local adapter + adds a backend | L | Same as above |
| Zero (Rocicorp) | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces the sync half only — so you run both systems | L | Requires a server process in front of Postgres |
| Liveblocks | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Nothing in `src/lib/persistence/**` | L | Hosted, server-side auth endpoint; not an offline document store |
| Yjs | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Would replace the document *shape* | L | Merged state ≠ validated document ([S5]); no blob-atomicity; co-editing is deferred ([S13]) |
| Automerge | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | As Yjs | L | As Yjs; needs `automerge-repo`-style adapters |
| Loro | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | As Yjs | L | As Yjs |
| Supabase Realtime | TODO-VERIFY (already in stack via `@supabase/supabase-js`, [S12]) | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Only a trigger to wake [S7] `sync()` | S | Not storage; no offline queue, no conflict model |
| Dexie (+ hooks) | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Replaces only the [S2] plumbing; nothing for B3/B4/B7 | M | Moves the upgrade chain out of `STICKERLAB_DB_VERSION` ([S3] guardrail) |
| idb | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | ~40 lines of [S2] | S | Minimal value |
| wa-sqlite / sqlite-wasm | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Whole of [S2] + every repository method + both memory adapters | L | No demonstrated scale need; worker/WASM/OPFS-VFS constraints |
| OPFS (platform, not a package) | n/a | TODO-VERIFY (browser support matrix) | n/a | n/a | n/a | Faster/larger blob I/O | M | Breaks the single-transaction doc+binary commit (B2) |
| zundo | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | ~60 lines of `past`/`future` in [S6] | S | Cannot express B12's coupled `assetsFor`/`masksFor` pruning without re-adding it |
| immer (patches) | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | n/a (framework-agnostic) | TODO-VERIFY | Replaces JSON round-trip clones in `cloneDocument` ([S6]) | M | Performance change, not a simplification; needs a profile first |
| use-undo / redux-undo | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | Would add a second state container | M | Wrong shape; violates "one store" ([S4]) |
| zod (versioned docs) | TODO-VERIFY | TODO-VERIFY | TODO-VERIFY | n/a | TODO-VERIFY | Re-authors [S5] validators | M | Rewrite of ~250 working, tested lines + a new dependency ([S12] has none); does **not** add migration, which is the actual gap |

---

## Part 3 — Review of `src/lib/persistence/**` + `src/features/editor/store.ts`

### 3.1 What the hand-rolled adapters already do well (and why that raises the bar for any replacement)

1. **Atomic multi-store commit of document + binaries.** [S1] `saveProjectWithAssets` opens
   `[PROJECTS, ASSETS, MASKS, SYNC]` in one readwrite transaction, writes binaries, then *re-reads*
   them inside the same transaction to prove every `assetId`/`maskKey` resolves, and finally puts the
   document. [S11] does the same for presentations. No general-purpose local DB layer gives you this
   invariant; it is product logic and would survive any adapter swap.
2. **Immutable media identity.** [S10] and [S11] refuse to overwrite stored bytes and refuse a
   MIME-type re-declaration; [S8] `download` re-hashes every fetched binary and cross-checks metadata
   against the decoded image before caching. This is stronger than "a blob store".
3. **A genuinely thought-through outbox.** [S1] `enqueue` (**repository.ts:359-370**) keeps the head
   snapshot immutable (its `operationId` is the idempotency key the RPC dedupes on), coalesces only
   the unsent tail, and thereby bounds queue growth to two snapshots per resource. Comment at :366
   states the intent. This is the kind of reasoning most sync engines make *their* job — adopting one
   means discarding this analysis and re-deriving it on their terms.
4. **Content-addressed binaries with verify-after-write.** [S8] `binaryHash` at
   **cloudRemote.ts:19-24** (Web Crypto SHA-256), path `${ownerId}/${hash}`, `upsert:false` with 409
   treated as success, then re-download and re-hash at **:101** before acknowledging. Combined with
   per-owner paths this is the CAS + integrity story already.
5. **Truthful, non-destructive failure semantics.** Lost acknowledgment is explicitly declared safe
   by operation identity ([S7] `drain`, comment at cloud.ts:154); conflicts produce a *copy*
   ([S1] `acknowledge` → `notice`), never an overwrite; a failed drain surfaces text and keeps local
   work ([S7] `sync()`); a not-yet-cached document fails with actionable copy instead of silently
   re-creating it (**cloud.ts:106-115**).
6. **Idempotent guest→account migration.** [S7] `copyGuest` derives target IDs from
   `sha256(ownerId, kind, id)`, skips anything already queued, and refuses to delete guest originals
   until cloud writes confirm — matching [S4]'s idempotency requirement without bookkeeping tables.
7. **Undo that respects view state and revision semantics.** [S6] `setViewport`/`selectLayer`/
   `setTool` never set `dirty`; `markSaved(revision)` only clears dirty on a revision match; undo/redo
   deliberately preserve the *current* revision rather than rolling it back.
8. **A swap-friendly seam.** `MemoryRepository` / `MemoryPresentationRepository` ([S1], [S10]) let the
   whole contract be tested without a browser DB — which is also what makes any storage rewrite
   expensive to validate, and worth calling out in an effort estimate.

### 3.2 Storage upgrades: what each would actually simplify / break

| Candidate | Simplifies | Breaks or costs |
|---|---|---|
| **idb** | ~40 lines in [S2] (`openStickerLabDatabase`, `idbRequest`, `transactionDone`, `runTransaction`) | Nothing structural. But it does not touch the guardrail constant, so the upgrade path stays yours. |
| **Dexie** | The same plumbing **plus** declarative upgrades, typed tables, and `useLiveQuery` for lists | Moves the version chain out of `STICKERLAB_DB_VERSION` ([S2]/**idb.ts:15**) which [S3] names as the authoritative additive-upgrade mechanism; `MemoryRepository` parity still hand-written ([S1]); blob/ArrayBuffer conversion still yours ([S2] `blobToArrayBuffer`, [S1] `toStoredAsset`). |
| **OPFS** | Large-blob writes, no structured-clone of big ArrayBuffers | Loses doc+binary atomicity (B2) — you gain a two-phase save that can leave orphaned or missing binaries, the exact failure [S1] `saveProjectWithAssets` exists to prevent. Also adds a second quota/eviction surface. |
| **wa-sqlite / sqlite-wasm** | Real queries/indices/migrations; listings stop being `getAll()` + JS sort ([S1], [S11]) | Rewrites every repository method, both memory adapters, and the additive-upgrade tests; adds WASM + worker/OPFS-VFS complexity for a library that holds tens-to-hundreds of rows. |

### 3.3 Undo/history against the stated invariants (one entry per gesture, 50 bound)

The binding constraints are **B12**, and they are stricter than "keep an array of past states":

- `withHistory` pushes a `cloneDocument(state.document)` (JSON round-trip **through the validator**,
  [S6] `cloneDocument` → `serializeProjectDocument`), so history entries are guaranteed-valid
  snapshots.
- `commitGesture` (**store.ts:248-269**) is the gesture boundary: it snapshots on `beginGesture`,
  compares with `sameContent` on `commitGesture`, and only then pushes history and bumps
  `revision` — this is what makes "one drag / one brush stroke / one slider gesture = one entry"
  true, and it is also what keeps a *no-op* gesture out of history.
- `withHistory`, `undo`, and `redo` all call `assetsFor(state.assets, [document, ...past, ...future])`
  and `masksFor(...)`, i.e. **a history entry pins the asset/mask records it references**. Removing a
  layer is undoable *because* the removed layer's media survives in `assets`/`masks`.

Consequences for each candidate (all library-internals `Inference`; the constraints are [S6]):

- **zundo**: temporal middleware snapshots store state and offers `limit`/`partialize`. To respect
  B13 (`view`/`selection`/viewport must not become part of history) it would need `partialize` down
  to `document` — at which point the coupled `assetsFor`/`masksFor` pruning has no hook, and removed
  media would be dropped with nothing to restore on undo. It also does not know about `revision`
  preservation in `undo`/`redo` or the `saveStatus` transition. Net: it can replace the two arrays,
  not the ~6 rules attached to them.
- **immer + inverse patches**: the one candidate with a real argument, but it is a *performance*
  argument, not a simplification. Today every history push does a full JSON stringify/parse/validate
  of the document ([S6] `cloneDocument`), 50 entries deep, plus `JSON.stringify` comparisons in
  `sameContent` and in `enqueue` ([S1] **repository.ts:367**). Patches would remove the clone cost and
  could still be grouped by `beginGesture`/`commitGesture`. Two cautions: (i) the JSON round trip is
  currently load-bearing as a *validator* on every push, so patches would need explicit validation at
  the save boundary to keep [S5]'s guarantees; (ii) structural sharing across history means the
  "release unused rendering resources" invariant ([S4]) changes from a reference-count-by-scan to a
  reachability question. **No recommendation without a profile** — and no benchmark may be asserted
  here, because none was measured.
- **use-undo / redux-undo**: generic UI-state history; would introduce a second state container and
  duplicate `dirty`/`saveStatus` ownership. Rejected on [S4] "one store".
- **Hand-rolled (status quo)**: ~60-80 lines that encode gesture grouping, revision preservation,
  dirty/saveStatus truthfulness and media retention. Nothing in the candidate list is *smaller* than
  the code it would replace once those rules are re-attached.

### 3.4 Blob/asset management

- Content hashing and CAS are **done** ([S8] **cloudRemote.ts:19-24**, :101). Nothing to adopt.
- The only concrete, local, library-free improvements visible: (i) memoize/single-flight `binaryHash`
  so an upload hashes once instead of twice (name + post-upload verification at :101) and repeated
  downloads of the same hash do not re-hash; (ii) the 15 MB / 25 MP limits from [S4] are already
  enforced via `validateUpload` at the cloud boundary ([S8] `download`) — keep validation *there*
  rather than adding a blob-management layer.
- OPFS for blobs: see 3.2 — rejected on atomicity (B2).

### 3.5 Conflict detection, merge helpers, schema migration, backup/restore

- **Conflict detection already exists and is well-specified** ([S9] `CommitResult { resource,
  original?, conflict }`; [S8] RPC `expected_revision`; [S1] `acknowledge` writes a conflict copy).
  A "merge helper" library has nothing to merge into: the product decision is *keep a copy*, not
  *auto-merge* ([S4] "preserve a conflict copy instead of silently overwriting newer work").
- **The one real gap is schema-version migration.** [S5] `parseProjectDocument` hard-fails on any
  `schemaVersion` ≠ current with `unsupported_schema`, and lists/detail loaders skip unreadable rows
  ([S1] `listProjects`, [S11] `listPresentations`). So an old document is not corruptible — it is
  *invisible*, and [S13] P41/P42 make portable backups a deliverable, which guarantees old-version
  documents will appear. The fix is small and in-repo: a `migrations` module keyed by
  `schemaVersion` that upgrades raw rows (sticker + presentation kinds, in the same DB per [S2])
  before validation, plus a backup-restore path that runs it ([S13] P42) and a recoverable error
  surface for versions it cannot upgrade ([S4]). No library covers this shape.
- Format validation libs (zod etc.) shorten validator *authoring* but add nothing to versioning or
  migration; [S12] shows zod is not currently a dependency, and [S5]'s validators are already written
  and tested.

---

## 4. Ranked recommendations (max 5; ranked only where local evidence supports it)

1. **Keep the hand-rolled repositories, outbox and RPC conflict model. Do not adopt a sync engine.**
   *Impact:* high (protects every invariant B1–B9, including idempotent replay and conflict copies).
   *Effort:* zero. *Confidence:* **high** — this is repo-evidenced: [S1] `enqueue`/`cacheRemote`/
   `acknowledge`, [S7] `drain`/`copyGuest`, [S8] `binaryHash`/`commit` already implement the
   guarantees the engines sell, and each engine would additionally own the document shape or require
   a server ([S4] forbids a new backend without a concrete requirement).
2. **Add an explicit, in-repo `schemaVersion` migration step for stored rows and backups.**
   *Impact:* medium-high (old documents are currently unreadable *and* un-restorable; [S13] P41/P42).
   *Effort:* **S**. *Confidence:* **high** on the gap ([S5] `unsupported_schema` hard-fail; [S2] two
   document kinds in one DB); medium on the exact design, which belongs to the implementer.
3. **If the IDB layer is being reworked anyway, take `idb` over `Dexie`; otherwise change nothing.**
   *Impact:* low (code clarity only). *Effort:* **S**. *Confidence:* **medium** — [S2] is small and
   correct, and Dexie relocates the upgrade chain that [S3] pins to `STICKERLAB_DB_VERSION`
   (**idb.ts:15**). Dexie's value (declarative upgrades, live queries) does not touch B3/B4/B7.
4. **Library-free blob work: single-flight/memoize `binaryHash`, keep validation at the boundary.**
   *Impact:* low-medium (removes duplicate hashing per upload and per repeated download;
   [S8] **cloudRemote.ts:101**). *Effort:* **S**. *Confidence:* **medium** (mechanism is visible in
   code; the magnitude of the win is unmeasured and I refuse to quote a number).
5. **Only consider `immer` patches for undo after a profile; do not adopt `zundo`-style middleware.**
   *Impact:* unknown (performance only). *Effort:* **M**. *Confidence:* **medium** that the JSON
   round-trip clone is the expensive part ([S6] `cloneDocument` per history push, 50 deep) —
   **low-medium** that patches are a net win once validation and media-retention rules are
   re-attached.

*Not ranked for lack of evidence:* ElectricSQL, PowerSync, RxDB, TinyBase, Jazz, InstantDB, Triplit,
Zero, Liveblocks, Yjs/Loro/Automerge, Dexie-vs-idb in the abstract, wa-sqlite, OPFS — **needs external
verification** of licence, current version, maintenance and (for ElectricSQL/PowerSync) the
freshness of their write-path architecture. Nothing above is ranked by invented confidence.

## 5. Anti-recommendations (examined and rejected, with the reason)

1. **ElectricSQL / PowerSync / Zero** — all require a sync **service** in the path. They would
   replace [S1] `enqueue`, [S7] `drain`, and [S8] `commit` (which uses `expected_revision` + returns
   `original` for the conflict copy, **cloudRemote.ts:104**), and [S4] forbids adding a backend
   component without a concrete requirement. ElectricSQL additionally carries an architecture-change
   risk that must be re-verified before anyone spends time on it (see Part 2 TODO-VERIFY).
2. **Jazz / InstantDB / Triplit** — these want to be the backend *and* the data model. That is a
   stack replacement (Supabase Auth/Postgres/Storage are fixed by [S4]) and it breaks "one document
   schema" ([S3], [S4]) because the document would become engine-owned objects.
3. **RxDB replication** — no stored-value win over [S2], and it introduces a second revision/conflict
   system beside the RPC one ([S9] `CommitResult`), plus an auditability regression for the
   guest-import idempotency that currently rests on `import-${sha256(...)}` IDs ([S7]).
4. **Yjs / Automerge / Loro** — a CRDT's merged result is not a `ProjectDocument`; [S5] validates
   strictly, so any unmapped field is a rejection risk, and CRDTs do not carry the immutable-binary
   atomic with document invariant (B2/B4). Also **deferred by product decision**, not just unbuilt:
   [S13] lists simultaneous editing as deferred.
5. **Liveblocks** — hosted, session/presence-oriented, server-side auth endpoint; replaces nothing in
   `src/lib/persistence/**` and adds a second source of truth.
6. **Supabase Realtime as a sync mechanism** — it is a notification channel: no durable pending
   operations, no operation identity, no conflict object. The *only* defensible use is a subscription
   that wakes [S7] `sync()` instead of relying on Account → "Refresh cloud"; that is a few lines, not
   an architectural change, and it must not be presented to users as live collaboration.
7. **TinyBase / use-undo / redux-undo** — second state container; violates [S3]/[S4] "one store, one
   document schema".
8. **OPFS for binaries (as designed today)** — trades away the doc+binary single-transaction
   atomicity that [S1] `saveProjectWithAssets` and [S11] `savePresentation` exist to provide.
9. **wa-sqlite / sqlite-wasm** — a full storage rewrite for query needs the app does not have
   (listings are `getAll()` + JS sort over personal-scale libraries).
10. **zod for versioned documents** — does not add migration (the real gap), adds a dependency that
    [S12] shows is currently absent, and rewrites working, tested validators ([S5]).
11. **A generic "merge helper" library** — the product rule is conflict *copy*, not merge ([S4]); the
    detection half is already implemented ([S9], [S8], [S1] `acknowledge`).

## 6. Where no good library exists (and the evidence that I looked)

1. **No drop-in replacement for `src/lib/persistence/**`.** A replacement would have to keep the
   validated serializable document ([S5]), the JSON/blob split with atomic doc+binary commits
   (B2, [S1] `saveProjectWithAssets`, [S11] `savePresentation`), immutable media (B4), the bounded
   replay-safe outbox ([S1] **repository.ts:359-370**), and an RPC-style `expected_revision` contract
   with conflict copies ([S8] **cloudRemote.ts:104**, [S1] `acknowledge`). Among the candidates
   examined, none is designed around an *external* revision-checking API plus separately-stored
   immutable binaries; the offline-first ones own their own storage and protocol, and the ones that
   could be layered (RxDB) impose their own collection/revision model.
2. **No library for "undo entries that also pin referenced media".** Generic temporal middleware
   models state history; the invariant here is that history entries keep `assets`/`masks` alive
   across `[document, ...past, ...future]` ([S6] `withHistory`/`undo`/`redo` → `assetsFor`/
   `masksFor`). No candidate expresses that without re-adding the same glue.
3. **No library for versioned-document migration of two document kinds in one additive IDB DB.**
   [S5] hard-fails on unknown `schemaVersion`; [S2] holds both kinds in one DB whose version chain is
   guarded by [S3]; [S13] P41/P42 demand restorable backups. The missing piece is a small in-repo
   migration module, not a dependency.

**Evidence quality — read this honestly.** I compared (i) every candidate named in the assignment
(sync: ElectricSQL, PowerSync, RxDB replication, TinyBase, Jazz, InstantDB, Triplit, Zero, Liveblocks,
Yjs/Loro/Automerge, Supabase Realtime; storage: Dexie(+hooks), idb, OPFS, wa-sqlite/sqlite-wasm;
history: zundo, immer patches, use-undo, redux-undo; plus content-hashing/CAS and zod-style versioned
documents), against (ii) the actual persistence implementation in this repo, which I read in full
([S1], [S2], [S5], [S6], [S7], [S8], [S9], [S10], [S11]), and (iii) the repo's own prior research
([S15]), which covers canvas/editor SDKs only and makes no persistence recommendation. **I did not
perform a registry-level or web sweep this run** — no such tool was available (§ "Sourcing
limitation"). So "no library exists" means precisely: none among the examined set, and no candidate
of this shape is represented in the set. A web-enabled pass should specifically probe for
(A) libraries that sync against a *Supabase* RPC/`expected_revision` pattern, (B) patch-based undo
helpers for Zustand that preserve non-history state, and (C) in-browser document-migration helpers —
those are the three places a genuinely better option could still be hiding.

## 7. Fifteen-line summary

1. This file was produced without web tools; every third-party licence/version/date is `TODO-VERIFY` and no external number appears.
2. The repo already implements the hard part of local-first sync: bounded replay-safe outbox, idempotent operation IDs, content-addressed binaries, optimistic concurrency, conflict copies.
3. Evidence: `enqueue` (repository.ts:359-370), `drain` (cloud.ts:137), `commit_sticker_resource` with `expected_revision` (cloudRemote.ts:104), SHA-256 CAS with upload verification (cloudRemote.ts:19-24, :101).
4. Guest→account migration is already idempotent by construction (`import-${sha256(ownerId,kind,id)}`) and retains guest originals.
5. Documents plus binaries commit in **one** IndexedDB transaction with write-time referential integrity — a general local-DB layer would not provide this.
6. Therefore ElectricSQL / PowerSync / Zero / RxDB / Jazz / InstantDB / Triplit / Liveblocks all trade away working guarantees for a relocated model; Jazz/InstantDB/Triplit would also replace the Supabase stack the brief fixes.
7. Yjs / Automerge / Loro are the wrong shape: merged CRDT state is not a strictly validated document, and CRDTs do not carry immutable binaries; co-editing is deferred by product decision.
8. Supabase Realtime is a notification channel, not storage; its only defensible use is waking the existing drain.
9. Dexie/idb would simplify only the ~40-line IndexedDB plumbing; Dexie additionally relocates the additive upgrade chain that HANDOFF.md pins to `STICKERLAB_DB_VERSION`.
10. OPFS for blobs would break doc+binary atomicity; wa-sqlite is a full rewrite for query needs the app does not have.
11. zundo-style middleware cannot express gesture-boundary undo plus history-pinned media retention; immer patches are a performance question needing a profile first.
12. Content hashing/CAS and conflict detection are already done; a generic merge library has nothing to merge (the product rule is conflict *copy*).
13. The one real, library-free gap is `schemaVersion` **migration**: unknown versions hard-fail today, while P41/P42 guarantee old documents in backups.
14. **Highest-confidence recommendation: keep the hand-rolled persistence and sync layer unchanged; add a small in-repo `schemaVersion` migration module; change storage adapters only if that plumbing is reworked for another reason.**
15. Part 2 is a work-list for a web-enabled pass; Parts 1 and 3 stand on their own.
