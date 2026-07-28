# The Hidden Machine — Genesis Implementation Plan

> **For agentic workers:** this plan is executed by the BOSS SESSION step-by-step with a human
> gate between tasks (Daniel's explicit process contract — spec §3). Do NOT batch-execute.
> Each task: pre-gate questions → dispatch build to a ≤Opus worker → grade (first line = model
> grep of subagent transcript) → post-step summary → Daniel iterates or continues.

**Goal:** Stand up `channels/the-hidden-machine/` so every channel-side input a pipeline skill
reads exists, is human-gated, or is tracked in `TO-DEVELOP.md`.

**Architecture:** Boss-driven walk of channel-forge's 12 genesis stages (forge machinery stays
parked), donor = `channels/the-second-take/`, template = `channels/_TEMPLATE/`.

**Spec:** `docs/superpowers/specs/2026-07-28-hidden-machine-genesis-design.md` (binding; §5
source verdicts, §6 landmines, §7 TO-DEVELOP seed list).

## Global Constraints

- Branch `claude/hidden-machine-genesis`; stage explicit paths only; never `git add -A` / `commit -a`.
- Second Take files are read-only donors. Do not touch `videos/2026-07-28-bricks-fresh/` or the
  uncommitted `shots-schema.md` edit (other effort's work).
- No image generation, no video content, no Studio/account actions.
- All file writes explicit UTF-8; verify bulk copies by codepoint (operating-law F-encoding).
- Worker models per BOSS.md: haiku mechanical / sonnet standard / opus taste-critical synthesis.
  Never fable. Grade before accepting; ungrepped grade invalid.
- Dates in artifacts: absolute, from session current date.
- Paths below are relative to `orgs/faceless-youtube/`.

---

### Task 0: Scaffold channel directory

**Files:** Create `channels/the-hidden-machine/` from `channels/_TEMPLATE/` (copy all files/dirs;
inventory `_TEMPLATE` first — known: `dna.md`, `performance.md`, `idea-backlog.md`,
`capability-map.example.json`, `videos/`).

**Pre-gate questions:** none beyond dir-name confirm — working name `the-hidden-machine`;
if Task 1 renames the channel, `git mv` then.

- [ ] Inventory `_TEMPLATE` (`ls -R`); note any tokens/visual-kit templates present vs absent
- [ ] Copy template → `channels/the-hidden-machine/` (haiku worker or inline — mechanical);
      create empty `research/`, `visual-kit/`, `voice-lab/` dirs if template lacks them
- [ ] Verify: every copied file byte-identical to template (`git diff --no-index`), no ST content
- [ ] Commit: `feat(fyt): scaffold the-hidden-machine channel from _TEMPLATE`
- [ ] Post-step summary → Daniel continue/iterate

### Task 1: Identity lock → `dna.md` §Identity

**Files:** Modify `channels/the-hidden-machine/dna.md` (Identity section only).

**Pre-gate questions (Daniel):**
1. Channel name: lock "The Hidden Machine" or alternatives?
2. Handle/URL preference (record as *desired*, not registered)?
3. Premise one-liner — board's is "the invisible infrastructure of daily life — the system is
   the character"; keep or reword?
4. Target viewer (ST is US/English, general-curious; same here or narrower/techier)?
5. Idea-ID prefix for the backlog (ST uses `ST-###` — `HM-###`?)
6. Differentiation stance vs The Second Take (no money-story overlap rule?) and vs incumbents
   (Wendover/RealLifeLore/Animagraffs) — what's OUR wedge in one sentence?

- [ ] Dispatch sonnet worker: draft Identity section into `dna.md` using Daniel's six answers +
      niche-board A1 card; scope = Identity section only; acceptance = every answer reflected
      verbatim-faithful, no invented facts, template section headers preserved
- [ ] Grade (model grep first line), fix or re-dispatch until clean
- [ ] Present diff to Daniel [taste gate]
- [ ] Commit: `feat(fyt): hidden-machine identity locked (Daniel YYYY-MM-DD)`

### Task 2: Reference-channels board → `reference-channels.md`

**Files:** Create `channels/the-hidden-machine/reference-channels.md` (structure donor:
`channels/the-second-take/reference-channels.md` — tier system + dimension-learnings format).

**Pre-gate questions (Daniel):**
1. Candidate incumbents to include/exclude (default sweep: Wendover, RealLifeLore, Half as
   Interesting, Animagraffs, Practical Engineering, New Mind, Branch Education + discoveries)?
2. Any channel you specifically admire/want studied for this niche?

- [ ] Dispatch 2 sonnet research workers in parallel (web): per channel — format, length,
      upload cadence, visual approach, hook style, what works/doesn't, sub/view scale; write
      findings incrementally to scratchpad
- [ ] Dispatch sonnet synthesis worker: build `reference-channels.md` in ST's board structure
      (tiers, per-dimension learnings); acceptance = every claim traceable to a finding, no
      copied ST learnings, explicit "informs, never copy" header
- [ ] Grade both stages (model grep)
- [ ] Present board [review gate]
- [ ] Commit: `feat(fyt): hidden-machine reference-channel board`

### Task 3: Doctrine → `dna.md` §Doctrine

**Files:** Modify `channels/the-hidden-machine/dna.md` (Doctrine section).

**Pre-gate:** present 3–4 lever OPTIONS side by side (operating-law §E: options, not one answer),
e.g. awe-of-the-invisible ("you'll never see X the same way"), scale-shock, competence-reverence
(the system as unsung hero), fragility-tension (one bolt from chaos) — each with: the feeling,
a sample framing of the same topic (the container port), and what it rules out. Daniel picks ONE.

- [ ] Draft options inline (boss judgment work) using Task-2 board + niche-board card
- [ ] Daniel picks [taste gate]
- [ ] Dispatch sonnet worker: write Doctrine section (one lever, definition, what it licenses/
      forbids) mirroring ST dna.md's doctrine section shape; acceptance = single lever, no
      hedged dual-lever, consistent with picked option text
- [ ] Grade; present diff; commit: `feat(fyt): hidden-machine doctrine — <lever> lever locked`

### Task 4: Format + pipeline flags → `dna.md` §Format/§Pipeline

**Files:** Modify `channels/the-hidden-machine/dna.md` (Format + Pipeline sections).

**Pre-gate questions (Daniel):**
1. Length band (ST just ruled 8–10 min for its niche; same, or different here)?
2. Structure default: single-system deep-dive per video vs multi-system themed episodes?
3. Research mode: `research: deep` (fact-heavy niche — recommended) or `none`?
4. Shorts stance: funnel-only (the A1 card's noted catch) — confirm?
5. Cadence target for planning purposes?

- [ ] Dispatch sonnet worker: write Format + Pipeline sections per answers, ST dna.md as shape
      donor; acceptance = all five answers encoded, pipeline flags valid per `_TEMPLATE/dna.md`
      schema (`research`/`topic_scouting`/`long_form`)
- [ ] Grade; present diff [decision gate]; commit: `feat(fyt): hidden-machine format + pipeline flags`

### Task 5: Niche playbook → `knowledge/research/niche-playbooks/hidden-systems.md`

**Files:** Create `knowledge/research/niche-playbooks/hidden-systems.md` (shared layer — additive
only; shape donor: `niche-playbooks/business-money.md`; must compose with `universal.md`, never
duplicate it).

**Pre-gate questions (Daniel):** none expected beyond Task 1–4 outputs; confirm go.

- [ ] Dispatch sonnet worker: author playbook — niche-specific exemplars (from Task-2 board),
      title formulas, original-angle formats, hook patterns, one worked example (container port
      or ocean-cable topic), pitfalls (dry-explainer trap, Wikipedia-recap unoriginality risk);
      acceptance = zero overlap with universal.md content, every exemplar real (named channel +
      verifiable video), fits existing playbook file pattern
- [ ] Grade; present [review gate]; commit: `feat(fyt): hidden-systems niche playbook`

### Task 6: Storytelling grammar → `storytelling-grammar.md` (copy-adapt)

**Files:** Create `channels/the-hidden-machine/storytelling-grammar.md` from
`channels/the-second-take/storytelling-grammar.md` (copy, then adapt).

**Pre-gate questions (Daniel):**
1. ST's wit-abundance default — keep as-is, dial up, or dial down for this register?
2. Inline examples: ST's are drawn only from its approved excerpts and CANNOT come along
   (spec §6). Placeholder slots ("[example seeded from first approved script]") or genericized
   descriptions until the voice bar exists?
3. What of ST's register explicitly must NOT survive (vindication framing, con-story beats,
   money-stakes language)?
4. Anything hidden-systems-specific to add (e.g. scale-comparison moves, cutaway-reveal beats)?

- [ ] Copy ST grammar byte-identical, commit the raw copy first (clean diff base):
      `chore(fyt): copy ST storytelling grammar as hidden-machine adaptation base`
- [ ] Dispatch opus worker (taste-critical synthesis): adapt per answers + locked doctrine/format;
      acceptance = no ST-approved excerpt text remains, no money/vindication register residue,
      joke toolbox + story-shape architecture preserved, example slots per Daniel's answer 2,
      diff reviewable section-by-section
- [ ] Grade (model grep); present diff [taste gate]
- [ ] Commit: `feat(fyt): hidden-machine storytelling grammar — ST grammar adapted to <lever> register`

### Task 7: Visual identity direction + draft docs

**Files:** Create `channels/the-hidden-machine/visual-kit/style-bible.md` (DRAFT header) and
`visual-kit/visual-grammar.md` (DRAFT header). Structure donors: ST's current (trimmed) files.

**Pre-gate:** present 3 visual-direction OPTIONS (text descriptions only — no generation):
e.g. (a) diagram-forward 2.5D cutaway world (Animagraffs-adjacent, system-as-character, no host),
(b) ST-style stylized cast BUT cast = anthropomorphized systems/objects, (c) clean-vector
schematic + occasional human-scale inserts. Each: palette family, cast implications, motion
implications, distance from ST's look. Daniel picks direction + palette family + cast stance.

- [ ] Draft options inline (boss); Daniel picks [taste gate]
- [ ] Dispatch opus worker: author BOTH drafts — style-bible carries ST's section architecture
      (§-numbering, verify-gate, seed rules, base-then-fan-out protocol) with this channel's
      direction filled in and every generation-dependent value marked `DRAFT — locked at
      style-lock sweep`; visual-grammar layered on `universal.md §13`, staging rules translated
      from the locked lever; acceptance = zero ST palette/rig/cast values copied, DRAFT status
      + sweep plan section present, no claim of locked anything
- [ ] Grade; present both [review of taste docs — second gate]
- [ ] Commit: `feat(fyt): hidden-machine visual-kit drafts — style-bible + visual-grammar (pre-sweep)`

### Task 8: Voice lab → locked voice + dials

**Files:** Create `channels/the-hidden-machine/voice-lab/voice-lab.md` (method donor: ST's
voice-lab.md — rounds format); modify `dna.md` §Voiceover.

**Pre-gate questions (Daniel):**
1. Voice direction: gender/age/energy priors for this register, or fully open audition?
2. Audition text: I draft a ~60–80-word standard test paragraph in the new register — approve
   before generation.
3. Spend confirm: ElevenLabs credit use for audition batches (N voices × 1 snippet, then
   finalists × dial variants) — approve batch sizes.

- [ ] Draft audition paragraph; Daniel approves text + batch [spend gate]
- [ ] Round 1: shortlist candidate voices (ElevenLabs library search per priors); generate one
      snippet each via the voiceover skill's TTS path (worker: sonnet, executing the skill —
      never hand-rolled API calls); files to `voice-lab/auditions/round-1/`
