# Remint resume — report (2026-08-05)

Resume worker finishing the remainder of the dead worker's remint round. Nothing outside that
remainder was touched: no commit, no stage, no push; no writes outside `V/scratchpad/` and
`<kit>/_staging/`; `registry.json`, `refs/` and every `_archive-*` / `_pre-*-archive` folder untouched.

## The 12 reminted assets

| # | asset | minted by | call cost (est.) | bytes | pixels | state |
|---|---|---|---|---|---|---|
| 1 | `L03.png` | dead worker | $0.039 | 924,714 | 1376x768 | staged, valid |
| 2 | `L05.png` | **$0 stage** — Daniel's pick copied in, no provider call | $0.000 | 5,017,074 | **2752x1536** | staged, valid |
| 3a | `L28.png` — **attempt 1, FAILED era-register review** | dead worker | $0.039 | 1,247,543 | 1376x768 | superseded; preserved at `scratchpad/L28-remint-attempt1.png` |
| 3b | `L28-retry1.png` — **the LIVE L28** | **resume worker (surgical retry)** | $0.039 | 1,350,329 | 1376x768 | staged, valid; camera FIXED, **line weight still failing** |
| 4 | `L63.png` | dead worker | $0.039 | 1,505,951 | 1376x768 | staged, valid |
| 5 | `L71.png` | dead worker | $0.039 | 984,319 | 1376x768 | staged, valid |
| 6 | `L113.png` | **resume worker (canary)** | $0.039 | 1,203,783 | 1376x768 | staged, valid |
| 7 | `L172.png` | **resume worker** | $0.039 | 1,170,998 | 1376x768 | staged, valid |
| 8 | `L196.png` | **resume worker** | $0.039 | 1,234,094 | 1376x768 | staged, valid |
| 9 | `fig-auditor-rep--action-present--expr-deadpan.png` | **resume worker (canary)** | $0.039 | 1,058,884 | 848x1264 | staged, valid |
| 10 | `fig-qt-wiles--action-accuse--expr-deadpan.png` | **resume worker** | $0.039 | 1,100,515 | 848x1264 | staged, valid |
| 11 | `fig-qt-wiles--action-present--expr-delighted.png` | **resume worker** | $0.039 | 1,132,150 | 848x1264 | staged, valid |
| 12 | `fig-qt-wiles--action-armscrossed--expr-crestfallen.png` | **resume worker** | $0.039 | 1,103,492 | 848x1264 | staged, valid |

All live in `C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/`,
all carry today's mtime, all open as valid PNGs under Pillow `verify()`. **`_staging` ends the run with
zero `.lock` files.** L28 is the one shot with two staged files: `L28.png` (attempt 1) and
`L28-retry1.png` (the live frame) — the retry mechanism forbids a retry name equal to its shot, so
attempt 1 was never overwritten, which is also what makes the before/after board possible.

## The L28 retry (review-derived correction)

A fresh-eyes era-register review failed L28 attempt 1 on three criteria. **Two were model deviations
and took the one sanctioned retry; the third was AUTHORED and was left strictly alone.**

| failed attribute | class | what I did |
|---|---|---|
| Thin cool-grey hairlines instead of the even medium-thick warm brown-black register | model deviation | corrected in the retry span |
| Deep oblique ELEVATED camera down the bench line, against the authored "wide static eye-level from the aisle" | model deviation | corrected in the retry span |
| Cool grey palette | **AUTHORED** — the shot says "Palette: beige, steel grey, cool white tube light" | **untouched**; it is the human's palette ruling, and silently "fixing" it would be a fidelity violation dressed as a repair |

Mechanism: a `forge-retry-overlay@2` **scene** entry, `defect: content`, ONE exact `{from,to}`
replacement of the Framing span (`instruction` is forbidden on scene retries, so the exact-replace is
the only legal authority). Dry-run confirmed `changed_spans: 1`, 1K, 16:9, and the same two seeds as
the original L28; a character-level diff showed the edit is one contiguous span with the palette
clause and the `'MINISCRIBE'` sign clause byte-identical.

**Outcome, measured rather than eyeballed** (`lum<90` ink mask):

| image | ink coverage | ink mean luminance | ink mean R−B |
|---|---|---|---|
| archived prior L28 (the correct register) | 11.43% | **23.0** | +11.5 |
| L28 attempt 1 (failed) | 11.65% | 48.1 | +21.2 |
| **L28 retry 1 (live)** | **8.90%** | **44.5** | +16.9 |

`#241a12` has luminance 28.2; the archive's ink sits at 23.0 — dark and solid. Both remint attempts sit
at 44–48 (pale, low-contrast strokes), and the retry's ink coverage **fell** from 11.65% to 8.90%.

- **CAMERA: corrected.** Eye-level from the aisle, horizon mid-frame, bench tops edge-on, floor confined
  to the lower band. The authored framing renders now.
