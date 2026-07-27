---
name: shorts-writer
description: Writes the SHORT-FORM bench for a video whose long-form script.md is already done — self-contained vertical Shorts derived from it (+ research.md if present). Use for "make the shorts", "clip the long-form into shorts", or the shorts scripting step, any niche. Writes videos/<slug>/shorts/short-NN.md. Runs after long-form-writer, parallel with metadata-writer/visual-prompt-writer. Do NOT use for the long-form script (long-form-writer), ideas (idea-generator), research (researcher), or titles/tags (metadata-writer).
---

# shorts-writer

Turn a **finished long-form script** into a bench of **self-contained vertical Shorts** — each a closed
loop that delivers and *closes* one surprising, concrete payload on its own. One skill for every channel;
the niche is **data** in `channels/<name>/`.

## Mental model

The long-form did the work; you find the moments inside it that stand alone and rebuild each as a Short.
A Short is **not a teaser** for the long-form (universal.md §11-0 — this is the load-bearing rule). The
algorithm optimizes satisfaction (completion, replays, loops), so pointing off-video for the answer
spikes drop-off and gets throttled. **If a payoff needs the long-form to land, it was never a Short — it
was a long-form beat.** Derive shorts from the long-form's *strongest self-contained payloads*, not from
its cliffhangers. On research channels you inherit the same **leash**: a short may state only facts in
`research.md`'s ledger.

## Step 0 — Identify channel + video

1. **Channel + slug** from the request → `channels/<name>/videos/<slug>/`.
2. **Require the finished long-form.** `script.md` must exist (status `scripted`). **If it doesn't,
   stop** — shorts are derived from the finished long-form, not written blind. Point the user at
   `long-form-writer` first.

## Step 1 — Read

- **`videos/<slug>/script.md`** — the finished long-form. This is your quarry: scan it for the moments
  that are **surprising and self-contained** — a single number that shocks, a mechanism that fits in 20s,
  a myth the video busts, one analogy-that-indicts. Those become shorts; a mid-arc cliffhanger does not.
- **`videos/<slug>/research.md`** (if present) — the **fact ledger** is still the leash (a short's
  numbers must trace to an `[F-NN]`); the **myths-to-bust** and **analogies** are pre-vetted short fuel.
- **`videos/<slug>/brief.md`** — the brief's **candidate short angles** (on research niches these were
  marked *provisional* — you finalize them now against the actual finished long-form). Note the niche's
  cadence band it was sized to.
- `channels/<name>/dna.md` — the **register, narrator persona, humor dial, locked lever**, and the
  **shorts-per-long-form cadence band** (business 2–4 / what-if 3–6 / AI 2–3 / engineering 1–3 /
  horror-lore 4–8 / micro-health 3–5; universal.md §10).
- `knowledge/research/niche-playbooks/universal.md` — **§11 + §11-0** (Shorts are self-contained closed
  loops), **§1d-R** (register) + **§1d-V** (cadence + humor), §4d (10 short-form hook archetypes), §12
  (burned-hook anti-patterns). `<niche>.md` — niche hook flavor + any accuracy quirk.
- `.claude/skills/idea-generator/references/shorts-clipping.md` — the Short structure + archetype library.

## Step 2 — Write the bench (`shorts/short-NN.md`)

Script **every viable short** — as many as are genuinely strong, sized to the niche's cadence band;
**cut weak angles rather than pad to a number** (quality/variety over count). Each short is a
**self-contained closed loop**, spine `hook → context → payoff → loop`, all inside the short. Target
15–30s (up to 45s if the payoff is visual). Rules:

- **Front-load the payload — the first second is a thumbnail.** State the surprising fact (or flash the
  end state) in second one; viewers swipe in ~1s. No slow build, no withholding the answer for later.
- **~3–5 escalating beats around ONE payoff.** Each line adds a concrete detail or raises stakes toward
  the reveal — not one vague mood, not ten forgettable facts.
