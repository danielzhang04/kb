# Prospecting infrastructure handoff — 2026-09-11

Updated 2026-09-12T00:15:00Z. Active infrastructure work; no release claim.

## Goal and roots

Build effective, adaptable infrastructure from saved intake through capture, qualification, ranking, drafting and human review. Use synthetic, actual-model and small real nonsending tests to identify gaps. Root orchestrates and verifies; workers implement and review.

- MAIN: `C:/Users/danie/kb`.
- DELIVERY: `C:/Users/danie/kb/_private/codex-worktrees/prospecting-session-20260909`, branch `codex/prospecting-session-20260909`.
- COORD: `C:/Users/danie/kb/_private/codex-worktrees/boss-remote-context-20260908`, branch `codex/boss-remote-context-20260908`.
- ORCH: `C:/Users/danie/kb/_private/prospecting-orchestration-20260911`.
- PILOT: `C:/Users/danie/kb/_private/prospecting-startup-pilot-20260909/store.sqlite`.

## What worked

Source implementation through `35ac5517` is published on draft PR181. Local HEAD `5518114a` adds a plan checkpoint. Capture authoring, exact spans, import/export/replay, selected-source binding, restart, native adapters and operator docs passed independent reviews. Accepted commits include `4bbea820`, `1e362284`, `ebf29901`, `97df0409`, `9e8dfe4e`, `4637171b`.

Full regression evidence `ORCH/full-suite-123.xml`: 2,087 tests, 2,082 passed, 5 failed, no errors/skips, 1,245.491 seconds. Two environment-sensitive cases passed focused reruns in 2.33 seconds. Three recorded P1/P6 gate/manifest failures remain human-owned. The full suite is not green. Focused prior evidence: 320 selected/native, 36 HTML UI state, 168 acquisition, 37 final verifier, 170 qualification/native and 36 post-pin checks. Do not repeat the full suite without a new reason.

The accepted native bundle is `e07ade2e36d078cd83fecb2e4244a0c33322563969308da912a18205e0ca7814`, CLI 0.154.0, requested `gpt-6-astra`, responding identity unverified. All four actual adapters and public prepare passed. Synthetic qualification run `9f9b3d139d3641f1b423a147b31e8501`, editorial run `16f17d9de7e74fd4ba2a61c5d9a0db49`, and `ORCH/public-prepare-118-evidence.json` retain acceptance evidence. Earlier synthetic runtime cleanup was verified; actual pilot CLI exits were zero without cleanup errors, but P19 stores no durable cleanup receipt.

The user explicitly approved saved pilot context transfer to the existing native runtime. All three real P19 items then completed. Metadata evidence is `ORCH/task134/real-pilot-evidence.json`: four cumulative attempts, three artifacts; one historical failed attempt followed by three successful calls. First company is source-supported with one current-role-supported and one contradicted person; second company contradicted with three unknown people; third company unknown with zero candidates. These are machine outcomes, not human attestations.

P20 selected one eligible person across three companies and reports a five-person shortfall. Exact rank-start replay returned the same batch/hash with replayed=true; rank-project matched. No source attestations, approvals, execution requests or sends exist. The attempted draft materialization left zero selected-draft bindings.

PR180's prepared title/description was separately explicitly approved, published and verified. Both earlier automatic-approval rejections are resolved history. PR181 remains draft; neither PR was merged or deployed.

## What failed and current repair

The historical first P19 attempt failed `qualification_output_invalid` after provider schema validation because source bindings were incomplete. The wrapper repair and approved retry resolved it; do not spend another qualification attempt.

Real P22 materialization through `ReviewService.materialize_selected_draft` refused `selected_draft_unavailable`. The read-only `ORCH/selected_draft_prerequisite_probe.py` isolated `copy_profile_missing`. Separate metadata-only sender checks all passed: sender fields present, draft campaign, informational call, valid ask duration. The new format status read also passed saved campaign integrity.

Copy format was coupled to P8 fit approval in manager policy validation although P22 intentionally requires no fit approval. Source review corrected an earlier assumption: P15–P20 bind the targeting hash, which excludes copy_profile. P22 independently binds full render context. A legitimate format-only operation can preserve completed research.

Task138 worker `/root/capture_export_verify_103` is implementing an explicit canonical draft-format configuration service, authenticated status/CSRF configuration HTTP endpoints, closed public errors and backend tests/docs. It accepts a standalone canonical profile, configures only a missing profile before draft/review/approval/executor work, preserves target hashes and never invents sender facts, fit approval or authority. Existing canonical format is a read-only no-op; conflicting settings refuse. Creation behavior remains unchanged. Root review requested fail-closed schema checks, saved campaign integrity, transaction cleanup and isolation of unavailable format status so legacy review screens continue working.

