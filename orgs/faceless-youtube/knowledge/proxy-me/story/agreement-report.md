# Story-editor-me — agreement report (Task 7)

Date: 2026-07-09. Method: the judge blind-rated two held-out drafts; scored against Daniel's ground
truth by `score_agreement.py` (verdict match + normalized same-lines overlap).

## The held-out set

| id | draft | Daniel (ground truth) | Judge | verdict match |
| --- | --- | --- | --- | --- |
| HO-1 | pre-gold Poyais first draft (`da8c888`) | reject/rebuild (historical fact — he rebuilt it into the gold) | reject 24/36 | ✅ |
| HO-2 | fresh **non-Poyais** Lustig draft | revise | revise 34/36 | ✅ |

(Plus the Task-5 smoke test: the judge greenlit the locked gold at 35/36.)

## Metrics

```
HO-1: verdict_match=True  recall=0.80  precision=0.57
HO-2: verdict_match=True  recall=0.00  precision=0.00
AGGREGATE: verdict-agreement 2/2 (100%); mean line-recall 0.40
```

Proposed bar: verdict-match ≥ 80% AND mean line-recall ≥ 0.5.
Result: **verdict PASSES (100%); line-recall FAILS (0.40 < 0.5), entirely due to HO-2.**

## What this means (honest read)

- **Verdict reliability is real.** Across gold (greenlight), a heavily-flawed draft (reject), and a
  strong fresh-topic draft (revise), the judge made Daniel's ship/revise/kill call every time — including
  off Poyais. That is genuinely useful on its own: it can pre-screen drafts.
- **Substance-matching is NOT there yet on a fresh topic.** On HO-1 (Poyais) the judge caught 4/5 of the
  exact lines Daniel struck (recall 0.80). On HO-2 (Lustig) it shared **zero** flags with Daniel — and
  not because it was lazy: it actively rated several of Daniel's disliked lines as *good* (it praised
  "no more right to sell it than to sell the moon"; scored register 2/2). This is a genuine
  taste-resolution gap, not an oversight.

## The three uncodified preferences HO-2 exposed

Daniel's HO-2 notes cluster into three general preferences the taste pack does not yet encode at this
resolution:

1. **Digestibility / plainness bar (the big one).** Daniel rejects mildly clever, indirect, or inflated
   constructions that the grammar's "no literary phrasing" rule passes because they aren't *full*
   literary tells: "no more right to sell it than to sell the moon", "been lying for a living for a very
   long time", "could not bring himself to tell a single soul", "nobody alive would have the nerve to",
   "genuinely nervous about the dollar", "a completely different level of heat", "it had gone up back in
   1889". His bar: instantly digestible on first hearing; cut filler intensifiers and stock inflation.
2. **Hookier hook.** He wants the opening punchier and slightly longer/more detailed, not just correct.
3. **Quantify money + modern perspective.** A con story should state the sum AND put it in today's terms
   casually ("that much today could buy you X") so the audience feels the scale — a payload/accessibility
   expectation the rubric doesn't currently demand.

## Verdict on the proof

**FAIL the substance bar → Task 8 = TUNE, not freeze.** The fix is calibration-only (add the three
preferences to the TRAINING set as general rules), never a grammar/writer edit — per the "don't lose
ability" constraint. Because HO-2's own lessons feed the tuning, a **clean re-proof needs a NEW held-out
draft** (re-running on HO-2 would be teaching to the test).
