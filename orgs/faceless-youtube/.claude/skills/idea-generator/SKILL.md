---
name: idea-generator
description: Generates differentiated, ranked video ideas for a faceless YouTube channel. Use for new content ideas, video concepts, angles, titles, a content backlog, "what should we make next", ideation, or brainstorming — any niche. Reads dna.md + performance.md + idea-backlog.md; writes ranked idea briefs back to idea-backlog.md. Do NOT use it to write scripts (long-form-writer/shorts-writer) or pick metadata/tags (metadata-writer).
---

# idea-generator

Generate **differentiated, ranked, script-ready video ideas** for one faceless-YouTube channel.

This is one skill for every channel. The niche lives as **data** in `channels/<name>/`, so the
same logic produces personal-finance ideas for the finance channel and "what if the sun went out"
ideas for the what-if channel. You never fork this skill per niche — you point it at a channel.

## Mental model

An idea's job is to be the **contract handed to `scriptwriter`**: specific enough that the writer
can start immediately, loose enough that the writer still owns wording, pacing, and jokes. You are
not writing the script here. You are deciding *what* to make and *why it will perform*, and proving
it isn't a duplicate of anything we've already done. Get this wrong and every downstream step
(voice, visuals, render, upload cost) is spent on a bad bet — so the ranking matters as much as the
ideas.

## Step 0 — Identify the channel and mode

1. **Which channel?** Take it from the request ("ideas for the finance channel" → `channels/finance/`).
   If there are multiple channels and it's ambiguous, ask which one. If no channel folder exists yet,
   tell the user to create one from `channels/_TEMPLATE/` first — this skill needs a `dna.md` to have
   a niche and voice to write toward.
2. **Which mode?**
   - **strategy** — the channel is new or `performance.md` has no real data yet. Goal: establish a
     spread of *broad angle families* that define the channel's territory. Do the web research pass
     (see Research). Produce more ideas (aim ~8–12) covering different lanes.
   - **per-video** — the normal run. Goal: the next few concrete videos, informed by what has
     actually worked in `performance.md`. Aim ~3–5 unless the user asks for a specific count.
   If unclear, infer from `performance.md`: empty → strategy, has data → per-video.
3. **Read the channel's pipeline flags** — the `Pipeline` block in `dna.md`. Two flags change this run
   (default to `topic_scouting: stored` / `research: none` if the block is absent — the lightweight path):
   - `topic_scouting: live` → run the live web topic-scouting pass **every** run, not only in strategy
     mode (see Step 2). A research-driven channel hunts fresh, well-framed topics each time.
   - `research: deep` → this channel inserts a **`researcher`** stage between the human pick and the
     scriptwriter. You are writing the brief to **hand off to the researcher, not straight to the
     scriptwriter** — so long-form briefs take the *research-niche* shape (Step 3a) and the handoff
     routes to `researcher` (Step 7). Don't pre-write a speculative beat outline the research will overturn.

## Step 1 — Read the channel's memory (always)

Read these before generating. They are the difference between generic ideas and *this channel's* ideas:

- `channels/<name>/dna.md` — niche, one-line promise, original angle/POV, format, tone, target
  length, **the channel's LOCKED emotional lever** (per universal.md §1a — one lever per channel,
  never per video), recurring structure. **Every idea must fit this.**
- `channels/<name>/performance.md` — what's worked, what flopped, retention/CTR patterns, the
  "Learnings" list. In per-video mode, lean hard on this: make more of what worked, avoid repeating
  what didn't.
- `channels/<name>/idea-backlog.md` — everything already queued or used. This is your **dedupe set**.
- `channels/<name>/videos/` — titles already produced/published (another part of the dedupe set).
- `knowledge/research/niches.md` — cross-niche strategy and demand signals.
- `knowledge/research/niche-playbooks/universal.md` — the cross-niche doctrine. **Read this every
  run.** Load-bearing sections: **§1-P (the payload rule — the primary axis; read first)**, §1
  (entertainment-not-education doctrine + 10-lever taxonomy *as secondary flavor* + 12 tactics + CCN
  rule) + §1d-R (default plain-concrete register), §3c (15 universal title patterns with levers),
  §4c/d (20 long-form + 10 short-form hook archetypes), §5 (10 opening structures for the second gate),
  §6 (15 retention tactics + updated re-hook cadence), §7 (6 payoff structures), §10 (per-niche shorts
  cadence) + **§11-0 (shorts are self-contained, not teasers)**, §12 (measured anti-patterns).
