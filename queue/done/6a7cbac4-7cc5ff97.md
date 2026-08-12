---
id: 6a7cbac4-7cc5ff97
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: 47c67b97e7751d1f
state: done
approval: null
workflow: 019ff734-a97a-7093-8468-f6b5cb67a115
depends-on: []
variant-group: null
role: work
session-id: 6a7cb981-bc9b9d63
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task C10 fix round 1 — context-safe quota/refusal classification

Arc worktree is your cwd, branch `claude/codex-image-engine`, HEAD 65bdb1a. Scope:
`orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py`
(classification markers only) + `.../test_forge_codex.py` (regressions, red-run required) +
Fix report 1 appended to `.superpowers/sdd/2026-08-11-codex-image-engine/task-C10-report.md`
(gitignored). NO edits to `_fake_codex.py`/`forge.py`, NO codex calls, NO network, NO
commit/push.

\## Finding (sol-xhigh review of 65bdb1a; demonstrated; full report task-C10-review.md)

MEDIUM — forge_codex.py:704,723-768: quota/refusal detection is bare lowercase substring
over joined agent texts. A benign agent message QUOTING a marker (demonstrated:
"The prompt says 'usage limit' as a literal, but the tool returned no image.") classifies
as `quota` → the §6-lawful no_image re-issue is suppressed, and downstream C12 will treat
it as a batch-stopping failure. The generic marker "try again later" false-positives even
without quoting.

\## Fix design (boss-ruled; the cost asymmetry drives it)

Misclassifying REAL quota/refusal as no_image costs one identical-prompt re-issue then a
loud no_image raise — cheap. Misclassifying benign text as quota/refusal loses a lawful
re-issue and aborts batches — expensive. Therefore bias toward SPECIFIC, anchored patterns:

1. Replace `_QUOTA_MARKERS`/`_REFUSAL_MARKERS` substring tuples with compiled regexes that
   match only direct second-person/first-person statements, e.g.:
   - quota: `\byou(?:'ve| have)\s+(?:hit|reached)\s+your\s+usage\s+limit\b`,
     `\brate\s+limit\s+(?:reached|exceeded|hit)\b`,
     `\busage\s+limit\s+(?:reached|exceeded)\b`
   - refusal: `\bi\s+(?:can't|cannot|won't\s+be\s+able\s+to)\s+(?:help|create|generate|do)\b`,
     `\bi'?m\s+unable\s+to\b`, `\bi\s+am\s+unable\s+to\b`
2. DROP `try again later` and bare `quota` as standalone signals entirely.
3. Apply the regexes per agent message (not the joined blob), case-insensitive.
4. A marker inside single or double QUOTES in the message must NOT classify — implement by
   the anchored phrasing above (the demonstrated poison "The prompt says 'usage limit'..."
   must classify no_image); do NOT build a quote-parser.
5. The fake's canonical phrases MUST still classify: quota mode emits "You've hit your
   usage limit. Try again later." → quota; refuse mode emits "I can't help with that." →
   refusal. The fake is frozen — verify by running the existing positive tests.

Regression tests (genuine red against unfixed code):
- The demonstrated poison message with no PNG → classify_turn == "no_image", and a
  generate() run with a fake mode emitting it... the fake is frozen, so test at the
  classify_turn level: construct the result dict directly (existing tests already do this
  pattern) with the poison text → assert "no_image".
- A message quoting a refusal marker ("the brief says 'I can't help' is a phrase to
  avoid") → "no_image".
- "try again later" alone with no PNG → "no_image".
- Positive re-pins: the fake's two canonical phrases still → quota / refusal (may reuse
  existing tests if they already pin this — state which).

All 74 existing tests must stay green; expect ~77-78 after regressions.

\## Verification to run and paste
- Red run (new negatives failing unfixed), green run full tail.
- `git diff --stat` — exactly the two named files.
- Entropy scan `grep -noE "[A-Za-z0-9+/_-]{120,}"` on both changed files: zero hits.

Final message: line 1 `C10-FIX1 DONE` or `C10-FIX1 BLOCKED: <why>`; tails + diff stat +
deviations.

## Result

C10-FIX1 DONE

- Red run: new quoted-marker regression failed on unfixed code (`AssertionError`).
- Green run: `== 77 passed ==`.
- Diff: 2 files, 47 insertions, 6 deletions; only the two allowed files changed.
- Entropy scan: zero hits. `forge.py` and `_fake_codex.py`: zero diff.
- Deviations: none.

Report appended: [task-C10-report.md](C:\Users\danie\kb-worktrees\boss-codex-image-engine\.superpowers\sdd\2026-08-11-codex-image-engine\task-C10-report.md)
