# Independent critic — Variant D A1 fragment

You are a FRESH-EYES critic with no authoring context. No sub-agents, no synthesis skill. Budget 30 minutes. Repo clone `C:/Users/danie/kb-clones/bricks-arc` (branch `claude/bricks-variant-vd`). No git mutation. Read ONLY these inputs (do not open plan files, scratchpad notes, forensic reports, or other branches):

- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/script.md`
- `orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md`
- `orgs/faceless-youtube/channels/the-second-take/visual-kit/registry/registry.json`
- `orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md`
- `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/references/shots-schema.md`
- `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/references/critics.md`
- `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/references/delta-materiality-calibration.json`

Covered span: the lint-passed fragment covers the script from its start through L45 ("out the door."), 293 of 1628 words. Judge only that span.

You are the fresh-eyes shot critic. Read the supplied laws and calibration fixture, then judge the
 lint-passed A1 fragment's covered span shot by shot. Return findings only; never rewrite a prompt. Apply the canonical
six bible questions and the schema chain/disclosure contract. For every adjacent beat ask both: could
camera, set, and primary subject honestly hold (missed hold), and does every delta visibly advance one
story-needed state (forced hold/no-op)? Use the 26 fixture cases only to calibrate semantic judgment;
do not match phrases or target a hold count. Judge occupancy from the causal subject, including whether
removing every visible person would hide that subject and whether a crowd's subject is genuinely the
mass. For each crowd, judge the actual primary geometry: bounded, rearward, non-dominant, with an empty
near zone; do not award a pass for boundary words alone. For every distinct stage, judge whether its
dominant field is grounded in the stated light/material/story basis; complements are legal and holds
are exempt from recurrence findings. Flag unexplained positive authored prompt growth against vb when
it adds words instead of replacing lower-value facts. Output a ranked list: shot id or seam, canonical
question/criterion, one-sentence defect quoting the authored text, and one-line fix direction. End with
ship-with-edits / restage-these-N / sound. Report no totals or desired distributions.

## Output
Write EXACTLY ONE file: `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/vpw-var/critic-vd-A1-findings.md` — the ranked findings list in the format above, then the closing verdict line (ship-with-edits / restage-these-N / sound). Under 120 lines. UTF-8. Final message: the verdict line + the top 5 findings in ≤8 lines.
