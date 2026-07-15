# Predicted-performance scoring (entertainment-and-revenue-weighted)

The score is a **prediction of how well an idea will perform**, on a fixed formula so two runs score
the same idea about the same and so a future autonomous mode can rank without re-judging. Total
**/100** = sum of seven anchored sub-scores. Always show the sub-scores next to the total.

**Rubric change (2026-07-02):** added **Payload / information value /20 as the top weight** (the
concrete thing the viewer learns — universal.md §1-P). Cut **Emotional lever /20 → /10** (it's the
register on the payload, not the payload), **Hook /20 → /15**, **Channel fit /10 → /5**. Total still
/100. (Prior 2026-07-01 change had bumped Emotional lever to /20; that over-weighted feeling over
information and produced mood-only "vapor" ideas — this corrects it.)

**Gate before scoring:** an idea that fails the Step-4 **payload gate** (no concrete thing the viewer
learns; mood/countdown only) is **not scored at all.** The Payload sub-score below rates weak-but-real
payloads; it is not a place to give partial credit to an idea that has none.

## Weights and anchors

Rate each metric within its band using the anchors, then sum.

### Payload / information value — /20  (the primary axis)
How concrete, surprising, and specific is the **one thing the viewer learns or realizes** (§1-P) — a
fact, mechanism, number, or genuine "wait, *what*." This is now the top weight because information,
not feeling, is what a satisfying video delivers; emotion is the frame around it.
- 18–20: a specific, genuinely surprising, checkable payload most of the target audience doesn't know;
  the whole video/short exists to deliver it.
- 12–17: a real, concrete payload, but somewhat familiar or mild in surprise.
- 5–11: thin payload — mostly a known fact or a single obvious point stretched.
- 1–4: almost no payload; the idea is carried by mood/hook, not information.
- **0: no payload** (pure vibe/countdown/portent) — should have failed the Step-4 gate; do not rank.

### Hook strength — /15
The curiosity gap / stakes in the first 5 seconds (Shorts: 1.5s) — a gap the video then actually
**closes** (an unclosed gap is clickbait the algorithm throttles). Ties to universal.md §4.
- 13–15: you'd stop scrolling instantly; a number/question/image that demands resolution and gets it;
  matches one of the named archetypes cleanly.
- 9–12: strong, clear hook but not arresting; a coherent archetype, ordinary execution.
- 4–8: mild interest; requires context to care.
- 0–3: no real hook, a burned pattern (§3b/§12), or a gap the video never closes.

### Emotional lever — /10  (secondary — the register, not the content)
Which of the 10 named levers (universal.md §1a) it pulls *as the register on top of the payload*, and
how well it fits. **Must match the channel's locked lever** (dna.md). Cross-lever ideas score **0 here
regardless of everything else** — no partial credit (the channels that survived July-2025 lock one
lever). Note: a strong lever can **never** rescue a weak payload — that inversion is what produced the
vapor failure.
- 9–10: clean single-lever fit, register genuinely sharpens the payload.
- 6–8: lever fit, register present but not doing much extra work.
- 3–5: lever fit but faint; the idea barely carries the feeling.
- 1–2: hits the lever only glancingly.
- **0: cross-lever idea** (does not match channel's locked lever) — filter out or dna.md needs a
  lever change first.

### Demand & virality — /15
Real search + browse appetite, trend timeliness, and how shareable the *format* is.
- 13–15: proven high-appetite topic or a live trend worth riding now; inherently shareable.
- 8–12: steady evergreen demand.
- 4–7: niche/thin appetite.
- 0–3: little evidence anyone is looking.
(For time-sensitive/trend ideas, this sub-score decays ~1.5/week — see Cadence below.)

### Monetization (RPM) potential — /15
Topic CPM. Encodes the "viral format on high-CPM topics" cheat code — a viral shape on a money/tech
topic earns far more per view than the same shape on pure entertainment.
- 13–15: high-CPM lane (money, business, finance, tech, B2B, some health).
- 8–12: mixed / mid-CPM (education, science-with-application, aviation).
- 4–7: lower-CPM entertainment/curiosity.
- 0–3: hard-to-monetize or ad-unfriendly (extreme horror, gore, medical misinfo territory).

### Differentiation — /15
Originality vs. our own backlog + posted videos + the niche at large. Also the policy gate: a low
score here is a July-2025-inauthentic-content risk, not just a weak idea.
- 13–15: genuinely fresh angle; nothing close in backlog/posted; not cloning any rival.
- 8–12: familiar territory, distinct execution.
- 3–7: close to something we (or rivals) already did.
- 0–2: near-duplicate — reject, don't queue.

### Channel fit — /5
Fits `dna.md`'s promise/POV/lever and echoes what `performance.md` says worked. **Passes the CCN
test** (universal.md §1d) — Core fans + Casual returners + New viewers can all click and enjoy.
- 5: squarely on-brand, matches a proven winner pattern, clears CCN.
- 3–4: on-brand, unproven pattern; CCN passes but one leg is weak.
- 0–2: a stretch for this channel's identity or fails CCN (e.g. requires deep prior context to
  appreciate).

### Feasibility — /5
Producible at reasonable cost/effort with our stack (voice + visuals + render).
- 5: easy with current tools.
- 3–4: doable, some extra asset work.
- 0–2: expensive or beyond current stack.

## Tie-break chain (deterministic)

When two ideas tie on total, break by: **Payload → Hook → Monetization → Differentiation → ID
(creation order)**. Two runs on the same set produce the same order, never a coin flip. (Chain
updated 2026-07-02 to lead with Payload, matching the information-first doctrine in §1-P.)

## Re-scoring cadence (smart triggers + decay)

Scores are predictions and drift, so keep them current cheaply:

- **At creation** — score every new idea.
- **On new performance data** — when `performance.md` gains rows/learnings, re-score all unused
  (`idea`-status) ideas: the Channel-fit, Demand, Monetization, and Emotional-lever priors have
  moved (a proven lever hit updates the whole backlog's calibration).
- **On every strategy run** — re-score the unused backlog (you're resetting the channel's
  territory).
- **Weekly time-decay** — for ideas tagged time-sensitive (trend/news pegged), subtract ~1.5 from
  the Demand sub-score per week since creation, floored at that idea's evergreen baseline, so
  stale trend ideas sink on their own.
- **Never re-score committed ideas** (`picked` / `scripted` / `produced` / `published`) — they're
  already in flight; re-ranking them is noise.

Re-scoring reuses stored sub-scores and only recomputes the moved components — no re-research
unless you're in strategy mode. Note in the backlog when a bulk re-score happened and why (e.g.
"re-scored 2026-07-08 after new analytics").
