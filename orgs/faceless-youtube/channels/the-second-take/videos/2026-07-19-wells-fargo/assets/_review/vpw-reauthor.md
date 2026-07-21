# VPW re-author — supplied-text clearance + L105 cast reconciliation

- **Run:** fyt-run-001, stage `visual-prompt-writer` (authoring only, zero spend, no image generated)
- **Date:** 2026-07-20
- **Wrote to:** `staging/shots.json` (single-writer rule — root `shots.json` NOT touched)
- **Scope:** the 7 HARD supplied-text violations + L105 `cast`. Nothing else.

## Job 1 — the 7 supplied-text violations

| shot | unsupplied fragment | resolution | new literal / treatment | source |
| --- | --- | --- | --- | --- |
| L28 | `marked with the stagecoach tag` | 2 — element omitted | Bank now identified by architecture: "a much larger cream columned bank with a wide portico and tall arched windows". No mark rendered. | — (none in ledger) |
| L29 | `big scorecard number` | 1 — value supplied | "a tall marker scorecard board carrying the single numeral **'8'** painted large on its face … that numeral and no other digit anywhere in the frame" | `[F-01]` |
| L30 | `giant scorecard number` | 3 — deliberately blank | "crank a tall scorecard board higher by its side handle … The board's metric face is left **COMPLETELY EMPTY**: NO digits, no numerals, no decimal point, no percent sign and no placeholder glyph anywhere on it" | — (forbidden; see below) |
| L32 | `reading` (wall clock) | 2 — element omitted | Clock cut. End-of-day now carried by "the tall windows behind them gone dusk-dark with the end of the working day". | — |
| L34 | `name marker-written` | 3 — deliberately blank | "Its customer-name line across the top is left **COMPLETELY BLANK** — not one letter on it, no scrawl, no placeholder glyph." | — (forbidden; see below) |
| L116 | `one enormous glowing scorecard number` | 1 — value supplied | "one enormous glowing scorecard numeral **'8'** floating above them … That numeral '8' is the only digit anywhere in the frame." | `[F-01]` |
| L116 | `giant number` (red accent) | 1 — value supplied | "the one red accent on the rim of that numeral **'8'**" | `[F-01]` |

### Why resolution 1 was FORBIDDEN on L30 and L34

- **L30** — the VO is *"people stop trying to serve the customer and start trying to move the number."* The number being **moved/cranked** is the **reported cross-sell ratio**, not the fixed target. `[F-03]` establishes that Wells Fargo reported a cross-sell ratio to investors as a headline metric but **carries no numeric value for it**, and `research.md` carries none anywhere else. Supplying any figure would be fabrication. Deliberately blank + an explicit exclusion clause is the correct authoring, and it mirrors the house pattern already committed at **L16** (same label, same COMPLETELY EMPTY metric field, same exclusion clause). The "cranking it higher" beat is preserved by the side handle and the existing red rising-arrow accent — no load-bearing content dropped.
- **L34** — `research.md` names **no defrauded customer**. This is a real, documented case; inventing a customer name would put a fabricated name on a real record. Blank name line is the honest composition and reads as the beat's own point (nobody consented). The `NEW ACCOUNT` tab, already supplied verbatim, still carries the "an account was opened" payload.

### Why resolution 1 was CORRECT on L29 and L116 (verified against the ledger, not the brief)

`[F-01]` is explicit: the target was formalised as the 1999 **"Going for Gr-eight"** campaign — **eight products per household**, the number eight chosen partly because it rhymed with "great". The numeral `8` is therefore directly sourced.
- **L29** VO: *"But once a bonus rides on a number like that"* — "a number like that" refers back to the eight-products target established upstream, not to the ratio.
- **L116** VO: *"There was just a target the whole bank had been chasing"*, and the very next line (L117) names it outright: *"a number somebody picked back in 1999 because it rhymed with the word great."* The target IS the sourced 8; no other value is in play.
- `8` is already the committed treatment elsewhere in this file (L31's boulder numeral, L105's screen numeral), so this is consistent, not novel.