- `knowledge/research/niche-playbooks/<niche>.md` — the playbook for *this channel's* niche
  (`business-money.md`, `what-if.md`, `ai-tools.md`, `engineering-disasters.md`,
  `horror-internet-lore.md`, `micro-health.md`). Match from `dna.md`'s niche. It holds this niche's
  **dominant lever + channels to study + title patterns + hook flavors + beat template + length
  band + sub-niches + signature formats + accuracy gates**. `universal.md` governs common
  conventions; the niche file governs niche-specific ones. If no file matches, say so and lean on
  `dna.md` + `niches.md`.

If `knowledge/playbook.md` is present, skim it for the originality bar and format/length rules
(policy/cadence live there; craft lives in the playbooks above).

## Step 2 — Research (hybrid / on-demand)

Default to working from the repo files above — it's fast and deterministic. Do a **live web-research
pass** (WebSearch) when *any* is true:

- the channel's `Pipeline` flag is **`topic_scouting: live`** (a research-driven channel scouts fresh
  topics every run — actively hunt for curious, well-framed, high-appetite topics in the lane, not just
  riff from memory), **or**
- you're in **strategy** mode (a new channel deserves fresh, current territory), **or**
- the user explicitly asks for trending / timely / current ideas.

When you research, look for: current trends and timely hooks in the niche, what's resonating right
now, and up-to-date audience-psychology signals (why people click/stay/share this kind of content).
**Cite sources** in the idea's `Sources` field so a human can sanity-check. Keep it lean — a few
targeted searches, not an exhaustive crawl. Outside those triggers, skip the web and note that ideas
are from stored knowledge.

Not every idea in a research batch needs its own citation. Time-pegged or news-driven ideas **must**
cite; evergreen model/mechanism explainers (e.g. "how loyalty programs really work") may lean on
stored knowledge — mark those `Sources: (evergreen — verify before scripting)` so the gap is
explicit rather than hidden.

## Step 3 — Generate (long-form primary → derive a shorts bench sized to the niche)

Long-form is the earner; Shorts are (now algorithmically decoupled — late 2025) their own format
running in parallel. So:

1. Generate **long-form ideas** first — these are the real bets, sized to the channel's target
   length band from the niche file. **Every idea must have a concrete payload first** (universal.md
   §1-P: the one specific fact/mechanism/number/realization the viewer walks away with) — *then* an
   emotional register on top (§1a) and a *felt* payoff, not "the lesson" (§1c + §7). An idea whose
   only answer to "what does the viewer learn?" is a feeling is not an idea yet.
