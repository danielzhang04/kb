# Scripting Overhaul — Round 3 Implementation Plan

> **For agentic workers:** execute ONLY the task assigned in your dispatch prompt. Every edit is
> replace-in-place; nothing is appended to file ends. Steps use checkbox syntax for tracking.

**Goal:** bake Daniel's round-3 script-#2 line rulings into the scripting doctrine so a fresh
`long-form-writer` run produces a script he accepts.

**Architecture:** examples dominate, rules shrink. Every learning lands as (a) an example in the voice
bar, (b) an operation a stage executes, or (c) a defect species in a critic's hunt list — never as a
floating sentence. All grammar/critic edits rewrite existing rule language in place.

## Global Constraints

- Worktree: `C:/Users/danie/kb-worktrees/fyt-writer-r2`, branch `claude/fyt-writer-grammar-slim`. Never touch the main kb checkout.
- **Replace-first:** every edit names the existing text it replaces or deletes. Zero new sections in grammar/critics/SKILL. §numbers in storytelling-grammar.md MUST NOT change (judge/critic pointers depend on them).
- **Line budgets (hard):** storytelling-grammar.md ≤ 357 lines; critics.md ≤ 335; SKILL.md ≤ 165. example-scripts.md may grow (its function) but only by the specified excerpts.
- No em/en dashes in any authored channel/script prose. UTF-8 encoding on every write (never cp1252).
- Daniel-verbatim texts below are the law; fix only spelling (Ramsay, Johnson), punctuation house style (26,000), and facts that the ledger refutes. Do not compose alternatives.
- Workers edit files only; no git commands, no new branches/worktrees, no edits outside listed files.

## Round-3 doctrine (source rulings, condensed)

