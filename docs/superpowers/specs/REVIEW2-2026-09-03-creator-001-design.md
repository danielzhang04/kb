# Re-review — creator-001 design spec v2

Review date: 2026-09-03  
Target: `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md` at `0015a0e2`  
Prior review: `docs/superpowers/specs/REVIEW-2026-09-03-creator-001-design.md`

## Verdict

**REJECT.** The v2 makes substantial, real corrections, but it is not yet safe to build and spend
from as written. Of the 26 prior findings, **14 are closed, 12 are partial, and 0 are wholly
unaddressed**. This review adds **13 findings: 3 blockers, 4 high, 3 medium, and 3 low**.

The decisive blocker is expansion-02's live-run shape. Its preflight arithmetic reaches exactly
3,600 seconds with no slack, while its claim that a 240-second job timeout clears the measured
cold-job band is contradicted by the cited evidence: `composite-01/run.json` records a
**260.449-second** first job. Running P3 with this design can spend on a pod that times out on its
first cell. The other blockers are authorization defects: several tonight phases are incorrectly
called gate-independent despite the figment contract, and the spend-card example assigns the live
run to the wrong owner and does not require the schema's human `approval` token.

## 1. The 26 prior findings

| # | closed? yes/partial/no | where | what is still wrong |
|---:|---|---|---|
| 1 | partial | §0 lines 18–37; P3 line 547 | The research-before-expansion gate is real and P3 is safely blocked, but the document says `r15b-edit-motion.md` is absent and the r15b reports are pending. All three reports now exist and are claim-checked. S5/S6 and the r15b training corrections have not been reconciled into this spec. |
| 2 | partial | §2.7 lines 208–209; §6 lines 492–502; P3 line 547 | A pre-create T2 card is now mandatory. The concrete card is still wrong: `owner: claude-boss` conflicts with `figment-expand` as the S2 executor, and the required human-minted `approval` field is not part of the stated payload. |
| 3 | yes | §2.7 lines 220–221; S2 lines 248–250; P2 line 546 | Expansion-02 explicitly forbids `network_volume_id` and uses fresh ephemeral pods; later caching requires a separately approved, ledgered delete-and-verify lifecycle. |
| 4 | partial | §2.4a lines 177–187; P1 line 544; C1 line 47 | The three safety axes, fail-closed schema validation, board display, tests, and independent review are real. C1 still says “all six rulings axes”; the schema has four original plus three new axes, so the required count is seven. |
| 5 | partial | S2 line 255; testing line 533; P0R/P2R lines 543–547 | SHA-bound P0R/P2R gates now exist. P2R is nevertheless scheduled before P2 while S2 says it reviews `build_expansion_set.py`; it cannot review a file that P2 has not built. The current harness fixes also still lack the promised post-fix different-model review. |
| 6 | yes | §2.4 lines 155–175; P1 line 544 | Lifecycle state, review status, and gate decisions are orthogonal, have named sole writers, and have legal/illegal transition tests. `parked` no longer mutates lifecycle state. |
| 7 | yes | §2.2 line 135; §6 lines 488–490; testing lines 527–533 | `gate.json` is hash-bound, written atomically by one writer, persisted for resume, and reopened when its subject changes. |
| 8 | partial | §2.2 lines 109–126; S2 lines 243–254; P2 line 546 | The count is now 60 by operator ruling: 40 required strata plus 20 replicates, sharded 10 each. The document still does not identify the selected 20 replicate strata or define the supposedly “fixed” traversal order, so the builder author must invent load-bearing allocation policy. |
| 9 | yes | §2.2 lines 131–133; S2 line 243; tests line 254 | `pod_runs[]` now preserves one append-only provenance row per shard, derives batch cost, and has partial-resume tests. |
| 10 | partial | §9 lines 548–553, 579 | P4 is split into P4a–P4f with useful dependency edges. P4f still has the unbounded target “org-file consistency”; P4b/P4e/P4f lack phase-local test commands and named reviewers; and their gate-independent labels conflict with the contract. |
| 11 | partial | C2 line 48; S2c lines 262–271; SX-T lines 402–413; P6b/P7 lines 556–557 | Full-body and operator-only explicit paths now exist, but there is no phase that trains the production Instagram LoRA v2 on S2 ∪ S2b ∪ S2c. P7 is named LoRA v1 while waiting on GATE A3, and S2c may depend on an approved LoRA v1 that P7 has not produced. |
| 12 | yes | §4 lines 415–427; S8 lines 368–370 | Authenticated browsing is T3 per run, live account reads are T2, public research is T1, follows are forbidden, and “warm-up” is replaced by an operator readiness record. |
| 13 | partial | S3 lines 282, 287–288; P5 line 554 | The four bounds and their preflight equation are specified and Q4/T2-gated. The implementation premise is stale: HEAD now has a global `DEFAULT_MAX_MINUTES` of 840, not a hard 60-minute default or a `TRAINING_MAX_MINUTES` exception. |
| 14 | yes | S3 lines 287–288; P5 line 554 | Finding 8, a shell-injection regression test, and the separately approved `.txt`/`.toml`/`_dataset.ready` upload contract proof are explicit prerequisites. |
| 15 | yes | platform P5 line 65; P11b line 562 | P11b is an executable two-account isolation proof with an expired-grant fault injection and a platform-readiness gate. |
| 16 | yes | account schema line 136; S8 lines 364–365; testing line 527 | All four disclosure placements are represented; publisher preflight fails closed on missing, stale, or mismatched account disclosure before post 1. |
| 17 | yes | §2.6 lines 193–204; roster line 460; SX lines 391–400 | `figment-checker` is restricted to Instagram-tier judgments and the explicit adapter returns only opaque operator-authored metadata. |
| 18 | yes | S5 line 324; P4a line 548 | `chain[]` is builder input, compiled to documented pod keys, with workflow-SHA/node-set toggle tests. |
| 19 | partial | S6 line 341; P10 line 560; arc line 581 | CLI-versus-manifest notation is corrected. Two proof invocations at `--max-usd 0.50` have a $1.00 invocation ceiling, not the $0.70 phase ceiling carried into §9. |
| 20 | yes | S3 line 282; P5 line 554; Q4 line 592 | P5 is explicitly blocked on the Q4 operator decision and an approved T2 code card. |
| 21 | partial | declaration matrix lines 455–469; P4e line 552 | Valid role/runtime/model/profile/project fields and S2–S9 executors now exist. SV/P14 still has no executor; the declarations omit concrete values for required frontmatter such as `runner-bound`; and the workflow target is not the repo's project workflow path. |
| 22 | yes | §5 lines 429–451; P16 line 577 | Studio is an actual decision, Q10 is removed, six routes have acceptance tests, and the first gates do not wait on UI work. |
| 23 | yes | error handling line 510; regression tests line 528; P0 line 542 | REVIEW-e finding 18 and its exact UTC-midnight regression test are present in the build plan. The current implementation still needs that P0 work; the prior design omission itself is closed. |
| 24 | partial | persona schema lines 104–107; S2 line 251; S2c line 268 | Learned-threshold lifecycle objects and raw-only expansion scoring landed. `min_face_px` is nevertheless pre-labelled `locked` with no calibration-set SHA and S2c calls its threshold deterministic; measurement is deterministic, but 600 px is a provisional learned cutoff under r16. |
| 25 | partial | SV line 389; SX/SX-T lines 391–413; P14a–g/P15a–e lines 565–576 | The umbrella phases are split and spend is itemized. The rows still lack exact file targets, phase-local tests, and named reviewers, and P14 has no declared executor. |
| 26 | yes | cadence table lines 419–427; roster lines 466–467 | Ownership is now explicit: four named researcher cadences and three named analyst cadences, with a tier on each row. |

