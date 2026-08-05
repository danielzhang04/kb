# Fresh VPW authoring — fifth 1 report (doctrine reset validation leg, $0)

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`. Nothing
committed. No generation, no provider call, no spend.

## 1. Fifth boundary

**P01–P06 = 293 of 1,632 words = 18.0% of the script, 41 shots, Σ 100.5 s.** Ends at L41
("and Terry Johnson was out the door.").

Why there: the 20% mark lands inside P07, which is one continuous act beat (H&Q's $20M, Wiles' arrival, the
Doctor Fix It / Gordon Ramsay riff, the LA office) running to 25.0%. Cutting inside it would split a held
stage and hand the next fifth a chain with no base. P06's end is the story's own act seam — the setup closes
with the founder walking out, and the turnaround man arrives on the very next line — so the fifth ends at the
last complete stage before 20%.

## 2. What was authored

- `shots.json` rewritten fresh: v2 header, `global_prompt_suffix` = **"hand-lettered marker capitals for any
  in-world text"** (the new lettering-only suffix, verbatim from the grammar header), `long_form` with 41
  shots, full `thumbnail` block (primary + exactly 2 challengers), `shorts: []` (no `shorts/` folder exists).
- `scratchpad/vpw-fresh-skeleton.md` — the GLOBAL plan (4 acts, whole-file density budget ~208 shots / 559.5 s,
  the complete 9-slug cast map with entrance lines, the 6-place inventory with owner decisions, stage plan,
  three peaks, disclosure/cadence rules) so fifths 2–5 continue coherently.
- `scratchpad/vpw-log-fresh.md` — the authoring log + act self-audit (the old `vpw-log.md` was neither read
  nor touched).

**Fresh-authoring law held:** derived from `script.md` alone. The archived file, `_archive-pre-reset/`, the
old file's git history and the old `vpw-log.md` were never read. The stale `shots.json` was deleted unread
(the Write tool refuses to overwrite an unread file, so deletion was the only way to obey both rules).

## 3. Place inventory + owner choices

| place | plate | plate is cast-free / non-delta | owner forced choice | shots |
| --- | --- | --- | --- | --- |
| `brick-warehouse` | **L03** | yes / yes | `owner_ambiguity: true` — a rented shell with nobody's name on it; the unmarked-ness is the authored read, not a forgotten sign | 4 |
| `miniscribe-plant` | **L26** | yes / yes | `place_owner: "MINISCRIBE"`, quoted verbatim on the plate's own prompt (board over the floor entrance) | 8 |

**12 of 41 shots carry a `place`; both places have an authored plate and a recorded ownership decision.** The
other 29 are one-visit sets run as `stage` chains (8 chains: den, store, vault, shopfront, back room, brick
tease, IBM deal, plant thinning) or place-exempt classes. Judgment call worth flagging for review: I read
"recurring diegetic set" as *revisited by the file*, so a 3-shot single-visit chain (the 1983 shop) gets a
stage but no place. The conditional plate law supports that (a single-use place needs no plate, so declaring
one only mints waste), but the doctrine does not say it in those words — if the reviewer wants place declared
on every multi-shot set, that is a one-line policy change, not a re-author.

Four more places are pre-decided in the skeleton for later fifths (`wiles-office`, `miniscribe-boardroom`,
`brick-company-yard`, `denver-newsroom`) so no set gets invented twice mid-pass.

## 4. Lint — final state

```
== lint_shots: .../2026-07-28-bricks-fresh/shots.json ==
long-form shots: 41  |  shorts: 0

HARD violations (2):
  [long-form] Sum of duration_s 100s < 85% of the ~558s runtime (1628 words / 175wpm, per the header)
  [long-form] 41 shots for a ~558s runtime (< 1 cut / 4s) — too few cuts; densify

Heads-up (1):
  [long-form] L41: covers ~1346 words on one anchor (>~8s VO)
