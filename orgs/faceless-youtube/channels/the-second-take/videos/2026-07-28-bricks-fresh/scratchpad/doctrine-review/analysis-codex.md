# Bricks doctrine text forensics

## Scope, baseline, and method

- **Pinned pre-reset baseline: `30d2b7e8b41afbbc9f7a01f4afd2f8abb3e573bb` (2026-08-04 20:02 EDT).** The archive file `assets/_archive-pre-reset/shots.pre-reset.json` (created 20:04) parses to exactly the same JSON object as that commit's `shots.json`: 214/214 shot objects and all top-level fields equal. This is stronger evidence than choosing the earlier `309b341b` full-image-run commit by subject line alone. `30d2b7e8` is the last exact, git-addressable text state behind the archived pre-reset package.
- **Window/current landmarks:** `d1f771a7` (2026-08-05, perspective/style “era restoration”), `ea71f99e` (2026-08-06, saturation wording), `27bc7e25` (2026-08-06, delta cap/figure-performance doctrine), `52b17ab2` (2026-08-06, doctrine window complete), `db0ffd14`/`3d2aea26` (2026-08-12 Phase-3 tier/plate revisions), and `eb901bb8` (2026-08-13, 246-shot full re-author). HEAD still has 246 shots; its later narrow edits do not change the reported categorical counts except two single-word occurrence totals noted below.
- Counts below are case-insensitive over `long_form.shots[].still_prompt`, except where explicitly labelled **whole shot object** or **field count**. “Shots” means unique shot ids containing the token; “occ.” means token occurrences. Qualified `wide-camera` means `wide shot/view/framing/composition`, `framed wide`, or `in wide`; raw `wide` is also reported so stance/width uses cannot be mistaken for camera language.

## 1. Era diff: `30d2b7e8` versus HEAD

### `visual-prompt-writer/SKILL.md`

| Axis | Pre-reset | HEAD | What changed / commit |
|---|---|---|---|
| Camera/composition | Required “framing + scale” plus depth as explicit fore/mid/background, filled edge-to-edge (`SKILL.md@30d2b7e8:83-89`). It also named the failure attractor: a long pass “settles into the centered eye-level medium” (`:111-116`). | Requires subject scale, stage-left/centre/stage-right, and layered depth “by overlap and scale” (`SKILL.md@HEAD:129-138`); the explicit centered-eye-level warning was replaced by generic “same nouns and same staging” (`:162-167`). | `d1f771a7` changed both passages. The current prompt template became more positional and less camera-directive; the strongest anti-flat warning disappeared.
| Figure routing/scale | Already used the two-tier named-cast-or-crowd model and said story-bearing foreground people cannot be removed merely to avoid a figure (`@30d2b7e8:68-75`, `:121-143`). | Adds a strong “figure bias”: bodies are mandatory by default on people/decision/action beats (`@HEAD:63-68`), and anonymous story-bearers must become existing/new named cast or mass action (`:96-104`, `:172-188`). | Figure bias landed in `b6f16b0d`, was strengthened to “performance, not population” in `27bc7e25`, and the present two-tier wording was consolidated by `db0ffd14`. This raises character incidence generally, but names no preferred reusable character and gives no license to reuse `pc-boxy` off-subject.
| Chain/continuity | Group consecutive shots on one set as one base + ≤3 deltas; each delta changes one feasible element and carries its parent state (`@30d2b7e8:95-107`, `:124-134`). | The same requirement survives, tightened to ≤2 deltas; figure entrances must be bases, not deltas (`@HEAD:148-158`). Recurring places and stage chains are planned separately (`:189-213`). | `27bc7e25` tightened ≤3→≤2. `52b17ab2` also made **departure** the default when staging is open (via grammar, below). No commit removed stage/delta authoring.

### `visual-prompt-writer/references/`

Only the two references changed: `references/shots-schema.md` and `references/critics.md`.

