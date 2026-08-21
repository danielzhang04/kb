# Variant D Task 1 adversarial review

## Verdict

PENDING — review in progress.

## Findings

| id | severity | file:line | claim | evidence | required fix |
| --- | --- | --- | --- | --- | --- |
| F2 | HIGH | `.claude/skills/image-generation/SKILL.md:83` | Pair/cast transport is internally contradictory and old authoritative-`cast` speakers remain. | Lines 83–86 say “Derive the character table from `cast`” and call it “the authoritative figure list”; 118–119 say “`cast` names each figure”; 160–170 and technique (b) describe cast refs as scene seeds. These conflict with lines 215–220, schema 171–177, and Forge’s token-derived `shot_cast`. Schema 214 and grammar 86–95 also still say `cast` drives locking/seeding. | Replace every remaining speaker with prompt-token transport and make any retained `cast` use explicitly descriptive/review-only; extend the sweep/tests beyond the exact phrase `cast is authoritative`. |
| F1 | LOW | `.claude/skills/image-generation/scripts/test_forge_place_and_gates.py:517` | The seedless-crowd regression does not make the plan-required `figures.crowd` assertion and adds a duplicate instead. | The two added assertions are both satisfied by the pre-existing error text `crowd \`crowd-exemplar\``; neither checks the requested structured trigger wording. | Replace the duplicate with a meaningful assertion that proves the structured crowd request selected this gate, or revise the plan expectation explicitly. |

## Leftover speakers

Old cast authority remains at IG SKILL 83–86/118–119/160–170/227, shots-schema 214, and visual-grammar 86–95. The plan’s literal stale-phrase sweep misses these paraphrases.

## Per-file slimness

| file | net lines | judgment |
| --- | ---: | --- |

## Measured results

`python scripts/preamble.py` → `PREAMBLE OK`; branch is `claude/bricks-variant-vd`.

## What survives

Pending.
