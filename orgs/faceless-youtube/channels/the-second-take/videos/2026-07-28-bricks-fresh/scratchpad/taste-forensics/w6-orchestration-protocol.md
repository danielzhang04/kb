# W6 — image-generation orchestration protocol (DRAFT)

Status: protocol draft, 2026-08-13. It seeds a later image-gen agent; it authorizes no build, API call, spend, stamp, or promotion.

Normative terms: **MUST**, **MUST NOT**, **STOP**.

- `forge.py` = `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`
- `SKILL.md` = `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md`
- `style-bible.md` = `orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md`
- `task-15-report.md` = `.superpowers/sdd/2026-08-11-bricks-taste-forensics/task-15-report.md`

## 0. Invariants

1. `shots.json` is authored upstream. Image generation resolves and tags it; it does not plan or improvise shots (`SKILL.md:3,504-507`).
2. The image-generation skill and the channel `style-bible.md` are injected into every worker brief. Inheritance is never assumed (`knowledge/operating-law.md:3-12`).
3. Forge is the only slate builder and provider-call path. `forge.py batch` + `gen --dry-run` precede spend (`SKILL.md:188-208`; `forge.py:3112-3115`).
4. Every assignment names exact inputs, seed roles, digests, and output slots. A worker never chooses an alternate reference or output name.
5. A named figure is seeded; a genuine mass is declared crowd. There is no anonymous foreground tier (`style-bible.md:31-38`; `SKILL.md:177-186`).
6. Generation workers never review themselves, stamp, register, promote, edit manifests, or edit the review store (`SKILL.md:409-411,442-460`).
7. Spend requires a human-approved plan and hard stop (`knowledge/operating-law.md:67-75`).
8. **Spend rate (corrected 2026-08-14):** the engine `gemini-3-pro-image` bills **$0.134 per 1K/2K output image** (+ input tokens, ~$0.01/gen on multi-seed payloads; no free tier). Every plan, `--rate-usd`, cap check, and ledger row MUST use $0.134/gen minimum. The $0.039/gen figure used by genlogs before 2026-08-14 was the gemini-2.5-flash-image rate carried over in error; those ledger rows were corrected on ops 2026-08-14. Empirical all-in average from the 2026-07-30 priced wave: ~$0.17/gen. Batch API (async, 24h window) bills $0.067/gen — same model; use it only under an explicit human ruling.

## 1. Wave law

### W0 — derive and preflight ($0)

- Read `shots.json`, style bible, visual grammar, registry, video library manifest, current review store, and approved prior-wave manifests.
- Derive the asset/card/scene plan by the recipes in §3.
- Build the canonical slate with Forge; dry-run every assigned item.
- Present asset list, wave partitions, request count, resolution/rate, maximum attempts, and hard spend ceiling.
- Any missing/vetoed asset, stale digest, review refusal, cross-place seed, duplicate output, or unsatisfied parent: **STOP at $0**.

### W1 — asset base → verification → human gate

Scope: recurring named cast canonicals, video crowd exemplar, approved place plates, recurring props, and every pose/expression/action/interaction primitive needed by the file.

Order:

1. Reuse before regenerate; reused pixels still require an all-pass, digest-current record (`SKILL.md:78-85`).
2. Build/verify the base canonical before fan-out (`SKILL.md:84-107`).
3. Mint only assets approved at the pre-gen gate. A veto returns the beat to VPW; it is never improvised in a scene (`SKILL.md:74-77`).
4. Plates/crowd/one-off props remain video-local anchors, not portable cross-video canonicals (`SKILL.md:27-35,52-70`; `style-bible.md:189-200`).
5. Run the verifier pair (§4), single-writer stamp/promote (§4), then present the full W1 board to the human.
6. No W2 dispatch until the human records W1 approval. Named cast canonicals minted by the standard cast wave retain the skill's narrow G2 exemption; every other seed used with them still needs its own ruling (`SKILL.md:71-73`).

### W2 — all STEP-1 seed cards → verification → human gate

- Derive the complete fresh-scene card set from the locked file: character × selected pose × selected expression × derived-clause digest (§3.2).
- Each card is minted from its exact W1-approved canonical/primitive recipe, in isolation, with its hard `_staging/fig-...png` slot. A card is never hand-minted with ad-hoc seed roles (`SKILL.md:263-281,395-400`).
- Generate cards in parallel partitions; deduplicate only exact card names.
- Run the verifier pair, stamp passing card records, and present all cards on one gate board.
- No W3 dispatch until the human records W2 approval.

### W3+ — scenes from approved seeds only