- **Schema:** pre-reset defined `stage`/`stage_role`/`changed_elements`, continuity through held stages, and ≤3 deltas (`shots-schema.md@30d2b7e8:20-25`, `:52-58`, `:77-78`). HEAD retains the fields, tightens to ≤2, adds `place`, `place_anchor`, `hard_cut`, parent feasibility, and an action-chain presence check (`shots-schema.md@HEAD:21-30`, `:57-73`, `:111-150`, `:165-168`, `:215-216`). This is more continuity machinery, not less.
- **Critic:** pre-reset delegated mechanical chain rules to lint and had no composition-distribution audit (`critics.md@30d2b7e8:76-82`). HEAD adds action-chain cause→effect review and makes “a long-form plan revisiting a setting with zero stage chains” a finding (`critics.md@HEAD:85-94`, `:106-119`). It still explicitly refuses to judge style choices such as palette/negative space (`:121-125`) and has no whole-plan camera/scale/temperature-collapse question. That omission matters: the 246-shot file can pass while repeating frontal staging and one palette family.

### `visual-kit/visual-grammar.md`

| Axis | Pre-reset | HEAD | What changed / commit |
|---|---|---|---|
| Camera and framing | Framing, scale **and angle** were payload-driven; centered eye-level medium was “fine once, deadly on repeat” (`visual-grammar.md@30d2b7e8:165-174`). Character reveals explicitly allowed “spotlight / low angle / arrival” (`:118-120`). | “The vantage is not a choice — it is the house eye-level frontal” (`visual-grammar.md@HEAD:256-264`). The reveal examples lost low angle and became “spotlight / scale / arrival” (`:145-147`). | `d1f771a7`, section 3 and the reveal bullet. This is the clearest doctrine-level cause of flat frontal staging.
| Figure subject choice | People versus objects had no global preference; choose the beat's subject (`@30d2b7e8:55-64`). | Adds figure bias, requiring concrete bodies for people/decision/action beats and explaining that the reset's first fifth went 29/41 figureless (`@HEAD:56-77`). | `b6f16b0d`, strengthened at lines 70-72 by `27bc7e25`. This can raise cast frequency but does not prescribe `pc-boxy`.
| Personified objects/institutions | Institutions **may** be personified or represented by landmark/building/letterhead/product as the beat requires (`@30d2b7e8:81-85`). | Same wording survives (`@HEAD:102-106`). | No net doctrine change. The class table also still offers symbolic object **or** personification (`@30d2b7e8:36-51`; `@HEAD:37-52`). The PC overuse is therefore not routed by this file.
| Chain/continuity | One base + ≤3 deltas, with parent-space feasibility (`@30d2b7e8:66-79`). | One base + ≤2 deltas, plus entrance-as-base and feasibility laws (`@HEAD:79-100`); when the beat is open, departure is the default (`:81-84`). | Cap tightened in `27bc7e25`; departure bias added in `52b17ab2`. The latter plausibly reduces chaining at ambiguous beats, although chain authoring remains mandatory when continuity is semantic.
| Figure scale | Named/crowd tiering and rear-zone crowd separation were already present (`@30d2b7e8:123-156`). | Phase 3 elaborates named-cast/crowd routing, caps named cast at two, and introduces plate variants/occupancy (`@HEAD:153-223`). | `27bc7e25`/`52b17ab2`, then `db0ffd14`/`3d2aea26`. These govern identity/seed geometry, not “make the lead large and centered”; the latter comes from authoring under the frontal-vantage rule.

### `visual-kit/style-bible.md`