- **Stage it, even in 20 seconds — apply storytelling-grammar (mini-arc version).** A short is still a
  *scene*, not a fact-recital: build it on **one lever/mechanism** (not the whole machine) and lead with
  the single sharpest **staged** move the story has (per storytelling-grammar §1 + §4 — its move catalog is
  the source of truth, don't re-derive it here). Render an exchange as narrator **reported speech** by
  default (grammar §4), never inventing a line the source doesn't support.
- **Close the loop, then seam it.** Answer the question you opened; write the **last line to flow back
  into the first** so a replay is seamless (loops = views since Mar 2025).
- **Never end on "watch the full video to find out."** That's the withholding failure. The short must
  fully satisfy alone; the long-form link is a **bonus in the pinned comment**, not the payoff (CTR to
  another video isn't even a Shorts ranking signal).
- **No burned hooks (§12):** "Did you know," "You won't believe," bare question openers, "welcome back."
- **First frame is the hook** — pattern-interrupt visual + on-frame text (3–7 words); **burned-in
  captions throughout** (+15–25% retention). Mark `[B-ROLL]` weighted to the first 3 seconds. **Cue the
  beat's MEANING, not a literal picture** — `visual-prompt-writer` applies the non-literal grammar
  (universal §13a), so voice claims/spin verbatim (so the visual can unmask them) and reach for vivid
  idioms (so it can draw the pun). Shorts are the most-cloned surface — non-literal visuals matter most.
- **Match the channel's register, narrator persona, and locked lever,** with the same anti-trailer-voice
  + human-cadence rules as long-form (universal §1d-V). Set the comedic rate by the clip's **topic gravity**
  (the humor dial in `dna.md`) — a DIAL, never a fixed rate — with comedy off on human cost (grammar
  §1.7). Shape it as a **mini-arc** (§1): hook on the paradox/irony → one
  turn → a button, not a flat fact — the humor riding the fact (§2.4), never a bare dry recital.
- **Stay on the leash (research channels):** every number/claim in a short traces to an `[F-NN]`. A short
  can't say what the long-form couldn't source.
- **Write for the ear/TTS:** spell numbers/symbols/units as spoken words.
- Aim for **≥70% average view duration** (viral shorts ~76%; ≥75% earns ~3× algorithmic push).

**Status:** tag the strongest per the niche's cadence band as **`publish`** and the rest as **`bench`**
(scripting the full bench builds a ready library; `voiceover`/`render-builder` only spend on `publish`
ones; `publish-queue` paces posting). Don't invent new statuses.

One file per short (`shorts/short-01.md`, `-02`, …) containing: its **archetype**, the **parent long-form
slug**, the marked-up VO script (`[B-ROLL]` weighted to the first 3s, tiered pause cues), a burned-in
**caption** note, and the **`publish`|`bench` status**.

## Step 3 — Humanize

Same discipline as the long-form: run the **pre-ship checklist** (read aloud; cadence variance; near-zero
exclamation marks; intensifier/signpost sweep; specificity pass; humor carries a fact; TTS-safe) over
each short, then **run the `humanizer` skill** as a final pass and keep its edits. At short length every
filler line is a larger fraction of the runtime — the specificity pass matters most here.

## Step 4 — Hand off

The idea stays `scripted` (the long-form already set it). The folder now has the full script package for
`voiceover` (voices long-form + every `publish` short) and `visual-prompt-writer` (reads each short for
its shot list). Shorts are **algorithmically decoupled** from long-form — they stand alone; the
pinned-comment link back is a bonus, set by `metadata-writer`/`publish-queue`, not you.

## Output to the user

Short summary: how many shorts scripted and how many are `publish`, each with its one-line payload. The
`shorts/*.md` files are the source of truth; keep the chat brief.

## Output contract (what downstream reads)

- `videos/<slug>/shorts/short-NN.md` — one per short: archetype, parent slug, VO + `[B-ROLL]`/pause cues,
  caption, `publish`|`bench` status. VO lines clean so `voiceover` can strip markers. No `<!--F-NN-->`
  traces left in the final file.