2. For each long-form idea, derive a **shorts bench sized to the niche's cadence** (universal.md
   §10 per-niche bands, refined in the niche file): business 2–4 per long-form; what-if 3–6; AI
   tools 2–3; engineering 1–3; horror/lore 4–8; micro-health 3–5. Read
   `references/shorts-clipping.md` for structure + archetype library.

   **"As many as have integrity, not a fixed count."** Generate every angle that stands as a
   **self-contained** `hook → context → payoff → loop` piece (universal.md §11-0) — one that delivers
   AND closes a surprising, concrete payload in <40s. A short whose payoff needs the long-form to land
   is **not a short — it's a long-form idea in disguise; drop it.** The pinned long-form link is a
   bonus, never the payoff. **Cut weak angles rather than pad to a number.** If a long-form only
   supports 3 self-contained shorts, generate 3 — do not stretch to 10. If it supports 8, generate 8.
   Tag the strongest per the niche's publishing cadence as `publish` and the rest as `bench`. The
   10-archetype cap that used to exist here is retired.

   Shorts are their own format under 2025-2026 algorithmic decoupling — **do not assume passive
   lift to long-form.** Any funnel is engineered explicitly (pinned comment, description link,
   end-screen).
   - **Scale the benches to the mode.** In per-video mode, generate the full niche-band bench for
     every idea. In strategy mode (8–12 ideas at once, most won't be produced soon), give the top
     ~5 by score the full niche-band bench and 2–3 light angles for the rest. An idea earns its
     full bench when it's picked.

Every idea must clear the **originality guardrail** (Step 4) *before* it earns a slot.

## Step 3a — Research-niche briefs (only when `research: deep`)

For a `research: deep` channel the brief is a **handoff to the `researcher`, not the scriptwriter**, so
its long-form body changes shape. The real structure of a deeply-informative video can only be honestly
built *after* the research — a beat outline written from memory here is a guess the research will
overturn. So for each long-form idea, replace the speculative **beats** with:

- **Provisional angle** — the specific lens/thesis you'd take on the topic (still a bet, refined post-research).
- **Payload promise** — the one concrete thing the finished video should leave the viewer with (the same
  §1-P payload, framed as the promise the research must deliver on).
- **Key questions the video must answer** — 4–8 specific, answerable questions that define what the
  researcher has to go find (mechanism, numbers, who-did-what-when, the overlooked angle, the myth to
  check). **These are the seed of the research plan** — write them concrete and hunt-able ("What did the
  SEC filing actually say the fee was?", not "research the fees"). Steer *away* from the famous, already-
  saturated narrative toward the mechanism and the overlooked specifics — that steer is what keeps us
  original and is what the researcher will chase.

Everything else (title options, payload, lever, why-original, score, sources, status) is unchanged.
**Shorts for research niches:** list *candidate* short angles for the virality/scoring signal, but mark
them **provisional** — the final shorts are derived by `shorts-writer` from the *researched, finished
long-form*, not locked here. Don't over-invest the bench at idea stage for these channels.

### Viability gate — before scoring or research

Every deep-path brief must clear all four named fields below. This is a storyability screen, not a
retention prediction or another weighted score. If any field is missing or vague, re-angle the idea or
drop it before research spends time proving the wrong promise:

- **Accountable stake and question:** name the accountable person or system, the concrete stake, and one
  dominant open question.
- **Cold open and title promises:** give one vivid cold-open moment and at least three short, defensible
  title promises.
- **Mechanism, escalation, relevance:** state the specific mechanism, its escalation or reversal, and a
  plausible relevance bridge.
- **Differentiated against:** name the specific published and/or backlog items compared, and say how this
  angle differs. Never assert originality from memory.

The researcher owns evidence, not wishful fulfillment: it must verify or revise the first three fields and
record every title or angle promise the evidence cannot support.

## Step 4 — Payload + originality gates (both non-negotiable, both pass/fail)

**Payload gate (new — apply first).** Before an idea can be scored at all, write its **Payload** line:
the one concrete thing the viewer learns or realizes (a specific fact, mechanism, number, or genuine
"wait, *what*"). Then check:
- **Long-form:** is there a real, concrete payload the video teaches/reveals? (Emotion is the register,
  not the payload — §1-P.)
- **Every `publish`/`bench` short:** does it have its *own* surprising, concrete fact deliverable and
  *closeable* in <40s, without leaning on the long-form for the answer?

If the honest answer is "it's mostly a feeling / vibe / countdown," the idea (or that short) **fails the
gate — do not rank it.** This is the fix for the vapor failure mode (a dread idea with no information).
A feeling is how you *frame* a payload; it is never a substitute for one.

**Originality gate.** The July-2025 "inauthentic content" policy penalizes the **whole channel**
(demonetization) for templated near-duplicates. So an idea only survives if:

- It is **materially different** from every entry in `idea-backlog.md` and every title in `videos/`
  — not a rephrase, a genuinely different angle/substance.
- It does **not clone a specific rival** video or channel. Draw on the niche broadly; never
  reverse-engineer one competitor's exact format.
- It fits `dna.md`'s original angle/POV (that POV is what keeps us policy-safe).

For each idea, write a one-line **"Why original"** note explaining how it differs. If you can't write
that line honestly, the idea doesn't belong in the queue — drop it and make another.

## Step 5 — Score and rank (predicted performance, entertainment-and-revenue-weighted)

Score every surviving idea so a human can pick the best now, and so a future autonomous mode can
auto-advance the top N without re-judging. Total **/100**, reweighted 2026-07-02 to make the
**information payload the primary axis and emotion secondary flavor** (per universal.md §1-P):

| Metric | Max | What it measures |
| --- | --- | --- |
| **Payload / information value** | 20 | How concrete, surprising, and specific is the one thing the viewer learns/realizes (universal.md §1-P)? Vague/mood-only = low. **This is now the top weight.** |
| Hook strength | 15 | Curiosity gap / stakes in the first 5s (Shorts: 1.5s) — and crucially a gap the video actually *closes*. Ties to §4. |
| Emotional lever | 10 | Which of the 10 named levers (§1a) it pulls as the *register*, and how well it fits. **Must match the channel's LOCKED lever** — cross-lever ideas score 0 here. (Demoted from /20: it's flavor on the payload, not a substitute.) |
| Demand & virality | 15 | Real search/browse appetite, trend timeliness, shareable format |
| Monetization (RPM) | 15 | Topic CPM — money/business/tech ↑, pure entertainment ↓ (the revenue lever) |
| Differentiation | 15 | How original vs. backlog + posted + the niche (ties to Step 4) |
| Channel fit | 5 | Fits dna.md's promise/POV/lever and echoes what `performance.md` says worked. Passes the CCN test (universal.md §1d — Core + Casual + New viewers). |
| Feasibility | 5 | Producible at reasonable cost/effort with our stack (voice+visuals+render) |

**Rubric change (2026-07-02):** added **Payload / information value /20 as the top weight**; cut
**Emotional lever /20 → /10** (it's the register on top of the payload, not the payload — §1-P); Hook
/20 → /15; Channel fit /10 → /5. Total still /100. Two hard rules survive: an idea whose lever doesn't
match the channel's locked lever still scores **0 on Emotional lever**, and an idea that **fails the
Step-4 payload gate is not scored at all** (a low payload score is for weak-but-real payloads; *no*
payload = not ranked).

Use the **0–N anchors in `references/scoring.md`** so scoring is reproducible, not vibes; show the
sub-scores next to the total so the ranking is auditable. Rank the queue by total, highest first;
**break ties by Payload, then Hook, then Monetization, then Differentiation, then ID (creation
order)** — a fully deterministic chain so two runs on the same set produce the same order, never a
coin flip. (Tie-break chain updated 2026-07-02 to lead with Payload, matching the doctrine.)

**Re-scoring:** scores drift as analytics land and trends age. Re-score all unused (`idea`-status)
ideas whenever `performance.md` gains new data, on every strategy run, and apply the weekly
time-decay to time-sensitive ideas. Never re-score committed ideas. Details + decay rule in
`references/scoring.md`.

## Step 6 — Write to `idea-backlog.md`

Update `channels/<name>/idea-backlog.md`. If the file is missing or still the empty template,
**initialize it from `channels/_TEMPLATE/idea-backlog.md`** (which already has the queue-table +
briefs + parking-lot scaffold) rather than inventing your own layout — that keeps every channel's
backlog identical so downstream skills can parse it. Keep two coordinated parts:

**(a) The ranked queue table** — the at-a-glance index, sorted by score:

```
| Rank | ID | Score | Working title | Format | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | F-014 | 82 | Why the middle class is quietly going broke | long + 2 shorts | idea |
```

**(b) A full brief per idea**, below the table, keyed by the same ID. This is the contract for
`scriptwriter`:

```
### F-014 — Why the middle class is quietly going broke
- **Format:** long-form (~10 min) + shorts bench (N; scale to the niche's cadence band)
- **Payload (the one thing learned/realized):** your wages rose in *dollars* but fell in *purchasing
  power* — the "raise" you got since 2019 is a ~40% real-terms pay cut, hidden by asset inflation.
- **Hook premise (first 5s):** open on the paycheck that buys 40% less than it did in 2019…
- **Angle / POV:** systemic, data-first, no doom-porn — the channel's calm-authority promise
- **Emotional lever (register):** vindication ("you were lied to") — matches channel's locked lever;
  delivered plain and concrete, not as portent (§1d-R)
- **Talking points / beats:**
  - real-wage stagnation vs. asset inflation (the concrete mechanism)
  - the "quiet" part: lifestyle creep hides it
  - what actually moves the needle
- **Title options (a promise the payload keeps):** 1) … 2) … 3) …
- **Why original:** backlog has nothing on real vs. nominal wages; not cloning any rival's format
- **Score:** 86/100 (payload 18, hook 13, lever 9, demand 12, monetization 14, diff 13, fit 4, feasibility 3)
- **Shorts bench (N; niche-band):** archetype · hook line · **self-contained payload** · publish|bench
  — per `references/shorts-clipping.md`. Each short must *close* its own payload in <40s (§11-0). Cut
  weak angles rather than pad to a number.
  1. [Shocking stat · publish] "Your 2019 paycheck buys 40% less today" → the real-vs-nominal number, shown and explained in-short
  2. [Myth-bust · publish] "You didn't get poorer — the dollar did" → the one chart, stated and closed
  3. [Single-mechanism · publish] why asset inflation hides the cut → the mechanism in 30s
  N. …
- **Sources:** (research mode only) <links>
- **Status:** idea
```

**Research-niche variant (`research: deep`):** same fields, but swap the `Talking points / beats` block
for the Step-3a trio and mark shorts provisional:

```
- **Provisional angle:** the specific lens/thesis (a bet, refined after research)
- **Payload promise:** the one concrete thing the finished video must leave the viewer with
- **Viability — accountable stake and question:** <accountable person/system> · <concrete stake> · <one dominant open question>
- **Viability — cold open and title promises:** <vivid opening moment>; 1. <defensible title promise> 2. <defensible title promise> 3. <defensible title promise>
- **Viability — mechanism, escalation, relevance:** <specific mechanism> → <escalation/reversal> → <plausible relevance bridge>
- **Viability — differentiated against:** <named backlog/published items compared> · <specific difference>
- **Key questions the video must answer (→ the researcher's seed):**
  1. <concrete, hunt-able question>
  2. …  (4–8 total; steer toward mechanism + overlooked specifics, away from the saturated narrative)
- **Candidate shorts (provisional — shorts-writer finalizes from the researched long-form):**
  - <angle · self-contained payload> …
```

**IDs** are stable: a short channel prefix + zero-padded counter, assigned in **creation order** and
**never reused or renumbered**. Derive the prefix from the channel name's initials (Money Mechanics →
`MM-`, What If Lab → `WIL-`); once set, record it at the top of the backlog and keep using it. Keep
IDs decoupled from rank — `Rank` is a separate column that changes every time you re-score, while an
ID must point to the same idea forever (a re-run that inserts a higher-scoring idea gets the next
free number, not a renumber of the queue). **Status**
lifecycle: `idea → picked → scripted → produced → published`. New ideas start at `idea`. Preserve
existing entries and their statuses — you're appending/refreshing the queue, not wiping history.
Move stale raw notes to the "Parking lot" rather than deleting them.

## Step 7 — Handoff (build the autonomy ramp incrementally)

**Now (Stage 0 — human gate):** generate, score, store. Present the ranked shortlist to the user and
let *them* choose which idea(s) advance. When one is chosen, set its status to `picked`. Do not
auto-advance — the human idea gate is intentional at this stage. **This is the channel's single human
gate on the deep path** (idea → researcher → scriptwriters run autonomously after the pick).

**Where a picked idea goes next depends on the `research` flag:**
- `research: deep` → the picked brief hands off to **`researcher`** (writes `research.md`) → then
  **`long-form-writer`** scripts from it → **`shorts-writer`** derives the shorts. The idea gate is the
  last human checkpoint before a draft.
- `research: none` → the picked brief hands off straight to **`long-form-writer`** (single mode) →
  **`shorts-writer`**. (The old combined `scriptwriter` is superseded by this pair.)

**Later (the goal):** the same data supports autonomy with no rework. When the user opts in (and the
autonomy stage allows), an auto-push run = filter `idea-backlog.md` for status `idea`, take the top
XX by score across freshly generated *and* previously stored unused ideas, and hand them straight to
`scriptwriter` (set status `picked`). Because scoring and status already live in the file, this is a
filter, not a new system. Don't do this until explicitly asked.

## Output to the user

After writing the file, show a concise ranked shortlist (title · format · score · one-line hook) and
ask which to advance (to `researcher` on the deep path, or `long-form-writer` on the plain path). Keep the
chat summary short — the backlog file is the source of truth, not the conversation.