| Axis | Pre-reset | HEAD | What changed / commit |
|---|---|---|---|
| Camera/depth | Environments: edge-to-edge with a **fore/mid/background depth read**, committed warm palette (`style-bible.md@30d2b7e8:127-138`). | Environments: depth by overlap and scale, **eye-level frontal**, committed warm palette (`style-bible.md@HEAD:161-173`). | `d1f771a7`, §5. The warm requirement survived; the depth/camera language changed materially.
| Palette/temperature | Scene palettes free per scene within the channel family; neutral-grey-only is not a palette; §5 requires a committed warm scene palette (`@30d2b7e8:114-125`, `:135-137`). | Those exact palette rules remain (`@HEAD:148-159`, `:169-171`). §2b now additionally says greys/neutrals may be tinted warm **or cool** and a cold scene should be cold-coloured, not greyscale (`:51-60`). | `ea71f99e` added the explicit cool/cold permission while fixing greyscale saturation; `d1f771a7` added a scene-style tile for cast-free gens, with saturation-only scope refined by `ea71f99e` (`@HEAD:174-177`). This permits cool beats but does not remove the committed-warm home register.
| Figure rules | Two tiers by identity: named/recurring seeded cast or crowd (`@30d2b7e8:9-28`). | Same two tiers, now explicitly forcing an anonymous foreground story-bearer into cast or mass action (`@HEAD:9-38`), plus resting-canonical law. | `db0ffd14` post-window consolidation. No rule requires a centered/large cast figure.
| Personified-object routing | §5 says personified institutions carry one identity tag (`@30d2b7e8:132-136`). | Same statement (`@HEAD:166-170`). | No change and no `pc-boxy`-specific routing.
| Chains | Style bible did not author chains; it supplied rig/look invariants. | Same responsibility split. | No causal change here.

**Era verdict.** The net doctrine diff contains one strong composition regression (`d1f771a7`: payload-driven angle → mandatory eye-level frontal), one weaker continuity pressure (`52b17ab2`: departure default), and an explicit license for saturated cool/cold scenes (`ea71f99e`) without deleting the warm home register. It contains no `pc-boxy` preference and no removal of chain fields or chain authoring.

## 2. Shot-list re-author diff: 214 pre-reset shots versus 246 HEAD shots

### Personified computer / personification

| Measure | `30d2b7e8` | HEAD (re-author origin `eb901bb8`) | Delta |
|---|---:|---:|---:|
| `pc-boxy` in `still_prompt` | 5 shots / 6 occ. (2.3%) — L01-L04, L16 | 10 / 10 (4.1%) — L01, L05-L07, L10-L12, L14, L16-L17 | **2.0× shots** |
| `shot_class: personified-character` | 13/214 (6.1%) | 25/246 (10.2%) | **+92% count** |
| `personif*` anywhere in whole shot object | 18 shots / 28 occ. | 34 / 39 | **+89% shots** |
| rival-computer variant | 0 | 1, L16 (`rival personified computer`) | +1 |

The old file explicitly fenced ordinary PCs away from `pc-boxy`: L01's notes say L05-L09 are “ORDINARY UNFACED PROPS, never `pc-boxy` copies” (`shots.json@30d2b7e8:22-29`). The current file has no equivalent routing distinction and spends ten prompts on the slug. This is an authoring/cast-plan change, not a grammar mandate.

### Camera/composition vocabulary

| Token/pattern in `still_prompt` | `30d2b7e8` shots / occ. | HEAD shots / occ. |
|---|---:|---:|
| low-angle | 1 / 1 | 0 / 0 |
| high-angle | 0 / 0 | 0 / 0 |
| over-shoulder | 0 / 0 | 0 / 0 |
| close-up | 0 / 0 | 0 / 0 |
| raw word `wide` | 96 / 103 | 22 / 22 |
| qualified camera-wide | **25 / 25** | **1 / 1** |
| `frontal*` | **0 / 0** | **36 / 36** |
| adjective `centered|centred` | 0 / 0 | 0 / 0 |
| positional center/centre (`centre frame`, `dead centre`, etc.) | 4 / 4 | 18 / 18 |
| `eye-level` | 31 / 31 | 2 / 2 |
| flat ground/backdrop/horizon | 0 | 30 |

The low-angle old example is the Wiles reveal (`shots.json@30d2b7e8:846-847`). Current prompts need not repeat `eye-level` because HEAD doctrine injects the house vantage globally; instead they repeat `frontal` and flat-ground constructions. The camera vocabulary therefore changes exactly in the direction predicted by `d1f771a7`: qualified wides fall 11.7%→0.4% while frontal rises 0%→14.6%.