## 2. Expansion-02 arithmetic

### Stated shape

| Quantity | Derivation | Result |
|---|---:|---:|
| Per-pod preflight budget | 900 readiness + 10 × 240 job + 300 teardown | 3,600 s = 60 min |
| Capacity | 6 pods × 10 cells | 60 cells |
| Rate-based one-pod estimate at $0.80/h | 1 h × $0.80/h | $0.80 |
| Invocation ceiling per pod | `--max-usd 0.90` | $0.90 |
| Expansion invocation ceiling | 6 × $0.90 | $5.40 |
| Today's ledger plus P3 ceiling | $0.872646 + $5.40 | $6.272646, under the $10 daily limit |
| Arc ledger plus P3 ceiling | $2.845268 + $5.40 | $8.245268, under the $50 arc cap |

The multiplication is correct, but the operational conclusion is not. Equality at 3,600 seconds
leaves no planning slack, and the cited run evidence includes a 260.449-second first job
(`personas/creator-001/composite-01/run.json:58`). A 240-second wait cannot honestly be described as
clearing a 215–260 second band “with headroom.” Job timing also includes submit/wait/download while
the harness timeout covers the output wait, so the recorded aggregate does not prove that the wait
portion was below 240 seconds. It certainly does not prove headroom.

Concrete safe replacement under the same 900-second readiness and 60-minute per-pod limits:

> `job_timeout_seconds: 280`; eight shards with cell counts `[8,8,8,8,7,7,7,7]`; the largest shard
> budgets `900 + 8×280 + 300 = 3,440 s`, leaving 160 seconds. Keep `--max-usd 0.90` per invocation;
> the expansion invocation ceiling becomes **$7.20**, and today's ceiling becomes
> `$0.872646 + $7.20 = $8.072646`, still below $10.

If six pods is a hard product decision, P3 must remain blocked until a measured model-prewarm change
moves the cold load out of the per-job path and a fresh timing sample proves a 240-second timeout.
The current evidence does not.

### Arc totals

The §9 phase rows sum to **$14.90** exactly as printed:

`5.40 + 0.60 + 0.90 + 2.80 + 0.80 + 1.10 + 0.70 + 2.00 + 0.20 + 0.20 + 0.20 = 14.90`.

That is not the true invocation-ceiling total:

- S6 specifies two proof runs, each with `--max-usd 0.50`; P10 therefore contributes **$1.00**, not
  $0.70. Correcting only that row makes planned future invocation ceilings **$15.20**.
- Existing figment ledger spend is **$2.845268**. The projected running arc ceiling is therefore
  **$18.045268**, not $14.90.
- Closing the missing production-LoRA phase with another training + tester ceiling of $2.80 makes a
  mandate-complete future plan **$18.00**, or **$20.845268 including spend already incurred**.
- S2's “planned ≈ $3.30” may remain as an estimate, but it is not derivable from the conservative
  60-minute inputs and must not be labelled a ceiling.

All corrected totals remain below $50. They still have to be recomputed from the live ledger before
every create.

## 3. New contradictions and defects