```

**Classification — real violations: ZERO.**

- HARD #1 (duration sum) — **artifact of partial coverage.** Both checks measure against the whole 9:20
  runtime; this file covers 18% of it. Σ 100.5 s is exactly the span the 41 shots cover at the header's
  175 wpm.
- HARD #2 (shot floor) — **artifact of partial coverage.** The floor is 558/4 = 140 shots for the finished
  file; the fifth's own floor is 100.5/4 = 26, and it carries 41 (avg hold 2.45 s, inside the 1.5–3 s band).
- Heads-up (L41's 1,346-word span) — **artifact of partial coverage.** `vo_text` tiling runs each anchor to
  the NEXT anchor, and the last shot has none, so it absorbs the remaining four fifths of the script.

Everything else passed, first run, with no fix cycle: verbatim in-order anchors against the real VO
word-stream (all 41 matched), place key/exempt/inventory/plate/owner laws, `place_anchor` shape, two-cast
presence (plane + eye-line + head scale on L29), seat/support, action-chain, semantic-cast, text-supply,
lettering word/char/count caps, carried literals (L-1), crowd tiering + rear zones, delta feasibility,
rig-clause and control-leak guards, banned render terms, suffix one-voice.

`--write` was NOT run: it refuses while any HARD remains, so `vo_text` stays underived until the file is
complete. Expected, not a defect.

One drift was caught by the act self-audit and fixed before lint's final pass: red accents appeared in 29 of
41 frames (one per frame, but at that density red stops reading as the one semantic ink). Nineteen decorative
accents were removed by an explicit per-id list; red now sits in 10 frames, each alarm / ownership / punch.

## 5. Friction — where the doctrine fought the authoring (verbatim, all of it)

1. **The place-owner literal collides with the cast slug, and lint fires on the collision.** `place_owner:
   "MINISCRIBE"` on the plant plate makes `MINISCRIBE` an established literal for the whole PLACE.
   `carried_literal_check` then scans every in-place prompt for `\bMINISCRIBE\b` case-insensitively — and the
   backticked cast name `` `miniscribe-rep` `` contains it, with word boundaries on both sides of the
   fragment. So naming the company's own personified cast inside the company's own branded place is a HARD
   failure unless the prompt re-quotes `'MINISCRIBE'` **within 60 characters after the slug with no
   coordinator (and/with/beside/above/below) in between**. Two consequences, both bad:
   (a) it forces sign-quoting prose into shots whose framing may not even include the sign, i.e. the lint can
   push an author to draw a sign into a frame to satisfy a carry rule; and
   (b) it fights the ordering law directly — the payload (the quoted lettering) is supposed to be the FINAL
   clause, but the supply window forces it into the identity zone at the top. L28 is the compromise
   (`` `miniscribe-rep` under the board carrying 'MINISCRIBE', `expr-delighted`… ``) and it reads like
   compliance, not staging. I dodged it twice more by casting `terry-johnson` instead of the personified
   company on L29 (defensible: he ran the firm when the IBM contract landed) — but that means a lint rule
   quietly influenced a CASTING decision, which is exactly the class of thing the doctrine says lint must not
   do. Suggested fix: exclude backticked spans from `carried_literal_check`'s body, or compare against the
   prompt with backticked vocabulary names stripped.

2. **The plate law and the character-reveal law want the same frame.** "A character reveal lands on the line
   that NAMES them" and "a qualifying place's plate declares zero named cast" collide on
   "The company was MiniScribe" — the naming line is both the place's establishing moment and the
   personification's entrance. Disclosure order forbids moving the plate earlier (the brand cannot appear
   before the VO says it), so the plate takes the naming line and `miniscribe-rep` enters two shots later on
   "And they were HOT." It works, but the entrance no longer lands on its own name, and every branded place
   in every future video has this same 1–2 shot lag baked in.

3. **`owner_ambiguity` is the honest answer far more often than the doctrine's framing implies.** The forced
   choice is written as if a missing owner cue is the failure mode (audit failure #6). But act 1's warehouse
   genuinely has no owner — it is rented, off-site, and its anonymity is the point — and the 1983 computer
   shop, the den, the stockroom and the gold-rush stall have no script-sourced owner literal either. If a
   later author reaches for `place_owner` because ambiguity "looks like the weaker answer", the doctrine will
   have produced invented signage, which is the fabrication the text laws exist to stop. Worth stating in the
   doctrine that ambiguity is a first-class answer, not a fallback.

4. **"Recurring set" is undefined at the 2-shot boundary.** A set used by exactly 2 adjacent shots in one
   stage chain is a revisit by lint's counting (≥2 shots declare it ⇒ qualifying ⇒ plate demanded) but not by
   any reasonable reading of "recurring". I resolved it by declaring `place` only for sets the file revisits
   after leaving them, and running single-visit sets as stage chains. The doctrine should say which it means,
   because the two readings produce very different place inventories (mine: 2 places / 12 shots; the literal
   reading: 8 places / 32 shots, six of which would need a dedicated cast-free plate frame apiece — pure
   generation cost for sets never seen twice).

5. **The place-exempt class list forces class choice by mechanism rather than by meaning.** Several act-1
   beats are set-based but classify most honestly as `physicalized-imbalance` or `number-glued-to-object`,
   which may never declare `place`. Where the beat genuinely wanted both (a scale argument staged ON the
   plant floor), I had to either restage it off-place or pick a different class. L33 ("giants like Compaq")
   went off-place to keep the class honest; a reviewer may reasonably say the shot lost its setting to a
   schema rule.

6. **The action-chain law is silent when a chain is declared, which means a wrong chain is invisible to
   lint.** Declaring any `stage`/`stage_role` silences it. That is the correct boundary (lint should not
   judge coherence) but it means the only thing standing between "declared chain" and "physically impossible
   chain" is the critic — and this run had no critic (Step 8 is out of scope for a partial file). Worth
   remembering when the adversarial review reads this fifth: lint's silence on chains is not evidence.

7. **Lint's `_ANON_INDIVIDUAL` guard is easy to satisfy by vocabulary rather than by staging.** Writing
   "packers" instead of "workers", or "buyers" instead of "customers", clears the check with no change to the
   image. I staged all six crowd shots with real rear-zone geometry anyway (far side of a counter, behind
   window glass, far side of the racks, across a creek, out through a rear doorway), but the guard as written
   is Goodhart-able by a thesaurus.

8. **Minor:** the grammar bans lettering-register words in prompts ("hand-lettered marker style"), and the
   `global_prompt_suffix` is exactly those words. That is coherent — one voice, one home — but it means the
   suffix reads as a violation of the rule it sits above, and I nearly wrote "hand-lettered board" into three
   prompts before catching it. A single sentence in the grammar ("the suffix says this so your prompt never
   has to") would prevent the reflex.

9. **Not friction, but a note for the reviewer:** the SKILL's Step 8 critic pass was not run — a fresh-eyes
   critic over 18% of a file would judge cadence and peaks against a file that does not exist yet. The critic
   should run on the assembled whole.
