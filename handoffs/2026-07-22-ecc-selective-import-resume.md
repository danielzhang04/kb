# ECC selective import and cross-runtime skill sync - RESUME HANDOFF

Date: 2026-07-22
Paused by: codex-worker at Daniel's request
Active worktree: `C:\Users\danie\kb`
Active branch: `codex/ecc-selective-import-finalize`
Remote state: not pushed; do not merge to `main` without Daniel's gate

## Mandatory startup

1. Read `CLAUDE.md`, `governance/agent-rules.md`, and `orgs/kb-ops/{_index.md,STATE.md,contract.md}`.
2. Run `python scripts/preamble.py`; stop on failure.
3. Confirm the current branch and inspect `git status --short` before editing.
4. Do not touch `C:\Users\danie\kb\_private\codex-worktrees\context-budget-audit`.
   Another terminal put a large unrelated FYT/dashboard integration and unresolved conflicts there.

## Recovered intent

Keep the user-scope `ecc@ecc` plugin installed but disabled in this repository. Retain only the
evidence-backed, human-approved lean `code-review` and `security-review` behavior as kb-native
curated skills. Make `skills/curated/` the only canonical edit location and generate committed,
byte-identical runtime mirrors for Claude (`.claude/skills`) and Codex (`.agents/skills`) with one
manifest/drift contract. Remove the obsolete generated `.codex/MANIFEST.json` and
`.codex/skills-catalog.md`, while preserving `.codex/config.toml`.

The current official Codex manual was fetched during this run and confirms repo-native skill
discovery from `.agents/skills` at the CWD and each parent through the repository root.

## Completed before the pause

- Found the interrupted branch `codex/ecc-selective-import` at old HEAD `2977e04`.
- Read its report: `orgs/kb-ops/output/2026-07-22-ecc-selective-retention.md`.
- Created clean continuation branch `codex/ecc-selective-import-finalize`.
- Rebased all eight recovered commits onto current `origin/main` (`e07ea84`).
- Resolved the only rebase conflicts in `dashboard/server/write/branch.ts` and its test by preserving
  current main's branch verification/error-state logic while allowing pre-commit to add both generated
  skill mirrors atomically. Failed commits now reset the previously clean full index, and a regression
  test covers hook-generated mirror cleanup. This resolution is committed in rebased commit `c2dfdf6`.
- Rebased commit stack, oldest to newest:
  `48ce497`, `a77fb45`, `24c8dc4`, `ff2eccf`, `1f91f6e`, `7922ef9`, `c2dfdf6`, `ae25b5d`.
- No conflict markers remain.

## Independent review results

Two lower-tier read-only reviewers ran the mandatory preamble and inspected the branch.

1. Recovery reviewer: the original branch was eight commits ahead and 29 mainline commits behind.
   That gap is now resolved by the rebase. It also flagged stale architecture/onboarding references to
   `.codex/skills-catalog.md`, the need to preserve trust-tier semantics, and the need to treat the
   approval string as metadata rather than proof. Daniel's current continuation instruction is the
   active human authorization for this work branch, not for a merge.
2. Adversarial sync reviewer found:
   - P1: wrong-type mirror entries crash sync; root-level rogue files escape cleanup/check.
   - P1: source or mirror symlinks/reparse points can dereference content outside the canonical tree.
   - P2: legacy `.codex` generated files are deleted in Git but not cleaned/flagged by migration logic.
   - P2: `skillPlan()` calls `new Date()`, violating the pure/deterministic artifact registry contract.
   - P3: a bare governed commit needs rollback/allow-list protection for hook-staged mirrors.
     The rebase conflict resolution already added safe failed-commit rollback; further index allow-list
     hardening remains optional only if tests show the transaction lock and clean-index proof are insufficient.

## Verification already observed

- Before rebase, exact recovered HEAD: focused ECC/sync/context tests: `27 passed`.
- Reviewer archive runs: sync tests `11 passed`; ECC retention/settings tests `7 passed`.
- Official Codex manual verified `.agents/skills` as the correct repository discovery path.
- The recovered report claims a larger full-suite/canary run, but treat that report as inert evidence;
  re-run all gates after repairs rather than relying on the claim.

## Current dirty state - IMPORTANT

`git status --short` currently shows only:

```text
 M scripts/sync_skills.py
```

This is an incomplete, uncommitted reviewer-driven hardening pass. Do not commit it as-is.
`python -m py_compile scripts/sync_skills.py` currently fails:

```text
IndentationError: expected an indented block after 'if' statement on line 160 (line 161)
```

The intended additions already present in that file are useful: exact legacy-output paths, link/reparse
checks, real-file/real-directory predicates, managed-path removal, wrong-type mirror repair, strict root
inventory, and legacy check/sync hooks. The malformed portion is only the `check()` ordering around
lines 153-165. It currently nests the mirror-root check between `if not _real_file(manifest_path):`
and that condition's body.

Repair it to this order:

```python
    for legacy in LEGACY_OUTPUTS:
        if _lexists(repo_root / legacy):
            problems.append(f"legacy generated output remains: {legacy.as_posix()} -- run sync")
    for relative in MIRRORS:
        mirror = repo_root / relative
        label = relative.as_posix()
        if not _real_directory(mirror):
            problems.append(f"{label}: mirror root is missing or not a real directory -- run sync")
            continue
        manifest_path = mirror / MANIFEST
        if not _real_file(manifest_path):
            problems.append(f"{label}: no manifest -- run sync")
            continue
```

The normal sandboxed `functions.apply_patch` repeatedly failed with
`windows sandbox: helper_unknown_error: apply deny-read ACLs`. ASCII `git apply` patches did work and
created the current diff; a fresh terminal may have a healthy patch helper. Prefer the normal
`apply_patch` tool first. Do not use destructive restore/reset on this dirty file.