The depth-word count is a false reassurance, not evidence against the regression:

| Depth/staging phrase | `30d2b7e8` | HEAD |
|---|---:|---:|
| any `foreground` | 68/214 (31.8%) | 202/246 (82.1%) |
| any `depth` | 66/214 (30.8%) | 203/246 (82.5%) |
| explicit fore→mid→background construction | 63/214 (29.4%) | 0/246 |
| exact tail `foreground depth from …` | 0/214 | **202/246 (82.1%)** |
| stage-left / stage-right | 16 / 19 | 106 / 100 |

The new file mechanically appends a cropped-foreground tail to 202 shots while eliminating the old three-plane construction. It also has 30 flat-ground/backdrop/horizon frames. Textually, this is templated positional staging, not authored deep composition; it is consistent with the human's report of shallow outputs without requiring pixel analysis.

### Chains, parents, and continuity

| Field/language measure | `30d2b7e8` | HEAD |
|---|---:|---:|
| shots with `stage` / `stage_role` | 140 / 140 | 114 / 114 |
| `base` / `delta` | 67 / **73** | 71 / **43** |
| `changed_elements` | 74 | 43 |
| explicit `parent`, `parent_id`, `source_scene`, or `continuity` field | 0 | 0 |
| `place` / `place_anchor` | 0 / 11 | 65 / 0 |
| shots saying `same` (prompt+notes) | 123 | 41 |
| `locked framing` | 72 | 0 |
| `only this changes` | 70 | 43 |
| `everything else exactly as established` | 72 | 43 |

Thus “the 246-shot list has none” is not literally true at the authored-schema layer: it has **43 deltas in 71 stage chains**. What did vanish is much of the old continuity density: deltas fell 73→43 despite the file growing 214→246, and held-scene language collapsed. `chain_parents_added.json` in `C:/Users/danie/kb/.../bricks-fresh/` is an execution artifact, not a `shots.json` field; it lists 16 old parent ids. Of those, ten still directly parented the next delta in the exact 214-shot archive state, one (L27) had already been deleted, and only L116/L190 are direct next-delta parents at HEAD. Neither JSON version has an explicit parent field because Forge derives the parent from stage/file order (`shots-schema.md@HEAD:122-137`).

### Palette / temperature vocabulary

| Token in `still_prompt` | `30d2b7e8` shots (rate) | HEAD shots (rate) |
|---|---:|---:|
| warm | 56 (26.2%) | 43 (17.5%) |
| amber | 43 (20.1%) | 25 (10.2%) |
| cool | 27 (12.6%) | 35 (14.2%) |
| cold | 36 (16.8%) | 32 (13.0%) |
| teal | **2 (0.9%)** | **128 (52.0%)** |
| charcoal | **14 (6.5%)** | **118 (48.0%)** |
| cream | **33 (15.4%)** | **234 (95.1%)** |
| grey/gray | 87 (40.7%) | 88 (35.8%) |
| brown | 32 (15.0%) | 19 (7.7%) |
| orange | 5 (2.3%) | 1 (0.4%) |

Co-occurrence is more diagnostic than any single temperature adjective: **cream+teal+charcoal occurs in 0/214 old prompts and 56/246 current prompts (22.8%)**; cream+teal occurs in 122 (49.6%), cream+charcoal in 115 (46.7%). Warm+amber falls from 18/214 (8.4%) to 14/246 (5.7%). Examples of the repeated current construction occur throughout HEAD (`cream-teal-charcoal palette`, e.g. `shots.json@HEAD:1397-1480`, `:2367-2906`). This is an authored palette template, not an inference from pixels.

## 3. Cause attribution

