# DRAFT — Phase 0 Linux integration environment preflight, 2026-09-08

Author: `codex-worker`

Status: **READ-ONLY PREFLIGHT.** This is not a test run, pin waiver, install,
or deployment authorization. No package manager, broker, daemon, browser, or
model was started.

## Current tool evidence

Windows has the exact package pins on PATH:

| Host | Node | npm | Evidence |
| --- | --- | --- | --- |
| Windows | `v24.18.0` | `11.16.0` | `C:\Program Files\nodejs\node.exe` and `npm.cmd` |
| WSL default Ubuntu 24.04.3 LTS / WSL2 | `v24.19.0` | `11.17.0` | direct read-only `wsl.exe -- node/npm --version` |

The dashboard manifest requires exactly Node `24.18.0` and npm `11.16.0`.
The default WSL pair therefore has a real one-patch pin discrepancy. The prior
Linux `Y5mujQ` evidence records the same mismatch, then records a 399-test,
typecheck, and build pass. That result proves the offline cache and Linux path
were usable on its source archive; it does not satisfy the exact-pins gate.

Available WSL prerequisites are Ubuntu 24.04.3, `g++ 13.3.0`, GNU Make 4.3,
`/usr/include/node`, `/usr/lib/node_modules/npm`, and
`/var/cache/apt/archives`. The unprivileged WSL user is `danie`; known cache
locations exist at `/home/danie/.npm` and `/home/danie/.cache/node-gyp`.
Their contents were deliberately not inspected. The current runner's explicit
node-gyp path is
`/usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js` and it sets
`npm_config_nodedir=/usr`, so installed headers can build the locked
`node-pty` package without downloading headers. Existing evidence confirms an
offline `npm ci` installed 293 packages and the explicit `node-pty` rebuild
passed under the mismatched WSL runtime.

The WSL distribution enumeration initially failed in the normal sandbox with
`Wsl/EnumerateDistros/Service/E_ACCESSDENIED`; the authorized read-only
elevated inspection then established one stopped `Ubuntu` WSL2 distribution and
one stopped `docker-desktop` WSL2 distribution. No distro was changed.

## Existing archive and evidence

`_private/linux-correction-source-20260908.tar` is the latest known archive in
this worktree (158,607,360 bytes, 2026-09-08 00:29 local). Both the broad gate
and correction-cycle evidence identify it as SHA-256
`6d09d54ab5356a8425f9c5b1b0fb6291fcb153159ad709136dc12f32bc5aa073`.
It is historical evidence only: an integration run must use a freshly created
archive from the reviewed final Git object, never a dirty checkout or this
preflight's live worktree.

The existing manual runner
`orgs/kb-ops/output/2026-09-06-platform-phase0/linux-verification.sh` correctly
copies its archive to `/tmp`, extracts there, creates a fresh state/cache root,
uses `npm ci --offline`, rebuilds `node-pty`, retains `/tmp` work on exit, and
copies log, versions, archive hash, scope, and exit status to the supplied
evidence directory. `_private/linux-correction-cycle.sh` adds a valid
mutation-and-restore proof for the held worktree-add admission test: its
historical mutant has exactly two expected failures and its restored run has
two passes. Neither script starts a production service or executes from
`/mnt/c`.

## Exact pin resolution required before a new Linux gate

Do not run the new integration gate on WSL's current default runtime. Choose
one reviewed resolution, then prove it in the runner's existing `versions.txt`:

1. **Recommended:** make an approved offline, isolated Linux toolchain
   containing exact Node `v24.18.0` and npm `11.16.0` available outside the
   source worktree, prepend only that toolchain's `bin` to the manual runner's
   `PATH`, and verify `node --version`/`npm --version` before `npm ci`.
2. If an exact pinned WSL toolchain already exists, name its absolute
   non-secret binary directory in the manual invocation and perform the same
   preflight assertion. This preflight found no confirmed second toolchain.
3. A maintainer can deliberately update the repository pins to the installed
   WSL pair, after normal source review and a new archive. That changes the
   declared environment rather than waiving it and is outside this preflight.

An offline installation or a manifest pin update is not authorized by this
document. The current discrepancy is the only known environment blocker.

## Required Phase 0 test selection

The old runner's selected 399 tests omit the new generation and receipt ports.
After the pinned runtime is available, its `run_test` list must include these
serial native-loader selections in addition to its existing boot, adapter,
failure, and real-Linux-broker gates:

- A1: `server/control/execution.test.ts` and
  `server/control/spendGrantProvision.test.ts`.
- C schema and delivery: `server/control/attemptSessionAdapter.test.ts`,
  `server/control/attemptVertical.integration.test.ts`,
  `server/pty/contracts.test.ts`, `server/pty/sessionPersistence.test.ts`,
  `server/pty/sessionRecord.test.ts`, `server/pty/sessionMigration.test.ts`,
  and `server/http/surface.test.ts`.
- D1: the ledger receipt/recovery test supplied with D1 plus
  `server/control/queueBridge.test.ts`; retain canonical integration tests
  supplied by D if its forward-admission changes are present.
- B: `server/control/activation.test.ts`, `server/control/routes.test.ts`, and
  `server/control/launch.test.ts`.

Use the existing runner form for each path:

```bash
npm test -- --configLoader native --no-cache --maxWorkers=1 --no-file-parallelism <explicit-paths>
```

Run the expanded focused list before its existing `npm run typecheck` and
`npm run build -- --configLoader native`. A future runner patch should add only
these explicit paths and labels; it must retain the archive extraction,
offline/cache/header checks, native node-pty rebuild, and evidence trap. Do not
replace it with a glob or an entire suite, and do not edit it until the named
owners have accepted their source interfaces.

## Safe manual execution shape after review

