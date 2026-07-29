# The Hidden Machine — first-pass channel infrastructure (genesis) — design spec

**Date:** 2026-07-28 · **Owner:** boss session (orchestrator) · **Status:** awaiting Daniel's spec review

## 1. Goal

Build the complete, end-to-end, first-pass infrastructure for a second channel,
**The Hidden Machine** (concept **A1** from the 2026-07-14 niche board: the invisible
infrastructure of daily life — hidden-systems 2.5D explainers), so that a first video run
can start with every upstream file a pipeline skill reads already in place.

**Success condition:** `channels/the-hidden-machine/` exists with every infrastructure file
either built and human-gated, or explicitly listed in `TO-DEVELOP.md` as first-video-dependent;
every per-video pipeline skill's channel-side inputs resolve; nothing pretends to be locked
that isn't. No video content is produced or iterated in this pass.

## 2. Decisions already made (Daniel, 2026-07-28 session)

| Axis | Decision |
| --- | --- |
| Concept | A1 · The Hidden Machine (niche-board recommendation; name itself re-confirmed at step 1) |
| Conductor | **Boss-driven.** channel-forge stays parked as machinery; its 12 genesis stages + recipes are the plan skeleton and reference. Friction/learnings logged back for the forge. |
| Visual generation | **Deferred.** Style-bible + visual-grammar built as draft docs (structure + direction); zero image-gen spend; style-lock sweeps owed later. |
| Voice | **Live.** Real ElevenLabs voice-lab auditions; new voice mandatory (never reuse Miles); fresh dials — ST's 2026-07-28 dial values are un-proofed, do not inherit. |
| Audio kit | **Copy over** ST's SFX/music pools + attribution (generic CC0/CC-BY assets, not taste-locked). |
| Storytelling grammar | **Copy ST's `storytelling-grammar.md` and adapt** the register to hidden-systems. No teardown/measurement wave in this pass. |
| Content-dependent pieces | **Leave out**: `example-scripts.md` voice bar, proxy-me/proxy-judge facet + calibration, visual registry canonical seeds, brand art. Tracked in `TO-DEVELOP.md`; developed during video dev. |
| Content iteration | None. Infrastructure only. |
| Delegation | Boss orchestrates; all substantive builds dispatched to subagents ≤ Opus per BOSS.md routing; model verified at grading via transcript grep. |

## 3. Process contract (binding for the run)

1. **Pre-step gate:** before each step is built, the boss asks Daniel that step's clarifying /
   scope / taste / goal-function questions. No step builds on assumed taste.
2. **Post-step summary:** after each step, the boss summarizes what was built; Daniel iterates
   or says continue.
3. Gates presented **one at a time, at their plan position** (kb memory rule).
4. Dispatched workers get deep briefs: exact files in scope, norms (operating-law clauses),
   what NOT to touch, acceptance criteria. Graded before acceptance; first grade line = model
   grep of the subagent transcript.
5. Branch: `claude/hidden-machine-genesis` (cut from `claude/fyt-writer-grammar-slim`,
   2026-07-28). Work products only; explicit-path staging (`git add <paths>`, never `-A`/`-a`).
6. Second Take files are **donors, never modified**. The pre-existing uncommitted
   `visual-prompt-writer/references/shots-schema.md` edit and `videos/2026-07-28-bricks-fresh/`
   belong to another effort — untouched.

## 4. Plan skeleton (14 steps)

Forge stage order, re-sequenced for dependencies + scope decisions. Per-file source verdicts
in §5.

| # | Step | Output | Gate |
| --- | --- | --- | --- |
| 0 | Scaffold: channel dir from `channels/_TEMPLATE/` | `channels/the-hidden-machine/` skeleton | confirm |
| 1 | Identity lock: name, handle, premise, audience, differentiation vs ST and vs incumbents | `dna.md` §Identity | taste |
| 2 | Reference-channels board: hidden-systems space survey, dimension learnings | `reference-channels.md` | review |
| 3 | Doctrine: the ONE emotional lever | `dna.md` §Doctrine | taste |
| 4 | Format + pipeline flags: length band, structure, `research:` mode, cadence | `dna.md` §Format/Pipeline | decision |
| 5 | Niche playbook (new shared-layer file) | `knowledge/research/niche-playbooks/hidden-systems.md` | review |
| 6 | Storytelling grammar: copy ST's, adapt register; inline examples handled per §6 note | `storytelling-grammar.md` | taste |
| 7 | Visual identity direction + style-bible DRAFT + visual-grammar DRAFT (no generation) | `visual-kit/style-bible.md`, `visual-kit/visual-grammar.md` (draft-status headers) | taste |
| 8 | Voice lab: ElevenLabs auditions → locked voice + fresh dials | `voice-lab/`, `dna.md` §Voiceover | **ear** |
| 9 | Audio kit: copy ST pools + attribution; fresh tokens from template, retired dead fields stripped | `visual-kit/audio/`, `audio-tokens.json`, `motion-tokens.json` | confirm |
| 10 | Guardrails + capability-map | `dna.md` §Guardrails, `capability-map.json` | review |
| 11 | Idea backlog: `idea-generator` run, ranked briefs | `idea-backlog.md` | pick |
| 12 | Channel page draft + to-develop tracker | `channel-page.md`, `TO-DEVELOP.md` | review |
| 13 | Close-out: STATUS, decisions.md entries, `_index`/dashboard touch, forge-friction log, worktree/scratch sweep | housekeeping | done |

