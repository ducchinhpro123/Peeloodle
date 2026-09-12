# Provenance: libraries that could raise StickerLab's ceiling

- **Date:** 2026-09-12
- **Deliverable:** [`docs/library-upgrade-scan.md`](library-upgrade-scan.md)
- **Rounds:** 2 (round 1: four parallel dimension scans; round 2: independent evidence audit +
  verification review)
- **Artifacts:** [`docs/research/library-upgrade-scan/`](research/library-upgrade-scan/)
- **Plan:** [`research/library-upgrade-scan/plan.md`](research/library-upgrade-scan/plan.md)

## Sources

| | Count | Notes |
| --- | --- | --- |
| Sources consulted | 90 packages (registry packuments + weekly downloads) plus 8 first-party documentation/model pages plus ~35 repository files | Every registry value is stored verbatim in `research/library-upgrade-scan/registry-facts.tsv` |
| Sources accepted | 90 registry rows; 7 first-party pages quoted verbatim in `fetched-quotes.md`; 1 deployed-header capture; repository files | |
| Sources rejected or unusable | 5 | See below |

**Rejected / unusable sources, with the reason:**

1. `https://jazz.tools/docs/react` — HTTP 404 (moved or renamed); no replacement located, so the Jazz
   service-model row is inference.
2. `https://triplit.dev/docs` — no readable content extractable from the HTML; Triplit's row is
   inference.
3. `https://www.instantdb.com/docs` — fetched but yielded no usable text; InstantDB's row is inference
   and is flagged as such in the brief's Open Questions.
4. `https://huggingface.co/onnx-community/U2Netp` — HTTP 401; not used.
5. `mattmdjaga/segformer_b2_clothes` — registry licence resolves to `other` with no readable model
   card; treated as ambiguous and **not recommended** rather than guessed at.

Additionally, `exa` web search was rate-limited (HTTP 429) throughout this run, so the fact pass was
done by fetching registries, model APIs and documentation directly rather than via search. That is
the stronger method for this document's claims and is why almost every claim has a stored value.

## Verification

- **Method:** a separate `evidence-auditor` cross-checked every version, licence, release date,
  download count, peer range and quotation against the lead's stored retrieved data (not an
  independent re-fetch — the verifier had no network tool); a separate `reviewer` re-derived the
  repository-side claims against the working tree and checked for logical gaps and overstated
  confidence.
- **Result:** PASS WITH NOTES.
- **Findings fixed before delivery:**
  1. **FATAL (reviewer, confirmed by lead):** the original #2 recommendation — build a command palette
     because "search is not implemented" — was **factually wrong**. Search ships in
     `src/components/GlobalSearch.tsx` with `Ctrl/Cmd+K` and e2e coverage; the claim came from a stale
     line in `docs/ui-audit.md`. Section 3 was rewritten around the real state, the stale audit line is
     now flagged as a documentation defect, and the genuine (scale-triggered) library question is
     recorded instead.
  2. **FATAL (auditor, confirmed by lead):** `@playwright/test` was listed as MIT; it is **Apache-2.0**.
     Corrected.
  3. Miscitation corrected: the deployed header sentence claimed "nothing else in the cross-origin
     family" while the capture includes `access-control-allow-origin: *`. Now states only what is
     absent (COOP and COEP).
  4. Unbacked numbers removed or attributed: the ONNX totals are relabelled MiB and marked as derived
     by summing files (not model-card text); the 314 kB chunk is attributed to `proofs/baseline.md`
     rather than presented as a fresh measurement; "12 known-failing **overflow** checks" reverted to
     the source's wording ("12 of its desktop-side checks fail").
  5. The 19,400-line codebase figure is now cited to the command that produced it.
  6. Confidence relabelled in §7: the repository half is verified, the engine rows are uneven —
     PowerSync/Electric/Zero have first-party quotations, the rest are inference.
  7. A ranking-axis contradiction was removed (the document said the kinds "should not be ranked
     against each other" and then produced one mixed ranking); the ranked list now names the kind per
     row and states the single axis plus the tie-break rule.
- **Findings accepted and applied:** two non-library wins the scans had ranked but the draft dropped
  were restored to §11 (WOFF2 font delivery + selective preload; single-flight `binaryHash`).
- **Findings noted but not actioned:** the reviewer's suggestion of `@tanstack/react-query`,
  `@tanstack/react-table`, `dompurify` and `@vitest/coverage-v8` was investigated in a bounded second
  pass: react-query and coverage joined the trigger table (with the vitest 5.x peer trap recorded),
  `dompurify` was examined and **rejected with evidence** (§10 — the paste path already parses in an
  inert template, reduces to a text model, and escapes on the way back), and `react-data-grid` was
  rejected as React-19-only.
- **Not verified anywhere in this document:** bundle sizes (none measured), runtime performance,
  benchmark numbers, and the InstantDB/Jazz/Triplit service models.

## Method limits worth carrying forward

- **The candidate space was searched, not swept.** Four dimensions were scanned in depth and five
  more were added in the second pass, but there was no exhaustive npm/GitHub sweep. Every "no library
  exists for X" claim means "none among those examined". The two conclusions most worth attacking are
  §7 (do not adopt a sync engine) and §8 (cutout is licence-blocked).
- **Two of the four round-1 scanners had no network tool**, so their external cells were left as
  `TODO-VERIFY` and the lead performed the entire fact pass. That worked, but it means the external
  facts were verified by one agent using stored data, cross-checked afterwards — not by two
  independent parties.
- **The workflow's `verifier` agent does not exist in this harness**; `evidence-auditor` filled that
  role. `memory_remember` was likewise unavailable, so the plan artifact is the durable record.
- **Suggested falsification pass**, if this is revisited: libraries that sync against a Supabase
  RPC/`expected_revision` pattern; Zustand undo helpers that preserve non-history state; in-browser
  document-migration helpers; and a maintained in-browser LibreOffice build (which would change the
  PPTX-import conclusion).
