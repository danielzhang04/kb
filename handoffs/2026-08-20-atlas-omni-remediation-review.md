# Atlas omni-interface remediation review handoff — 2026-08-20

**Topic:** Adversarial correction of the local Atlas omni-interface foundation before Daniel's >400-line review gate.

### What WORKED (with evidence)

- **Acceptance gaps were converted into an executable tasklist** — the terminal plan tracked baseline verification, security remediation, UI/state work, Google proposal work, independent re-review, and the human delivery gate.
- **The combined Atlas backend is green** — confirmed by `235 passed, 1 warning` from `atlas/.venv/Scripts/python.exe -m pytest tests -q --ignore=tests/test_preflight.py` with a worktree-local `--basetemp`; the warning is the existing pydantic unresolved-forward-reference warning.
- **Changed UI/dashboard paths are green** — 18 focused Vitest tests, `tsc --noEmit`, and the Vite production build passed. The build retains the existing >500 kB chunk warning.
- **Fresh-context review passed after one remediation loop** — the first review found hidden confirmable fields, non-atomic Drive claims, OAuth-generation drift, and ACTING-state loss; the re-review returned PASS with no HIGH/MEDIUM blockers.
- **Local-file access now fails closed** — the raceable pathname adapter, model tools, and production wiring are unreachable; configured roots remain untouched and catalog state is `configuration-needed` until a strong Windows handle-relative backend exists.
- **Consequential proposals are reviewable or un-runnable** — exact previews up to 4,000 characters are confirmable; larger previews are server-rejected for Run but can be cancelled. Google Gmail/Calendar proposals bind to the prepare-time token generation; Calendar update/delete require ETag + `If-Match`; Drive share/delete remain unavailable.
- **ACTING is a durable effective state** — publisher-owned action depth retains latent voice state, so concurrent confirmed actions remain visibly ACTING until the final action settles.

### What Did NOT Work (and why)

- **The inherited build-complete claim was false** — independent review found ACTING absent, Now incomplete, settings missing, Google action paths incomplete, and local-file TOCTOU exposure. The prior audit must not be treated as current truth.
- **A safe Windows atomic edit primitive was not available** — pywin32 could pin directory/file handles, but verified-parent relative rename failed and atomic replacement could not remain bound to the reviewed target identity. Best-effort revalidation was rejected; all local-file access is deferred.
- **Drive v3 share/delete could not be made version-atomic** — Drive file JSON exposes `version`, not the invented body `etag`, and the reviewed endpoints do not provide the proven conditional contract required here. The operations were removed rather than weakened.
- **In-app-browser visual QA remains blocked** — the Browser plugin rejected its cached service module as outside the trusted code path. Its skill prohibits an unmanaged Playwright fallback, so no screenshot approval is claimed.
- **Full dashboard suite is not a green gate in this sandbox** — 209 files/2,953 tests passed, while 32 files/241 tests failed across unchanged Win32, auth, control-store, git-fixture, PTY, and UI timeout paths. Changed Atlas tests, typecheck, and build are green; do not attribute the broad failures to this diff without an environment-correct serial baseline.
- **Exact delegated-model identity was not observable** — requested model pins were supplied, but workers could not independently expose their runtime model ID. Their reports were supporting evidence only; the boss reran gates and fresh-context review.

### What Has NOT Been Tried Yet

- Daniel's required review of the >400-line remediation diff and decision to commit it on `codex/atlas-enhancements-20260820`.
- Trusted in-app-browser screenshot/interaction QA after the plugin trust-path configuration is repaired.
- Real Google OAuth in a disposable account, signed-in browser pairing, and desktop alias desk tests. No external activation has occurred.
- A native Windows root-confinement backend using handle-relative NT primitives and adversarial race tests.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `atlas/worker/localfiles.py` | DONE / DEFERRED | Production construction always fails closed; feature awaits a strong backend. |
| `atlas/worker/runtime.py` | DONE | Exact confirmability, Google generation binding, Calendar proposals, honest catalog projection. |
| `atlas/worker/connectors.py` | DONE | Opaque token-generation binding; Calendar PATCH/delete require ETag + `If-Match`; unsafe Drive mutations absent. |
| `atlas/worker/state.py` | DONE | Five-state publisher with action-depth arbitration. |
| `atlas/worker/stateserver.py` | DONE | Server rejects unconfirmable Run, allows Cancel, and brackets confirmed actions. |
| `atlas/worker/toolreg.py` | DONE | Local files and Drive mutations absent from model surfaces; Calendar prepare tools remain. |
| `atlas/ui/` | DONE | ACTING, compact Now projection, exact proposal controls, honest settings and adapter health. |
| `dashboard/src/**/Atlas*` and `dashboard/src/lib/useAtlasState*` | DONE | ACTING rendering and executable behavior tests. |
| `dashboard/src/lib/atlasStandaloneUi.test.ts` | DONE / UNTRACKED | New jsdom behavior contract; include it when committing. |
| Branch `codex/atlas-enhancements-20260820` | REVIEW-GATED | Commit `280a67a9` plus a cleanly reviewed unstaged remediation diff; do not self-commit under the Atlas >400-line gate. |

### Exact Next Step

Daniel reviews the unstaged diff in `C:/Users/danie/kb/_private/codex-worktrees/atlas-enhancements-20260820`. If approved, commit it there as `codex-boss <codex-boss@agents.local>`, rerun `git diff --check`, the 235-test Atlas suite, the 18 changed dashboard tests, typecheck/build, and `python scripts/canary.py --diff-guard origin/main...HEAD` after the commit. Do not push the feature branch, enable OAuth, pair a signed-in browser, or activate external integrations without a separate explicit decision.

### Load list

- `CLAUDE.md`
- `BOSS.md`
- `orgs/atlas/contract.md`
- `orgs/atlas/STATE.md`
- `handoffs/2026-08-20-atlas-omni-remediation-review.md`
- `docs/specs/2026-08-20-atlas-omni-interface-design.md`
- `docs/plans/2026-08-20-atlas-omni-interface-GOAL-STATE.md`
- `docs/plans/2026-08-20-atlas-omni-interface-plan.md`
- `docs/audits/2026-08-20-atlas-omni-interface-build-verification.md` (historical; superseded by this handoff where claims differ)
- Invoke `code-review` and `security-review` before commit; invoke `save-session` if paused again.
