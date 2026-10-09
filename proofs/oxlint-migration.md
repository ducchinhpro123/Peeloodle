# ESLint → Oxlint lint migration (2026-10-09)

Branch `chore/oxlint-migration`, worktree `.worktrees/oxlint-migration`, based on
`b35cf45` ("Complete SvelteKit 3 migration"). Oxlint 1.87.0. Node 24.21.0.

## What changed

| File                                       | Change                                                                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.oxlintrc.json`                           | New. Rule list from `npx @oxlint/migrate eslint.config.js`, then hand-adjusted (see below).                                                                                                            |
| `eslint.config.js`                         | Deleted.                                                                                                                                                                                               |
| `package.json`                             | `lint` is now `prettier --check . && oxlint`. Added `oxlint@^1.87.0`. Removed `@eslint/js`, `eslint`, `eslint-config-prettier`, `eslint-plugin-svelte`, `globals`, `typescript-eslint`.                |
| `.vscode/extensions.json`                  | `dbaeumer.vscode-eslint` → `oxc.oxc-vscode`.                                                                                                                                                           |
| `.prettierignore`                          | Added `/proofs/` and `/project.inlang/` (except `settings.json`). See "Pre-existing findings".                                                                                                          |
| `README.md`                                | Lint row now reads Prettier + Oxlint.                                                                                                                                                                  |
| `KonvaArtboard.svelte`, `PresentationEditorPage.svelte` | Removed 8 `eslint-disable` directives that no longer suppress anything.                                                                                                                   |

Config adjustments made by hand after the migrator ran:

- `no-unused-expressions` is off for `.svelte`: Svelte 5 records a dependency by
  reading it bare inside `$effect` (`retry;`), which the rule reads as a useless
  expression. The old `eslint-plugin-svelte` config made the same exception.
- `no-useless-assignment` (nursery) is on for `.svelte` and `no-undef` (nursery)
  is on for `.js`, to keep the coverage the old core rules gave those files.
- The migrator's `jsPlugins: ["eslint-plugin-svelte"]` entry was dropped. See
  "Known coverage gap".

## Rule parity

Effective ESLint config for a `.svelte` file: **98 active rules** — 62 core/other
and 36 `svelte/*`. Oxlint config: **59 top-level rules** plus 6 rule entries in
three `overrides` blocks.

`npx @oxlint/migrate` reports 95 rules written and 4 skipped: `no-dupe-args` and
`no-octal` (superseded by strict mode), plus `no-undef` and `no-useless-assignment`
(nursery at the time). The two nursery rules are enabled explicitly here.

## Known coverage gap: Svelte files

Oxlint lints only the `<script>` block of `.svelte` files. It has no Svelte
template parser (oxc-project/oxc#15761) and ships no `svelte` plugin, so the 36
`svelte/*` rules the old config enforced are no longer checked. Template-level
checks that are now gone include `svelte/no-dupe-else-if-blocks`,
`svelte/require-each-key`, `svelte/valid-each-key`, `svelte/no-useless-mustaches`,
`svelte/no-at-html-tags`, and `svelte/no-dom-manipulating`.

`oxlint` also suppresses scope rules such as `no-unused-vars` inside components,
because a binding may be read from a template Oxlint cannot see. `svelte-check`
(part of `npm run check`) still covers types, compile diagnostics and a11y.

Reproduce the gap (Oxlint 1.87.0, `probe/bad.svelte` holding a duplicate
`{:else if}` chain and an each block without a key):

```bash
npx oxlint --rules | grep svelte            # no output: no svelte rules exist
```

`@oxlint/migrate --js-plugins` offers `jsPlugins: ["eslint-plugin-svelte"]`
instead. It is not adopted here:

- Script-only rules do run through it: `svelte/no-svelte-internal` fires.
- Template rules do not: `svelte/no-dupe-else-if-blocks`, `svelte/require-each-key`
  and `svelte/no-useless-mustaches` produce nothing.
- Rules that need template context do not: `svelte/prefer-svelte-reactivity`
  produces nothing.
- `eslint-plugin-svelte` peer-depends on `eslint@^8.57 || ^9 || ^10`, so keeping
  it keeps ESLint in the dependency tree.

To restore the lost rules, keep ESLint for `**/*.svelte` only and let Oxlint own
the rest:

```bash
npm i -D eslint eslint-plugin-svelte eslint-plugin-oxlint
```

```jsonc
// package.json
"lint": "prettier --check . && oxlint && eslint ."
```

## Verification

| Command                                                        | Result                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run lint`                                                 | exit 0 — Prettier clean, 3 Oxlint warnings (listed below)                  |
| `npm run check`                                                | exit 0 — svelte-check 0 errors, 0 warnings                                 |
| `npm run build`                                                | exit 0 — `✓ built in 3.83s`                                                |
| `npx playwright test e2e/editor.spec.ts e2e/masks.spec.ts`      | exit 0 — 21 passed (45.2s)                                                 |

