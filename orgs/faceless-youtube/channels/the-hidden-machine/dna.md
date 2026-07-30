# Channel DNA — The Hidden Machine

The frozen identity of one channel. Written once during setup, then referenced by every per-video
task. Fields marked TODO are set at channel creation (genesis in progress — see
`docs/superpowers/plans/2026-07-28-hidden-machine-genesis-plan.md`).

## Identity

- **Channel name:** The Hidden Machine  *(origin: concept A1, 2026-07-14 channel-forge niche board)*
- **Handle:** `@TheHiddenMachine` — **desired only; nothing registered.** Verify availability before
  the real YouTube channel is created.
- **Premise (locked):** the invisible infrastructure of daily life — **the system is the character.**
- **Niche:** everyday-infrastructure / mechanism-explainer  (see `knowledge/research/niches.md`)
- **One-line promise:** what's actually happening, right now, behind the ordinary thing you just
  did — tap Pay, send a text, flush, flip a switch — the machine behind the moment.
- **Original angle / POV — the wedge ("behind one everyday action"):** every video starts from a
  mundane human moment (tap Pay, send a text, flush, flip a switch) and descends into the machinery
  behind it; the hook is the viewer's own life. Differentiation vs. incumbents (Wendover,
  RealLifeLore, Animagraffs): they explain topics; we open inside YOUR ordinary second.
  **Boundary vs. The Second Take (sister channel):** mechanism-explainers are in-bounds here even on
  money-adjacent systems (e.g. what happens after you tap Pay) — The Second Take owns narrative
  money STORIES (cons, collapses, characters). No topic here may be a re-skin of a Second Take story.
- **ID prefix:** `HM-###`
- **Audience / region / language:** US, English; general-curious — no technical background assumed,
  concrete, story-led explainers (same register altitude as The Second Take's audience definition,
  different subject).

## Doctrine (universal.md §1a — one lever per channel, never per video)

- **Locked emotional lever (2026-07-28, Daniel):** **Scale-shock** — the disproportion between the
  viewer's tiny, ordinary action and the colossal machinery that action sets in motion ("I did
  THAT?"). It is the §1a **awe** lever (perceived vastness that dwarfs the self) narrowed to one
  specific trigger: the gap between a human-scale input and a civilization-scale consequence,
  measured in orders of magnitude. Register sample (spirit, not a script template): cold open —
  *"Your thumb moved one centimeter. That started a relay across 14,000 miles — 200,000 tons of
  steel began moving because of it."* Every idea and script must make that gap **felt**, not just
  stated — this is the load-bearing brand decision; cross-lever content gets flagged as slop by the
  policy classifier and by the human audience.
- **What it licenses:** earned magnitude contrasts — the human action must be genuinely small and
  the system response genuinely large, never inflated to fit; scale-facts (weight, distance, count,
  speed) doing the emotional work directly rather than decorating it — concrete-object +
  startling-number is the proven converter (`reference-channels.md` §2, Branch Education's
  transistor-count hook); an arc that runs **vertigo → wonder**, landing on revelation ("the
  machine was always this big; you just never looked") — **never on dread.**
- **Named refusals:** no topic where the true scale is modest — never inflate a number to
  manufacture the lever where it isn't earned; no alarmism / fragility-porn (the system is
  fragile, could fail, should scare you) — that is a different channel's lever, rejected
  2026-07-28; no comedic-deflation register (Half as Interesting's lane — the punchline undercuts
  the scale instead of landing it); no competence-lecture register (Practical Engineering's lane —
  admiration for the engineers/design, not vertigo at the size); never open on the object or the
  structure itself — the wedge requires opening inside the human action, before the machine is
  named.
- **Lever vs. wedge:** the wedge (open inside the action) is the doorway; scale-shock is what walks
  through it once the door is open.
- **Alternatives rejected at the gate:** awe-of-the-invisible (unenforceable as a script-time
  check — too vague to fail a script against); competence-reverence (Practical Engineering's home
  register, not a wedge onto it); fragility-tension (disaster-adjacent, reads as dread rather than
  the vertigo-then-wonder arc this channel owns).

