# Story / selection lane audit — 2026-07-22

**Scope.** Commit `c59d89c` against base `5c901947`, assessed against design commit `5857709`
and the callers/contracts required to establish its behavior. Integrated head `6dd5dfa` was used only
to confirm that its later voice-only changes do not alter this lane.

## Review record

- Read governing project context: `CLAUDE.md`, `knowledge/operating-law.md`,
  `docs/handoffs/STATUS.md`, the 2026-07-21 engagement handoff, `knowledge/decisions.md`, the
  live skill registry and its design rules.
- Read the full changed selection/story-lane files: `idea-generator`, `researcher`,
  `long-form-writer`, its critics/calibration/lint/tests, and The Second Take DNA, storytelling
  grammar, and watchability rubric. Also traced the existing `proxy-judge` acceptance-gate contract
  before judging the rubric handoff.
- Verified the Poyais dossier supports the calibration excerpt's load-bearing factual claims
  (for example, F-02, F-03, F-04, F-05, F-08, F-15).

## Validation

- `python orgs/faceless-youtube/.claude/skills/long-form-writer/scripts/test_lint_script.py` — PASS,
  3 tests.
- `python -m unittest discover -s orgs/faceless-youtube/.claude/skills/long-form-writer/scripts -p 'test_*.py' -v` — PASS,
  3 tests.
- `git diff --check 5c901947 c59d89c` — only two trailing-whitespace warnings in the design document;
  no implementation whitespace error.
- Focused negative test: a body line formatted as `> "He said it."` passes `lint_script.py` with
  `HARD violations: none` and a zero-word count. This is a reproduced script-lint escape, not a
  hypothetical parser concern.

## Initial findings (superseded where noted below)

### HIGH — The implementation removes the explicit third-person lock while the governing review input says it must survive

**Type:** hard-constraint regression / unresolved human-authority conflict.

Before this commit, the DNA locked the channel to “Third-person throughout” and described the narrator as
“One narrator, third-person, no quotes.” Commit `c59d89c` replaces those clauses with permission for
“Narrator-I and generic audience-facing `you`” at
`orgs/faceless-youtube/channels/the-second-take/dna.md:74-77` and removes third-person from the narrator
persona at `dna.md:87-94`; the revised rubric likewise accepts narrator-I
(`watchability-rubric.md:40,73-74`). A resulting script may now use a first-person aside such as “did I
mention he made a flag?”, which satisfies the new documents but violates the stated third-person constraint
in this audit's governing brief.

The design itself is internally decisive in the other direction: it permits first-person narrator asides at
`docs/superpowers/specs/2026-07-22-engagement-overhaul-design.md:77`, while that file still declares its
status `PROPOSED — Checkpoint 2 human review` at line 4. Consequently there is no way to both preserve the
third-person lock and follow the implemented/design rule; this is a taste/identity decision that needs an
explicit human resolution, not silent precedence by a skill edit.

**Bad outcome:** the channel can change narrator stance across all future stories before the conflict is
resolved, and the reviewer/critic will score the changed stance as compliant.

**Smallest owning fix direction:** at the channel-DNA/design decision layer, explicitly choose either (a)
retain third-person and remove narrator-I from the calibration, rubric, and skill prompts, or (b) approve
the first-person exception as the new lock and amend the governing constraint. Do not leave both readings
live.

### MEDIUM — The deterministic no-quotes lint silently drops Markdown-blockquoted body content

**Type:** correctness / missing test; inherited guard gap preserved in this modified lint lane.

`lint_script.py` declares quotation marks in VO body a hard violation, but classifies every `>`-prefixed
body line as metadata before testing it (`orgs/faceless-youtube/.claude/skills/long-form-writer/scripts/lint_script.py:113-122`).
Therefore this body passes clean:

```markdown
> "He said it."
```

The reproduced command reported `HARD violations: none` and `VO word count: 0`. That is incompatible with
the hard channel lock of zero quotation marks and narrator-reported speech
(`channels/the-second-take/storytelling-grammar.md:24-25`) and also evades runtime accounting.

**Trigger/state:** a generated `script.md` body uses a Markdown blockquote to format direct speech or a
quoted source. The existing guard treats it as non-VO metadata; the newly added tests cover plain/bold
Step cards only (`test_lint_script.py:31-57`) and do not cover this escape.