The operator should create a final archive from a reviewed immutable commit in
a new temporary location, not from a working directory. The Linux runner then
receives that archive and an unused evidence location outside the source tree,
for example a new WSL-home directory. Its retained `/tmp` run root, plus the
copied `gate.log`, `versions.txt`, `source-archive.sha256`, `scope.txt`, and
`status.txt`, are the minimum evidence bundle. Preserve the archive alongside
that bundle so its SHA-256 can be checked later.

After a reviewed final commit and an approved exact-pinned toolchain exist, the
manual runner command shape is exactly:

```bash
set -Eeuo pipefail
source=/mnt/c/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907
commit=<reviewed-final-commit>
toolchain_bin=<approved-node-24.18.0-npm-11.16.0-bin>
bundle_root="$HOME/kb-phase0-linux-evidence/$commit"
archive="$bundle_root/source.tar"
evidence="$bundle_root/gate"
mkdir -p "$evidence"
git -C "$source" archive --format=tar "$commit" >"$archive"
sha256sum "$archive" | tee "$bundle_root/source.tar.sha256"
PATH="$toolchain_bin:$PATH"
test "$(node --version)" = v24.18.0
test "$(npm --version)" = 11.16.0
"$source/orgs/kb-ops/output/2026-09-06-platform-phase0/linux-verification.sh" \
  "$archive" "$evidence" all
tar -C "$bundle_root" -czf "$bundle_root/evidence.tar.gz" gate source.tar.sha256
```

`git archive` reads only the named reviewed object and writes the new archive
outside the source tree. The runner copies that archive to `/tmp` before
execution; its `gate` directory contains the runner outputs. The final `tar`
archives evidence after a successful or failed runner exit and does not modify
the reviewed worktree. The shell's current WSL `PATH` must not be used until
the exact toolchain assertion above passes.

Before `npm ci`, record the selected toolchain's `node --version` and
`npm --version` and require literal equality with `dashboard/package.json`.
Then run the manual runner once in `all` mode. If a separate correction proof
is still needed, run `_private/linux-correction-cycle.sh` only against the same
archive and a separate evidence directory after the broad run; it is not a
substitute for the broadened gate.

The browser bootstrap ACL failure described in old handoffs was intentionally
not probed: it is unrelated to these Linux source gates and no browser UI work
was requested.

## Isolated exact Linux toolchain prepared

The authorized environment-preparation pass created this bounded artifact root,
outside the source worktree:

```
C:\Users\danie\kb\_private\isolated-linux-toolchain-20260908
```

It downloaded only the official public Node.js artifacts from
`https://nodejs.org/dist/v24.18.0/`: `SHASUMS256.txt` and
`node-v24.18.0-linux-x64.tar.xz`. The archive was hashed before extraction.
Its computed SHA-256 is
`55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742`,
which equals both the task's independently supplied value and the exact archive
row in the downloaded official manifest. The archive is 31,511,588 bytes; the
downloaded manifest is 2,967 bytes with SHA-256
`3927bab574a00ca0560c9583fe19655ba19603a1c5851414e4325d34ac50e469`.

The verified archive was extracted once, without a global install, at:

```
/mnt/c/Users/danie/kb/_private/isolated-linux-toolchain-20260908/prefix/node-v24.18.0-linux-x64
```

A direct WSL invocation with that prefix first on `PATH` proved:

| Component | Exact evidence |
| --- | --- |
| Node | `v24.18.0`; binary SHA-256 `41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c` |
| npm | `11.16.0`; package manifest SHA-256 `60ff022e32b5d8291d3e09849fd0cee6bbbff4e4d8352ad258214b1adf070714` |
| node-gyp | bundled `12.3.0`; `lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js`; package manifest SHA-256 `d19b594bcbf958f80ec6863a44be2c5bd3ad84077c1de5f57b18168014fa97bd` |
| Node headers | bundled `include/node/node.h` exists; `include/node` is 58,969,198 bytes by WSL `du -sb` |

The local read-only inspection script is retained with the artifact at
`inspect-toolchain.sh` (1,265 bytes, SHA-256
`447e7820bafbb173bfbebee15161e1c128d07d527e2b4ff64873f1aa673925de`).
Its final assertions require literal `v24.18.0` and `11.16.0`.

One earlier inspection command was malformed by its cross-shell quoting. It
accidentally resolved WSL's default `v24.19.0`/`11.17.0`, then exited nonzero
while looking for an empty-prefix header path. It performed no installation or
source change. The retained script replaced that transport and the direct
isolated invocation above passed.

The final Linux runner can consume this without a global change by accepting
the extracted prefix as an explicit input, then setting only its child shell:

```bash
toolchain=/mnt/c/Users/danie/kb/_private/isolated-linux-toolchain-20260908/prefix/node-v24.18.0-linux-x64
PATH="$toolchain/bin:$PATH"
npm_config_nodedir="$toolchain"
export PATH npm_config_nodedir
test "$(node --version)" = v24.18.0
test "$(npm --version)" = 11.16.0
node "$toolchain/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" --version
```

The runner should record the prefix, exact versions, archive SHA-256, Node
binary SHA-256, header path, and node-gyp path in `versions.txt` before
`npm ci --offline`. Its existing explicit node-pty rebuild should invoke the
bundled node-gyp above with `npm_config_nodedir` set to this prefix. This pass
did not edit the runner or run the integration suite because the source
worktree is still under independent review.

Root independently recomputed the archive SHA-256 and invoked the retained
inspection script through WSL. Both checks passed, including literal Node and
npm pins, the bundled node-gyp version, header presence and Node binary hash.
This accepts the isolated toolchain preparation only. The broadened manual
runner and the final reviewed-source integration run remain separate gates.
