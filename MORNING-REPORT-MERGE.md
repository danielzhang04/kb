# MORNING REPORT — agent-platform merge-ready + VM-compat (overnight 2026-08-20)

**One line:** `claude/agent-platform-w1` now contains main (the release live on the VM), every Wave-1/2/W3
feature either runs on the hardened VM or degrades explicitly, zero regressions vs main, and the PR is open:
**https://github.com/danielzhang04/kb/pull/139** (74 commits, tip `23ab9842`, remote == local).

## Your gates (in order)
1. **Merge PR #139 on GitHub** (merge commit, not squash). Your merge review doubles as the eval-diff blessing
   under rule-8 V-human (gate 5 of the Wave-2 list). CI = `pytest --ignore=atlas` + typecheck + build — all three
   boss-run green on this exact tree before the push.
2. **Deploy** the resulting release to the VM via your normal path. Then hand the **Deploy handoff** block in the PR
   body to the other CLI (6 items: exact-value `KB_VM_RUNTIME` check, ops seed of `agents/**` + agent-builder skill,
   pinned python deps, Brain provisioning recipe, optional `evals/**`, no new env keys). Nothing in this branch touches
   `deploy/**`.
3. **First look on the VM** after deploy: Schedules (sidebar) should read/pause/show history with the Edit control
   hidden; Brain Search should say *index not built* until provisioned; Run Envelope should say *no transcript on
   this machine*; Grades History, Agent Platform panels, roster with version badges should just work.
4. Post-merge ceremony (next session): `python scripts/sync_skills.py` · U7/U9 hook-arming ceremony (desktop) ·
   gate 3 maintainer first supervised fire + cadence commit · sweep `kb-worktrees/agent-platform-w1` + this clone.

## What happened overnight (evidence)
| Step | Result | Evidence |
|---|---|---|
| Merge main → branch | `7aa2a2d6`; 3 conflicts resolved (`server/index.ts`, `App.test.tsx`, `codex_dispatch.py`) + 2 semantic reconciliations | focused tsc green, vitest 195, pytest 78 |
| VM-compat audit + fixes | `d4da9aa1`; 17-row compat matrix; 3 adversarial review rounds: 5 HIGH, 2 MED, 2 LOW — all closed | round-2 verdict table; sonnet re-verification 4/4 (model grep-verified) |
| Security fix found on main | `POST /api/write/pause-cadence` path traversal (`../../STOP` → `<ops>/STOP`) — live on the VM today | fixed in `stop/floor.ts` (declared-id + direct-child), tests for traversal/encoded/unicode/NUL |
| Full sweep | `23ab9842`; CI gate 1433/0 + typecheck + build; vitest 89 fails → 13 files pre-existing on main (reproduced in an `origin/main` probe), 11 files serial-green flakes, 4 real merge regressions fixed | `scratchpad/classify.txt` in the boss session; PR body §Verification |
| Atlas pytest | 21 env failures, identical on main, outside CI (`--ignore=atlas`) | probe run |

## Things you should know
- **Main's own vitest is red in 13 files** (54 tests): passkey-era client assertions that #138's auth-mode-discovery
  client broke. CI never runs vitest (only the "dev platform" does), so main merged green. Not fixed here — it is
  main's debt and out of this PR's scope; worth a follow-up card.
- The dashboard is **not** revived locally; `:4630` still serves the pre-merge build (harmless, display-only). Stop it
  whenever: it is `node server/index.ts` under `%LOCALAPPDATA%\kb-agent-platform-w1-display\`.
- codex 0.148.0 still breaks Windows spawn; this session ran on the 0.147.0 pin at
  `…/2c6a60ac-…/scratchpad/codex-pin/node_modules/.bin` (PATH-prepend). A global fix is still owed.
- Codex sandbox cannot write `.git` — boss starts merges/stages/commits; workers edit the working tree only (law now).

## Worker roster (all codex via dispatch-codex; Claude only verified)
merge sol·xhigh 978s · compat audit sol·xhigh 2691s · review-1 sol·xhigh 1961s · rework-1 sol·xhigh 2694s ·
review-2 sol·xhigh 922s · rework-2 sol 984s · sweep terra 2826s · survey terra 444s · verifier claude-sonnet-5 (62 turns grep-verified).
$0 API spend (subscription only). Cards + cost rows on ops.