| ID | severity | location | contradiction / outcome | concrete fix |
|---|---|---|---|---|
| N1 | blocker | S2 lines 249–254; P2/P3 lines 546–547; `composite-01/run.json:58` | `240 s` is claimed to clear a measured band ending at 260.449 s, and the preflight reaches the 60-minute cap exactly. P3 can spend and fail on the first cold cell. | Replace the run shape with the eight-shard/280-second text above, update all cell/pod/card/test counts and the P3 ceiling to $7.20; or keep P3 blocked pending a measured prewarm proof. |
| N2 | blocker | build-order definition line 538; P1/P4b/P4e/P4f lines 544, 549, 552–553; `contract.md:3,21–27` | “GATE-INDEPENDENT” is defined as needing no operator decision. P4b changes the taxonomy/templates, explicitly T2; P1/P4e/P4f are outside the T1 allow-list and default to queues-for-me. Executing tonight's parallel set as written violates authorization. | Change each affected status to `GATE-BLOCKED (approved T2 build card)` or split it into a target that the contract actually lists as T1. A direct review brief is not an approval to execute those build phases. |
| N3 | blocker | expansion card lines 492–502; roster line 461; `card-schema.md:10–19,36,41,50–59` | The live S2 card is assigned to `claude-boss`, while `figment-expand` is the declared executor. A citation to a boss-session ruling is not the schema's `approval` token. This can make ownership/approval checks fail or tempt an out-of-band create. | Require a complete schema-valid card, dispatcher-assigned `owner: figment-expand`, `role: work`, concrete runtime/model, all dependencies, and a non-null human-minted `approval` value. Keep the ruling citation as evidence, not authorization. |
| N4 | high | S2 review line 255; P2R/P2 lines 545–546; safe set line 579 | P2R gates P2 but is also required to review P2's `build_expansion_set.py` at the executing SHA. This is a dependency cycle. | Order `P1 → P2 → P2R → P3`. Make P2 depend on the P1 schema and the dry-run-capable harness, not P2R. Make P2R review the union of P1's QA/scorer changes and P2's builder/allocation/manifests, then gate only P3. |
| N5 | high | §0 lines 18–37; S5 line 312; S6 lines 329–343; §11 lines 601–614 | The spec was committed after all three r15b reports and their claim-check commit, yet calls them pending/absent. It also repeats the now-corrected A100 claim and omits the edit/motion findings. P3's research gate is therefore not satisfied. | Mark all three reports claim-checked; correct module 05 to L40S and distinguish the taught 5,000-step recommendation from the 3,000-step demo; record module 11's 77-minute run/cache-embeddings/sampling-off facts; reconcile S5/S6 with the module-07/08 findings while keeping 9B/Wan2.1-specific nodes as challengers, not direct Wan2.2/klein-4B settings. |
| N6 | high | C2 line 48; S2c lines 266–271; gate spine lines 478–480; P6b/P7/P8 lines 556–558; §11 line 623 | The phase graph has no production LoRA v2 training task. P7 is v1 but waits for A3; S2c may wait for v1; P8 can then register a provisional checkpoint. The two-tier claim is not executable. | Make P7 train v1 from S2 after GATE A + P5; run P6/P6b after GATE B; add P7b to train/rank LoRA v2 from S2 ∪ S2b ∪ S2c and write GATE B2; make P8 depend on B2. Add the $2.80 P7b ceiling to the arc. |
| N7 | high | components line 73; spend lines 216–217; S3 line 282; testing line 534; P0/P5 lines 542, 554; `pod/README.md:167–175`; `runpod_run.py:38` | The spec describes 21 open harness defects, a red 38/81 baseline, and a hard 60-minute global default. HEAD has 152 combined pod/train tests green and `DEFAULT_MAX_MINUTES = 840`; REVIEW-e 1–17 and 20 are implemented, while 18/19/21 remain. P0/P5 would now edit against a false baseline. | State the exact HEAD status. Define 60 minutes as an expansion manifest+CLI limit, not the global default. Either accept the current global 840-minute ceiling with mandatory per-manifest/CLI bounds or propose a reviewed stage-specific policy; do not add a fictional `TRAINING_MAX_MINUTES` over the current implementation. Retain P0 for 18/19/21 and P0R before P3. |
| N8 | medium | S6 line 341; P10 line 560; arc line 581 | Two `$0.50` invocations are summarized as a `$0.70` ceiling, and the “arc ceiling” omits already-spent rows. | Set P10 ceiling to $1.00, future invocation ceilings to $15.20 before the missing LoRA-v2 phase, and projected running arc ceiling to $18.045268. After adding P7b, use $18.00 future / $20.845268 running. |
| N9 | medium | §9 lines 544–553, 565–576 | Tonight's build rows are not complete work orders: exact test files/commands and named reviewers are absent; P4f's targets are open-ended; later P14/P15 rows have the same defect. | Add an owner, exact target paths, exact focused test command, and reviewer to every phase. Use `figment-checker`/Claude Opus for P1+P2's P2R after P4e lands; use existing `grader` for P4e itself so the new checker does not review its own declaration. Name P4b/P4f reviewers as well. |
| N10 | medium | persona floor lines 104–107; S2 line 251; S2c line 268; `r16-detail-passes.md:36–52` | `min_face_px: 600` is locked without calibration provenance and is later treated as a deterministic hard route. r16 labels the cutoff provisional and requires 60 labelled outputs before routing. | Initialize `min_face_px` as uncalibrated with `calibration_set_sha: null`; lock it at GATE A from the labelled 60-cell set; permit S2c hard routing only when the stored calibration SHA and gate hash match. |
| N11 | low | C1 line 47; §2.4a lines 177–187 | The success condition says six axes while the schema and board correctly require seven. | Replace “all six rulings axes” with “all seven rulings axes.” |
| N12 | low | S6 line 340; gate spine lines 475–486; P10 line 560 | The video eye gate is persisted but has no stable gate id, unlike A–H, so its `gate.json.gate_id` and downstream dependency are ambiguous. | Name it, for example `GATE D2`, and use that id in S6, the gate spine, P10, and any phase that consumes an approved clip. |
| N13 | low | evidence line 27; layout lines 143–153; P4e line 552; declaration text line 469 | The measured run path is printed as `personas/.../batches/composite-*`, while the files are currently `personas/.../composite-*`; the intended persona root is `orgs/figment/personas/`. The workflow is named at root `workflows/`, while project workflows live under `orgs/<project>/workflows/`. | Cite the current evidence path exactly, state the P1 migration destination, and target `orgs/figment/workflows/figment-creator.md`. |