Steps 2 and 5 may run partially in parallel (both research-shaped); everything else is
sequential on its gate.

## 5. Source verdict per infrastructure file

| File | Source | Note |
| --- | --- | --- |
| `dna.md` | `_TEMPLATE/dna.md`, fields decided at gates 1/3/4/8/10 | never copy ST values |
| `storytelling-grammar.md` | **copy ST + adapt** (Daniel override of the fresh-measure default) | vindication/money register → hidden-systems register; joke toolbox + structure survive |
| `example-scripts.md` | **absent** | TO-DEVELOP: seeded by first approved script excerpts |
| `reference-channels.md` | fresh (method reused from ST's board) | Tier-3 channel-specific by definition |
| `idea-backlog.md` | fresh via `idea-generator` | new prefix (decided step 1) |
| `performance.md` | template | empty log |
| `visual-kit/style-bible.md` | fresh DRAFT; ST doc structure (current trimmed version) as skeleton | no pixels; sweep plan documented inside |
| `visual-kit/visual-grammar.md` | fresh DRAFT on `universal.md §13` | staging bends to this channel's lever |
| `visual-kit/registry/registry.json` | empty seed | TO-DEVELOP: canonicals need image-gen |
| `motion-tokens.json` / `audio-tokens.json` | template values, fresh | strip retired fields ST's copies still carry (engine-drawn text cards, whip entrances, `audio_layer`, baked `[PAUSE]`) |
| `visual-kit/audio/` (pools, manifest, attribution) | **copy ST** | generic licensed assets; attribution file must move with them |
| `voice-lab/voice-lab.md` | fresh (ST's file is the method exemplar) | new voice, fresh dials, ear-gated |
| `capability-map.json` | `_TEMPLATE/capability-map.example.json` | pipeline = `stylized-compositing` (the one built pipeline) |
| `channel-page.md` | copy ST structure, fresh content | Studio application is human-only |
| `TO-DEVELOP.md` | new file (this spec §7 is its seed list) | lives in channel root |
| proxy-me facet for this channel | **absent** | TO-DEVELOP: needs gold script + holdouts; methodology per proxy-me survey |
| `videos/`, `research/` | empty dirs | — |

## 6. Known landmines this plan must honor

- **Grammar inline examples:** post-overhaul, ST's grammar draws inline examples only from
  Daniel-approved `example-scripts.md` excerpts. The Hidden Machine has none. The adapted
  grammar must either carry clearly-labeled placeholder slots or genericized descriptions —
  decided at step 6's pre-gate. It must NOT keep ST's excerpt examples (wrong channel's
  approved content) and must not invent fake "approved" examples.
- **Voice dials:** ST's `stability 0.20 / style 0.6` (2026-07-28) is flagged "re-proof by
  ear" — Hidden Machine derives its own at step 8.
- **`image-generation` hard-errors on unseeded generation** — acceptable in this pass only
  because no generation runs; `TO-DEVELOP.md` must state the base-then-fan-out seeding order
  as the first visual task of video dev.
- **8–10 min format lock is 4 days old and ST-specific** — step 4 decides fresh for this
  niche, informed by, not inheriting, that ruling.
- **channel-forge stage 12 (channel-page) is unproven in Studio** — page stays a draft with
  ST's known caveat.
- **Encoding:** all bulk copies/edits explicit UTF-8, verified by codepoint (F-encoding).

## 7. TO-DEVELOP seed list (what first-pass deliberately does not build)

1. `example-scripts.md` voice bar — from first Daniel-approved script excerpts.
2. proxy-judge story facet: calibration set (5-source mining), 2–3 blind holdouts,
   agreement report ≥80% verdict-match — after gold script #1 exists.
3. Visual style-lock: sweeps → locked rig/palette/recipe → canonical base cast +
   env anchors → `registry.json` seeds (base-then-fan-out; image-gen spend gate).
4. Brand art (avatar/banner) — blocked on style lock.
5. Channel-page application in Studio + real handle/URL — human, after branding.
6. Grammar re-measure decision: after N videos, judge whether the copied-adapted grammar
   needs a real teardown wave (explicitly skipped in first pass).
7. Voice consistency proof at the locked dials (ST's method).

## 8. Out of scope

Any video content (script, shots, VO takes kept beyond audition snippets, renders); YouTube
account/handle creation; Studio changes; image generation of any kind; modifying Second Take
or shared skills (exception: adding the new niche playbook file, which is additive shared
data); unparking channel-forge machinery.
