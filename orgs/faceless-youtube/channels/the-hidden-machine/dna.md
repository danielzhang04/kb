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

- **Primary format:** TODO — long-form / Shorts / hybrid funnel
- **Target length:** TODO  (see the niche playbook at `knowledge/research/niche-playbooks/<niche>.md`
  §Length band for the validated 2025-2026 range — old universal 8–15 min rule is retired)
- **Shorts per long-form:** TODO — from the niche cadence band (business 2–4 / what-if 3–6 /
  AI tools 2–3 / engineering 1–3 / horror-lore 4–8 / micro-health 3–5). See universal.md §10.
- **Cadence:** TODO — e.g. 1–2 long-form/week + shorts staggered every 2–3 days after each
  long-form (long-form ships first; shorts decoupled algorithmically since late-2025).
- **Recurring structure:** TODO — the repeatable shape (hook → second gate → body cycles →
  mid-video re-arm → withheld peak → emotional close) for this niche's beat template.

## Pipeline (machine-read by idea-generator / researcher / the scriptwriters)
<!-- Routes this channel through the pipeline. Skills read these flags to pick the path; a channel
     with no block defaults to the lightweight path (research: none / topic_scouting: stored /
     long_form: single) so a new channel never silently triggers the expensive route. -->
```yaml
research: none          # deep = insert the researcher stage (idea → researcher → long-form-writer,
                        #        grounds the script in a sourced fact-ledger; use for deeply-
                        #        informative / YMYL niches). none = idea-generator hands the brief
                        #        straight to the scriptwriter (fine for lighter niches).
topic_scouting: stored  # live = idea-generator does live web topic-scouting every run. stored =
                        #        riff from stored knowledge/playbooks unless asked to go live.
long_form: single       # staged = long-form writers-room (outline → section drafts → accuracy/
                        #        quality editor pass → humanize; resists sag over 2,500 words).
                        #        single = one-pass scriptwriter + humanize.
```

## Voice & style

- **Voice ID (locked):** TODO — one ElevenLabs voice ID for this channel (premium prosody tier
  minimum; stock TTS is documented at 35% drop-off in first 45s vs human/premium)
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
voice_id: TODO                    # REQUIRED — the channel's one locked ElevenLabs voice
model_id: eleven_multilingual_v2  # eleven_v3 = most expressive; eleven_turbo_v2_5 = cheapest
stability: 0.5                     # 0–1; lower = more expressive, higher = steadier
similarity_boost: 0.8
style: 0.2                         # 0–1; keep low for calm narration
use_speaker_boost: true
speed: 1.0                         # 0.7–1.2
output_format: mp3_44100_128
```

- **Script rules:** hook in first 0–5s (Shorts: 1.3–1.8s); establish value in 7s; second-gate
  structure through 30s; micro-interrupt every 30–45s; macro re-hook every 2–3 min; **mandatory
  mid-video re-arm at 55–65% runtime**; withheld peak in final 20% (hard rule); emotional
  payoff — NO "and that's why…" closer; `[B-ROLL]` + `[PAUSE]` markers; humanized (no AI tells);
  visual density weighted to first 60s. Full doctrine in `universal.md`.
- **Visual style:** TODO — palette, footage type, motion vs stills. Must be a locked signature
  (July-2025 policy hunts templated stock B-roll).
- **Visual register (locked):** TODO — pick ONE lane (universal.md §13): **stylized-signature** (a
  single locked illustrated style-token — best for abstract niches: finance, what-if, mechanisms;
  cheap, coherent, hides AI tells) OR **real-footage/screencap/archival** (only where the value is the
  realism — ai-tools demos, internet-lore evidence). **Never** the generic semi-photoreal AI B-roll
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
