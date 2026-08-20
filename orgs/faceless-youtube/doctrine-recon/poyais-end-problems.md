# Poyais-end problem list — what Daniel actually wanted fixed

## Finding

Daniel's binding late-21-July feedback did not ask to replace Poyais's visual
register, story form, or narrator. It named six engagement failures: sparse
visual/cut life, sparse SFX, flat delivery, flat script pacing/performed humour,
weak story selection, and no whole-video engagement bar. The immediately
following fresh run exposed five pipeline controls that had masked comparable
Poyais defects. Those eleven are the Poyais-end doctrine problems.

R6--R12 also contain many real Poyais shot defects. Those are corrections to
this video, not doctrine to carry through a restoration. August changes to style,
seeds, plates, or composition are likewise not in scope merely because they are
later in the same pipeline.

**Status terms.** *fixed-since* means a named mechanism landed with
implementation/test or independent-review evidence, not that every later video
was good. *still-open* means the mechanism exists but the history lacks a
production-calibration proof. *made-worse* needs affirmative evidence; none was
found for a listed problem.

## Pipeline / doctrine problems (recut scope)

| ID | Problem in force at Poyais-end | Severity then | Evidence | Status now |
| --- | --- | --- | --- | --- |
| P1 | **Sparse visual life / held stills.** About 95 stills over 504 seconds (~11s each), locked camera, dead-still frames. Daniel asked for more images and cuts, not a new style. | High | [E1], [E2] | **fixed-since.** `82435535` added runtime coverage/cadence, long-hold justification, motivated layers, and restrained opt-in motion. Preserve only the minimal rule below. [E3] |
| P2 | **SFX were too sparse / restrained.** The defect was missed meaningful landings, not a request for a laugh-track. | High | [E1], [E2] | **fixed-since.** `c0f064ce` added semantic-coverage review of reveals, numbers, pivots, entrances, turns, punchlines, and gravity, with no rate quota. [E4] |
| P3 | **One flat macro delivery for an 8+ minute narration.** | High | [E1], [E2] | **fixed-since.** `6dd5dfa1` added a tiny validated delivery-marker vocabulary, sparse-at-real-turns rule, dry-run request review, and seam ear review. [E5] |
| P4 | **Script pacing/humour was written but not performed; at length it read flat.** | High | [E1], [E2] | **fixed-since.** `c59d89c1` added causal-turn planning, fact correction that preserves casual rhythm, and raw-versus-leashed independent review. [E6] |
| P5 | **The chosen content/angle was curious but boring:** weak stakes, angle, character, and escalation. | High | [E1], [E2] | **fixed-since.** `c59d89c1` added viability checks for stake/question, cold open/title promise, mechanism/escalation/relevance, and named differentiation; research may reject the premise. [E7] |
| P6 | **No complete-video engagement judgment.** Individual craft controls could all pass while the assembled video remained B-minus. | High | [E1] | **still-open.** The integration was independently reviewed and tested, but its own handoff says the zero-spend Poyais calibration sequence was not run. Keep the human gate; do not claim output proof. [E8], [E9] |
| P7 | **Image review was prose, not a pre-render stage.** Render depended on PNG existence, so a conductor could skip review. | Blocking | [E10], [E11] | **fixed-since.** `a17892c8` made review a DAG node/artifact; the July-30 executable DAG bound every stage. [E12], [E13] |
| P8 | **Verification could lie or be inert.** The binary state lacked “reviewed but defective/parked”, and layered-shot exemption bypassed review for 119/119 frames. | Blocking | [E10], [E11] | **fixed-since.** `df0c18ef` added non-shippable `parked`; `91220a86` kept only the PNG compatibility carve-out, not a verification bypass. [E14], [E15] |
| P9 | **On-screen text could fabricate or garble facts.** Poyais had no lettering-review axis and transcribed only 29/117 shots; its text-bearing defect rate was about 35%, versus Wells Fargo's 37%. | Blocking for real-person factual text; High otherwise | [E10], [E17], [E18] | **fixed-since.** `fc034820` HARD-fails unsupplied text; `57010f68` adds carried-literal fidelity and short-lettering checks on both VPW and motion prompts. [E17], [E18] |
| P10 | **Rig constraints vanished on environment-seeded figure frames.** Whether RIG-HOLD applied came from seed paths even when the prompt depicted people. | Blocking | [E10], [E19] | **fixed-since.** `6460ff3e` derives RIG-HOLD from depicted content as well as seed type, with a regression test. [E19] |
| P11 | **Anchor selection silently crossed historical periods.** Default anchors were Poyais 1820s images, leaking tropical valleys, mangroves, top hats, and bonnets into another story. | Blocking | [E10], [E20] | **fixed-since.** `087ed196` period-tags anchors and errors on foreign-period fallback; its repair reports 127/127 rig-held entries and zero Poyais anchors. [E20] |

