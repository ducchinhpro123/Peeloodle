# P06 — PDF raster pages and bounded backup (proof)

Date: 2026-09-10. Task: "Prove PDF raster-page export and bounded ZIP
backup/restore using the fixture."

## Artifacts

| File | Produced by |
| --- | --- |
| `proofs/out/p06-fixture-render.pdf` | `e2e/proofs/pdf-backup.spec.ts` → production `buildRasterPdf` |
| `proofs/out/p06-backup.zip` | production `createBackupArchive` |
| `proofs/out/p06-page-1.png`, `p06-page-2.png` | `pdftoppm -r 72` inspection of the PDF |
| `proofs/out/p06-report.json` | sizes/paths summary from the proof |

Code under test: `src/features/presentations/exports/pdf.ts` (pdf-lib 1.17.1)
and `src/features/presentations/exports/backup.ts` (fflate 0.8.3).

## PDF results

```
pdfinfo p06-fixture-render.pdf
Pages:      2
Page size:  960 x 540 pts
```

- Two pages in slide order; each slide rendered at 1920×1080 with Konva and
  embedded as a single PNG per page (no full-slide flattening of the *source*
  document; rasterization is inherent to this image-based PDF contract).
- Rendered pages inspected visually: background, rounded panel, ellipse,
  transparent sticker image (soft alpha edge), Vietnamese text, bullets,
  nested bullet, numbered item, hyperlink styling and divider are all present.
  No checkerboard, selection handles, guides or viewport transform appear.
- Defect found and fixed: wrapped bullet continuation lines drew a second
  marker. `LayoutLine.firstInParagraph` now marks the paragraph's first line and
  the renderer draws markers only there (unit-tested in
  `textLayout.test.ts`).
- Documented limitation: this PDF is image-based; text selection, searchable
  text and PDF hyperlinks are not promised (PPTX is the editable path).

## Backup results

```
unzip -l p06-backup.zip
document.json                6748
media/fixture-asset-transparent.png  262488
manifest.json                 897
```

- Manifest includes format/version, schema version, document id/title, every
  entry with byte length + SHA-256, and the two bundled font identities with
  their licenses.
- Independent verification (Node `crypto`, outside the app): **2/2 entries**
  match manifest byte length and SHA-256; `document.json` parses as
  `kind: "presentation"`, two slides, the expected Vietnamese title.
- Restore in the browser proof reproduced the document JSON and the exact media
  bytes (`p06-report.json`: `restoredSlideCount: 2`).

## Bounded parser checks (unit tests, 11 cases)

`src/features/presentations/exports/backup.test.ts` covers: fixture round trip;
archive containing only manifest/document/media; missing media refused at write
time; checksum mismatch; future backup version; path traversal; nested archive;
per-file media size limit; missing/malformed manifest; injected document-parser
failure; and the dedicated `BackupError` type. Limits are centralized in
`BACKUP_LIMITS` (250 MB archive, 300 MB expanded, 5000 entries, 15 MB media,
25 MP decode).

Remaining for P42: ID remapping on restore, duplicate-path archives crafted
outside fflate's writer, per-image pixel decode checks, and the restore UI.