- **LINE WEIGHT: still failing** — by measurement and by my own honest look. Per the standing
  instruction I **stopped at one retry**; both attempts ship to the board and the register question
  goes to the human.
- `suspected_mechanism_layer`: **provider_limitation / forge_assembly.** Line weight is already asserted
  twice (bible descriptor at the head, `global_prompt_suffix` at the tail); a third, more emphatic
  in-payload statement did not move the stroke. A fourth restatement is the unchanged-mechanism re-roll
  the law forbids. Worth the human knowing: the *archived 2K* prior holds the register while both *1K*
  remints do not, so line weight may be entangled with the 1K era-register decision itself rather than
  being a per-shot prompt defect — that is a doctrine question, not a retry question.

## Spend

| | calls | cost (est.) |
|---|---|---|
| Inherited (dead worker, reconciled from `remint-gen-plates.log`) | 6 (4 landed, 2 failed) | $0.234 |
| **Resume worker (this run, incl. the L28 retry)** | **8 (8 landed, 0 failed, 0 re-issues)** | **$0.312** |
| **Remint total** | **14** | **$0.546** |

Price convention: 1K = **$0.039**/call (`knowledge/stack.md`, `probe-genlog.md`). Forge prints no cost,
so every figure is **est.** Resume-worker sub-ceiling $2.00 → **16% used**. Remint ceiling $4.00 →
**14% used**.

## Failures and anomalies

1. **No provider failures in this run.** Eight calls, eight landed. The stall policy never fired —
   slowest single call ~60 s against a 4-minute ceiling, so no re-issue was spent. The one *quality*
   failure is L28's line weight, above: it survived its sanctioned retry and is surfaced, not hidden.
2. **The inherited call count is 6, not 5.** The brief carried "~5 calls / ~$0.30" as the boss's
   pre-reconciliation estimate. `remint-gen-plates.log` shows six `START provider call` lines: L03,
   L28, L63, L71 landed; **L113 returned `Remote end closed connection without response`**; **L172
   logged a START with no completion line** (the worker died mid-call) and left the PID-31112
   sidecar lock. Both failed calls are ledgered at full price — a dropped connection after the
   request is not obviously free, and over-counting spend is the safe direction. The genlog records
   6 rows; the report and the genlog agree, and both differ from the brief on purpose.
3. **L05 is a 2K frame (2752x1536) sitting in an otherwise all-1K remint set.** It is Daniel's
   picked `$0` stage, carried over rather than regenerated per the work order, so this is inherited
   and not something this run introduced. Flagging it because the era register is exactly what this
   doctrine reset is about: **every other reminted plate is 1376x768 (1K), L05 is not.** A ruling is
   owed — keep it as the human pick, or re-mint at 1K. I did not touch it.
4. **`build_review_artifact.py`'s CLI does not fit this asset mix** (work order §6 anticipated this).
   Two reasons: its scene cards are collected from `<video>/assets/scenes|plates/`, and this video's
   `assets/scenes/` is **empty** — the reminted plates exist only in `<kit>/_staging`, unpromoted; and
   `--staging` adds a card for *every* pending `fig-*` in the channel-wide staging dir, not the 4 this
   remint minted. **I did not hand-roll the board.** `scratchpad/_build_remint_board.py` imports that
   module and calls its own `shot_index`/`applicable_invariants`/`describe_animation` collectors, its
   `build()` renderer and its `figure_verdict_skeleton()` — only the card *selection* is mine, so the
   HTML and the JSON schema come from the tool's own code paths. The skeleton's shape was then checked
   against `stamp_review.py`'s `_FIGURE_REQUIRED` presence check and matches.
5. **Every verdict is empty** in `remint-c6-figures.json` (`""` per invariant) and `reviewer` is left
   blank; `date` is today. Boss + Daniel fill them, then run
   `stamp_review.py --figures <remint-c6-figures.json> <kit>/_staging`. I stamped nothing — the
   single-writer law holds, and a generating worker never rules on its own output.
6. **Promotion is still owed and is not mine.** The plates are staged, not copied into
   `assets/scenes/`; the board labels each card `scene (staged, not yet promoted)`. Nothing downstream
   (render gate, scenes manifest) sees these pixels yet. **For L28 the promoter must take
   `L28-retry1.png`, not `L28.png`** — the staged filename is not the live frame for that one shot.
7. Cosmetic: the dead worker's `remint-dryrun-plates.txt` / `remint-dryrun-cards.txt` were written in
   ANSI (cp1252); mine are UTF-8. The diffs below decode both explicitly, so this changed nothing.

## Verification evidence

- **Dry-run parity before any spend.** `remint-dryrun-plates-resume.txt` diffed line-by-line against
  the dead worker's `remint-dryrun-plates.txt`: **L113, L172 and L196 all IDENTICAL** — same
  `mode=environment`, `aspect=16:9`, **`size=1K`**, same seed roles (L113/L196: `lettering-marker-italic`
  + `scene-style-tile`; L172: `crowd-exemplar`), era suffix present. The only delta in the entire file
  is the trailer `7 prompts assembled` → `3 prompts assembled`. Evidence: `_diffcheck.txt`.