| Regression | Attribution | Evidence and causal confidence |
|---|---|---|
| Too cool / muddy | **Primarily re-author choice; weak doctrine permission, not a removed warmth rule.** | The warm-environment rule is byte-equivalent in substance before/current (`style-bible.md@30d2b7e8:135-137`; `@HEAD:169-171`). `ea71f99e`, §2b, explicitly legitimized warm **or cool** neutrals/cold-coloured scenes (`@HEAD:53-57`) while fixing greyscale saturation, so it plausibly widened the door. But the magnitude — teal 2→128, charcoal 14→118, cream 33→234 and a 56-shot cream/teal/charcoal template — comes from `eb901bb8`'s prose. The critic has no palette-distribution check and refuses style-policing (`critics.md@HEAD:121-125`), so it did not catch the authoring reflex.
| `pc-boxy` far too frequent | **Re-author/cast-plan choice; no specific doctrine cause.** | `visual-grammar.md` offered the same institution alternatives before and now (`@30d2b7e8:83-85`; `@HEAD:104-106`), and style-bible's one-tag personification sentence is unchanged. `b6f16b0d`/`27bc7e25` figure bias can explain more bodies/personified-class shots generally, but not selecting this PC. `eb901bb8` doubled `pc-boxy` prompts 5→10 and nearly doubled `personified-character` class count 13→25 despite the old file's explicit ordinary-PC fence (`shots.json@30d2b7e8:22-29`).
| Delta chains vanished | **Premise partly false; density loss is re-author choice, with modest pressure from `27bc7e25` and `52b17ab2`.** | HEAD has 43 deltas, not zero. `27bc7e25` tightened ≤3→≤2 (`visual-grammar.md@HEAD:79-80`; `SKILL.md@HEAD:148-154`), and `52b17ab2` added departure-as-default (`visual-grammar.md@HEAD:81-84`), both of which can reduce chains. But current SKILL/schema/critic still require and audit them (`SKILL.md@HEAD:148-154`; `shots-schema.md@HEAD:122-137`; `critics.md@HEAD:85-94`, `:117-119`). The drop 73→43 is therefore mostly `eb901bb8` authoring, not doctrinal deletion.
| Flat frontal, large/centered figures, shallow depth | **Direct doctrine cause: `d1f771a7`, plus templated re-author execution.** | `d1f771a7` replaced payload-driven angle choice and the “centered eye-level medium … deadly on repeat” warning with mandatory house eye-level frontal (`visual-grammar.md@30d2b7e8:165-174` → `@HEAD:256-266`), removed “low angle” from reveal staging (`@30d2b7e8:118-120` → `@HEAD:145-147`), and changed style-bible depth from fore/mid/background to overlap/scale + frontal (`style-bible.md@30d2b7e8:135-137` → `@HEAD:169-171`). `eb901bb8` then operationalized that as 36 frontal prompts, 30 flat grounds, 202 identical cropped-foreground tails, and only one qualified wide. High confidence.

## 4. Parallelization audit

**Answer: no — safe parallel fan-out is not the default behavior encoded by either skill.** The current text has several compatible safety primitives, but specifies a serial act-batch workflow and never assembles them into a worker protocol.

What is already present:

- **Contiguous partitions and chain integrity:** image-generation Pass 2 uses contiguous act batches, requires every boundary to fall on a stage boundary, and never splits a held stage (`image-generation/SKILL.md@HEAD:323-335`). The technique table also defines delta parent order and ≤2-delta stages (`:246-255`). This satisfies the partition-shape requirement, but not disjoint parallel assignment.
- **Durable logs:** every generation round must log file, seeds/mode/delta, reason, verdict, and reproduction ID in manifests or a beside-frame lab log (`image-generation/SKILL.md@HEAD:14-20`). This is a run log, not a per-worker log contract.
- **Single-writer stamp safety:** generators never stamp; the orchestrator alone stamps after fresh-eyes review (`image-generation/SKILL.md@HEAD:442-460`). Asset-store writes replace only submitted ids and leave absent ids untouched (`:380-400`), and `--assets` can scope a board (`:364-372`). This prevents concurrent writers, but the scene stamp command is video-wide and no merge protocol scopes per-worker verdict/stamp payloads before the coordinator write.
- **VPW preserves chain semantics:** it plans stages before authoring and requires one base + deltas (`visual-prompt-writer/SKILL.md@HEAD:148-158`, `:189-213`). It authors in acts and re-reads before each (`:162-170`, `:237-247`).

