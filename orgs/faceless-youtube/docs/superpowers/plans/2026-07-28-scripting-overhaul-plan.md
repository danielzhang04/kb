# Scripting Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Second Take scripting stack (writer + grammar + critics + judge + voice bar) produce, in ONE research→script pass, a script Daniel accepts for image gen — per `docs/superpowers/specs/2026-07-28-scripting-overhaul-design.md`.

**Architecture:** One channel-owned voice-bar file (`example-scripts.md`) replaces `personable-calibration.md`; the grammar's rules are reworded (never excepted) to match Daniel's approved excerpts; the writer gains a cultural-pull sweep inside Step 3a; blind-protocol machinery is deleted; dna.md voice dials move to 0.20/0.6.

**Tech Stack:** Markdown doctrine files, `pytest` for the two script test files, grep sweeps for acceptance.

## Global Constraints

- **No bloat: CHANGE or REMOVE rule language; never add "do" lists, exceptions, or appendices** (Daniel, verbatim ruling).
- Every inline grammar example must come from a Daniel-approved excerpt (the two in `example-scripts.md`) or text he explicitly endorsed (the current Bricks script cold open).
- No em/en dashes in any authored exemplar text.
- Purge list (must appear nowhere in scope after the work): `personable-calibration`, blind fixture/blind reader bundle/blind-bundle text, "Most people would look at that", "tourist in Bali", "Thomas Jefferson is looking", "Official Shoemaker", "Step one in selling a fake country", "See? He is the Madoff", "Did I mention he'd made a flag", "Harry Potter with mortgage paperwork", "But normal people don't know the difference".
- Scope for purge greps: `channels/the-second-take/storytelling-grammar.md`, `channels/the-second-take/dna.md`, `.claude/skills/long-form-writer/`, `.claude/skills/shorts-writer/`, `.claude/skills/proxy-judge/`, `knowledge/proxy-me/`, `channels/the-second-take/example-scripts.md`. (decisions.md history and videos/ folders are exempt — history is history.)
- Branch: `claude/fyt-writer-grammar-slim`. Stage explicit paths only; never `git add -A`.
- Researcher and idea-generator files are OUT of scope.

## Approved excerpt inventory (the only example sources)