- **Cards slate re-checked clean.** Re-dry-ran the inherited `remint-cards-slate.json`: all four card
  blocks **IDENTICAL** to `remint-dryrun-cards.txt`, exit 0. Evidence: `_diffcards.txt`.
- **Canary-first, twice (§D).** L113 alone → verified on disk (bytes, PIL-valid, 1376x768) → only then
  L172+L196. Then `fig-auditor-rep--action-present--expr-deadpan` alone → verified → only then the
  remaining 3 cards.
- **No prompt text was edited anywhere.** The card canary was built by running `forge.py batch --retry`
  over a 1-entry *subset of the same overlay*, and its dry-run block is byte-identical to the 4-card
  slate's block for that card. The fix intents (three-arms defect on the present/accuse cards, the
  pale/cool crestfallen face) stay exactly as authored in `remint-cards-overlay.json`.
- All slates came from the **builder** (`forge.py batch`), never hand-typed.
- **The L28 retry changed exactly one span.** `changed_spans: 1` in the dry-run, and a character-level
  `SequenceMatcher` diff of the payload line shows a single contiguous edit inside the Framing clause;
  the palette clause and the `'MINISCRIBE'` clause are byte-identical. Evidence: `_diffL28.txt`.
- **The L28 verdict is a measurement, not an opinion** (§Prove it by measurement): ink-mask coverage,
  mean ink luminance and mean ink R−B across the archived prior, attempt 1 and the retry — the table
  above. It is what overrode any temptation to call the retry good enough.

## Files created (full paths)

In `C:/Users/danie/kb-worktrees/boss-bricks-reset/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/`:

- `remint-genlog.md` — the single authoritative ledger (inherited 6 calls + my 8, with costs)
- `remint-report.md` — this file
- `remint-c6-board.html` — **13-card** review board, 2.8 MB, images inlined, all verdicts empty
  (12 assets; L28 renders twice — retry 1 as the live frame, attempt 1 as preserved evidence)
- `remint-c6-figures.json` — C-6 skeleton for the 4 STEP-1 cards, all verdicts empty
- `L28-remint-attempt1.png` — the failed L28 attempt 1, preserved before the retry
- `remint-L28-retry-overlay.json` — the 1-entry scene retry overlay for L28
- `remint-L28-retry.json` — the builder slate from it
- `remint-dryrun-L28-retry.txt` — its $0 dry-run (`changed_spans: 1`)
- `_diffL28.txt` — the payload diff proving the single-span change
- `remint-plates-slate-resume.json` — builder slate, L113/L172/L196
- `remint-dryrun-plates-resume.txt` — its $0 dry-run
- `remint-plates-canary-L113.json` — 1-shot canary slate
- `remint-plates-rest.json` — L172+L196 slate
- `remint-cards-overlay-canary.json` — 1-entry subset of the inherited overlay
- `remint-cards-overlay-rest.json` — the other 3 entries
- `remint-cards-canary.json`, `remint-cards-rest.json` — the retry slates built from those
- `remint-dryrun-cards-recheck.txt`, `remint-dryrun-cards-canary.txt` — $0 dry-runs
- `_build_remint_board.py` — the board driver (documents exactly how the board was produced)
- `_diffcheck.txt`, `_diffcards.txt` — the dry-run parity diffs quoted above

In `C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/`:

- `L113.png`, `L172.png`, `L196.png`
- `L28-retry1.png` — **the live L28** (attempt 1 remains at `L28.png`, untouched)
- `fig-auditor-rep--action-present--expr-deadpan.png`
- `fig-qt-wiles--action-accuse--expr-deadpan.png`
- `fig-qt-wiles--action-present--expr-delighted.png`
- `fig-qt-wiles--action-armscrossed--expr-crestfallen.png`

Deleted: the stale `_staging/L172.png.lock` (owner PID 31112, dead).

## What is owed next (not mine)

1. Fresh-eyes ruling on `remint-c6-board.html` — all 13 cards, verdicts into `remint-c6-figures.json`.
2. `stamp_review.py --figures` by the orchestrator, before any batch tries to reuse these 4 cards.
3. **The L28 line-weight / era-register call** — the one defect that survived its sanctioned retry.
   Ask whether medium-thick warm-brown line is reachable at 1K at all, given the archived 2K prior
   holds it and neither 1K remint does; a fourth restatement of the same instruction is not the answer.
4. **The L28 palette ruling** — "beige, steel grey, cool white tube light" is authored, and the review
   read it as cool grey. Changing it means re-authoring `shots.json`, which is `visual-prompt-writer`'s
   file, not a retry.
5. A ruling on the L05 2K-vs-1K era-register mismatch (anomaly 3).
6. Promotion of the staged plates into `assets/scenes/` — **taking `L28-retry1.png` as L28** — and the
   commit; boss ports, per §F-git.