- [ ] Present round-1 snippets — device-player paths inlined [ear gate]; iterate rounds as
      Daniel directs (log each round in voice-lab.md as it happens, ST format)
- [ ] Finalist round: dial variants (stability/style grid — fresh values, NOT ST's un-proofed
      0.20/0.6) [ear gate → lock]
- [ ] Write lock into `dna.md` §Voiceover (voice ID, dials, "consistency proof owed" note per
      spec §7.7); commit: `feat(fyt): hidden-machine voice locked — <name> (Daniel ear-gate YYYY-MM-DD)`

### Task 9: Audio kit copy + fresh tokens

**Files:** Copy `channels/the-second-take/visual-kit/audio/` → `channels/the-hidden-machine/
visual-kit/audio/` (pools, manifest, attribution — attribution MUST move with assets). Create
`visual-kit/audio-tokens.json` + `visual-kit/motion-tokens.json` fresh.

**Pre-gate questions (Daniel):**
1. Copy ST's pools wholesale, or prune comedy-specific SFX that fight the new register?
2. Token values: start from template/neutral defaults (recommended) or from ST's values minus
   retired fields?

- [ ] Verify template token files exist in `_TEMPLATE`; if absent, derive minimal valid schema
      from ST's files MINUS the retired fields listed in `docs/retired-features.md`
      (engine-drawn text/device cards, whip entrances, `audio_layer` block, baked `[PAUSE]`)