**Bad outcome:** this does not reach TTS as direct speech: `voiceover.py` deliberately strips `>` blockquote
lines. Instead, a script can pass the hard lint while losing an entire quoted body beat in the produced VO;
the lint also reports the wrong runtime. The planned transcript/runtime QA may expose the divergence later,
but the script-lane hard gate neither rejects nor reports it.

**Smallest owning fix direction:** reject unexpected body blockquotes (or explicitly classify them as
non-spoken notes only where the schema permits), include them in the lint's runtime warning, and add negative
tests for blockquoted straight and curly quotes plus a transcript parity assertion.

### MEDIUM — A researched rejection/revision of an angle or title promise does not become the canonical downstream brief

**Type:** cross-skill contract / selection correctness risk.

The new researcher contract correctly records unsupported promises in `research.md`
(`orgs/faceless-youtube/.claude/skills/researcher/SKILL.md:211-215`) and says not to force them into the
script (`researcher/SKILL.md:234-235`). However, it never updates the picked brief or emits a named canonical
replacement that consumers must use. `long-form-writer` continues to read the original brief's angle, payload,
and title options (`long-form-writer/SKILL.md:66`) and only describes `research.md` as the source of truth for
facts (`lines 67-72`). `metadata-writer`, which creates the final title, reads `script.md` plus `brief.md`,
not `research.md` (`metadata-writer/SKILL.md:74-79`).

**Trigger/state:** the viability check marks an original cold-open/title promise unsupported or revises the
provisional angle after research. The original promise remains verbatim in `brief.md` / `idea-backlog.md`, the
only packaging input carried into metadata.

**Bad outcome:** a later writer or metadata pass can resurrect the rejected promise from the brief even though
the research dossier disproved it. The general fact leash reduces the chance of a false sentence in the script,
but it does not provide an explicit, auditable selection/title handoff or prove the final packaging abandoned
the failed promise. No fixture exercises this negative path.

**Smallest owning fix direction:** make the research output's verified/revised angle, payload and permitted
title-promise set the canonical handoff (for example, an explicit block copied into `brief.md` or a named
post-research brief); require writer and metadata to read it, and add one unsupported-promise fixture that
asserts it cannot reappear in the final script/title candidate.

## Initial requirement mapping

| Requirement | Evidence / assessment |
| --- | --- |
| Six-axis design: stronger story selection | Viability fields and research verification were added, but the verified result does not become the canonical writer/metadata input (MEDIUM finding). |
| Six-axis design: personable, paced narration | The new calibration, casual-first/leash-second order, raw-versus-leashed critic, causal planning cards, and de-button/taste checks are present. The acceptance gate remains owned by existing `proxy-judge`, not duplicated in the writer. |
| Strong stakes, angle, character, and content selection | Research now requests accountable stakes, scenes, motive, human cost, claim-reality pairs, and verification chain. The unsupported-promise propagation gap remains. |
| Overall human engagement gate | Existing `proxy-judge` still owns the `/36` acceptance verdict; this lane did not remove it. Its usual advisory/blocking choice remains a human/process decision. |
| One narrator, reported speech, no quotes | The documents retain the intent, but `lint_script.py` accepts a blockquoted direct quote and does not count it. Voiceover then strips the block, silently losing the beat (MEDIUM finding). |
| Third-person constraint | `c59d89c` removes it in favor of narrator-I. The design is still marked proposed while the review brief requires the lock to survive (HIGH conflict). |
| Comedy off on human cost | DNA, grammar, calibration, rubric, and taste critic retain the constraint. No concrete escape was found in this lane. |
| Fact leash | Research dossier fields, leash pass, leash critic, and raw-versus-leashed preservation critic retain it. No concrete factual-leash regression was found. |
| Checkpoint 3: blind Bricks/Pearlman control-candidate | The changed writer/grammar/critic route replaces legacy full-Poyais-script dependencies with the approved calibration excerpt and a documented restricted reader bundle. No executable-mode defect found. |
| Step-card semantics | Causal-only, complete sequential cards are documented; focused lint tests pass for complete, malformed, duplicate, skipped, and orphan sequences. |

## Initial findings ordered by severity