- A wave contains only the current dependency frontier: every canonical/card/plate/prop/primitive and every scene parent is already approved, digest-current, and, for scene parents, promoted.
- Fresh scene: STEP-1 figure card(s) first, then its own approved place/continuity seed. Delta: in-chain parent first, then held canonicals; raw primitives only through a proved `delta_primitives` declaration (`SKILL.md:122-140,263-281`).
- A stage chain has one worker owner for all waves. Its base and deltas never interleave across agents. One base + at most two deltas; deeper work re-bases or hard-cuts (`SKILL.md:246-261`).
- If a current wave creates a parent, its child waits for the next verified/stamped wave. Forge's review gate requires this dependency layering (`forge.py:1268-1282`).
- Generation completes for the whole wave before review. Review/fix completes before the next wave (`SKILL.md:323-335`).

### Verifier-pair chain per wave

The pair is **one combined fresh-eyes pass**, split by disjoint axes; it is not two duplicate reviews and not a three-agent fan-out.

- Verifier A: identity/rig, count, canonical match, costume, proportion, hands/head/face, held-set continuity, expression register.
- Verifier B: fidelity to `still_prompt` + full `vo_text`, place/seed routing, style/taste, flat-cel and line register, crowd bounds, and DSG-lite for lettering.
- Both receive the same board and immutable evidence but no generator transcript or self-verdict.
- Merge is strict: any fail on any applicable invariant fails/parks the frame. Coverage MUST prove every applicable row and end with `N/N covered` (`SKILL.md:337-378,402-426`).
- This instantiates the proven disjoint Sonnet pair (`g4-genlog.md:79-103`) while preserving the skill's single-pass law (`SKILL.md:342-346`).

### Stamp/promote law

Only the orchestrator writes verdicts and performs register/promotion. Generation and review workers cannot hold this capability. `stamp_review.py` remains the only verdict writer (`SKILL.md:376-378,448-460`).

## 2. Dispatch contract

### 2.1 Generator receives

One immutable `image-gen-worker-dispatch@1` envelope:

```json
{
  "schema": "image-gen-worker-dispatch@1",
  "run_id": "...",
  "wave_id": "W03",
  "worker_id": "w01",
  "model_role": "gen-worker-sonnet",
  "worktree": "C:/absolute/worktree",
  "video_dir": "orgs/.../videos/<slug>",
  "kit_dir": "orgs/.../visual-kit",
  "shots": {"path": ".../shots.json", "sha256": "..."},
  "worker_spec": {"path": "...W03.w01.spec.json", "sha256": "..."},
  "review_store_sha256": "...",
  "assignments": [{
    "item_ordinal": 1,
    "shot_id": "L01",
    "card_id": null,
    "chain_id": "place/stage",
    "dependency_depth": 0,
    "output_name": "L01",
    "staging_slot": "<kit>/_staging/L01.png",
    "promotion_slot": "<video>/assets/scenes/L01.png",
    "references": [{"role": "figure|canonical|pose|expression|place|crowd|prop|style-anchor", "path": "C:/absolute/file.png", "sha256": "..."}]
  }],
  "laws": {
    "skill": {"path": ".../image-generation/SKILL.md", "sha256": "...", "sections": ["Pass 1", "Pass 2", "Reviewing the run"]},
    "style_bible": {"path": ".../style-bible.md", "sha256": "...", "sections": ["1", "2-2d", "3", "5", "6"]},
    "operating_law": {"path": ".../operating-law.md", "sha256": "...", "sections": ["D", "F", "H"]}
  },
  "limits": {"concurrency": 2, "stall_seconds": 240, "stall_reissues": 1, "budget_usd": 0.0, "max_provider_attempts": 0},
  "prohibitions": ["no-improvisation", "no-force", "no-stamp", "no-promote", "no-manifest-edit", "no-review-store-write", "no-shots-edit"]
}
```

Contract rules:

- `assignments` is exhaustive. The worker generates no unlisted item.
- Reference paths and roles are exactly the final provider parts, in order; Forge rechecks them (`SKILL.md:125-140`).
- Each input digest is checked immediately before the provider read. Mismatch is a zero-spend integrity halt (`SKILL.md:212-240`).
- Aspect and image size are explicit per item; scene default is 1K unless the human approved another spend tier (`SKILL.md:150-161`).
- The brief embeds the governing clauses; a path-only pointer is insufficient under the reach law (`knowledge/operating-law.md:6-12`).

### 2.2 Generator returns

The exact `image-gen-worker-result@1` object defined in `w6-harness-design.md §4.3`, including:

