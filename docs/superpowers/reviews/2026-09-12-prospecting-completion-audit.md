# Prospecting infrastructure completion audit ? 2026-09-12

The assigned infrastructure scope is implemented and verified on
`codex/prospecting-session-20260909`. This is the boss's requirement audit, not an
independent inspector score or release authorization. The original goal and the
startup-pilot execution plan remain the acceptance scope; a prospect quota was never
substituted for infrastructure completion.

Independent Opus review180 identified the remaining full-suite and handoff checks.
Root inspected their authoritative results and retained desktop metadata. Subsequent
changes are documentation only; the tested implementation and P1 artifact hashes are
unchanged. Canonical delivery state is in the PR180 handoff.

| Requirement | Evidence inspected and result |
| --- | --- |
| Desktop runtime authentication | Actual native qualification and editorial trials succeeded. Retained synthetic SQLite states: qualification succeeded; humanizer, post-humanization fact-check and independent critic each succeeded; editorial item human_review, repair_cycle0. ORCH/completion-native-states-184.json records the read-only audit. |
| Source-only vCPU lifecycle | Verified Claude workers used the existing bounded vCPU helper. The VM recovery review records45 tests plus40 subtests, a negative control against old code, and two live synthetic timeout/cleanup probes with independent SSH absence checks for owned root and three units. |
| Exact selected-person drafts | Selected/native acceptance320 tests and actual real public format setup/materialization/replay. The original pilot retains exactly one selected_draft_binding; targeting, qualification and ranking hashes and exact draft replay match (completion-private-count-audit-181.json). |
| Atomic human-edit restart | Public edit/restart service coverage and actual Chrome DevTools ui157 proof: nine stage calls genuinely exhausted two repair cycles; Save edit made a QA-passed child; one restart created cycle0 while the old item stayed parked at cycle2. Source drift withdrew the exact source view; byte restoration restored it. |
| Durable acquisition | Core, packet authoring, span locator, compiler, export/import, replay, source-change refusal and retained-export reviews cover the public pipeline. Current full suite includes the public CLI-chain test. Fifty affected capture tests pass with a private basetemp and two boundary tests pass with a non-private basetemp. AST audit confirms every documented CLI flag exists; these CLIs disable --help intentionally. |
| Full native model path | Accepted bundle e07ade2e36d078cd83fecb2e4244a0c33322563969308da912a18205e0ca7814 returned all four adapters through public prepare/canary; capability invalidation and runtime-root cleanup were verified. Retained native qualification and three-stage editorial execution establish actual model calls separately from the canary. |
| Small real nonsending workflow | Retained task134 metadata records3 qualification artifacts/4 cumulative attempts, including one historical refusal then3 successes. P20 selected one person with five-person shortfall; ranking and draft replay matched. Current original store: one binding and zero source attestations, approvals, execution requests or sends. |
| Adversarial and code-review repair loops | Named independent reviews cover VM cleanup, selected-source binding, restart, capture/retained-export boundaries, claim counting and HTTP refusals. HTTP's original shape-only regression was rejected; disabling the repaired drain fails the strengthened byte-discard assertion. Claim-ratio negative control was likewise repaired after independent review found it vacuous. |
| Broad synthetic regression | ORCH/full-suite-179.xml:2147 passed,0 failures/errors/skips,738.964s JUnit; CLI739.41s, process741.130s, exit0. Run171's2143pass/4fail is preserved as repaired history. Run179 used supported Python3.13.7 with the project no-network setting and full scripts/prospecting/tests directory. |
| P1 gate and evidence integrity | Fresh verified Opus174/174b graded only the bounded P1 repair card95/100. The actual gate --phase P1 --inspector-score95 --record passed122 and generated P1.json in67218ba5. Current --verify-recorded matched:true; full artifact-set equality and36 prerequisite/contract tests were verified. P6 inventory904 validates and collects. |
| Existing browser and private-data boundaries | User's signed-in Chrome controlled through Chrome DevTools session9e9063aa-56ea-44d8-a68c-777d790b77ad; page3 localhost8765 loaded and visible. Real review-copy and synthetic edit/drift checks used the DOM/HTTP/store, with metadata-only output. Worker inputs were allowlisted source only; private runtime transfer used the existing authorized desktop runtime. |
| Handoff and publication | Final plan, evidence, STATE, assigned card, lessons and verified-worker cost rows are reconciled in the existing PR181/PR180 branches. The canonical handoff is handoffs/2026-09-11-prospecting-infrastructure.md in the coordination worktree, retained at the user's request. Publication is verified separately before marking the thread goal complete. |

## Current limitations

- Initial drafting and ranking use deterministic templates/policy. Acquisition requires
  operator browser control; compiled packets prove accepted bytes, not independent browser
  observation. Autonomous discovery UI and sending were not acceptance deliverables.
- Native responding-model identity is unverified; requested model was gpt-6-astra.
  Claude development identities were verified from actual assistant JSONL records.
- Current/potential-conflict native bindings were exercised; predecessor-relation binding
  remains an unexercised real-adapter coverage edge.
- Cleanup evidence is bounded to tested lifecycle paths, not reboot persistence or universal
  absence of OS/provider traces. The optional Codex-on-VM backend remains unverified;
  current source-only Claude vCPU and desktop-native operation are demonstrated.
- Strict phase allowlisting is not a passing claim:137 unlisted paths versus135 baseline,
  including two new inventory utility files outside phase declarations. Their13 tests run
  in the full suite; the bounded inspector classified the declaration gap as minor.
  No P6 generated record or human evaluation-manifest blessing is claimed.
- The inspector-role ledger scan failed on mandated role metadata. A sequencing error let
  that commit proceed; later schema/content verification found role metadata only. This
  remains a failed scan, not a retrospectively passing one. Final source/handoff scans are
  checked separately before commit.
- Both PRs remain drafts. This delivery is not a protected merge, deployment, source
  attestation, human readiness decision or send approval.

## Load list

- docs/superpowers/plans/2026-09-09-prospecting-startup-pilot.md
- docs/superpowers/reviews/2026-09-11-prospecting-final-verification.md
- docs/superpowers/reviews/2026-09-11-prospecting-selected-native-acceptance.md
- docs/superpowers/reviews/2026-09-11-prospecting-vm-recovery.md
- orgs/prospecting/runbook-acquisition.md
- orgs/prospecting/gate-results/P1.json
- PR180: handoffs/2026-09-11-prospecting-infrastructure.md

ORCH means C:/Users/danie/kb/_private/prospecting-orchestration-20260911. Raw private
artifacts stay there or in the pilot's desktop store/snapshots; no private bodies are
embedded in this record. The first state-audit probe omitted SQLite uri=True and failed
before opening the store; the corrected query-only URI probe produced the cited receipt.