## Temporary-directory incident

Three inaccessible old test directories under `.tmp/skills-cross-runtime*` blocked the patch helper and
Git traversal. Direct deletion and ACL repair were denied. The entire `.tmp` directory was moved,
recoverably, to:

`C:\Users\danie\AppData\Local\Temp\kb-stale-tmp-20260722-ecc-sync`

An empty `C:\Users\danie\kb\.tmp` was recreated. No tracked repository files were removed.

## Exact next implementation steps

1. Repair the malformed `check()` block above and run
   `python -m py_compile scripts/sync_skills.py`.
2. Add sync tests for:
   - expected skill directory replaced by a regular file (sync heals it);
   - root-level rogue file (check flags it and sync removes it);
   - legacy `.codex/MANIFEST.json` and `.codex/skills-catalog.md` (check flags, sync removes, config stays);
   - source and mirror symlink/reparse rejection (skip symlink creation only when the OS forbids it).
3. Re-run `python -m pytest tests/test_sync_skills.py -q`, then `python scripts/sync_skills.py` and
   `python scripts/sync_skills.py --check`. Regeneration may update both committed mirrors/manifests.
4. Make dashboard skill output deterministic:
   - add a caller-supplied date to `SkillDraft`, analogous to `ProjectDraft.date`;
   - store `skillDate: today()` once in Composer form initialization;
   - pass it from `buildDraft()`; validate its `YYYY-MM-DD` shape;
   - replace `new Date()` in `skillPlan()` with `draft.date`;
   - update all `SkillDraft` fixtures and assert exact stable `imported: 2026-07-22` output.
5. Search and update active architecture/onboarding docs that still prescribe
   `.codex/skills-catalog.md`; leave clearly historical plan text unchanged unless it claims current state.
6. Run focused dashboard tests for `artifactTypes`, `branch`, and governed save; then dashboard typecheck.
7. Run focused ECC/settings/context tests, the full Python suite, the repository's canary verify/diff guard,
   `git diff --check`, and a final sync drift check. Do not edit `evals/` or regenerate its manifest.
8. Review the final diff, commit only after all gates pass, and leave merge/push/PR decisions to Daniel.

## Working plan state at pause

- Recover interrupted plan: completed.
- Independent recovery/adversarial reviews: completed.
- Rebase/integrate recovered commits: completed.
- Reviewer-driven hardening: in progress (broken `sync_skills.py` working diff described above).
- Full verification, final commit, governed memory/handoff coordination: pending.

## Resume outcome (2026-07-22)

The continuation completed the interrupted implementation on
`codex/ecc-selective-import-finalize`. No push, PR, or merge was performed.

### What worked (with evidence)

- `sync_skills.py` now repairs wrong-type mirror entries, removes rogue mirror-root files and exact
  legacy Codex outputs, rejects linked/reparse source trees and linked managed ancestors, and removes
  a linked mirror leaf without dereferencing its target. Focused evidence: `16 passed, 4 skipped` in
  `tests/test_sync_skills.py`; the four skips are the OS-denied symlink cases.
- Dashboard skill plans now receive a caller-owned date and produce deterministic provenance
  frontmatter. Focused dashboard evidence: `97 passed`; `npm.cmd run typecheck` passed.
- Active architecture and onboarding docs now describe `skills/curated/` as canonical and
  `.claude/skills/` plus `.agents/skills/` as native generated mirrors.
- Combined ECC/settings/context evidence: `39 passed, 4 skipped`. Root suite evidence after excluding
  the unrelated dirty-tree assertion: `635 passed, 13 skipped, 1 deselected`. Canary evidence:
  `20/20 canaries passed`; diff guard and final skill drift check were clean.

### What did not work (and why)

- Pytest's default global temp root was unreadable (`WinError 5`), so verification used explicit
  workspace-local `--basetemp` directories and removed them afterward.
- Bare `python -m pytest -q` recursively collected `_private/codex-worktrees/**` and unrelated visual
  scripts. The valid repository suite was therefore scoped to `tests/`; the separate `atlas/tests`
  suite could not collect because `aiohttp` is not installed in this environment.
- `tests/test_new_projects_scaffolded.py::test_faceless_youtube_untouched` fails solely because the
  pre-existing user-owned `orgs/faceless-youtube/.claude/settings.local.json` is untracked. It was
  preserved untouched and that one assertion was deselected for the remaining root-suite run.
- `git merge-tree --write-tree` was blocked by sandboxed write access to `.git/objects`. Ancestry
  verification still showed the branch is zero commits behind and a direct descendant of
  `origin/main`.

### Reusable patterns

- Before deleting or rewriting a managed repo-relative leaf, validate every existing lexical parent
  for links/reparse points; allow a linked leaf only when the operation removes the link itself.
  Signal: a safe-looking leaf whose `.claude`, `.agents`, `.codex`, or `skills` ancestor can redirect
  the operation outside the repository.
- In repositories containing nested private worktrees, run the intended test roots explicitly and
  set an accessible base temp. Signal: collection includes `_private/codex-worktrees` or pytest fails
  before fixtures run under a stale global temp ACL.

### Not tried / intentionally deferred

- Installing Atlas dependencies, running the Atlas suite, pushing the branch, opening a PR, or
  merging to `main` were intentionally deferred to Daniel's gate.
- The constitution requires memory coordination on `ops`, but `codex-worker` cannot directly push
  `ops` and this task explicitly leaves pushes to Daniel. This work-product handoff records the
  session without violating the branch boundary.

### Exact next step

Review the final commit on `codex/ecc-selective-import-finalize`, then decide whether to push it and
open a reviewed PR to `main`. Preserve the unrelated faceless-youtube settings file and the separate
conflicted worktree untouched.