P1--P5 preserve narrowly-scoped engagement mechanisms only. They do not
authorize restoring later cadence numerology, a new art register, a new seed
architecture, plate abolition, or August composition law. P6 stays a human
judgment, not an automatic score.

## Video-specific defects (not recut doctrine scope)

| ID | Class | Severity then | Evidence and disposition | Status now |
| --- | --- | --- | --- | --- |
| V1 | Individual asset/rig/composition failures: off-rig people, noses/ears, crowd scale, wrong setting/map, bad arrows/stamps, cropped/misaligned elements. | Blocking/High at named frame | R6--R10 map these to specific shot IDs; R10 retained three crowd-rig regens and arrow geometry. [E21], [E22] | **Closed for Poyais; not doctrine scope.** P10 is the portable root repair. |
| V2 | Motion/realization bugs: one-beat-late reveals, stamps drifting after impact, post-card flash, double-cut, end white frame. | High | R8 identifies plate-overwrite, unbounded slam, and dormant-card causes; R9 assigns remaining realization bugs. [E23], [E24] | **Closed for Poyais; not doctrine scope.** |
| V3 | Per-video audio taste/mix: wrong/overlong SFX, pause placement, music volume, abrupt fades/transitions, title-card treatment. | High | R6/R7 enumerate cue/bed changes; R10 carries final halo, level, and fade fixes. [E21], [E25] | **Closed for Poyais; not doctrine scope.** P2 is the portable minimum. |
| V4 | VO continuity/timing: word-boundary cuts/ticks, incorrect sentence gaps, chunk-stitch drift, cuts in pauses. | Blocking | R10 finds nominal-next-word cuts and digital-silence holes; R11 measures real silence; R12 reports 9/9 cuts within 53 ms of onset. [E22], [E26], [E27] | **Closed for Poyais; not doctrine scope.** Already repaired before the engagement brief. |
| V5 | Poyais line/copy/fact edits: local cuts, re-anchors, card wording, and Britain/Scotland fact check. | Medium/High by line | R8/R9 list exact edits and resolved fact check. [E23], [E24] | **Closed for Poyais; not doctrine scope.** |
| V6 | Initial release-tail omissions: no thumbnail candidate and L17 unreviewed at first honest compliance run. | Release-blocking | The 20-Jul run was FAIL 4/6; the 21-Jul private upload reports compliance 6/6. [E28], [E29] | **Closed for Poyais; not recut doctrine scope.** |

## Minimal fix set to retain through a Poyais-end restoration