New warnings, all `unicorn(no-useless-spread)` (ESLint never had this rule):

- `src/lib/presentations/rendering/decodedArtwork.ts:104`
- `src/lib/components/KonvaArtboard.svelte:226`
- `src/routes/my-stickers/+page.svelte:31`

## Performance

Measured 2026-10-09 on this machine (16 cores, Node 24.21.0, load average 3.5
from another session). Before = ESLint 10.10.0 + `eslint-plugin-svelte` on a
worktree at `b35cf45`. After = Oxlint 1.87.0 on this branch. Both trees carry the
same `.prettierignore`, so Prettier does identical work in both columns. One
warmup run, then 5 timed runs; the table lists medians. Filesystem cache warm.
Output was silenced, so the numbers are lint work only.

| Measurement                                     | Before   | After    | Change          |
| ----------------------------------------------- | -------- | -------- | --------------- |
| Linter only, whole repo (`eslint .` / `oxlint`)  | 4,395 ms | 107 ms   | **41× faster**  |
| Linter only, best of 5                           | 4,150 ms | 93 ms    | 45× faster      |
| Single `.svelte` file (editor loop)              | 1,060 ms | 105 ms   | 10× faster      |
| `npm run lint` (Prettier + linter)               | 13,241 ms| 8,229 ms | −38% (−5.0 s)   |
| Prettier alone                                   | 8,627 ms | 8,011 ms | unchanged       |
| Peak RSS                                         | 679 MB   | 199 MB   | −71%            |
| Entries in `package-lock.json`                   | 557      | 476      | −81 packages    |
| Packages whose path matches `eslint`             | 32       | 0        | −32 packages    |
| Installed disk for the linter subtree            | ~17 MB   | 2.4 MB   | −86%            |

Prettier is now the bottleneck: 8.0 s of the 8.2 s `npm run lint`, with Oxlint at
1.3% of the total. Ordering the chain as `oxlint && prettier --check .` would
surface lint failures first.

Reproduce. The before column needs the ESLint dependencies, which only exist in
the main checkout's `node_modules` (installed from the pre-migration lockfile), so
the before worktree reuses them by symlink. Do not use the migration worktree's
`node_modules` — ESLint is no longer in it.

```bash
H=$PWD/.worktrees/oxlint-migration
git worktree add --detach /tmp/bench-base b35cf45
ln -s "$PWD/node_modules" /tmp/bench-base/node_modules
cp "$H/.prettierignore" /tmp/bench-base/.prettierignore   # identical file set

bench() { # bench <label> <dir> <runs> <cmd...>
  local label=$1 dir=$2 n=$3; shift 3; cd "$dir" || return
  "$@" >/dev/null 2>&1                                  # warmup
  local t=() s e
  for _ in $(seq 1 "$n"); do s=$(date +%s%N); "$@" >/dev/null 2>&1; e=$(date +%s%N)
    t+=($(( (e-s)/1000000 ))); done
  printf '%-28s %s ms\n' "$label" "$(printf '%s\n' "${t[@]}" | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}')"
}
bench "eslint ."      /tmp/bench-base 5 ./node_modules/.bin/eslint .
bench "oxlint"        "$H"            5 ./node_modules/.bin/oxlint
bench "npm run lint"  /tmp/bench-base 5 npm run lint
bench "npm run lint"  "$H"            5 npm run lint
```

## Pre-existing findings

Both were present at `b35cf45` and are not caused by this migration.

1. **`prettier --check .` was already failing.** On a fresh checkout of `b35cf45`
   it reports 5 tracked files: `proofs/out/sveltekit-3-migration/{cloud,e2e,e2e-final,offline-retry,retry}.json`.
   After an install it also reports the generated `project.inlang/.meta.json` and
   `project.inlang/README.md`. `eslint.config.js` ignored `proofs/**` with the
   comment "kept byte-identical to what it proved, so it is neither reformatted nor
   linted here", so `.prettierignore` now carries the same ignore, plus
   `/project.inlang/` for the generated files. Without those entries
   `prettier --check .` fails before `oxlint` ever runs.
2. **`npm install` fails with ERESOLVE on a clean checkout.** `better-auth@1.7.4`
   declares `peerOptional @sveltejs/kit@^2.0.0` while the project installs
   `3.0.0`. Reproduce with `npm install --dry-run` on `main`. Dependency changes
   here used `--legacy-peer-deps`, matching how the existing lockfile was built.
   `npm ci --dry-run --legacy-peer-deps` passes on the new lockfile.