1. Metaphor species: pulls skew heavily to NAMED cultural references (Ramsay, Doctor Strange, Samsung-vs-Apple, Ocean's Eleven); generic situational metaphors allowed as a minority; the defect is the drawn-out multi-sentence generic metaphor (video-game-level, wedding-suit). Setup-then-apply is licensed: hand the viewer the reference first ("You know that Gordon Ramsay show where…"), then apply it. Density: 1–2 pulls/reactions per block is normal; two consecutive dry blocks = register drift.
2. Language: stock idiom is the default reach ("fell off a cliff", "raking it in", "head on the chopping block"); fresh imagery survives only when it parses instantly as talk ("beige box", "went into reverse", "bleeding thing" fail; a parsing adjective stack or personification is fine). Contractions by default. DEAD: the fragment-punch ("That is one year.") and the paired parallel aphorism ("The 550 is the number people remember. The 128 is the number that got paid."). A single ironic capping line stays alive ("And it was already wrong the day they printed it.").
3. Detail budget: one number per beat; numbers rounded in the mouth ("over half a billion") except where precision IS the story (26,000 bricks; $125M rise marker); no résumé/model-name/logistics detail unless load-bearing; a color detail earns its place by becoming a pull or a joke (the LA rule: "ran it from LA" survives as the Doctor Strange bit, not as logistics).
4. Narrator stance: casual address licensed; staging the viewer as a participant is dead ("So put yourself in that room. You are a middle manager…" — scratched whole). Historiography is dead: never "the version of this story you usually hear" — a myth is busted by simply telling the documented version flat.
5. Escalation: motivate once, then trust it. Re-deriving stakes each beat ("That bought them a quarter. It fixed nothing, because the targets went up again…") is bloat. The namesake rule: the title object returns AS ITSELF, escalating ("These bricks weren't a one quarter thing").
6. Hook reveal: one-sentence tease + plain doorway; never an itemized inventory of the scheme.
7. Color leash: a witnessed scene/behavior from ONE credible source is tellable flat (the Wiles firing scene, Q-01); numbers and load-bearing plot facts keep the strict ledger leash. No hedge either way.
8. Aftermath: two blocks max (the money; the trial). Rounded numbers, pulls and reactions throughout — the friend compresses litigation.
9. Voice bar = register: writers absorb it for language/tone/jokes/pulls; it is neither a quarry to quote nor a minefield to avoid. Delete every "don't quote it / no line lifted" instruction. Critics judge the paragraph, not its ancestry (echoes of the bar are neither flagged nor rewarded).
10. Drift fix: 3b drafts act-by-act, re-reading example-scripts.md before each act to re-tune the ear.
11. Vibe enforcement: the taste critic's protocol becomes comparative — set each paragraph beside the voice bar and ask if it would survive in that company. Tripwires (countable, judge-side only): two consecutive dry blocks; >1 number per beat.

---

### Task A — doctrine files (storytelling-grammar.md, critics.md, SKILL.md)

**Files (all under `orgs/faceless-youtube/`):**
- Modify: `channels/the-second-take/storytelling-grammar.md`
- Modify: `.claude/skills/long-form-writer/references/critics.md`
- Modify: `.claude/skills/long-form-writer/SKILL.md`

**Steps (grammar):**

- [ ] **A1 — header:** line 12 "Match it; don't quote it." → replace with: "Absorb it before writing; it is a register, not a quarry and not a minefield."
- [ ] **A2 — §1.1 spoken grammar:** inside the existing "Spoken grammar beats written grammar" bold sentence's passage, work in (replacing the current single example clause, keeping length ~flat): contractions are the default ("That's one year", never "That is one year" as a dramatic punch); the default reach is the stock idiom a friend would use ("fell off a cliff", "raking it in", "head on the chopping block") — a fresh image survives only when it parses instantly as talk, and a phrase that sounds written ("everything went into reverse", "this bleeding thing") is the defect.
- [ ] **A3 — §1.4 analogies:** rewrite the body (same length or shorter) to add: the ratio skews heavily to named cultural references; generic situational comparisons are the minority; the drawn-out multi-sentence generic metaphor is the defect; setup-then-apply is licensed with the Ramsay example ("You know that Gordon Ramsay show where he goes around reinventing failing restaurants? Q.T. Wiles was the Gordon Ramsay of the business world."). Keep the universality-bar paragraph.
- [ ] **A4 — §1.3 density:** sharpen the existing "couple of beats in a row" sentence to: one or two pulls or reactions per block is the normal running density; two consecutive blocks with neither is register drift, the pipeline's signature failure in a script's back half.
- [ ] **A5 — §1.5 narrator stance:** append to the "Generic 'you' is normal speech." sentence: "Casual address is the voice; *staging* the viewer as a participant is dead ('So put yourself in that room. You are a middle manager…' — scratched). Talk to the viewer, never cast them."
- [ ] **A6 — §1.6:** extend the "What stays dead" close with the fragment-punch and paired aphorism: trailer fragments, the dramatic uncontracted punch ("That is one year."), and the paired parallel aphorism ("The 550 is the number people remember. The 128 is the number that got paid.") — all written moves; heat lives in capitals and delivery. A single dry ironic capper stays correct ("Or so they said.").
- [ ] **A7 — §2.1 hook:** after the paradox cold-open example, add one sentence: "The reveal is one sentence and a plain doorway; itemizing the scheme's details in the hook (serial numbers, labels, customer lists) spends the caper before the story starts."
- [ ] **A8 — §2.2 numbers/detail:** extend the scale-exception paragraph with the detail budget: one number per beat, rounded the way a friend rounds ("over half a billion dollars"), precision only where precision is the story (26,000 bricks); résumé lines, model numbers, and logistics enter only when load-bearing.
- [ ] **A9 — §2.5 color:** add the LA rule to the color definition: a color detail earns its place by becoming a pull or a joke; the same fact as bare logistics is clutter.
- [ ] **A10 — §2.7 escalation:** revise "every escalation says out loud what caused it" passage: the cause is said once, when it happens, and then trusted — re-deriving the stakes at each beat is bloat. Add the namesake sentence: the title object keeps returning as itself, escalating ("These bricks weren't a one quarter thing. They were the start to a strategy that ran quarter after quarter.").
- [ ] **A11 — §3.5 endings:** add the second approved shape reference (the counterfactual last laugh) in one sentence, examples live in example-scripts.md.
- [ ] **A12 — §4 facts:** (i) extend the first bullet with the color license: a witnessed scene or behavior from one credible source is tellable flat (the ledger marks it reported; the narration never hedges it); numbers and load-bearing plot facts keep the strict leash. (ii) extend the hedging bullet family with the historiography kill: a myth is busted by telling the documented version flat, never by staging the correction ("the version of this story you usually hear" is dead).
- [ ] **A13 — §5 bank:** merge the "Dwell" and "Restating the premise" rows (kin) into one; add rows (net table size ≤ current+2): fragment-punch/paired aphorism → heat in capitals and delivery; drawn-out generic metaphor → named cultural pull; viewer-staging → talk to the viewer, never cast them; historiography framing → tell the documented version flat; number pile-up → one rounded number per beat.
- [ ] **A14 — §6 toolbox:** under the franchise-pull entry add the setup-then-apply note with the Ramsay line. No new entries.
- [ ] **A15:** run a final read to confirm §numbers unchanged and line count ≤ 357.

**Steps (critics.md):**

- [ ] **A16 — "Everyone reads the bar first" paragraph:** add the comparison protocol sentence: judgment of voice is comparative — set the paragraph beside the approved excerpts and ask whether it would survive in that company; echoes of the excerpts are neither a defect nor a virtue (judge the paragraph, not its ancestry).
- [ ] **A17 — taste hunt list:** merge item 7 (dwell) and item 9 (premise over-restatement) into one item; renumber to keep 16 items. Then: extend item 8 (writerly/literary) to name the fragment-punch, the paired parallel aphorism, and the non-parsing fresh image ("went into reverse", "bleeding thing") while protecting parsing fresh images; extend item 12 (dead joke/flat analogy) to flag the drawn-out generic metaphor where a named pull would land, and note the named-vs-generic ratio; extend item 13 (flat stretch) with the tripwires (two consecutive blocks with no pull/reaction; more than one number in a beat is the number-pile cousin); extend item 11 (signposting) with viewer-staging and historiography ("put yourself in that room" / "the version you usually hear"); use the freed slot for a **detail-budget overrun** item: résumé/model-number/logistics detail doing no story work, and unrounded numbers where a friend would round.
- [ ] **A18 — taste never-flag list:** add: stock idioms ("fell off a cliff", "raking it in") — the channel speaks in them, never flag as cliché; fresh images and personification that parse instantly; the single ironic capping line; phrasing that echoes the voice bar.
- [ ] **A19 — leash critic item 2:** add the color license: a reported scene/behavior carried by one credible source (ledger-marked reported/anecdotal) is tellable flat per grammar §4 — do not propose cutting or hedging it; numbers and load-bearing plot facts keep the strict standard.
- [ ] **A20:** confirm critics.md ≤ 335 lines.

**Steps (SKILL.md):**

- [ ] **A21 — Step 1:** the example-scripts.md read becomes register language: "(the approved excerpts: the voice bar — absorb it for language, tone, joke grade, pull species, and density; it is a register, not a quarry and not a minefield)".
- [ ] **A22 — 3a:** in the cultural-material sentence, note the pull ratio: candidate comparisons skew heavily to named cultural references (grammar §1.4).
- [ ] **A23 — 3b (the drift fix):** rewrite the 3b paragraph: draft **act by act** (the acts fall out of the spine: the setup, the scheme, the unraveling — 2 to 4 of them). Before each act, re-read `example-scripts.md` to re-tune the ear; then write that act to the spine in the channel's voice, telling it out loud, no fact-checking. The register decays over a long single pass; the re-read between acts is what holds the back half's voice at the front half's level.
- [ ] **A24:** confirm SKILL.md ≤ 165 lines.

### Task B — voice bar (example-scripts.md) + ledger note

**Files (under `orgs/faceless-youtube/`):**
- Modify: `channels/the-second-take/example-scripts.md`
- Modify: `channels/the-second-take/videos/2026-07-10-bricks/research.md` (Q-01 note only)

**Steps:**

- [ ] **B1 — header:** rewrite the "Writers match the energy, never the content: nothing here is a rewrite order, and no line is meant to be lifted into a new script." sentence to: "It is a **register**: writers absorb it before drafting — for language, tone, joke grade, pull species, and density. It is neither a quarry to quote nor a minefield to avoid; critics judge a draft's paragraphs against it, never their ancestry." Keep the rest of the header.
- [ ] **B2 — intro excerpt, third paragraph** replaced with:
  > Well, computers run on these things called hard drives. A hard drive is the part of your computer that remembers things after you switch it off: your files, your applications, and your private collections. Every computer needs one. So while the computer companies were fighting like Samsung and Apple fight over the phone market, the hard drive manufacturers were quietly raking it in. They were the people selling picks and shovels in the gold rush.

  Paragraphs 1, 2, 4 and the doorway stay as they are. Update the demonstrates note's gloss sentence to mention the pull doing the explaining (Samsung/Apple) and the wink in "private collections."
- [ ] **B3 — rise excerpt** replaced with:
  > The company was MiniScribe, a hard drive manufacturer out of Colorado, founded in 1980 by a guy named Terry Johnson. And they were HOT. IBM picked MiniScribe to supply the hard drives for their PCs, and within four years, the company was making 125 million dollars a year. And at their peak in 1988, they were selling to giants like Compaq and making over 600 million dollars a year. Accounting for inflation, that's almost as much money as Reddit makes today. Or so they said.

  (Facts: F-25/F-26/F-28/F-29/F-31 all check.) Demonstrates note: add one clause on the numbers — two figures carry the whole rise, both at story moments.
- [ ] **B4 — fixer excerpt** replaced with:
  > By 1985, MiniScribe was struggling. IBM had slashed its orders, and the competition was closing in. So they brought in the man, the myth, the legend: Q.T. Wiles. You know that Gordon Ramsay show where he goes around reinventing failing restaurants? Q.T. Wiles was the Gordon Ramsay of the business world, an investment banker they called Doctor Fix It. Instead of shitting on your risotto, he's reading your quarterly statements. And, like Doctor Strange with his many sanctums, Doctor Fix It ran several other companies at the same time.

  Demonstrates note: rewrite around setup-then-apply (hand the viewer the reference, then apply it) plus the motivated arrival; keep it ≤ 4 lines.
- [ ] **B5 — NEW excerpt "Bricks / the fear regime"** (placed after the fixer excerpt):
  > Wiles ran MiniScribe with fear. He set sales targets. Hit them, and you got a fat bonus. Miss them, and your head was on the chopping block. And when you hit them, he raised them, so the next quarter was even harder. He once made two managers stand up in the middle of a team meeting and fired them on the spot, just to show everyone who was in control. What a dick.

  (Q-01, one-source color license; F-04.) Demonstrates: the regime told in idioms a friend reaches for, then one concrete witnessed scene instead of abstraction, capped with the narrator's honest reaction.
- [ ] **B6 — NEW excerpt "Bricks / the break-in"** (after fear regime):
  > In January 1987, problems started surfacing. Employees realized they had overstated inventory. Four million dollars of product that was supposed to be sitting there, wasn't. So they broke into the auditors' boxes with wrenches and paper clips, and replaced the real numbers with better ones. Not exactly Ocean's Eleven level, but pretty close.

  (F-12; the $4M states the top of the sourced $2–4M range flat — noted for Daniel's checkpoint.) Demonstrates: a caper beat compressed to verbs, closed by a named pull that sets up the later "This was Ocean's Eleven level stuff" callback.
- [ ] **B7 — caper excerpt** replaced with:
  > So the managers put their heads together, and came up with a brilliant idea. They rented a warehouse near headquarters, and went shopping at a local company: the Colorado Brick Company. They bought 26,000 bricks, handpicked to match the weight and size of a real boxed hard drive. They put the bricks in boxes, gave each one a serial number, and shrink wrapped them onto pallets. Perfectly indistinguishable. My Peloton bike is a scam, but these guys? Next level. This was Ocean's Eleven level stuff.

  Demonstrates note: trim to the chained verbs + two-word verdict + the pulls; drop the defective-drives clause from the note (that beat now lives in B8).
- [ ] **B8 — NEW excerpt "Bricks / it kept going"** (after the caper):
  > And these bricks weren't a one quarter thing. They were the start to a strategy that ran quarter after quarter. It worked, after all: they were hitting their targets, making their bonuses, and even the auditors didn't know. So they kept going, and started loading in defective drives, factory scraps, random shit lying around.

  (F-10/F-13/F-04; "kept buying bricks" bent to "kept going" — repeat purchases are unsourced — noted for Daniel's checkpoint.) Demonstrates: the namesake escalating as itself; stakes carried forward without re-derivation.
- [ ] **B9 — ending section:** keep the existing ending excerpt; add a second one under the same heading:
  > The scheme itself was never caught. It beat the audit, it beat the count sheets. What it didn't survive was HR. If MiniScribe had just kept a few more people on the payroll through Christmas, who knows how many more years they would've gone on selling those bricks.

  Extend the demonstrates note by one sentence: the counterfactual last laugh is a second approved shape; both settle rather than conclude.
- [ ] **B10 — research.md Q-01 note:** replace the parenthetical "*(Reported/anecdotal — attribute as "by one account," flag as reported, not asserted.)*" with "*(Reported single-source scene — tellable flat under the color license, grammar §4; keep hard numbers out of it.)*"
- [ ] **B11:** verify: no em/en dashes introduced; every excerpt is pure narrator prose; file reads clean top to bottom.

### Task C — boss: grade, bloat report, commit, checkpoint

- [ ] C1: grade both workers (model grep FIRST line from `~/.claude/projects/C--Users-danie-kb/27ae76d2-ea03-4a2b-80c4-d4a6b795e7e5/subagents/agent-<id>.jsonl`).
- [ ] C2: line-count table before/after; budgets enforced.
- [ ] C3: `python .claude/skills/long-form-writer/scripts/lint_script.py` self-tests still pass (no lint change expected); `lint_calibration.py` still passes.
- [ ] C4: commit with explicit paths; update `knowledge/decisions.md` + `docs/STATUS.md` (r3 entry).
- [ ] C5: checkpoint ③ to Daniel — full change summary + bloat table + the two fact-bends (B6 $4M, B8 kept-going) — BEFORE any regen.

### Task D — run #3 (only after Daniel's go at C5)

- [ ] D1: archive `script.md` → `script.r2.md`; fresh conductor dispatch, same brief, updated docs; verify + lint; present.