**MacGregor excerpt** (verbatim in `example-scripts.md`, from Daniel's 2026-07-28 edit): "Yeah, that's his real name" · "Bernie Madoff of the 1820s, except Madoff sold securities and MacGregor sold a fake country" · "Scottish George Washington before he turned to the dark side" · "the size of Maryland for a bar tab and a necklace" · "the louisiana purchase on crack" · "he thinks, and schemes, and finally, he hatches a plot" · "The balls on this guy, huh?" · "It was like Harry Potter in real life" · "It's like reading a textbook, you know? … Somebody must know what they're talking about" · "He wasn't some super intelligent con man; people just didn't care" (Megamind) · "Peru. Chile. Argentina." · "the dot-com bubble of the 1820's" · "I'd move to a country with golden rivers too, you know" · "his homemade magic money" · "This guy might even put Jordan Belfort to shame".

**Bricks intro** (PENDING GATE ② — Daniel approves final text; workers quote it provisionally and Task 6 syncs any edits): era drop-in opener ("We're in the 1980s. Home to big hair, Pac-Man, and one of the funniest corporate scams that you've never heard of." — Walkman rejected by Daniel 2026-07-28: failed the universality bar) · iPhone-launch analogy · everyman gloss ("computers run on these things called hard drives, which are basically where your computer keeps everything it remembers") · picks-and-shovels-in-the-gold-rush · spoiler wink ("well, the title gives it away") · doorway line ("Here is the story of that company.").

**Endorsed cold open** (Daniel: "isn't bad either"): the current `videos/2026-07-10-bricks/script.md` opening paragraph ("…There was just one problem. They were bricks. Actual clay bricks.").

---

### Task 1: Create `example-scripts.md`, delete `personable-calibration.md`, retarget core references

**Files:**
- Create: `channels/the-second-take/example-scripts.md`
- Delete: `.claude/skills/long-form-writer/references/personable-calibration.md`
- Modify: `channels/the-second-take/storytelling-grammar.md:11` (voice-reference pointer), `.claude/skills/long-form-writer/SKILL.md:39-40` (Step 1 read list), `.claude/skills/long-form-writer/references/critics.md` (all 6 reference sites)

**Interfaces:**
- Produces: `channels/the-second-take/example-scripts.md` — header stating what it is (approved script-level excerpts; the voice bar; writers match the energy, never quote content; judges judge against it; grows with future approved excerpts), then `## MacGregor / the Poyais pitch` (Daniel's 2026-07-28 text VERBATIM — the excerpt block only, WITHOUT the old file's "Blind reader bundle" section and without the "It is not a Poyais rewrite order…" framing sentence) with a 2–3 line "what this demonstrates" note (narrator presence, analogy engine, irreverence bar, universality bar), and `## Bricks / the era drop-in intro` marked `<!-- PENDING Daniel approval, gate ② -->` with the provisional text from the inventory above and its note (era drop-in hook, everyman gloss, spoiler wink, doorway line).
- Consumes: nothing.

- [ ] **Step 1:** Write `example-scripts.md` as specified. Keep Daniel's excerpt text byte-identical (copy from the current `personable-calibration.md`, blockquote formatting preserved; keep the closing "Raw and a little messy is preferable to polished and bland…" paragraph as the file-level principle line in the header).
- [ ] **Step 2:** `git rm` the old file. Update the three consumer files' pointers to `channels/the-second-take/example-scripts.md` and rename the concept everywhere from "the approved personable-calibration excerpt" to "the approved excerpts in example-scripts.md".
- [ ] **Step 3:** In critics.md, while retargeting, DELETE every blind-fixture sentence: `critics.md:41-42` ("Blind fixtures receive…legacy candidate script."), and the "Do not load any legacy script for a blind fixture." / "Do not load a legacy script for a blind fixture." sentences in all five agent prompts (taste, coherence, editor, structural, and the leash note if present).
- [ ] **Step 4:** Verify: `grep -rn "personable-calibration\|blind fixture\|Blind fixture\|blind reader bundle\|Blind reader bundle" orgs/faceless-youtube/.claude/skills/long-form-writer/ orgs/faceless-youtube/channels/the-second-take/storytelling-grammar.md` → zero hits.
- [ ] **Step 5:** Commit: `git add` the five exact paths; `git commit -m "refactor(fyt): example-scripts.md voice bar replaces personable-calibration; blind protocol retired from critics"`.

### Task 2: Grammar rewrite — rules match what Daniel writes

**Files:**
- Modify: `channels/the-second-take/storytelling-grammar.md` (§1.1, §1.3, §1.4, §1.5, §2.1, §2.4, §3.4, §3.6, §5 table, §6)

**Interfaces:**
- Consumes: `example-scripts.md` (Task 1) as the sole example source.
- Produces: the reworded rule set that Task 3 aligns critics against.

- [ ] **Step 1 — §2.1 hook = open set.** Rewrite so: the hook's one job is intrigue in the door; its SHAPE is free — named example shapes are (a) the paradox cold-open (keep the current endorsed Bricks example quote) and (b) the era drop-in: drop the viewer into a period with anchors everyone knows, and self-position the story ("We're in the 1980s. Home to big hair, the Walkman, and one of the funniest corporate scams that you've never heard of."). Delete the "four to five sentences … three jobs … then stop" prescription and the "no preview" absolutism; what remains banned is outlining the story's beats ("first he did X, then Y"). Keep the person-led-packaging paragraph and its "So there was this guy, Gregor MacGregor" example.
- [ ] **Step 2 — §3.4 + §3.6.** §3.4: reword the transition rule so the dead things are the literary connectors ("which brings us to," "little did they know") and category announcements ("here's the strange part") — a plain spoken doorway that launches the story ("Here is the story of that company.") is normal speech, not an announced transition. §3.6: fold the spoiler wink INTO the existing pre-spoiled-tension text — leaning into the give-away title on purpose ("well, the title gives it away") is one of the tools, alongside dramatic irony and comic dread. Change the sentences; do not append a new bullet.
- [ ] **Step 3 — §1.1 + short-punch.** Fold the everyman gloss register into the contextualize-in-same-breath sentence, using the Bricks gloss as the example ("computers run on these things called hard drives, which are basically where your computer keeps everything it remembers") — replace the bonds/IOU example. Reword the short-punch rule so the banned pattern is drama-manufacturing fragments; enumeration/momentum runs ("Peru. Chile. Argentina.") are normal speech. Replace the §1.1 ✓ example if its wording no longer matches the approved excerpt (current excerpt: "convinces the Bank of Scotland's official printer to make him 5,000 custom Poyais dollar notes").
- [ ] **Step 4 — purge + re-draw every inline example.** Every quoted example in §1.3, §1.4, §1.5, §2.4, §6 must exist in `example-scripts.md` (or be the endorsed cold open). Purge-list lines go; replacements come from the Approved excerpt inventory (e.g. ironic re-label → "his homemade magic money"; deflate-the-powerful → the Megamind line; viewer-solidarity → "I'd move to a country with golden rivers too"; rhythmic build → "he thinks, and schemes, and finally, he hatches a plot"; irreverent reaction → "The balls on this guy, huh?"; kicker-by-comparison → "This guy might even put Jordan Belfort to shame"). A §6 move with NO approved example left: keep it only if the approved excerpts clearly evidence it under another line; otherwise DELETE the move (no bloat). §1.5's Step-N example: replace the purged "Step one in selling…" echo with the excerpt's plain "**Step 1: Create the Fake Country.**" header form.
- [ ] **Step 5 — §1.4 universality bar.** Reword the analogy bar to Daniel's phrasing: every pull (humor, metaphor, phrasing, era anchor) must be something a general viewer instantly understands; the approved excerpts are the calibration; evergreen-only stays; Megamind/Belfort-grade pop anchors are in-bounds.
- [ ] **Step 6 — §5 table.** Update the "Announced/literary transition" row's fix wording to match the new §3.4. Scan other rows for wording that now contradicts §2.1/§3.4; fix in place.
- [ ] **Step 7:** Verify: `grep -n "Bali\|Thomas Jefferson\|Official Shoemaker\|Most people would look\|Step one in selling\|See? He is the Madoff\|mortgage paperwork\|he'd made a flag\|normal people don't know" channels/the-second-take/storytelling-grammar.md` → zero hits. Read the doc top-to-bottom once for internal contradictions.
- [ ] **Step 8:** Commit: `git add channels/the-second-take/storytelling-grammar.md; git commit -m "refactor(fyt-grammar): open-set hooks, doorway/wink/gloss sanctioned by rewording, examples re-drawn from approved excerpts only"`.

### Task 3: Writer cultural-pull sweep + critic alignment

**Files:**
- Modify: `.claude/skills/long-form-writer/SKILL.md` (Step 3a), `.claude/skills/long-form-writer/references/critics.md` (taste critic findings #6, #7; lint description unchanged)

**Interfaces:**
- Consumes: reworded grammar (Task 2).
- Produces: Step 3a text the fresh Bricks run (Task 7) executes.

- [ ] **Step 1 — SKILL.md Step 3a.** Change 3a.2/3a.3 (not a new step): while designing the plot and spine, the writer gathers the video's cultural material — era anchors ("what does everyone picture when they hear 1983?"), candidate modern comparisons, and joke angles per beat — noted beside the spine beats. WebSearch is licensed HERE, for era texture and for checking a reference is universally understood (the bar: a general viewer pictures it instantly; the approved excerpts in `example-scripts.md` are the calibration). Cultural material is the writer's job, never the researcher's; the fact leash still governs anything stated as fact.
- [ ] **Step 2 — critics.md taste critic.** Finding #6 (empty signposting): reword so the doorway line and era drop-in self-positioning are not flaggable — the defect is a label that hides or delays the next action, not a spoken doorway. Finding #7 (flat/dead joke): reword "reads dated/cringe" bar to the universality bar (would a general viewer instantly picture it?). Confirm #8 (flat stretch) and the never-flag list survive unchanged.
- [ ] **Step 3:** Re-read both files against reworded grammar §2.1/§3.4 for any remaining sentence a sanctioned move would trip. Fix in place.
- [ ] **Step 4:** Commit: `git add` both paths; `git commit -m "feat(fyt-writer): cultural-pull sweep in outline step; taste critic aligned to reworded grammar"`.

### Task 4: Peripheral sweep — judge, facets, tests, shorts-writer, records

**Files:**
- Modify: `.claude/skills/proxy-judge/references/judge.md:25`, `knowledge/proxy-me/facets.md:9`, `.claude/skills/proxy-judge/scripts/test_resolve_manifest.py:16`, `.claude/skills/shorts-writer/SKILL.md` (voice-bar pointer if present), `knowledge/decisions.md` (append entry), `docs/STATUS.md` (current-state line)
- Check-only: `knowledge/proxy-me/story/calibration-set.md`, `.claude/skills/proxy-judge/references/example-verdict-gold.md`, `.claude/skills/proxy-judge/SKILL.md` — grep for `personable-calibration`, Poyais-as-standard framing, blind-bundle text, purged lines; fix any hit.

**Interfaces:**
- Consumes: `example-scripts.md` path (Task 1).
- Produces: green `test_resolve_manifest.py`; decision-log record.

- [ ] **Step 1:** Retarget judge.md read-order item 1 and facets.md `voice:` to `channels/<ch>/example-scripts.md` (facets uses the `<ch>` pattern — check how `resolve_manifest` expands it and keep the pattern consistent).
- [ ] **Step 2:** Update `test_resolve_manifest.py` asserted filename to `example-scripts.md`; if `resolve_manifest` resolves paths from facets.md only, no code change is needed — run `python -m pytest orgs/faceless-youtube/.claude/skills/proxy-judge/scripts/test_resolve_manifest.py -v` → PASS. If the path is hard-coded anywhere in proxy-judge scripts, update it.
- [ ] **Step 3:** Sweep the check-only files; fix hits per Global Constraints.
- [ ] **Step 4:** decisions.md entry (dated 2026-07-28): blind protocol retired (reverses 2026-07-26 blind-validation plan — reason: Bricks became a teaching exemplar; acceptance is a directly-reviewed fresh run); example-scripts.md replaces personable-calibration (channel data with the channel; grows with approved excerpts); excerpt cuts = taste verdicts, grammar examples now drawn only from approved text; hook shapes open set + doorway/wink/gloss sanctioned by REWORDING (alternatives rejected: exception lists — Daniel: change the rule, don't bolt on); writer owns cultural pulls with WebSearch license in 3a (alternative rejected: researcher-side analogy section — Daniel: belongs in writer); voice dials 0.20/0.6. STATUS.md: one-line current-state update.
- [ ] **Step 5:** Commit: explicit paths; `git commit -m "chore(fyt): judge/facets/tests retarget to example-scripts; blind retirement recorded"`.

### Task 5: Voice dials — verify then edit dna.md

**Files:**
- Read: `.claude/skills/voiceover/scripts/voiceover.py` (how `stability`/`style` reach the ElevenLabs v3 call; any clamping/validation)
- Modify: `channels/the-second-take/dna.md` (Voiceover config YAML + the Voice ID prose bullet)

**Interfaces:**
- Produces: `stability: 0.20`, `style: 0.6` consumed by the voiceover skill at the next VO run.

- [ ] **Step 1:** Read voiceover.py; confirm arbitrary floats pass through to the API for `eleven_v3` (the 0.25 in production proves floats are accepted; confirm nothing clamps or special-cases style). If v3 constrains values, STOP and report to the boss instead of editing.
- [ ] **Step 2:** Edit dna.md YAML: `stability: 0.20`, `style: 0.6`. Rewrite the stability comment: chosen 2026-07-28 (Daniel: more variance + vocal emphasis; supersedes the 0.25 lock); the 0.25-era consistency proof no longer covers these values — re-proof by ear on the next real VO render. Update the Voice ID prose bullet's "stability 0.25" mention to match. Change nothing else in dna.md.
- [ ] **Step 3:** Commit: `git add channels/the-second-take/dna.md; git commit -m "feat(fyt-voice): stability 0.20 / style 0.6 for vocal emphasis (Daniel 2026-07-28)"`.

### Task 6: GATE ② — Bricks exemplar final text (human)

- [ ] **Step 1:** Daniel approves/edits the polished Bricks intro (presented in-session).
- [ ] **Step 2:** Write the final text into `example-scripts.md`, remove the `PENDING` marker; sync any grammar/SKILL quotes of the provisional text to the approved wording (grep `"the title gives it away"`, `"big hair"`, `"everything it remembers"` across scope and match).
- [ ] **Step 3:** Full acceptance grep (Global Constraints purge list, whole scope) + `python -m pytest` on both test files (`test_resolve_manifest.py`, `test_lint_script.py`) → all PASS.
- [ ] **Step 4:** Commit: `git add channels/the-second-take/example-scripts.md` (+ any synced files); `git commit -m "feat(fyt): Bricks era-drop-in exemplar approved and locked into example-scripts.md"`.

### Task 7: GATE ③ — fresh Bricks run (the acceptance test)

- [ ] **Step 1:** Create scratch folder `channels/the-second-take/videos/2026-07-28-bricks-fresh/` with COPIES of `2026-07-10-bricks/brief.md` and `research.md`. Untracked scratch; do not commit; do not touch `idea-backlog.md` status or the original folder.
- [ ] **Step 2:** Dispatch a fresh worker to run the `long-form-writer` skill on that folder (staged mode, full critic cycle incl. humanizer, zero spend), treating the copied brief+research as the picked input. The worker follows the NEW docs only.
- [ ] **Step 3:** Boss spot-checks lint output and the changelog honesty, then hands `script.md` to Daniel (open in VS Code) with the old script side-by-side for comparison. Daniel judges: does it hit the bar?
- [ ] **Step 4:** Route Daniel's verdict per operating-law §G: fixes go to the responsible doc, never the artifact; delete scratch when done, or keep per his call.

## Self-review (done at write time)

- Spec coverage: rulings 1→Task 1/4, 2→Task 1/6, 3→Task 2, 4/5/6→Task 2/3, 7→Task 3, 8→Task 5, 9→scope lines; acceptance 1→Task 6 Step 3, acceptance 2→Task 7. No gaps.
- Purge/pointer names consistent across tasks (`example-scripts.md`, exact grep strings).
- Execution: Tasks 1–3 = one Opus doctrine worker (coherence across the four core files); Task 4 = Sonnet worker after core lands; Task 5 = Sonnet worker in parallel; Tasks 6–7 gated on Daniel.