## Format

- **Primary format:** long-form is the pillar; Shorts are a **derived funnel, not a pillar** (A1 card
  stance, locked Daniel 2026-07-28) — Shorts clip the long-form's scale-shock beats to route viewers
  back to it; they carry no independent format identity of their own.
- **Target length:** **8–10 min** (locked Daniel 2026-07-28, matching The Second Take's 2026-07-28
  ruling — see `the-second-take/dna.md` §Format) — **avoid the 16–24 min death zone.**
- **Shorts per long-form:** TODO — from the niche cadence band (business 2–4 / what-if 3–6 /
  AI tools 2–3 / engineering 1–3 / horror-lore 4–8 / micro-health 3–5). See universal.md §10.
- **Cadence:** TBD — deliberately unset (Daniel 2026-07-28); decided after first videos, not a
  genesis field.
- **Recurring structure (flexible per idea, decided at brief time — locked Daniel 2026-07-28):** no
  single shape frozen at genesis. **Preferred default** when one system chain honestly fills 8–10
  minutes: **one action → one descent** — the wedge's single mundane action, followed down one
  mechanism chain to its civilization-scale consequence. **Licensed alternative** when a single chain
  cannot honestly fill the runtime: **one action → branching systems** (or multi-action) — the same
  opening action fans out into more than one system instead of one straight descent. **The test is
  content density, never padding:** branch only because the honest single-chain descent runs short —
  never to stretch a thin system to fill the clock. Padding a thin system to reach the runtime
  violates the doctrine's earned-magnitude rule (Doctrine §"What it licenses" above — the human
  action must be genuinely small and the system response genuinely large, never inflated to fit).
  Structure is picked per brief, not locked here.

## Pipeline (machine-read by idea-generator / researcher / the scriptwriters)
<!-- Routes this channel through the pipeline. Skills read these flags to pick the path; a channel
     with no block defaults to the lightweight path (research: none / topic_scouting: stored /
     long_form: single) so a new channel never silently triggers the expensive route. -->
```yaml
research: deep                           # REQUIRED (locked Daniel 2026-07-28) — this is a
                                          # scale-claims channel: every number in a script (weight,
                                          # distance, count, speed) must trace to a research dossier
                                          # fact-ledger. Insert the researcher stage (idea →
                                          # researcher → long-form-writer).
research_scope: capped-to-descent-chain  # NOT unbounded deep-research (locked Daniel 2026-07-28,
                                          # verbatim problem: full deep-research "goes way deeper
                                          # than I want and burns 10M tokens in a sitting"). Scope the
                                          # dossier to the single descent chain the video needs (or
                                          # the chosen branches, if "one action → branching systems"
                                          # was picked at brief time) — breadth capped to what the
                                          # video actually uses, not the topic's full extent. Explicit
                                          # token discipline: capped/medium research budget, never the
                                          # unbounded deep-research default.
                                          # VERIFY BEFORE FIRST VIDEO: the `researcher` skill's
                                          # cap-handling has not yet been checked against this field
                                          # as of 2026-07-28 — confirm it actually honors the cap
                                          # before running research on the first picked idea.
topic_scouting: stored  # live = idea-generator does live web topic-scouting every run. stored =
                        #        riff from stored knowledge/playbooks unless asked to go live.
long_form: single       # staged = long-form writers-room (outline → section drafts → accuracy/
                        #        quality editor pass → humanize; resists sag over 2,500 words).
                        #        single = one-pass scriptwriter + humanize.
```

## Voice & style

- **Voice ID (locked):** `iP95p4xoKVk53GoZ742B` — ElevenLabs "Chris" (Daniel ear-gate 2026-07-29,
  revocable "for now"; full config + consistency-proof-owed note in §Voiceover config below)
- **Tone:** TODO — e.g. authoritative-calm / dramatic-narration / conversational
- **Script/voice register (locked):** TODO — the **default is plain-concrete-specific** (Explains101 /
  Crayon Capital: lead with the fact, quiet true emotion — curiosity, sympathy, recognition). Choose the
  **loud/dread** register *only* for a niche that earns it (horror-internet-lore, a collapse story), and
  even then it must ride on concrete substance. No trailer-voice / empty portent. See universal.md §1d-R.