- run/wave/worker ids and input/review-store digests;
- per-item hard slots and exact reference paths/digests;
- every provider attempt, elapsed time, outcome, and billing estimate;
- final status and staged PNG digest;
- `suspected_mechanism_layer` when exhausted;
- item and worker `deviation_flags`;
- worker-local JSONL `genlog_segment` path.

Missing fields, unassigned output, wrong slot, unexpected reference, duplicate output, changed store, or non-empty deviation flag prevents review/promotion. Workers never return prose-only success.

### 2.3 Role/model tiers (draft default)

| Role | Tier | Authority |
|---|---|---|
| Orchestrator | Opus / current top reasoning tier | Derive plan, partition, allocate budget, merge, dispatch verifiers, single-write stamp/promote, present gates. No image-provider call. |
| Generation worker | Sonnet / standard production tier + `image-generation` skill | Execute exact Forge spec only. Image provider is fixed `gemini-3-pro-image`; the skill has no provider tiers (`SKILL.md:8-12`). |
| Verifier A | Fresh Sonnet | Disjoint A axes only; no generation/stamp. |
| Verifier B | Fresh Sonnet | Disjoint B axes only; no generation/stamp. |
| Build/preflight/merge/board/stamp | Deterministic tools, no model | Mechanical checks and single writes. |
| Human | Daniel | Spend, W1/W2 visual gates, taste, exceptions, final approval. |

Sonnet is grounded by the existing per-act review plan and disjoint verifier run (`../wave-plan.md:159-175`; `g4-genlog.md:79-103`). Opus/top-tier orchestration is a proposed risk allocation and requires the boss ruling in §5.

## 3. Derivation recipes

### 3.1 `shots.json` → cast/asset list

Authoritative execution is Forge/skill resolution; this recipe describes its deterministic result.

1. Walk `long_form.shots`, then each short's `first_frame` and `shots[]`; handle thumbnail candidates separately (`forge.py:1551-1564`; `SKILL.md:41-44`).
2. Keep `source: ai-gen|hybrid`; record other sources as skipped (`SKILL.md:163-165`; `forge.py:2088-2095`).
3. Extract backticked vocabulary in authoring order. Resolve against channel registry union video library; never registry alone (`forge.py:463-526`).
4. Named character → one cast row even for one shot. Group, recurring prop, place plate, environment reference, crowd exemplar, one-off prop, and every named primitive → asset rows under the Pass-1 rules (`SKILL.md:41-73`).
5. Reject bare `base` as cast. `figures.crowd: true` adds the video crowd exemplar, falling back to the channel exemplar only when the video has none (`forge.py:2076-2086`).
6. For each row emit `{name, kind, first_reach, shot_ids, satisfying_path, sha256, source: reused|missing, review_status}`.
7. Present every missing row at the pre-gen human gate. Approved rows proceed; vetoed rows route to VPW. No silent substitute.
8. After W1, write per-shot `assets` tags through the owning workflow. Pass 2 reads tags only and never re-resolves prose (`SKILL.md:113-118`).

### 3.2 `shots.json` → STEP-1 card list

1. Run the sanctioned full Forge batch at $0 and select its `name` values beginning `fig-`; do not hand-author the list (`forge.py:2011-2018,2205-2238`).
2. For each **fresh/non-delta** named figure, bind pose/expression primitives to the most recently named character in authored order (`forge.py:506-526`). Select at most one pose and one expression under the Forge recipe.
3. Derive the beat clause from the opening sentence plus the sentence(s) naming that character; strip backticked control tokens and quoted literals (`forge.py:529-562`).
4. Name the card exactly:

```text
fig-<character>[--<pose>][--<expression>][--sha256(derived-clause)[0:8]]
```

This key is `(character, pose, expression, authored-clause digest)`; only an exact match is reusable (`forge.py:607-622`).

5. Card references are the exact approved character canonical + chosen pose + chosen expression, with ordered roles and digests. Output slot is exactly `<kit>/_staging/<card-name>.png`.
6. Deduplicate exact names and aggregate owner shots. Different clause digests remain different cards.
7. Delta shots do not mint cards: they use parent + held canonicals, with any proved primitive reclaimed only via `delta_primitives` (`SKILL.md:263-281`).
8. Emit `{card_id, character, pose, expression, clause_sha256, owner_shots, references, staging_slot, review_status}`.

### 3.3 `shots.json` → partition plan

