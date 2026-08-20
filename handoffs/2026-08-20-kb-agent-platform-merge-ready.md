# agent-platform merge-ready + VM-compat — handoff — 2026-08-20

**Topic:** Overnight run that took `claude/agent-platform-w1` (Wave-1/2/W3, 71 commits) from "awaits cutover"
to merge-ready on top of the live VM release: merged main, audited + hardened every feature for the hardened VM
contract, proved zero regressions, opened **PR #139**. Consumes `2026-08-19-kb-agent-platform-wave2-review.md`
(deleted in this push). Work root: standalone clone `C:/Users/danie/kb-clones/agent-platform-w2`, tip `33764546`,
remote == local. Review entry = `MORNING-REPORT-MERGE.md` at the clone root.

### What WORKED (with evidence)
- **Merge of origin/main 439fc90d** (`7aa2a2d6`) — 3 conflicts (`server/index.ts`, `App.test.tsx`,
  `codex_dispatch.py`) + 2 semantic reconciliations; focused tsc green, vitest 195, pytest 78. Chose MERGE over
  rebase so the 71 SHAs cited in reports/handoffs/memory stay valid.
- **VM-compat audit + fixes** (`d4da9aa1`) — 17-row compat matrix against the VM contract (immutable release,
  state/ops-only writes, outbox publication, tailnet auth, Linux capabilities, closed env set) and the desk⇄VM spec;
  3 adversarial sol rounds (5 HIGH / 2 MED / 2 LOW, all closed); sonnet re-verified 4/4 (model grep: claude-sonnet-5 ×62).
  Key changes: `durablePrWrites` from publication+openPr (Schedules edit 503 on VM), `localTranscripts` gates trace
  routes, one state-root resolver per language (`scripts/kb_paths.py`, `scripts/hooks/lib/kb_paths.js`), brain
  model+index under state root with content-hash fingerprint, truthful docs + behavioral guards
  (`tests/test_vm_compat_docs.py`).
- **Security fix on main's code**: `POST /api/write/pause-cadence` path traversal (`queue/paused/../../STOP` →
  `<ops>/STOP`), live on the VM today — fixed in `stop/floor.ts` (declared-id via HEARTBEAT parser + direct-child).
- **Zero regressions** (`23ab9842`) — CI gate exactly as `kb-platform-release.yml`: `pytest --ignore=atlas` 1433/0,
  typecheck, build — boss-run. vitest 89 fails classified against an `origin/main` probe: 13 files pre-existing on main
  (54 tests identical), 11 files serial-green flakes (287/287), 4 real merge regressions fixed (panel tests model
  `GET /api/auth/context`; PWA colors). Atlas 21 env failures identical on main, outside CI.
- **PR #139 open** — https://github.com/danielzhang04/kb/pull/139, body carries compat matrix + 6-item deploy handoff.

### What Did NOT Work (and why)
- **Codex worker running `git merge`** — codex sandbox mounts `.git` read-only (`ORIG_HEAD.lock` EPERM). Law: boss
  runs merge/add/commit; workers edit the working tree only; briefs must say so.
- **Codex 0.148.0** still breaks Windows spawn — re-pinned 0.147.0 from an older scratchpad
  (`…/2c6a60ac-…/scratchpad/codex-pin/node_modules/.bin`, PATH-prepend). Global fix still owed.
- **Three concurrent background test shells** were killed by the harness mid-run, leaving orphaned vitest/pytest trees
  (had to `taskkill /T`). Run long verification as ONE sequential background job writing to a file.
- **Sweep worker's "pre-existing" list** was partly wrong: 2 of its 15 files were load-flakes (serial-green on both
  trees) and 1 Atlas failure was its own sandbox. Always reproduce worker classifications on the probe yourself.
- **First compat fix for `durablePrWrites`** keyed off `KB_VM_RUNTIME` (validator only checks presence, not value) —
  refuted in review; capability must derive from the thing it needs (publication mode + openPr).

### What Has NOT Been Tried Yet
- Daniel merges #139 → deploys to the VM → other CLI applies the 6 deploy-handoff items (PR body).
- Browser check on the VM after deploy (Schedules edit hidden, Brain index-not-built, Run Envelope no-transcript).
- Post-merge: `python scripts/sync_skills.py`, U7/U9 hook-arming ceremony, gate 3 maintainer first supervised fire +
  cadence commit, sweep `kb-worktrees/agent-platform-w1` + the clone (ACL-locked `.tmp` dirs need elevated delete).
- Follow-up card: main's own vitest is red in 13 files (passkey-era client tests left behind by #138; CI never runs vitest).
- Global codex pin/fix; `deploy/validate_vm_runtime.py` exact-value check for `KB_VM_RUNTIME=1`.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| clone `kb-clones/agent-platform-w2` @ `33764546` | DONE | pushed; PR #139 open; untracked `.tmp/` only |
| `MORNING-REPORT-MERGE.md` (clone root) | DONE | review entry + Daniel's 4 gates |
| worktree `kb-clones/ap-main-probe` | DONE | origin/main probe used for classification — removed at session close |
| worktree `kb-worktrees/agent-platform-w1` | TODO | retired lease; sweep after merge (elevated delete for `.pytest-*`) |
| `:4630` display | STALE | serves pre-merge build; display-only; stop any time (no local dashboard revival planned) |

### Exact Next Step
Daniel: merge https://github.com/danielzhang04/kb/pull/139 (merge commit), deploy to the VM, hand the PR body's
"Deploy handoff" block to the cloud CLI. Next boss session: verify the VM screens, then the post-merge ceremony list.

### Load list
- `MORNING-REPORT-MERGE.md` at `C:/Users/danie/kb-clones/agent-platform-w2` (gates + evidence)
- PR #139 body (compat matrix, deploy handoff)
- `docs/proposals/brain-query-runtime.md` (VM provisioning recipe), `docs/proposals/maintainer-cadence-entry.md` (gate 3)
- `memory/claude-boss.md` 2026-08-20 entry; personal memory `agent-infra-arc.md`