1. **HIGH** — explicit third-person lock removed before the requirement conflict is human-resolved.
2. **MEDIUM** — blockquoted body content bypasses lint, then is silently removed from the VO transcript.
3. **MEDIUM** — research-rejected or revised title/angle promises do not become the canonical downstream brief.

## Initial technical lane verdict: REQUEST CHANGES

The story/selection direction is materially stronger and the focused Step-lint suite passes (3 passed,
0 failed, 0 skipped). The blind reader-bundle design is adequately routed. However, the unresolved
third-person identity conflict and two concrete contract/lint gaps mean the lane should not be called ready
without the listed decisions and focused fixes.

## Initial smallest infrastructure-level fix sequence

1. Obtain the human decision on third-person versus the narrator-I exception, then leave one unambiguous
   channel lock across DNA, grammar, rubric, calibration, and critic prompts.
2. Correct `lint_script.py` body classification and add blockquoted quote/word-count/transcript-parity tests.
3. Promote research's verified viability result to the canonical post-research brief consumed by writer and
   metadata, with an unsupported-promise regression fixture.

## Post-fix verification — current shared worktree

**Scope rechecked:** the current unstaged changes to `lint_script.py`/its focused tests,
`researcher`, `long-form-writer`, and `metadata-writer`; the authoritative Daniel ruling in
`knowledge/decisions.md:3166-3200`; and the voiceover stripping behavior needed to establish the original
blockquote failure mode.

### 1. Blockquoted straight and curly quotes — fixed

`lint_script.py:117-121` now checks straight and curly quotation marks across the complete VO body before
the metadata classification that previously exempted `>` blockquotes. The new focused test exercises both
`> "He said it."` and `> “He said it.”` and requires a hard failure. This closes the prior path where
voiceover would silently strip the body beat. No new quote-parsing defect found in the reviewed change.

### 2. Viability verification downstream contract — fixed

`researcher/SKILL.md:156-160,214-218,237-239` defines **Viability verification** as the canonical
post-research story and packaging contract, including a permitted supported/revised promise set and an
explicit unsupported list. `long-form-writer/SKILL.md:66-76` instructs the writer to supersede conflicting
brief text and never reuse unsupported items. `metadata-writer/SKILL.md:64-72` reads the same block and
forbids unsupported packaging. This completes the previously missing researcher → writer → metadata handoff.
No new schema or compatibility defect found in the reviewed contract.

### 3. Third-person conflict — resolved by later authoritative decision

The dated decision log explicitly records Daniel's ruling that first-person narrator asides and generic
audience-facing `you` are allowed, while viewer role-casting, voiced character dialogue, and invented color
remain banned (`knowledge/decisions.md:3195-3200`). It is later and more authoritative than the stale
resume-language sentence that described a universal third-person/no-second-person lock. The DNA, grammar,
rubric, calibration, and critics consistently implement that ruling. The initial HIGH is therefore withdrawn;
no new human decision is required.

### Focused validation

- `python orgs/faceless-youtube/.claude/skills/long-form-writer/scripts/test_lint_script.py` — PASS,
  4 tests, 0 failures.
- `python -m unittest discover -s orgs/faceless-youtube/.claude/skills/long-form-writer/scripts -p 'test_*.py' -v`
  — PASS, 4 tests, 0 failures.
- `python -m pytest orgs/faceless-youtube/.claude/skills/voiceover/scripts/test_voiceover.py -q -k 'not probe_measures_real_mp3_and_is_concat_additive and not dry_run_reports_v3_v2_plan_and_never_opens_network and not dry_run_ignores_expressive_examples_in_unspoken_tail'`
  — PASS, 23 passed, 3 deselected. The full voiceover pytest invocation was otherwise blocked only by
  `WinError 5` access to the shared system `pytest-of-danie` temp directory in its three `tmp_path` tests;
  no assertion failed.
- `git diff --check -- <the five reviewed selection/story files>` — PASS (no whitespace errors).

## Revised findings ordered by severity

No open findings in the three requested post-fix areas. The initial three findings are superseded by the
evidence above.

## Revised technical lane verdict: READY

The reviewed fixes close the concrete script-lint and post-research contract gaps, and Daniel's logged ruling
resolves the narrator-stance conflict. The voiceover full-suite environment error is external to these changes;
the runnable focused subset passes. No new defect met the finding gate.