1. Freeze the full Forge spec and digest.
2. Build edges from each item to any generated seed it consumes; copy Forge `parent_depth` and `lineage`, never infer them by eye (`SKILL.md:287-297`).
3. Collapse each stage base + deltas into one sticky ownership component.
4. Mark current-ready nodes only when every external seed has a passing current digest and every scene parent is from an earlier promoted wave.
5. Sort components by descending request count, then canonical shot order/id; greedily assign whole components to the lightest of `K=2` workers, tie to lower id.
6. Validate: unique output/staging/promotion slots; one owner per node; one owner per delta chain; no cross-place seed; no current-wave parent edge; no worker budget or global hard-stop overflow.
7. Emit `<run>.<wave>.plan.json` plus per-worker ordered subset specs and digests.

Detailed collision/failure/accounting rules are normative in `w6-harness-design.md §§1-5`.

## 4. Post-return protocol

Execute in order. A failed step stops advancement.

1. **Receive.** Validate every `image-gen-worker-result@1`; reconcile assigned count, output slots, reference digests, attempt log, staged file existence/PNG validity/digest, spend lease, and deviation flags. Re-hash the review store. Merge worker result/log files deterministically.
2. **Classify transport.** `HALT-BILLING`, budget, integrity, or collision halts the wave. Park exhausted stall/503/mechanical items; never replace their seed or prompt. The 429 free-tier `limit: 0` condition is a global billing halt (`task-15-report.md:42-73`; `tranche-genlog.md:87-116`).
3. **Build review board.** Run `build_review_artifact.py --video <video> --out <board> --staging <kit>/_staging [--assets ...]`. The builder creates the machine-owned verdict skeleton; a non-empty `--assets` list is exact scope (`SKILL.md:348-372`).
4. **Verify pair.** Dispatch fresh Verifier A/B with disjoint axes and immutable board evidence. Require all applicable rows and `N/N covered` for each assigned surface. Merge strictest; generator observations are deviation flags, never verdicts.
5. **Retry once where authorized.** A content defect gets one Forge-built `forge-retry-overlay@2`: exact single-span replacement or legal seed/mechanism swap, fresh output name, all other bytes held. STEP-1 expression/pose/rig defects remint the card recipe. No prompt accretion, no second content retry (`SKILL.md:210-240,425-447`). Return retries to a fresh verifier pass; no agent clears its own park.
6. **Stamp assets — orchestrator only.** Fill the asset-verdict skeleton, then run `stamp_review.py --figures <verdicts> <kit>/_staging`. Any fail remains a fail; records are digest-bound and strictest wins (`SKILL.md:376-400`). This closes the seed gate before a later wave.
7. **Promote assets — orchestrator only.** For channel assets, `register` first, then copy into the video library; video-local assets go directly to the library. Only verified pixels move. Preserve identical bytes/digest (`SKILL.md:105-114`).
8. **Promote scenes and emit manifest — orchestrator only.** Materialize exact staged survivors to their hard `assets/scenes/<shot-id>.png` slots. Emit the scene manifest through `forge.py manifest --kind scenes --from-batch ...` so parent depth/lineage come from the spec (`SKILL.md:287-297`).
9. **Stamp scenes — orchestrator only.** Merge structured scene rulings into `assets/_review/merged.json`; run `stamp_review.py <video>`. Only fully clean rows become `verified`; any defect becomes `parked`; uncovered remains `unreviewed` (`SKILL.md:448-460`).
10. **Human wave gate.** For W1/W2, present the review board and weaknesses first; record explicit approval/veto before unlocking the next wave. For W3+, complete the act-batch gate before the next act batch.
11. **Build presentation board.** Rebuild the shot board from promoted, stamped files. Show full frames at ordinary viewing scale; mark parked/flagged reasons and include coverage lines. Human reviews images as an Artifact (`SKILL.md:490-502`; `knowledge/operating-law.md:185-197`).
12. **Advance.** Recompute the approved dependency frontier from current digests. Never carry a path merely because it existed before the gate.

## 5. Boss rulings required before this becomes agent law

1. Ratify role tiers: top-tier orchestrator; Sonnet generation workers; two fresh Sonnet verifiers on disjoint axes.
2. Ratify whether the verifier pair is mandatory for every wave or only W1/W2 + act-batch scene waves. Recommendation: every paid wave, because it is collectively one fresh-eyes pass.
3. Ratify initial concurrency `K=2` and the evidence threshold for any 3/4-worker probe.
4. Ratify first qualifying 429 as a global billing halt.
5. Choose whether W1 human approval is one combined asset-base board or separate cast / plates-props sub-gates; recommendation: one board with class sections, one recorded ruling.
