# Engagement overhaul integration review — 2026-07-22

## Review target

- Worktree: `C:\Users\danie\kb\_private\codex-worktrees\poyais-engagement-resume`
- Branch/head at audit start: `codex/poyais-engagement-resume` / `cb37cb6`
- Implementation base/head: `5c901947` / `6dd5dfa`
- Implementation commits: `5857709`, `8243553`, `8ea2f3d`, `c0f064c`, `c59d89c`, `6dd5dfa`
- Scope: 50 FYT files, 1,683 insertions, 311 deletions. The handoff-only `cb37cb6` adds no production logic.
- Explicit exclusions: no Poyais or Wells Fargo artifact regeneration, no paid TTS/image calls, no render,
  no publish, no queue-card transitions, and no ops cleanup.

## Requirement-to-implementation audit table

| Axis / design requirement | Owning change | Evidence to verify | Initial status |
| --- | --- | --- | --- |
| Stronger stake, angle, character, and content selection | `c59d89c` — idea-generator + researcher | Viability fields precede weighted ranking; verified/revised viability now canonically routes researcher → writer → metadata | MET |
| Tighter pacing and performed, fact-riding humor | `c59d89c` — writer, critics, grammar, rubric, lint | Facet-only exemplars; personable narrator; causal Steps only; localized fact leash; comedy off on human cost | MET |
| Macro voice dynamics and per-beat delivery without narrator drift | `6dd5dfa` — voiceover contract/runtime/tests | Exact marker whitelist and placement; v3 translation; v2 cleanup; planned chunks/settings; seam review; no paid-default change | MET |
| Faster stills-based visual life | `8243553` — VPW contract/lint/tests | New-video 2–5 second target, runtime/5 coverage, reason on holds over about six seconds; no retroactive artifact rewrite | MET |
| Opt-in motion with legacy compatibility | `8243553` + `8ea2f3d` — planner/builder/engine | `baseline_life` opt-in on scene and layered shots; legacy output unchanged; stage-start push/pull; opaque/static cards require authored pauses | MET |
| Denser but semantic SFX/audio coverage | `c0f064c` — audio director + builder/checker QA | Candidate-beat critic, no quota or new render schema, authored/resolved/unresolved comparison, no cue auto-insertion, restrained consequence handling | MET |
| Overall human engagement gate | `c59d89c` rubric + design gates | Fresh critics, blind fixture path, derived QA only, complete diff returns for human review before calibration | MET; HUMAN FEEL GATE REMAINS |

## Verification log

### Focused executable suites

- Initial command: focused pytest over all changed Python test modules.
- Result: `120 passed, 2 errors, 4 subtests passed`. Both errors occurred during pytest fixture setup
  because its default temp root resolved to the protected human-account directory
  `C:\Users\danie\AppData\Local\Temp\pytest-of-danie`; no product assertion failed.
- Bounded environment correction: reran the identical test set with `--basetemp` inside this worktree.
- Corrected result: `122 passed, 4 subtests passed` in 0.27 seconds.
- Post-fix complete owning-skill suite: `333 passed, 6 subtests passed` in 2.41 seconds across
  long-form-writer, motion-planner, visual-prompt-writer, render-builder, and voiceover scripts.
- Five changed skill folders pass the `skill-creator` `quick_validate.py` structural validator under
  UTF-8 mode. Two pre-existing frontmatter validation defects in metadata-writer/render-builder were
  corrected (angle-bracket placeholders; overlong render-builder description).
- TypeScript status: the render engine declares TypeScript but this worktree has no local `tsc` binary;
  do not download dependencies during review. Static/type verification remains pending until an existing
  authorized toolchain is found or the current-main integration supplies one.

## Findings and repair disposition

All fresh-review findings are resolved and re-reviewed:

1. **Opaque-card authored-pause bypass (HIGH, resolved):** a pure automatic sentence gap could authorize
   an opaque card. `apply_cards()` now requires `source: cue`; merged cue+sentence gaps preserve the full
   duration, and legacy untagged cue gaps remain compatible. Post-fix lane verdict: **READY**.
2. **Voice marker/rhythm false positive (MEDIUM, resolved):** `[PAUSE]`/`[BEAT]` before one delivery marker
   was rejected. Adjacency now requires two expressive markers, while placement ignores trailing rhythm
   cues. Post-fix voice suite: `46 passed`; verdict: **READY**.
3. **Dry-run unspoken-tail divergence (MEDIUM, resolved):** dry-run validated Sources/Notes text that paid
   synthesis excluded. Shared long/short region helpers now scope cleanup and planning identically; no
   provider path opened in tests. Post-fix voice verdict: **READY**.
4. **Blockquoted quote lint escape (MEDIUM, resolved):** quotes in body blockquotes passed lint and were
   later stripped from VO. The whole VO body is now quote-checked before metadata classification, with
   straight/curly regressions. Post-fix story verdict: **READY**.
5. **Research-rejected promise propagation (MEDIUM, resolved):** the existing Viability verification
   block is now the canonical deep-path story/packaging contract consumed by writer and metadata; unsupported
   promises cannot fall back from the provisional brief. Post-fix story verdict: **READY**.

The initial third-person conflict is withdrawn: the later authoritative 2026-07-22 Daniel ruling in
`knowledge/decisions.md` permits narrator-I and generic audience-facing `you` while retaining the ban on
viewer role-casting and voiced character dialogue. The stale resume sentence did not supersede that ruling.

## Integration and governance state

- Current fetched `origin/main`: `e07ea84`.
- Merge base of `origin/main` and the resume branch: `8204bec`.
- `git merge-tree --write-tree origin/main HEAD` completed successfully and produced tree
  `4cf1d21ad5a2a3b8769870794222ee5eaa429110` with no conflicts or worktree mutation.
- Story/voice standalone endpoint content is subsumed by the combined candidate on their owned paths.
  The combined visual candidate is intentionally more complete than the older standalone endpoint: it
  includes the opt-in `baseline_life` token block and reconciled opaque-card DNA required by the design.
- Technical readiness is separate from the project contract: merge to `main`, paid generation, render,
  publication, and queue-card mutations remain human/governance gated.

## Technical verdict

**READY FOR FEATURE-BRANCH INTEGRATION; HUMAN REVIEW REQUIRED BEFORE MAIN OR CALIBRATION.** All six axes are
represented, every concrete review finding has a regression fix, the full local skill suite is green, and
the current-main merge simulation is conflict-free. The remaining gates are deliberately human: review the
complete production diff, then select zero-spend Poyais calibration feel before any paid Bricks/Wells work.