Missing from DEFAULT behavior:

1. No coordinator instruction to split the eligible span into **disjoint** contiguous worker partitions and assign each exactly once.
2. No parallel-generation instruction at all; image-generation says generate/review/fix one batch before the next (`image-generation/SKILL.md@HEAD:325-335`), and VPW's act workflow is serial.
3. No per-worker manifest/log namespace or required worker completion record; only a shared run manifest/lab log is defined.
4. No coordinator merge rule proving union=target, intersections=empty, and every stage/chain wholly owned by one partition.
5. No worker-scoped scene-verdict input followed by one coordinator merge/stamp transaction. `--assets` scopes board construction, not the scene stamp.
6. No “poll running workers; never idle-wait while runnable work exists” instruction, timeout/escalation rule, or work-stealing/reassignment behavior.
7. No VPW fragment contract (central plan/cast/place map first, worker-owned contiguous act fragments, coordinator-only JSON merge/lint), so parallel VPW would currently risk duplicate ids, cross-partition chains, and divergent place/cast declarations.

## 5. Fix-list draft

1. `{file: channels/the-second-take/visual-kit/visual-grammar.md, section: "3. Composition defaults", kind: change, edit intent: "Replace the house eye-level/frontal default with the pre-reset payload-driven choice of framing, figure scale, and angle; use the existing examples space to restore the warning against repeating centered eye-level medium staging. Keep this a general composition decision, not a shot-type whitelist.", regression it fixes: "flat frontal, large-centered character shots", net line impact: "0 (replace in place)", blast radius: "Reopens composition decisions for future shots.json authoring; re-authoring current shots would invalidate only changed scene prompts/assets and their review stamps. Update any prose snapshot that pins the eye-level/frontal wording; no direct test was found."}`

2. `{file: channels/the-second-take/visual-kit/style-bible.md, section: "Environment scenes", kind: change, edit intent: "Replace the eye-level/frontal composition clause with the pre-reset fore/mid/background depth requirement, including overlap and scale as supporting devices rather than the whole recipe. Preserve the existing identity, texture, and committed-palette clauses.", regression it fixes: "flat staging and loss of deep diagonals/foreground anchors", net line impact: "-1", blast radius: "Changes future environment prompts and the review basis for current environment scenes; only re-authored/re-rendered scene assets and corresponding stamps are invalidated. Canonical cast/style references remain valid."}`

3. `{file: .claude/skills/visual-prompt-writer/SKILL.md, section: "Step 2.4 — Write the still prompt", kind: change, edit intent: "Replace the rote stage-left/centre/right plus terminal foreground-depth template with the earlier payload-driven framing/scale/angle instruction and a concrete three-plane spatial read. Require spatial specificity without prescribing one repeated sentence shape.", regression it fixes: "flat formulaic compositions despite high foreground/depth token counts", net line impact: "-2", blast radius: "Changes all future prompt authoring and requires re-lint/re-review of any re-authored shots.json; regenerated scene assets and their stamps change, while untouched canonical references do not."}`

4. `{file: channels/the-second-take/visual-kit/style-bible.md, section: "4. Palette", kind: change, edit intent: "Change the existing free warm/cool choice so temperature follows the beat while warm cream/amber remains the channel's home register and cool is a motivated contrast. Retain the ban on neutral-grey-only palettes and do not add numeric quotas.", regression it fixes: "cool/muddy palette drift", net line impact: "0 (replace in place)", blast radius: "Changes palette selection across future scenes and the review basis for the current 246-shot list; affected re-authored prompts, regenerated assets, and scene stamps are invalidated. Existing reference images need no remint unless separately rejected on color."}`

