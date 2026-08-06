---
id: eng-fold-audio
project: faceless-youtube
action: draft:engagement-audio-delta
target: orgs/faceless-youtube/docs/deltas
risk-tier: T2
profile: scanner
owner: dashboard-engine
state: blocked
execution-controller: dashboard
---

## Work order

Author a doctrine-delta document at `orgs/faceless-youtube/docs/deltas/2026-07-22-audio-doctrine.md`.
You write exactly ONE new file and change nothing else. The delta proposes exact text changes for a
human integrator to apply on a review branch.

Context: the channel's first released long-form was measured against its reference channels
(2026-07-21). Audio axis verdict: **our SFX rate is 3.81 events/min vs 8–20/min measured on the
closest reference channel — a 2x–5x gap.** The existing doctrine already prescribes richer audio than
the video carried ("SFX every 20–30s; music change at act boundaries" is already written in
universal.md) — so part of your delta is an ENFORCEMENT note: the audio-director stage under-executed
the doctrine on the books, and the skill must make the floor mechanical rather than advisory. Craft
research adds: a continuous subtle AMBIENT bed under the whole video is the highest-value calm-doc
audio move (beats discrete-hit density); reserve discrete SFX (~2–5/min minimum floor, references run
higher) for chapter turns, reveals, number landings, and motion accents (a whoosh on roughly a third
to half of hard cuts — never every cut); one music bed per chapter (~3–6 cues per video), each
establishing within ~8–10s, peaking at chapter changes; at least ONE deliberate drop-to-silence at the
single most pivotal line; when the frame deliberately freezes for a reveal, a low sting or boom makes
the still frame itself an event ("audio does the emphasis when the frame freezes"). Human-cost beats
keep the near-silent treatment — that lock survives, measured in the references too.

Read for context: `orgs/faceless-youtube/.claude/skills/audio-director/SKILL.md` (primary edit
target), `orgs/faceless-youtube/.claude/skills/render-builder/references/audio-plan-schema.md` (the
plan format the skill emits), `orgs/faceless-youtube/.claude/skills/sfx-forge/SKILL.md` and
`music-forge/SKILL.md` (asset sources), and universal.md's existing audio prescriptions.

Your delta document must contain, in order:
1. The measured problem statement (numbers above) + the enforcement finding (doctrine existed,
   execution fell short — name where the current skill text lets that happen).
2. For the audio-director skill: each proposed change as a block — existing passage quoted for
   location, full replacement text verbatim, one-line rationale. Cover: the ambient-bed law, the
   mechanical SFX floor with the reserved-hit categories, the per-chapter bed structure with the
   establish/peak timing, the single silence-drop requirement, the sting-on-deliberate-hold rule,
   and the every-cut-gets-a-sound ban.
3. Any additions needed in the audio-plan schema reference to express these (new fields only if
   genuinely required — prefer expressing everything in existing fields).
4. A "what does NOT change" section: human-cost beats stay near-silent; flat overall loudness law
   stays; no externally-licensed popular tracks (existing library and free sources only).

Repo doctrine voice: dense, imperative, fact-cited. One new file only. If context is unreadable, note
it and finish with what you have.
