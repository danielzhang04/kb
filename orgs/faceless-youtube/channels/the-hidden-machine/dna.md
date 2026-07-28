# Channel DNA — <CHANNEL NAME>

The frozen identity of one channel. Written once during setup, then referenced by every per-video
task. **To start a channel: copy this `_TEMPLATE/` folder to `channels/<name>/` and fill this in.**
Fields marked TODO are set at channel creation.

## Identity

- **Channel name:** TODO
- **Niche:** TODO  (see `knowledge/research/niches.md`)
- **One-line promise:** TODO — what a viewer reliably gets from every video
- **Original angle / POV:** TODO — the differentiation that keeps us policy-safe (must NOT clone a rival)
- **Audience / region / language:** US, English (default; change if different)

## Doctrine (universal.md §1a — one lever per channel, never per video)

- **Locked emotional lever:** TODO — pick ONE from the 10 named levers in `universal.md §1a`
  (curiosity gap is the carrier for all; the underlying arousal lever is: morbid curiosity /
  awe / morbid awe-dread / righteous anger / vindication-forbidden-knowledge / schadenfreude /
  hope-porn [face-required, avoid for faceless] / tribal identity / wonder-puzzle). **This is
  the load-bearing brand decision — cross-lever content gets flagged as slop by the July-2025
  policy classifier AND by the human audience.** Every idea and script must serve this lever.
- **Named refusals:** TODO — categories of content this channel explicitly does NOT do (e.g.
  Zack D. refuses non-visualizable topics; Bright Side refuses non-evergreen). Holds the DNA
  legible.

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