5. `{file: .claude/skills/visual-prompt-writer/references/critics.md, section: "Plan-level review", kind: change, edit intent: "Fold camera, figure-scale, depth-shape, and temperature repetition into the existing cadence/monotony review, judged against the visual kit and example shots. Replace equivalent prose rather than adding targets, caps, or vocabulary counters.", regression it fixes: "palette and composition template collapse escaping self-review", net line impact: "0 (replace in place)", blast radius: "Invalidates the prior whole-file critic verdict for a re-authored shots.json; only scenes the renewed review sends back for rewrite invalidate downstream assets/stamps. Critic fixtures or prose snapshots must follow the revised rubric."}`

6. `{file: .claude/skills/visual-prompt-writer/references/critics.md, section: "Semantic-cast critic / Q8", kind: change, edit intent: "Apply the existing semantic-belonging test equally to named people and personified objects: reuse a canonical only when that entity bears the beat, otherwise choose the environment, product, or anonymous story bearer already allowed by doctrine. This restores routing judgment without a pc-boxy-specific cap or whitelist.", regression it fixes: "personified PC overuse", net line impact: "0 (replace in place)", blast radius: "Invalidates semantic-cast approval for affected current shots and, if rewritten, their scene assets/stamps; the pc-boxy canonical asset and unaffected cast references remain valid. Update semantic-cast critic fixtures if present."}`

7. `{file: channels/the-second-take/visual-kit/visual-grammar.md, section: "1. Chain logic", kind: change, edit intent: "Replace the departure-as-default sentence with the earlier semantic rule: continue a chain when the causal beat or held set makes continuity do useful work; depart when the narration genuinely leaves it. Keep the existing feasibility and short-chain constraints rather than adding a chain quota.", regression it fixes: "loss of useful delta chains and parent continuity", net line impact: "-1", blast radius: "Changes stage planning, generation order, and continuity review for future lists; rebuilding affected stages invalidates their scene manifests/assets/stamps, not canonical references. Stage-contiguity lint remains applicable; prose expectations for departure default must change."}`

8. `{file: .claude/skills/image-generation/SKILL.md, section: "Reviewing a run — Pass 2", kind: change, edit intent: "Replace the serial batch loop with a default coordinator flow that assigns disjoint contiguous partitions, never splits a stage, polls completed workers instead of idly waiting, and reviews/fixes each returned partition while others run. Keep the current fresh-eyes and whole-stage constraints.", regression it fixes: "missing safe default parallel fan-out", net line impact: "0 (compress and replace existing loop prose)", blast radius: "Changes future run orchestration and run-log ordering, not existing image bytes. Update workflow/harness tests and docs that assume strictly serial batches; historical manifests and stamps remain valid."}`

9. `{file: .claude/skills/image-generation/SKILL.md, section: "Run logs, asset scope, and stamps", kind: change, edit intent: "Refactor the existing logging and stamp paragraphs so each worker writes a partition-scoped log/manifest, the coordinator verifies disjointness plus complete ordered coverage, and only the coordinator performs scoped stamp writes after merge. Preserve the current rule that generating workers never stamp.", regression it fixes: "missing per-worker provenance, merge safety, and scoped write protocol for parallel runs", net line impact: "-1", blast radius: "Changes future log/manifest shape and coordinator tests; migration is unnecessary for historical logs. No existing asset or stamp is invalidated unless a new merged manifest causes that asset to be regenerated or re-reviewed."}`

10. `{file: .claude/skills/visual-prompt-writer/SKILL.md, section: "Step 3 — Write act by act", kind: change, edit intent: "After the central cast/place/stage plan is locked, make disjoint contiguous act partitions the default authoring execution, keep every planned stage in one partition, and have the coordinator merge in narration order before one whole-file lint/critic pass. Reuse the existing act-by-act and critic prose budget.", regression it fixes: "VPW lacks safe default parallel authoring while preserving chains", net line impact: "0 (replace in place)", blast radius: "Changes future authoring workflow and fragment/log handling, not existing assets by itself. Update merge/lint workflow tests and docs; any resulting shots.json rewrite invalidates only the downstream assets/stamps for changed scenes."}`

**Net material line impact:** `-5` lines across the draft; no new files, variables, caps, whitelists, or case-specific routing rules.