- [ ] Dispatch haiku worker: copy audio tree + write tokens per answers; acceptance = attribution
      file present and complete, manifest paths rewritten to new channel, retired fields absent,
      JSON valid (`python -m json.tool`)
- [ ] Grade; spot-check by codepoint (F-encoding); present [confirm gate]
- [ ] Commit: `feat(fyt): hidden-machine audio kit (ST pools) + fresh motion/audio tokens`

### Task 10: Guardrails + capability-map

**Files:** Modify `dna.md` §Guardrails; create `channels/the-hidden-machine/capability-map.json`
from `_TEMPLATE/capability-map.example.json`.

**Pre-gate questions (Daniel):**
1. Accuracy bar: fact-heavy niche — require researcher fact-ledger citations for every
   mechanism claim (recommended)?
2. Any topic exclusions (e.g. active-disaster systems, security-sensitive infrastructure detail)?
3. AI-disclosure stance: ST scratched it for animated register — same call here?

- [ ] Dispatch sonnet worker: Guardrails section (answers + playbook non-negotiables) +
      capability-map.json with `production_pipeline: stylized-compositing`, per-slot verdicts
      honest (visual slots = `build` pending sweeps, voice = `built`, audio = `reuse`);
      acceptance = validates against `capability-map-schema.md` (run the forge's
      `validate_capability_map` script if runnable), no slot claims beyond real state
