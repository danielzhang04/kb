---
schema-version: 1
id: 6a99fdc0-584dabce
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 4ccdb24deedd1afc
state: done
approval: null
workflow: 01a06986-f345-7113-b0dd-eec0523a33ee
depends-on: []
variant-group: null
role: work
session-id: 6a99fda5-f05b32b0
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief v2: REWRITE the P7-UI plan against the REAL integrated code (cwd = the P6 worktree)

Codex worker: cwd = `C:/Users/danie/kb-worktrees/prospecting-p6` (branch `claude/prospecting-p6` = integrated
P1–P6 tree — `scripts/prospecting/**` is REAL here). Run `python scripts/preamble.py` once. Output: overwrite
`docs/superpowers/plans/2026-09-04-prospecting-p7ui.md` (rewrite) and, only where the review demands,
`docs/superpowers/specs/2026-09-04-prospecting-p7ui-amendment.md`. No other writes, no commit. Stop at 70 min.
FIRST read `docs/superpowers/plans/2026-09-04-prospecting-p7ui-REVIEW.md` (the adversarial review: verdict
REWRITE — Tasks 0, 2, 5–8 must be rebuilt from the actual `schema.sql` columns and the actual argparse blocks of
`scripts/prospecting/run_workflow.py`, `scripts/prospecting/manager/desktop_stage.py`,
`scripts/prospecting/approval/cli.py`, `scripts/prospecting/list_builder.py`, `scripts/prospecting/personalizer/cli.py`,
`scripts/prospecting/campaigner/cli.py`; every review item under ### 2, ### 3, ### 4 must be resolved in the
rewrite: workflow-slug allowlist before desktop_stage, exact-match POST paths, malformed Host/Content-Length/
payload/OSError/handler-exception tests, NO hard-coded approval URL (resolve the dashboard approval channel from
config and validate it in Task 0), redaction tests for child stdout/stderr/exceptions/typed results, in-root
symlink-to-external-file test, a numeric gate whose criteria are all record_property-backed).
Keep the plan format, the binding decisions, and Daniel's human gate from the original brief below.
Use REAL column names (read `scripts/prospecting/schema.sql` + `schema_p2/p4/p5/p6.sql`) in every projection.

--- original brief follows (READ BUDGET now points at the real files in this worktree) ---
\# Brief: write the P7-UI spec amendment + plan (local desktop web UI for prospecting)

Codex worker in kb (cwd = repo root, branch `claude/boss-2026-09-02`). Run `python scripts/preamble.py`
once (expect PREAMBLE OK). Output TWO files, nothing else, no commit:
1. `docs/superpowers/specs/2026-09-04-prospecting-p7ui-amendment.md` (≤ 250 lines)
2. `docs/superpowers/plans/2026-09-04-prospecting-p7ui.md` (same binding plan format as P1–P6)
Stop at 70 minutes; complete and self-consistent when you stop. First write of the spec file by command 12.

\## What Daniel asked for (verbatim intent)
"A small dashboard that's just a localhost or something that acts as the main interface for viewing this.
Not on kb vm, on local desktop. Same UI/UX style as our kb vm dashboard (output, input, analysis) and where
I can potentially just run stuff directly but running routes to kb vm." Views: lists (people/companies with
the two data tranches), evidence per person, drafts/revisions with QA, campaigns + deliveries + follow-up
state, inbox triage (replies/OOO/bounces), an ask box that files a P5 run (opaque ask ref; literal text stays
on the desktop), analysis (counts, funnel, bake-off results, budget/credits). Style: Claude-dark near-black,
NO accent colours, condensed nav, no sign-in chrome (localhost only). It reads the desktop SQLite store
directly (read-only for views); every WRITE (run a workflow, approve a T1 batch, edit a sender profile) goes
through the existing entrypoints (P5 `run_workflow` / desktop_stage, P6 approval verifier, P1 `cli.py`),
never raw SQL. Runs are executed by the VM manager (the UI submits via the same bridge contract the VM uses,
in reverse: desktop → VM `run_workflow --ssh` is NOT available, so the UI calls the LOCAL runner
`py -3 -m scripts.prospecting.run_workflow --local` or files a queue card for the VM; decide and justify).