## Job 2 — L105 `cast` decision

**Decision: `cast` set to `[]` (entry removed).**

Was: `[{"character": "tolstedt", "pose_ref": "action-present", "expression_ref": "expr-smug"}]`

Reasoning:
1. The skill's `cast` rule is that a `cast` entry **names an identifiable figure actually in frame**; anonymous figures stay prose in the `still_prompt` and are never cast. L105's own prompt stages "a SMALL back-turned presenter in silhouette at a lectern, **face not visible**". A figure whose face is not visible is not identifiable — so by the rule there is no castable figure in this frame.
2. `cast` is **authoritative and drives seeding** (`image-generation` seeds the character canonical + expression + pose into the one scene generation). Keeping the entry would seed Tolstedt's canonical face and a `smug` expression into a frame whose own text forbids a visible face. That prompt-vs-cast contradiction is precisely what produced the original engine refusal on the named-executive framing; it would resurface on any regen.
3. Removing it is also the safer YMYL/defamation posture. `research.md` is emphatic that everything about Tolstedt must sit at document altitude; an authored *smug* expression on a real, living, named person is a characterisation the ledger does not source. Attribution to Tolstedt lives correctly in the VO and in the shot `notes` — not in the pixels.
4. No load-bearing content is lost: the frame's subject is the number and the "BEST IN THE BUSINESS" banner, exactly as the delivered `assets/scenes/L105.png` shows.

The `notes` field records this reconciliation in full so a future regen cannot silently re-cast it.

## Verification

Final lint on the staged file:

```
== lint_shots: channels/the-second-take/videos/2026-07-19-wells-fargo/staging/shots.json ==
long-form shots: 119  |  shorts: 5

HARD violations (29) - render sync WILL degrade, fix before handoff:
```

**Supplied-text violations: 0** (was 7). Verified by filtering every HARD line for the
`without supplying its value` signature — zero matches.

**Diff containment** — machine-verified against root `shots.json`: the only changed fields in the
entire file are `still_prompt` + `notes` on L28/L29/L30/L32/L34/L116 and `cast` + `notes` on L105.
`shorts`, `thumbnail`, `house_style`, `global_prompt_suffix` are byte-identical, shot count
unchanged at 119, and every one of the 7 prompts' house-style tails is preserved verbatim
(asserted by string comparison from `Clean flat 2.5D vector cartoon` onward).

## BLOCKING FINDING — the brief's premise was stale (surfaced, not papered over)

The work order states the file "currently reports **7** HARD violations". It reports **36**. The 7
supplied-text ones are real and are now cleared. The other **29 are pre-existing HARD violations in
three different defect classes**, none of which my scope touches:

| count | class | shots |
| --- | --- | --- |
| 26 | production-control phrase sitting in the scene body (`rig form`, `comedy off`, `gravity register`) — the engine has rendered these as literal lettering (`rig form` on L100, `COMEDY OFF` on L69) | L01 L04 L10 L11 L17 L29 L30 L32 L33 L43 L57 L63 L67 L69 L70 L74 L76 L100 L102 L118, short-01 `first_frame`, S04-04 |
| 1 | delta frame refers to established lettering by description instead of re-quoting it (this is how `CHECKING` rendered as `CHECKIG`) | L12 (stage `household`) |
| 2 | authored lettering exceeds the 4-word cap | short-02 `first_frame` ("IT STARTED WITH A RHYME"), short-04 `first_frame` ("THEY CALLED THE ETHICS LINE") |

I did **not** fix these. They are a separate defect class, the brief explicitly forbade widening
scope, and `shots.json` is single-writer — a parallel agent may already be assigned to them. But the
brief's own success criterion ("HARD violations: none") is **unreachable within the stated scope**,
so the conductor must either dispatch that second class or explicitly accept it. Note the overlap:
L29, L30, L32 and L33 carry a `rig form` violation as well as (formerly) a supplied-text one — I left
their rig clauses untouched.

The 30 advisory VO-coverage heads-up notes are pre-existing and out of scope as instructed.
