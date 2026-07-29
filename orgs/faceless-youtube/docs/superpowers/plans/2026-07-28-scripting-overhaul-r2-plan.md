# Scripting Overhaul Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild the scripting doctrine around Daniel's round-2 rulings (spec: `2026-07-28-scripting-overhaul-design.md` §Round 2) so a fresh Bricks run produces a script he accepts. Round 1's fresh script was rejected; the fix is doc logic, never the artifact.

**Architecture:** Examples dominate, rules shrink. `script.md` becomes pure prose (no cues at all). Grammar §1/§2/§3/§4/§5/§6 rewritten; dryness-producing rules deleted; critics recalibrated; lint flipped; ledger topped up so the rise-beat facts exist.

## Global Constraints

- CHANGE or REMOVE rule language; never append exceptions/do-lists (Daniel, standing).
- No em/en dashes in authored text. UTF-8 via file tools. Stage explicit paths only; other sessions share the tree (`visual-prompt-writer/SKILL.md` has an uncommitted parallel edit — never stage it).
- Branch `claude/fyt-writer-grammar-slim`. Commits carry `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- OUT of scope: visual-prompt-writer, image-generation, render, audio-director, researcher SKILL, idea-generator (B-ROLL-removal ripple is recorded as deferred debt, not fixed).
- Every grammar/critic inline example comes from `example-scripts.md` (incl. the new excerpts below) — nothing invented.
- Profanity ceiling in any authored example: "ass"/"shit" grade; never the f-word.

## New approved excerpts (Daniel 2026-07-28, corrected pass approved; [verify] slots filled by Task R2-0)

**Company intro:** "The company was MiniScribe, a hard drive manufacturer out of Colorado, founded in [verify: year] by [verify: founder(s)/garage]. And they were HOT. By 1985 they were shipping [verify: volume] hard drives a year to electronics giants like IBM and [verify: second customer]. And at their peak in 1988, they were making over 600 million dollars a year. Accounting for inflation, they were making as much money as Reddit. Or so they said."

**Wiles intro:** "By [verify: year/mid 1980s], MiniScribe was struggling after facing increasing competition from other hard drive manufacturers, so they brought in the man, the myth, the legend: Q.T. Wiles. Q.T. Wiles was an investment banker nicknamed \"Doctor Fix It\". He was the mechanic for dying companies, and he built a reputation off of turning dying companies back into successful ones. And, like Doctor Strange with his many sanctums, Doctor Fix It ran several other companies at the same time."

**The caper:** "Wiles set impossible sales targets, and missing them meant your head was on the chopping block. So the managers put their heads together, and hatched a brilliant plan. They rented a warehouse, and went shopping. They bought 26,000 bricks from the Colorado Brick Company, handpicked so that a box with a brick felt and weighed exactly like a box of hard drives. Then each box got a serial number, because hard drives have serial numbers, and the whole thing was shrink wrapped onto pallets and sent out. These guys even put defective drives, scraps, and random shit lying around in too. My Peloton bike is a scam but these guys? Next level. This was Ocean's Eleven level stuff."

**Gap speculation (for §4):** "Don't ask me why. Maybe Wiles was just that charismatic, or maybe there was some under-the-table dealing going on. Either way, the same twenty six thousand bricks..."

**Ending example (for §3.5 — one example of the tone, not a formula):** "In the end, MiniScribe went bankrupt in 1990, their investors were screwed, and Q.T. Wiles lost his Fix It reputation. The big winner was probably the Colorado Brick Company, who scored a major payday selling bricks to a tech company."

---

### Task R2-0: Research top-up (sonnet)

**Files:** Modify `channels/the-second-take/videos/2026-07-10-bricks/research.md` (the durable original).

- [ ] WebSearch-verify and append new `[F-25]+` ledger rows + `[S#]` sources for: MiniScribe founding year + founder(s) + garage-or-not; a ~1985 growth/shipment marker; peak reported revenue 1988 (~$600M?) AND whether that figure was itself later restated as inflated; the year Wiles arrived/took over; a second named major customer besides IBM (only if truly sourced; else record "IBM leads, no second name sourced"); Reddit's most recent annual revenue (for the inflation comparison, with year). Match the ledger's exact row format incl. Conf and Note fields. Integrate: also update the "Open questions" section if a gap closes.
- [ ] Report each fact with its source URL and confidence; flag any [verify] slot the record refutes (e.g. if 1988 revenue was NOT ~$600M, say so — the exemplar text bends to the record, never the reverse).
- [ ] Commit research.md only: `feat(fyt-research): bricks ledger top-up — rise-beat facts + Reddit comparison (r2)`.

### Task R2-1 + R2-2 + R2-3: Doctrine core round 2 (ONE opus worker, for coherence)

**Files:** `channels/the-second-take/example-scripts.md`, `channels/the-second-take/storytelling-grammar.md`, `.claude/skills/long-form-writer/SKILL.md`, `.claude/skills/long-form-writer/references/critics.md`.

**example-scripts.md:**
- [ ] Add the three new excerpts + gap-speculation + ending example as sections with short "what this demonstrates" notes (leave `[verify]` placeholders exactly as written; a later step fills them from R2-0). Keep MacGregor and the Bricks intro untouched (incl. its wink line — approved text). Update the header: the file now also carries mid-story and ending exemplars.

**storytelling-grammar.md (rules reworded/deleted, never excepted):**
- [ ] §1: paragraph doctrine replaces the short-punch rule (idea blocks ~4–5 sentences average; no standalone one-liner paragraphs; short sentences live inside blocks — quote "And they were HOT." in context). Spoken grammar wins. Parse-on-first-listen line. Tense doctrine (past default; present for frames/timeless mechanics/optional hot runs; still-life tableau banned). Caps-for-heat + knowing stock phrases licensed; trailer-drama clichés stay dead. §1.2 kept but reworded so it can't be satisfied by clipped drops.
- [ ] §1.3/§6 humor recalibration per spec §Round 2 Humor (pop-culture license with named examples from the new excerpts; profanity ceiling; warm default; dry-ironic only when it lands; "not everything is a joke"; delete-test stays).
- [ ] §2.1 hook: actor + event + familiar anchor + concrete names; still-life/abstraction/unnamed-mystery dead; shape open. §2: scale-context move (revenue/valuation vs modern company, quote the Reddit line); facts enter when the story needs them. Rise-before-fall for company stories; explicit causal chains (each escalation motivated out loud).
- [ ] §3.5 endings rewritten as TONE: casual, brisk, unceremonious, lands an ironic observation or last laugh; no moral/essay; DELETE the "one earned ironic image" requirement; Daniel's ending quoted as one example, explicitly not a formula. §3.6: remove all wink language (pre-spoiled tension keeps its other tools). §3.4 unchanged (doorway stays).
- [ ] §4 rewrite: hedge ban (hedging = fact selection, never narration; "by one account"/"sources say" banned from VO); transparent-speculation move with the approved example; defamation discipline kept.
- [ ] §5 bank: rows updated — ADD concept-prose, clipped one-liner monotone, visible payoff-plant, audible hedge, doesn't-parse-on-first-listen; REMOVE/reword rows that now contradict doctrine. Every example re-checked against approved excerpts.
- [ ] Remove every remaining mention of B-ROLL/pause/beat markup from the grammar.

**long-form-writer/SKILL.md:**
- [ ] Step 3b/4: `script.md` is pure prose — no [B-ROLL], no pause/beat cues. Step 4 shrinks to: runtime header (words ÷ measured wpm via lint) + Sources + policy gate. Step 3a cultural sweep kept (add era anchors for the rise beat as an explicit gather). Step 3c leash pass rewritten: strongest-sourced-version-stated-flat, cut what can't be stated, transparent speculation for gaps, no audible hedges. Output contract updated (pure prose; downstream rework recorded as deferred debt in decisions/STATUS, not here).
- [ ] Purge B-ROLL/pause language everywhere in the SKILL.

**critics.md:**
- [ ] Taste critic hunt-list rewritten to the round-2 kills: clipped one-liner monotone / staccato house-style, concept-prose, lines that don't parse on first listen, visible payoff-plants, audible hedges, dead jokes judged as hit-or-miss against the excerpts (register-agnostic: warm or dry must HIT), plus surviving round-1 finds still consistent (grandeur buttons, dwell, jargon, premise restatement, credibility padding, flat stretches). Never-flag list updated (idea-block flow, caps-for-heat, stock-phrase intros, licensed profanity/pop-culture, in-paragraph short sentences).
- [ ] Leash critic: proposes the flat strongest-sourced version, never a hedge; checks speculation is transparently framed (maybe/either-way); invented-fact rules unchanged. Coherence: add explicit causal-chain check (every escalation motivated). Editor: no new hedges; conflict rule updated (keep the fact, state it flat). Remove critic language referencing deleted rules or cue markup.
- [ ] Acceptance: read all four files end-to-end; fix any sentence contradicting the new doctrine; grep zero for `B-ROLL|\[PAUSE|\[BEAT|short-punch|wink|by one account` across the four files (exception: example-scripts.md's approved Bricks-intro wink line and, if any, verbatim excerpt content). One commit per file-group is fine; messages per repo style.

### Task R2-4: Lint flip + tests (sonnet, parallel with doctrine worker — different files)

**Files:** `.claude/skills/long-form-writer/scripts/lint_script.py`, `test_lint_script.py`.

- [ ] Any `[B-ROLL`, `[PAUSE`, `[BEAT` occurrence in the VO body = HARD violation (script.md is pure prose). Runtime suggestion reverts to `Estimated runtime: MM:SS (N words ÷ W wpm)` (delete the cue-seconds math added earlier tonight — words at measured gross wpm already embed natural pausing). Keep --wpm, keep dash/trace/quote/padding checks.
- [ ] NEW advisory (non-blocking): standalone one-sentence paragraphs in the VO body — list line numbers ("N one-sentence paragraphs; idea blocks average 4-5 sentences").
- [ ] Update tests: cue-presence now asserts violation; runtime math pinned without cue seconds; new advisory pinned. `python -m pytest` → PASS. Commit.

### Task R2-5: dna + records + peripheral sync (sonnet, after doctrine worker lands)

**Files:** `channels/the-second-take/dna.md`, `.claude/skills/shorts-writer/SKILL.md` (check-only unless it teaches cues/hedges/old humor), `knowledge/proxy-me/story/calibration-set.md` (check-only: §5-bank pointers still valid), `knowledge/decisions.md`, `docs/STATUS.md`.

- [ ] dna.md: humor-dial section recalibrated (warm irreverent pop-loaded default; franchise/meme-with-staying-power license with the Thanos/idiot-sandwich/Peloton examples; profanity ceiling below f-word; drop "never memes" and "smart-not-cringe" phrasing; keep delete-test + punch-up-never-at-the-mark). Script-rules bullet: remove `[B-ROLL]`/`[PAUSE]`/tiered-pause mentions (pure prose). Nothing else.
- [ ] decisions.md entry (2026-07-28, round 2): script #1 rejected + why (rule-shaped dryness); paragraph doctrine + short-punch deletion; humor/profanity recalibration; hedge ban + speculation move; tense doctrine; hook/ending rulings (ending = tone not formula; "earned ironic image" requirement deleted); wink doctrine scrapped; pure-prose script contract (pauses → audio-director, B-ROLL removed, VPW/image-gen rework DEFERRED as recorded debt); research top-up; alternatives rejected (keeping cue markup; formulaic ending; hedged narration).
- [ ] STATUS.md: integrate round-2 state + the deferred downstream-rework debt line. Commit.

### Task R2-6: Fill [verify] slots (boss, small edit)

- [ ] From R2-0's report, fill example-scripts.md placeholders (text bends to the record); sync any grammar quote containing them; commit. Present filled values to Daniel with the grade report (gate ⑤ veto window).

### Task R2-7: Verification battery (boss)

- [ ] Greps per R2-3 acceptance across all touched files + `python -m pytest` on lint + resolve-manifest tests + grade both workers (grep model line first, per BOSS.md).

### Task R2-8: GATE ⑥ — fresh Bricks run #2

- [ ] In `videos/2026-07-28-bricks-fresh/`: rename `script.md` → `script.r1.md` (untracked scratch, kept for comparison); re-copy the topped-up `research.md` from `2026-07-10-bricks/`.
- [ ] Dispatch a fresh opus conductor: invoke `long-form-writer` on the folder, staged mode, new docs only, same overrides as round 1 (no backlog touch, no commits, zero spend, no shorts), and forbid reading `script.r1.md`, the 07-10 script, or decisions history.
- [ ] Boss: lint + grep the transcript for model + read the script; open in VS Code beside script.r1.md; Daniel judges.

## Self-review

Spec §Round-2 coverage: voice/prose → R2-1..3 grammar §1; humor → grammar §1.3/§6 + dna (R2-5); facts/leash → §4 + SKILL 3c + leash critic; story shape → §2/§3 + coherence critic; markup → SKILL + lint (R2-4); examples/top-up → R2-0/R2-1/R2-6; deferred debt → R2-5 records. Gates ④ (this plan) ⑤ (R2-6) ⑥ (R2-8). No placeholders beyond the deliberate [verify] slots R2-6 owns. Names consistent: `example-scripts.md`, `script.r1.md`.
