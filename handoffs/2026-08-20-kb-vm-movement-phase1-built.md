# desk⇄VM movement — spec SHIPPED + Phase 1 BUILT overnight — 2026-08-20

**Topic:** Full design pass (all 8 handoff items, Atlas decoupled) → adversarially
reviewed spec + Phase-1 plan → Phase 1 (state foundation, 7 tasks) built by codex
workers with per-task adversarial review, on branch `codex/vm-movement-p1` (pushed).
VM NEVER TOUCHED. Consumes `2026-08-20-desk-vm-movement-design.md`.

### What WORKED (with evidence)
- **Design decisions locked with Daniel** — `docs/plans/2026-08-19-desk-vm-movement-decisions.md`
  (boss branch `codex/boss-2026-08-19`, pushed): resume-safe over interim, one-click
  desktop-signed deploys (key never leaves desk), immediate apply + resume-on-new-code,
  hybrid inbox (no VM merge token; VM pushes PRs, Daniel merges+deploys), floor leans,
  Atlas = /api/v1 seam only (Daniel builds Atlas separately).
- **Spec SHIP** — `docs/specs/2026-08-20-desk-vm-movement-design.md` after 4 adversarial
  rounds (~90 findings fixed; citation sweeps 42/63/47 anchors). Same branch.
- **Phase-1 plan EXECUTE** — `docs/plans/2026-08-20-vm-movement-phase1-plan.md` after
  3 review rounds (4 BLOCKERs + 16 more fixed), + 2 in-force boss amendments in its
  header banner (sanctioned parser-only activator edit; two-artifact merge-precondition).
- **Phase 1 complete: 7/7 tasks committed** on `codex/vm-movement-p1` (off origin/main
  439fc90d, pushed): bf90836b schema manifest → fd1fbd1e lifecycle rename+migrations →
  7dfa5bc6 deployment CAS+journal → bc6a92d4 writer lease → fdf8b261 coalesced
  persistence+benchmark → 26aa4e13 python seed/backup → c9b0fd64 attestation v2.
  Every task: codex build → boss-verified tests → model-verified adversarial review
  (opus for store/lease/attestation, sonnet for mechanical) → fix loop → commit.
  ~20 review-caught defects fixed incl. 5 BLOCKERs tests couldn't see (wire-contract
  lifecycle leak on 5 routes; host-%LOCALAPPDATA% store migration from 4 test files;
  resident-VM ModuleNotFoundError killing deploy+rollback; stale-registry pin bricking
  schema-advancing releases; unexecuted POSIX adapter).
- **Closing sweep all green** — pytest 957 passed; generator --check; typecheck;
  vite build; ENTIRE server vitest serial: 163 files / 2500 tests / 0 failures.
  Writer lease also proven on Linux via WSL (14/14, 15/15 twice); python suite on
  Linux 95/95 (symlink-gated restore-drill tests executed).

### What Did NOT Work (and why)
- **Full-suite runs inside codex workers** — dispatch shells got KILLED twice
  mid-`npm test` (Task 3, Task 6 workers died; orphaned children kept working once).
  Rule adopted: workers run focused gates only; boss runs broad suites.
- **Codex sandbox vs native/host paths** — authorizedFailedRunReconciliation.test.ts
  fails 20/23 IN SANDBOX (native NtCreateFile interception) but 23/23 outside; pytest
  tmp under host %TEMP% denied (use --basetemp in worktree). Never trust
  worker-reported failures of native-I/O tests without an outside-sandbox rerun.
- **Full parallel vitest on this box under load** — UI (src/) waitFor-timeout flake
  (13-21 files); server suite is clean serially. Not a code problem; don't chase.
- **Plan's grep-based completion checks** — structurally cannot catch pass-through
  serialization drift (the 5-route lifecycle leak). Type-first enumeration by the
  reviewer is what caught it.
- **ACL-locked sandbox temp dirs** in the build worktree resist deletion
  (`.pytest-*`/`.tmp/` with Permission denied) — untracked+harmless; admin shell or
  reboot clears them.

### What Has NOT Been Tried Yet
- Phase 2+ of the spec's §8 build order (engine fence/park, boot rehydrator,
  swap/rollback protocol, one-click v1 script, inbox+/api/v1, floor). Each needs its
  own plan (write just-in-time against the then-current tree, same review loop).
- VM-side validation of Phase 1 (all deliberately deferred — see gates below).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `codex/vm-movement-p1` branch (pushed) | DONE | 7 commits, tree clean, all local gates green; NOT merged; NOT deployable to VM (Global Constraint — first deployable release is Phase 3) |
| `docs/specs/2026-08-20-desk-vm-movement-design.md` | DONE | SHIP after 4 rounds; + sidecar snapshot-contract build note |
| `docs/plans/2026-08-20-vm-movement-phase1-plan.md` | DONE | EXECUTE + 2 boss amendments in header banner |
| `docs/plans/2026-08-19-desk-vm-movement-decisions.md` | DONE | Daniel's binding decisions incl. review rulings |
| (all docs on `codex/boss-2026-08-19`, pushed) | | |

### MORNING HUMAN GATES (Daniel — in order)
1. **Review + merge PR** for `codex/vm-movement-p1` (7 commits; local gates all green;
   CI runs typecheck+build+pytest only — vitest is a local gate, already run green).
   MERGE-PRECONDITION for the attestation-v2 commit: none for merge-to-main itself
   (Phase 1 is non-deployable), BUT before ANY future release is shipped to the VM:
2. **Two-artifact resident install** (root SSH, out-of-band): updated
   `activate_release.py` + `control_plane_schema.py` into `/usr/local/lib/kb`, then
   run the VM v2 probe (plan §Task-7; ModuleNotFoundError = install the pair, never
   revert the import).
3. **VM-side checks** (5 min, read-only): root filesystem is ext4/xfs
   (`stat -f /var/lib/kb` — exotic fs degrades lease diagnostics only), and run the
   durability benchmark on the VM (`KB_VM_DURABILITY_BENCHMARK=1`, vitest
   server/control/store.durability.vm.test.ts) before Phase 3 relies on its numbers.
4. Boss docs branch `codex/boss-2026-08-19` also awaits merge (decisions/spec/plan).

### Exact Next Step
Daniel reviews/merges the two PRs (gate 1). Next boss session then writes the
Phase-2 plan (engine fence + rehydrator per spec §8) against the merged tree with
the same worker/review loop. Do NOT start Phase 2 before Phase-1 merges — its plan
must anchor to real line numbers.

### Load list
- `docs/plans/2026-08-19-desk-vm-movement-decisions.md` (binding decisions)
- `docs/specs/2026-08-20-desk-vm-movement-design.md` (the contract; §8 = build order)
- `docs/plans/2026-08-20-vm-movement-phase1-plan.md` (header banner = in-force amendments)
- `git log origin/main..codex/vm-movement-p1` (the 7 task commits)
- `memory/codex-boss.md` (overnight lessons)