- [ ] Grade; present [review gate]; commit: `feat(fyt): hidden-machine guardrails + capability map`

### Task 11: Idea backlog seed

**Files:** Modify `channels/the-hidden-machine/idea-backlog.md` (template file → seeded).

**Pre-gate questions (Daniel):** target count for first-pass backlog (default 10 ranked briefs)?
Any must-include topics (board suggested: text message across the ocean floor, container-port
choreography, the 6 seconds after you tap Pay)?

- [ ] Invoke `idea-generator` skill (worker: sonnet) against the completed dna.md + playbook +
      empty performance.md; acceptance = skill's own output contract (ranked briefs, `HM-###`
      IDs, differentiation notes), zero ST-overlap topics
- [ ] Grade; present ranked list [pick/review gate — picking a first video is OPTIONAL, not in
      first-pass scope]
- [ ] Commit: `feat(fyt): hidden-machine idea backlog seeded (N briefs)`

### Task 12: Channel page draft + TO-DEVELOP tracker

**Files:** Create `channels/the-hidden-machine/channel-page.md` (structure donor: ST's file;
fresh content; carries "unproven in Studio" caveat). Create `channels/the-hidden-machine/
TO-DEVELOP.md` from spec §7's seven items, each with: what, why deferred, trigger condition,
owning skill/procedure pointer.

**Pre-gate questions (Daniel):** links to list on the page (none exist yet — placeholder policy)?

- [ ] Dispatch sonnet worker: both files; acceptance = channel-page keeps ST's genre skeleton
      (bimodal About, keywords, Studio checklist) with zero ST copy text; TO-DEVELOP lists all
      seven §7 items + anything new tasks surfaced, each with trigger + pointer
- [ ] Grade; present [review gate]
- [ ] Commit: `feat(fyt): hidden-machine channel page draft + TO-DEVELOP tracker`

### Task 13: Close-out

**Files:** Modify `docs/STATUS.md` (new channel section), `knowledge/decisions.md` (append:
channel genesis decisions — conductor call, grammar copy-adapt call, deferred-generation call,
with alternatives rejected), repo-root `index.html` (dashboard: new channel + Last-updated bump),
`orgs/faceless-youtube/STATE.md` (kb layer). Create `docs/superpowers/
2026-07-28-hidden-machine-forge-friction.md` (what the forge's recipes got right/missed —
feeds future unpark decision).

- [ ] Dispatch sonnet worker: STATUS + decisions + STATE edits (integrate-in-place, F-docs);
      boss writes friction log inline (orchestrator's own observations)
- [ ] Update index.html (worker; material knowledge change per operating-law §A)
- [ ] Sweep: scratchpad survey files noted-or-deleted, no stray untracked files in repo
      (`git status` — only intended paths)
- [ ] Grade; final summary to Daniel with full file inventory + every gate outcome
- [ ] Commit: `docs(fyt): hidden-machine genesis close-out — status, decisions, friction log`
- [ ] Append lessons to kb `memory/claude-boss.md` (boss, inline)

---

## Self-review (done at authoring)

- Spec coverage: §4 steps 0–13 all present; §5 verdicts encoded in Tasks 0/6/7/9/10/12; §6
  landmines → Tasks 6 (examples), 8 (dials), 9 (retired fields), 12 (Studio caveat); §7 → Task 12.
- No placeholder work items: gate-dependent content is encoded as the exact questions that
  resolve it — deliberate, per process contract, not TBD.
- Consistency: channel dir name `the-hidden-machine` used throughout; rename contingency Task 0.