\## READ BUDGET (closed list)
- spec `docs/superpowers/specs/2026-09-02-prospecting-design.md`: §Store (tranches, tables), §Agents,
  §Workflows, "### P1" (Datasette view — the UI replaces it), "### P7" (why it is unscheduled: the UI is an
  amendment, not the reserved automation P7; name it P7-UI and say the reserved P7 stays untouched).
- kb dashboard STYLE ONLY: `dashboard/src/styles/*.css` or the tokens file (≤ 200 lines), `dashboard/index.html`,
  ONE page component under `dashboard/src/` (≤ 150 lines) to copy layout idiom; `dashboard/README.md` (≤ 80 lines).
  Never read `dashboard/server/`, `dashboard/dist*`, `node_modules`.
- P1 store surface: `scripts/prospecting/schema.sql` (table names/columns for views), `scripts/prospecting/export.py`
  (fixed LOCALAPPDATA root), `scripts/prospecting/serve_datasette.ps1`.
- P5/P6 entrypoints: `scripts/prospecting/run_workflow.py` (argparse only), `scripts/prospecting/manager/desktop_stage.py`
  (argparse only), `docs/superpowers/plans/2026-09-03-prospecting-p6.md` Task 1–3 (approval scope + verifier names).
- `governance/risk-tiers.md` §"Approval channels", `CLAUDE.md` §Autonomy.
Forbidden: repo-wide grep; memory/, queue/, ledgers/, orgs/faceless-youtube/.

\## Decisions already made (binding)
- Stack: Python 3.13 stdlib-first backend (`http.server`/`ThreadingHTTPServer` or FastAPI ONLY if already
  installed on the host — check `py -3 -c "import fastapi"`; if absent, stdlib) bound to 127.0.0.1 with a
  random port + one-time token in the URL, launched by `py -3 -m scripts.prospecting.ui.serve`. Frontend:
  ONE static bundle built with the dashboard's Vite+TS toolchain (`scripts/prospecting/ui/web/`), reusing the
  dashboard's CSS tokens verbatim (copied file, provenance comment). No auth UI, no remote binding, ever.
- Read path: SQLite opened `mode=ro`; PII stays on the desktop; the UI never sends store content anywhere.
- Write path: only via existing CLIs/entrypoints (subprocess with argv, shell=False). T1 approvals show the
  P6 scope hash and route to the kb dashboard WebAuthn channel (link out), never sign locally.
- Tests: no browser automation; backend handlers tested with `http.client`; a static HTML render smoke via
  `vitest` if the toolchain is present, else a Python HTML-structure test. Gate = `gate_manifest_p7ui.json`,
  prerequisites P1–P6 recorded.
- Frozen files: everything P1–P6 (no edits); the UI lives entirely under `scripts/prospecting/ui/`.

\## Plan format (binding — same as P1–P6)
Header, Goal, Architecture, Tech Stack, Spec pointer, `## Global Constraints` (verbatim rules above),
`## File Structure`, then `## Task N:` (7–9 tasks, each: Files, Interfaces, failing test code, run/expect,
implementation code, run/expect, commit; ≥ 60 fenced code blocks total; every step concrete, no placeholders).
Task 0 = verify prerequisites + pin the entrypoint argv; last task = numeric gate. Include Daniel's human
gate: he opens the UI, browses the P2 list + P3 drafts + P4 campaign, files one ask, and replies "P7-UI pass".
Self-review at the end against the amendment (coverage, placeholders, type consistency).

## Result

FAILED: orphaned — dispatch parent died before completion (model gpt-5.6-sol, started 2026-09-03T23:07:18Z, log C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a99fda5-f05b32b0.jsonl)

Last log lines:

{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I’ll work only in the integrated P6 worktree, run the required preamble once, then rebuild the P7-UI documents from the review and real code surfaces. I’ll keep all writes confined to the two authorized Markdown files and won’t commit."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command 'python scripts/preamble.py'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command 'python scripts/preamble.py'","aggregated_output":"PREAMBLE OK\r\n","exit_code":0,"status":"completed"}}
{"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command \"Get-Content -Raw -LiteralPath 'docs/superpowers/plans/2026-09-04-prospecting-p7ui-REVIEW.md'\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command \"Get-Content -Raw -LiteralPath 'docs/superpowers/plans/2026-09-04-prospecting-p7ui-REVIEW.md'\"","aggregated_output":"### 1. Intentâ†’amendmentâ†’plan coverage\n\n| Intent / view / behaviour | Plan task(s) | Status |\n|---|---|---|\n| Localhost-only desktop server, random port, no sign-in | 3, 7 | PARTIAL â€” loopback design is concrete, but launcher has an undefined `prerequisite_status`. |\n| kb dark, achromatic, condensed UI | 5 | PARTIAL â€” tokens/shell exist, but the specified dense table/detail UI is replaced by raw JSON `<pre>`. |\n| Overview | 5â€“6 | PARTIAL â€” bootstrap route only; no implemented overview panel. |\n| People and Companies exact tranches | 2, 6 | PARTIAL â€” routes exist, but projections conflict with the designâ€™s physical sketch and no functional table/nav wiring is specified. |\n| Evidence detail | 2, 6 | PARTIAL â€” route/renderer exist but no selected-row interaction calls it. |\n| Drafts plus QA | 2, 6 | PARTIAL â€” revision route/renderer exist but are not wired into the Drafts view. |\n| Campaigns, deliveries, follow-ups | 2, 6 | PARTIAL â€” backend returns campaign/enrollment/delivery data, but no campaign-detail UI; follow-up state is not rendered. |\n| Inbox triage | 2, 6 | PARTIAL â€” route only; generic JSON rendering is not triage UI. |\n| Analysis | 2, 6 | PARTIAL â€” route only; no analysis presentation. |\n| Ask box: five slugs, opaque ref, typed stage/run result | 4, 6 | PARTIAL â€” form is defined but never mounted; returned ref/status are never shown. Invalid workflow is staged before it is rejected. |\n| Sender-profile mutation through P1 CLI | 4, 6 | MISSING â€” the posted `Object.fromEntries(data)` includes `profile_id`, which `update_sender` rejects. |\n| T1 batch scope and kb WebAuthn link | 4, 6 | PARTIAL â€” renderer has only a link, as desired, but the approval URL is hard-coded and the P6 argv is unverified. |\n| Runs through manager path | 0, 4 | PARTIAL â€” intended route is correct, but the named frozen P5 files are absent here and argv cannot be pinned. |\n| SQLite read-only | 1â€“2 | PARTIAL â€” good `mode=ro` design and write-rejection test, but schema/column contracts cannot be verified. |\n| All writes through existing CLIs; no raw SQL writes | 0, 4 | PARTIAL â€” subprocess seam is appropriate, but frozen CLI interfaces are unavailable and route matching is overly broad. |\n| PII stays desktop-only | 1, 3â€“4, 6 | PARTIAL â€” no remote listener/CORS is planned, but there is no sink test proving subprocess/exception paths and UI responses meet the claim. |\n| UI wholly under `scripts/prospecting/ui/`; P1â€“P6 frozen | 5, 8 | PARTIAL â€” sources are scoped there, but build/test commands require `dashboard/node_modules`; the gate does not prove the claimed numeric criteria. |\n\nThe mandatory validation inputs are not present: `scripts/prospecting/schema.sql`, `run_workflow.py`, and `manager/desktop_stage.py`. This makes the planned prerequisite test fail immediately and prevents validating the requested schema and argparse contracts.\n\n### 2. Executability defects\n\n- Task 7 imports `CommandRouter`, `open_readonly`, `make_server`, and `ProjectionService`, but not `prerequisite_status`; `Application.__init__` therefore raises `NameError`.\n- Task 5 says â€œCreate all `web/` filesâ€ but never supplies `main.ts`; Task 6 says â€œadditions to `main.ts`.â€ It also never mounts `shellHtml()` or attaches nav buttons to the custom `route` event.\n- Task 6 defines `state.ts`, but the shown code uses `endpoint` without an import. No Ask, sender, or batch form is mounted.\n- Task 6â€™s sender call includes `profile_id` in the JSON body. Task 4 rejects every payload key outside the approved sender fields, so the form always returns `sender_field_not_allowed`.\n- Task 4 validates the workflow only inside `run_workflow_argv`, after `desktop_stage` has already persisted the literal ask. An invalid workflow must be rejected before staging.\n- Route recognition uses `startswith`; `/api/sender-profiles/id/extra` and similarly shaped paths can execute the operation for `id`. Require exact segment matching.\n- The planâ€™s own fixtures are missing: `projection_db`, `fake_run`, `repo_root`, `post_cases`, `app`, and `built_dist`. `test_static.py` is named but never authored.\n- Task 0 predicts â€œ7 passed,â€ but its supplied test code has six tests: four parametrized help cases plus two ordinary tests.\n- The projection SQL is not executable against the supplied design sketch: it uses `company.one_line_summary`, `person.one_line_blurb`, `contact_point.selected`, and `inbound.state/reason` (plan lines 377, 388, 416); the design sketch instead shows `summary`, `blurb`, no `selected` column, and `explanation_code`/`correction_class`. The absent authoritative `schema.sql` makes this a hard blocker.\n- The pinned P5/P6/P1 argv is an assumption, not a pin, because all three named target files are absent. The plan must not declare those argv immutable until the actual argparse surfaces are available.\n- `dashboard/node_modules` is required by both the UI package script and build commands (line 778). That is an undeclared external toolchain dependency outside `scripts/prospecting/ui/`, with no availability/version gate.\n\n### 3. Security\n\nGood foundations: literal `127.0.0.1`, no bind option, suppressed request logging, a single-use token, session cookie, Host/Origin/CSRF checks, `shell=False`, and resolved static-file containment are all directionally correct.\n\nBlocking gaps:\n\n- Validate the workflow allowlist before calling `desktop_stage`; otherwise an attacker with a valid local session can cause an unwanted local persistent ask write with an invalid slug.\n- Exact-match POST paths, not prefixes.\n- Add tests for duplicate/malformed `Host`, malformed `Content-Length`, unknown/missing payload keys, subprocess `OSError`, missing `ask_ref`, and handler exceptions. Current uncaught exceptions can be emitted by the HTTP serverâ€™s error handler.\n- Do not hard-code `approval_url` as `http://127.0.0.1:4317/` (line 1010). Resolve and validate the existing dashboard approval-channel URL as a prerequisite; otherwise the â€œReview in kbâ€ link can point to the wrong local service.\n- Add explicit tests that child stdout/stderr, exception paths, and typed command results never expose literal asks, sender content, evidence, email, or message bodies. The current redaction test only checks a happy-path result shape.\n- The static-path implementation resolves symlinks correctly, but its tests do not exercise an in-root symlink to an external file; add that case.\n\n### 4. Test quality\n\n- The numeric gate is vacuous. After merely checking command exit codes, it calls `verify_inventory` with a literal perfect result (line 1147), rather than parsing runner output.\n- `route_shapes`, `write_routes`, `security_rejections`, read-only mutation attempts, traversal attempts, and the zero-valued criteria are printed metadata, not measured assertions.\n- The manifest is file-count based, not a flat, per-phase inventory of named tests. It has no fixture-by-basename contract and no criteria recorded by `record_property`.\n- Collection checks only for the substring `\"59 tests collected\"`; it does not verify per-file collection or the manifestâ€™s individual counts.\n- Most stated test totals (14 projections, 18 HTTP, 4 static, etc.) have no corresponding supplied test cases.\n- The frontend â€œtestsâ€ inspect HTML strings, not mounted interaction behavior. They cannot catch the missing app mount, nav dispatch, form rendering, result status display, or sender payload defect.\n- The Host/Origin/CSRF test delegates all substantive cases to an undefined fixture and does not prove the advertised 30 rejections.\n\n### 5. Verdict: REWRITE\n\nRewrite Tasks 0, 2, and 5â€“8 after P1â€“P6 land, using the actual schema and argparse blocks as the source of truth. The current plan cannot be executed literally in this worktree, and its core UI wiring, mutation form, projection contract, and numeric gate are incomplete or unsound.\n\n\r\n","exit_code":0,"status":"completed"}}
