# DRAFT - Linux integration runner update, 2026-09-08

Status: root review READY; independent WSL `bash -n` passed. This records a manual-runner change only. It
is not an integration execution, source archive regeneration, install,
deployment, VM action, model launch, or acceptance result.

## Changes

`linux-verification.sh` now accepts an optional fourth argument,
`NODE_TOOLCHAIN_PREFIX`, after archive, evidence directory, and mode. It
requires an absolute extracted Linux Node prefix with executable `bin/node` and
`bin/npm`, bundled `include/node` headers, and npm's bundled node-gyp. The
runner prepends only that prefix's `bin` to its own child process PATH and sets
`npm_config_nodedir` to the same prefix. The invoking WSL login environment is
not changed.

Before `npm ci --offline`, it reads the archive's `dashboard/package.json` with
Python, records the requested and actual Node/npm pins, canonical binary paths,
Node binary SHA-256, node-gyp path/version, headers path, and nodedir in the
copied `versions.txt`. Any mismatch exits 70 before dependency installation.
The selected isolated prefix is therefore the documented Node 24.18.0/npm
11.16.0 toolchain, not WSL's system Node 24.19.0/npm 11.17.0. Prefix mode never
uses `/usr` for node-gyp or headers; default mode retains the historical bundled
system paths.

The all-mode test invocation now lists every current integrated seam exactly
once: execution lifetime/session chains/engine/managed cancellation/grants;
adapters and canonical integration; the C adapter and PTY schema/persistence
files; atomic and fleet receipt recovery; ledger/roster; activation/routes/
launch/surface; and the existing boot, store, failure reporter, queue bridge,
and real broker suites. `unaffected` keeps its explicit historical label and
excludes only `adapters.test.ts`; it does not claim full acceptance.

The runner additionally runs `python3 -m pytest tests/test_ledger.py` from the
extracted source with `--basetemp` below its retained `/tmp` run root. WSL
read-only inspection found `/home/danie/.local/bin/pytest`, version `9.1.1`.
If that prerequisite is later absent, the runner records a named failure and
performs no installation; the bounded remedy is to make an approved offline
pytest environment available to that same WSL shell.

## Evidence and checks

- `wsl.exe -- bash -n .../linux-verification.sh` passed.
- Static extraction of the selected test list found 28 unique current test
  paths; all exist under the extracted dashboard layout.
- The runner was not executed against the active dirty source, and no archive
  was regenerated.
- Existing archive extraction, `/tmp` execution, offline npm cache, preamble,
  node-pty rebuild, evidence copy, and same-shell EXIT trap remain unchanged.

## Intended reviewed invocation

```bash
runner=/mnt/c/Users/danie/kb/_private/codex-worktrees/kb-vm-overhaul-resume-20260907/orgs/kb-ops/output/2026-09-06-platform-phase0/linux-verification.sh
prefix=/mnt/c/Users/danie/kb/_private/isolated-linux-toolchain-20260908/prefix/node-v24.18.0-linux-x64
"$runner" /path/to/reviewed-source.tar /path/to/evidence all "$prefix"
```

The archive must be created from a reviewed immutable Git object before this
manual command is used. The runner does not turn an archive into evidence of
source acceptance by itself.