1. **Cadence / no stretch-to-fill:** retain runtime coverage plus a real long-hold justification (progressive reveal, legibility, or gravity); use the 2--5s new-plan starting band only as P1's direct cure. [E3]
2. **Semantic-audio fresh-eyes pass:** test uncovered meaningful landings and over-cueing by role, with no SFX-per-minute quota. [E4]
3. **Validated sparse delivery markers + dry-run/seam ear review:** retain only the six sentence-leading markers, validation, and human ear gate. [E5]
4. **Idea viability gate:** accountable stake/question; cold-open/title promise; mechanism/escalation/relevance; named differentiation; research may reject the promise. [E7]
5. **Story-preserving leash workflow:** causal-turn planning, local fact correction that preserves rhythm, and raw-versus-leashed review. [E6]
6. **Whole-video human engagement gate:** require the human decision after an assembled calibration render; do not replace it with a score. [E8], [E9]
7. **Pre-render image-review state gate:** review DAG artifact; only verified frames ship; `parked` is honest and non-shippable; layered shots cannot bypass verification. [E12], [E14], [E15]
8. **Supplied-text and lettering-fidelity HARD lint:** bind requested text to a literal; re-quote carried literals; run one checker on VPW and motion prompts. [E17], [E18]
9. **Content-triggered RIG-HOLD:** figure depiction, not only character seed path, triggers rig constraints. [E19]
10. **Fail-closed period anchor selection:** period-tag anchors and reject foreign-period fallback. [E20]

## Evidence index

- **[E1]** `5d214716` — `docs/handoffs/2026-07-21-engagement-overhaul-handoff.md`, Daniel's binding feedback and six-axis table.
- **[E2]** `cb37cb62` — `docs/handoffs/2026-07-22-poyais-engagement-overhaul-codex-resume.md`, recovered gap measurement: 90.6% dead frames, SFX 2--5x under, macro-flat VO, humour written not sold.
- **[E3]** `82435535` — VPW/motion cadence, hold, layer, and restrained-camera implementation.
- **[E4]** `c0f064ce` — audio-director semantic-coverage critic and no-rate doctrine.
- **[E5]** `6dd5dfa1` — expressive delivery contract, validation, dry-run, and seam review.
- **[E6]** `c59d89c1` — long-form causal planning, fact-leash preservation, and fourth critic.
- **[E7]** `c59d89c1` — idea-generator/researcher viability gate and verification.
- **[E8]** `529a04ce` — final integration handoff: reviewed implementation and 109 targeted / 411 broad tests.
- **[E9]** `529a04ce` — same handoff's explicit untried Poyais calibration sequence.
- **[E10]** `f0c73cb7` — `docs/2026-07-20-fyt-run-001-HANDOFF.md`: 0/119 clean, 36 BLOCKING, Poyais comparison, structural work owed.
- **[E11]** `77f9f962` — first full batched review: fabricated text, unseeded rig failures, inert gate.
- **[E12]** `a17892c8` — image review made a real DAG node.
- **[E13]** `354c6f9d` — human-gated executable video-run DAG.
- **[E14]** `df0c18ef` — representable, non-shippable parked review state.
- **[E15]** `91220a86` — layered shots no longer bypass verification.
- **[E16]** `ccc6880f`, `aa4b273e`, `8f192950` — July-30 false-pass/merge/lint closures.
- **[E17]** `fc034820` — supplied-text HARD lint and mutation evidence.
- **[E18]** `57010f68` — lettering-fidelity law and Poyais text-review coverage finding.
- **[E19]** `6460ff3e` — content-derived RIG-HOLD root repair and regression test.
- **[E20]** `087ed196` — period-tagged anchor selector and zero-Poyais-anchor proof.
- **[E21]** Poyais `_r6-fix-plan-2026-07-17.md` and `_r7-fix-plan-2026-07-17.md`.
- **[E22]** Poyais `_watch-through-5-notes-2026-07-17.md` and `_r10-fix-plan-2026-07-18.md`.
- **[E23]** Poyais `_watch-through-3-notes-2026-07-17.md` and `_r8-fix-plan-2026-07-17.md`.
- **[E24]** Poyais `_watch-through-4-notes-2026-07-17.md` and `_r9-fix-plan-2026-07-17.md`.
- **[E25]** Poyais `_r10-fix-plan-2026-07-18.md`, WS-M.
- **[E26]** `c056d67e` and `e824965c` — R11 measured-silence repair and verifier.
- **[E27]** `a4f48770` and `09f9c6b1` — R12 measured-onset cut placement proof.
- **[E28]** `fa104c60` — Poyais `run-report.md`, initial compliance FAIL 4/6.
- **[E29]** `68d1eec7` — first private upload after compliance 6/6.