- **Narrator persona (locked):** TODO — the recognizable *person* who narrates every video (a few
  traits, e.g. "dry, curious, unimpressed by hype, explains like a smart friend at a bar"). The
  scriptwriter writes toward this person; the narrator is the brand/moat (§1d-V, §13). Keep it stable
  across videos.
- **Humor dial (locked):** TODO — `off` / `dry-sprinkle` / `comedic`. Niche defaults:
  **dry-sprinkle** for what-if / history / general explainer; **off (earnest)** for finance & YMYL
  (they win on relatability + analogy, not jokes); **dark-dry** (a `dry-sprinkle` variant) for
  dread/morbid — joke about the mundane detail, never the danger, payload stays sincere. Rules in
  §1d-V: sparse (~1 drop / 20–40s), every joke carries a fact, evergreen cultural references only
  (no meme-chasing).

### Voiceover config (machine-read by the `voiceover` skill)
<!-- The `voiceover` skill reads voice_id + delivery knobs from here. Match settings to the locked
     lever above; see .claude/skills/voiceover/references/voiceover-contract.md for per-lever starting
     points. Only voice_id is required; omit any knob to accept the project default. -->
```yaml
voice_id: iP95p4xoKVk53GoZ742B    # LOCKED 2026-07-29 (Daniel ear gate, "for now" — revocable) — ElevenLabs
                                  # premade "Chris" (Charming, Down-to-Earth). Beat Eric in round 2, then
                                  # held the lock in the 2026-07-30 bricks-slice re-audition (6 library
                                  # challengers). Premade fingerprint caveat on record (voice-lab.md §Round 1).
model_id: eleven_v3               # matches the dials below; v3 ignores use_speaker_boost
stability: 0.10                   # LOWERED 2026-07-30 (Daniel) — max variance/creativity; supersedes the
                                  # ST-adopted 0.20. Proven on the full 103s bricks-slice VO (clean single take)
similarity_boost: 0.85
style: 0.75                       # RAISED 2026-07-30 (Daniel) — "almost perfect" here; 0.70/0.65 auditioned
                                  # and declined. Supersedes the ST-adopted 0.6
use_speaker_boost: true
speed: 1.0
output_format: mp3_44100_128
```
<!-- Consistency proof owed (spec §7.7): dials not yet variance-proofed on Chris across takes —
     measure F0/wpm/pause% at first real HM script before treating the lock as final. -->

- **Script rules:** hook in first 0–5s (Shorts: 1.3–1.8s); establish value in 7s; second-gate
  structure through 30s; micro-interrupt every 30–45s; macro re-hook every 2–3 min; **mandatory
  mid-video re-arm at 55–65% runtime**; withheld peak in final 20% (hard rule); emotional
  payoff — NO "and that's why…" closer; `[B-ROLL]` + `[PAUSE]` markers; humanized (no AI tells);
  visual density weighted to first 60s. Full doctrine in `universal.md`.
- **Visual style:** **R1 "screen-print editorial"** (LOCKED Daniel 2026-07-29, revocable) — riso
  grain, limited rust/teal/mustard/cream inks, registration drift; two render modes (full-texture
  narrative + locked-registration mechanism cutaways) + flat data cards; mostly stills at 1.5–3s cuts
  with eased moves, 15–20 Veo motion beats per video. Full law: `visual-kit/style-bible.md`.
- **Visual register (locked):** **stylized-signature** — the single locked style-token above
  (universal.md §13 lane). **Never** the generic semi-photoreal AI B-roll
  middle (uncanny + identity-less).

## Branding

- **Thumbnail style:** TODO
- **Banner / profile:** TODO
- **Naming conventions for titles:** TODO — proven patterns for this niche

## Guardrails specific to this channel

- (none yet — project-wide compliance in `knowledge/playbook.md` always applies)

## Status

- **Created:** TODO date
- **Autonomy stage:** inherits project Stage 0 unless noted
- **Monetization progress:** subs __ / 1,000 · watch hours __ / 4,000