Task142 worker `/root/capture_cli_chain_101` owns only `scripts/prospecting/review_app.html` and `scripts/prospecting/tests/review_app_state.test.js`: an explicit format action with stale-response guards. Task139 reviewed the backend initially; final independent review and focused tests are still required. No private configuration mutation has run yet. Source changes are uncommitted and must not be represented as accepted.

## Exact private pins and next step

Run `prun_3aa69faabfd556a49f8db1534604b26c`; campaign `camp_cc3b012c99074255`.
Qualification batch `pqba_c9a7805e2b3d5e9db76cf6ea9cfcc0ce`, hash `7de1407868b8272e49c6dc66d7bf1962c636705ba81a515843b7986b2353b494`.
Ranking batch `prrb_699e9dc9ff6a5d0c9ced805e66f14277`, hash `c55b224d6b94239fb7623dfd56feabb5a13c79811faa46ecb4efd4dacda215d1`.
Selected person rank `prrp_3180e6770a7756848d7256687ab5adcc`.
Target policy hash `17fb0dadfd035c8ed2fce837b99e3e9fa7ac0f0aea2c75e6675b0f722f5de6ad`.
Format status before configuration: missing; full policy state hash `370bbd300900abeffbc2ae3ff5603b5c0bb4f972b2c8b50696d7cfe65cf6f431`. Re-read fresh status before mutation.

Under PILOT's `snapshots/operational-validation/`, retain backup `1113f94b77ae4569a842472b3006e4b8.sqlite`, rank request `rank-start-6ce8d110.json`, and draft request `selected-draft-78b0c679.json`. Draft request UUID `78b0c679-b8f3-4077-8047-d4a3d1f57b78` can be reused; the refusal wrote no binding. Qualification retry request `d69e6f57-abf9-4e69-83cc-89315f93dc22` WAS USED successfully.

Next: finish Task138/142, independently review and run affected backend/HTML tests. Then root verifies fresh format scope, invokes the reviewed public format service once, confirms unchanged P19/P20 hashes, and retries draft materialization/replay through the existing public service probe. Keep source confirmation and send authority separate. Never print private review projections or message bodies.

## Remaining gates and operating constraints

Supported UI inventory is still apps=[] and browsers=[]. Visible browser acceptance remains unavailable; do not substitute another acquisition transport. Recorded P1/P6 manifests and historical gates remain human-owned; agents do not bless them.

The existing source-only Claude vCPU is retained. Claude hit quota; user authorized Codex fallback. Return NEW development work to Claude at 00:30 UTC September 12 (20:30 New York); healthy in-flight Codex work may finish. Use `ORCH/run_vm_proposal.py`, source-only inputs and bounded jobs; verify actual responding Claude model IDs from logs. Never send private pilot data to the vCPU. Native Codex runtime for the product remains its accepted configured runtime.

Coordination local HEAD is `14ee8d54`; published HEAD is normal merge `b88dfcd8`. Preserve merge ancestry: duplicate patch `ae3573e3` already exists locally, and a plain rebase replay was aborted. Fetch origin/ops and verify ancestry before coordination writes; no force push or direct main/ops push. Registered worker coordination reaches ops through PR180.

Keepawake PID17176 has a bounded lease ending about 07:16 UTC September12. Preserve unrelated worktrees and untracked DELIVERY/.tmp artifacts, including prior pilot-flow-audit and unknown test roots. No active full-suite process remains. No credentials as objects, paid fallback, cap increases or sends.

## Load list

- MAIN/CLAUDE.md, governance/agent-rules.md, BOSS.md; DELIVERY/orgs/prospecting/contract.md.
- COORD/orgs/prospecting/STATE.md and queue/working/01K4KB00000000000000000002.md (owner codex-worker).
- DELIVERY/docs/superpowers/plans/2026-09-09-prospecting-startup-pilot.md.
- DELIVERY/docs/superpowers/reviews/2026-09-11-prospecting-final-verification.md and 2026-09-11-prospecting-selected-native-acceptance.md.
- ORCH/task134/real-pilot-evidence.json and the two selected-draft probes.
- Current Task138/142 working diff, affected tests, acquisition runbook and COORD/memory/codex-worker.md.
