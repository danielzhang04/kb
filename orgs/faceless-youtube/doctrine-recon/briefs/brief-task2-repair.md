# Repair brief — Variant D Task 2b: author disposition of the independent critic's findings

You are the A1 author's repair pass (ONE round, per plan). No sub-agents, no synthesis skill. Budget 30 minutes. Do NOT commit or touch git state.

Repo clone: `C:/Users/danie/kb-clones/bricks-arc`, branch `claude/bricks-variant-vd`. `V` = `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`.
Inputs: the critic's findings `V/scratchpad/vpw-var/critic-vd-A1-findings.md` (13, verdict ship-with-edits); the authoring record `V/scratchpad/vpw-var/plan-vd.md` (decisions, no-growth table, payload rulings); the file `V/shots.json` (45-shot A1 fragment); doctrine as it stands on this branch (VPW SKILL.md, shots-schema.md, critics.md, visual-grammar.md, style-bible.md, registry.json); vb's same-id prompts for the no-growth ceiling: `git show claude/bricks-variant-vb:V/shots.json`.

Binding rules: apply the D criteria (who acts; hold-camera + one visible change; per-stage field+basis; crowds bounded beyond something with near zone empty; closed-world poses/expressions — snap to registry tokens or elevate via `needed_assets`, never invent; colour only with a cause); **per shot authored words ≤ vb same-id** (re-author until ≤0); no rig recitation; no mojibake.

Do, in order:
1. For each of the 13 findings write a disposition row in `plan-vd.md` under "Author disposition": accept-and-fix / accept-and-elevate (`needed_assets`) / reject-with-reason. Findings 1 (unregistered identities `rival-pc`, `drive-maker`, `terry-johnson`, `ibm-suit`, `line-worker`): check `registry.json` on this branch; if absent, do NOT invent — add `needed_assets` entries per the schema and leave the tokens (this is the same canonical gap vb carried; note it). Finding 10 (prose acting): resolve each pose/expression to an existing registry pose/expression token where one exists; otherwise elevate. Findings 3 and 12 (L12 internal drive; L13→L14 missed hold): apply the criteria and fix. Finding 13 (L01 hook): fix within the word ceiling. Findings 2, 4–9, 11: fix or reject with the criterion cited.
2. Update the touched shots in `V/shots.json` and mirror them into `V/scratchpad/vpw-var/fragment-A1-vd.json`; update the no-growth table rows and payload rulings for every changed shot (all must remain ≤0 vs vb same-id).
3. Lint: `py -3 lint_shots.py "<abs path to V>/shots.json" --write --fragment` from `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/scripts` → 0 HARD required; paste the summary lines (fragment scope, HARD count, heads-up count) into `plan-vd.md`.
4. `py -3 -m json.tool V/shots.json > nul` and a mojibake sweep (`rg -n "Ã|Â|â€" V/shots.json V/scratchpad/vpw-var/plan-vd.md`).

Final message ≤10 lines: per-finding disposition summary (accepted/elevated/rejected counts + which), shots changed, `needed_assets` added, lint result, max no-growth delta after repair.