## 4. Tonight's scope

Requested shape: `P1 ∥ P4b ∥ P4e ∥ P4f → P2 → P2R → P3 gate-blocked`.

It is **not buildable as written**, but it becomes buildable without widening scope after these
edits:

| Phase | State after correction | Required task packet |
|---|---|---|
| P1 | buildable after a T2 build card | Exact listed schema/reducer/gate/QA targets; focused reducer, safety-axis, gate-hash, and threshold-lifecycle tests; reviewed later by P2R. |
| P4b | buildable after a T2 content-change card | Exact taxonomy plus CT-1…7/RT-1…6 paths; schema/mix/aspect tests; named reviewer. |
| P4e | buildable after a T2 build card | Nine exact `agents/figment-*.md` files plus `orgs/figment/workflows/figment-creator.md`; complete required frontmatter; card-DAG validation; reviewed by existing `grader`, not by a declaration created in the same task. |
| P4f | not yet bounded | Replace “org-file consistency” with an exact path list; add cadence parse/due/tier tests and a named reviewer; clarify that only a human-authored commit to protected main grants standing cadence authorization. |
| P2 | buildable after P1 and the corrected expansion math | Exact builder/allocation/eight manifests/transcript targets and the stated deterministic tests. It must not depend on P2R. |
| P2R | buildable only after P2 | `figment-checker` on a different model/session reviews P1+P2's exact SHAs, focused test transcript, allocation, all manifests, QA changes, and scorer changes. Its verdict gates P3. |
| P3 | correctly gate-blocked | Do not create a pod until N1–N7 are corrected, the r15b reconciliation is committed, P0R/P2R are live-safe at the executing SHA, and the schema-valid T2 spend card is approved. |

P0/P0R cannot simply disappear from the live boundary because the 152-test green baseline does not
close REVIEW-e findings 18/19/21 and is not a different-model review of the fixes. They may run
outside tonight's build-only chain, but P3 must continue to depend on a completed P0R.

## 5. Verification evidence

- `python scripts/preamble.py` — **PREAMBLE OK**.
- `py -3 -m pytest orgs/figment/pipeline/pod/tests orgs/figment/pipeline/train/tests -q -p no:cacheprovider`
  — **152 passed in 12.47s**.
- An exploratory invocation that overrode pytest's `--basetemp` produced **151 passed, 1 failed**;
  the sole failure was the repository's environment-policy test correctly asserting that `tmp_path`
  lives under its configured `PYTEST_DEBUG_TEMPROOT`. Re-running the repository-shaped command above
  passed 152/152.
- `git diff --check` — no diff-hygiene errors.
- No live pod, browser, account, network, publish, or spend action was performed.
- The target spec was not edited. This review file is the only intended repository output.

## Required fixes before re-review

1. Replace the unsafe six-pod/240-second expansion shape or provide a measured prewarm proof; update
   every derived pod count, manifest count, card field, test, and ceiling.
2. Put P1/P4b/P4e/P4f behind the T2 approvals required by the contract and turn each into an exact
   work order with a named reviewer and test command.
3. Make the expansion spend card schema-valid, assign it to `figment-expand`, and require the
   human-minted `approval` token before create #1.
4. Reorder the chain to `P1 → P2 → P2R → P3`; P2R reviews P1+P2 and gates P3, never P2.
5. Reconcile all three claim-checked r15b reports into §0/S3/S5/S6/§11, including the L40S,
   5,000-vs-3,000-step, 77-minute, cache/sampling, targeted-edit, SAM3, prompt, start-frame, and
   `force_rate` findings.
6. Add the missing production-LoRA-v2 training/ranking phase and GATE B2, repair the P6/P6b/P7/P8
   dependencies, and add its ceiling to the arc.
7. Reconcile the spec with the current harness: 152 green, global 840-minute default, fixes 1–17/20
   present, 18/19/21 and the different-model post-fix review still open.
8. Correct P10 and running-arc totals, label `$3.30` as an estimate only, and include already-incurred
   spend in every projected arc total.
9. Leave `min_face_px` uncalibrated until GATE A binds it to the labelled-set SHA.
10. Correct the seven-axis count, give the video gate a stable id, and fix the evidence/workflow paths.
