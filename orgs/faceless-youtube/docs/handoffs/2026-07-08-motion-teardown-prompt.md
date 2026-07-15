# PROMPT: Motion-direction teardown → the motion grammar (Crayon-based)

Run a medium-deep research cycle on HOW the reference channels MOVE — camera behavior, element
entrances, text/chart treatment, cut energy — and encode the findings into the motion layer built
2026-07-08 (Remotion engine; see decisions.md). The earlier teardowns (2026-07-02/04, shot-logs)
studied packaging/script/what-appears; **this cycle studies motion only — do not re-derive those.**
Base/goal = **Crayon Capital**; HeyHistorically = learnings-only (too hard to imitate wholesale);
OverSimplified = the family's source grammar; Kurzgesagt = OPTIONAL, entrances/typography ONLY.

Skills: **claude-video-vision:watch-video** (the video tools) per video via subagents;
superpowers:writing-plans first; curate-doc discipline on every doc touched. Commit with EXPLICIT
`git add <paths>` only (parallel terminals are active).

## Video set (~7)

Pick popular (high-view), story-shaped videos — recency preferred but views win; list your chosen
URLs + titles and CHECKPOINT with the user before watching:
- Crayon Capital ×3 (the base — its motion vocabulary gets measured, not sampled)
- HeyHistorically ×2
- OverSimplified ×1
- Kurzgesagt ×1 (CONFIRMED IN; extraction scoped to element entrances + typography ONLY — its full
  animation grammar is out of reach and must not enter the grammar table as a norm)

**The extraction filter — "Remotion-implementable" means exactly:** camera (push/pull/pan/whip/
shake, easing, when to HOLD), element entrances/exits (pop/slide/stamp/grow/draw-on, overshoot,
word-timing), typography treatment (captions vs labels vs title cards), chart behavior (draw-on,
bar growth, counters, arrows), cut energy (hold lengths by beat; what changes across a cut),
held-frame life (what keeps a long hold alive), emphasis grammar (how a number/reveal is SOLD),
palette shifts, and **SFX coupled to motion events**. Anything outside this list (limb animation,
fluid morphs) is logged as "observed, not adoptable" and never enters the grammar as a norm.

## Method (the part that prevents junk findings)

1. **Configure video quality DOWN first** (known failure: high-quality downloads choke the tools —
   use the video_configure/setup tools; ~480p is plenty for motion study).
2. **One subagent per video**, run in background, monitored — check on each; a spun-out agent gets
   one nudge then gets its video reassigned smaller. Each agent gets the SAME extraction template
   and a fixed quota; its final message is data, not prose.
3. **Burst sampling — mandatory.** Motion lives BETWEEN frames: for each sampled event, pull a
   2–3s window at ~3–4 fps and describe the frame-to-frame deltas (what moved, how far per frame,
   easing character: does spacing accelerate/decelerate/overshoot = snap/spring/linear). A
   keyframe-per-shot pass cannot see easing and is a FAILED extraction.
4. **Event quota per video (~13):** 3 hard cuts (energy + what changes across the cut) · 3 element
   entrances (text, prop, character — how each arrives) · 2 camera behaviors during a held scene ·
   1 chart/diagram appearance (does it draw on? bars grow? static?) · 1 emphasis beat (a number or
   reveal — what motion sells it) · 1 scene-to-scene transition (confirm the cut idiom; note ANY
   non-cut device found) · **1 held-set evolution** (the same set/stage gaining or losing elements —
   does the channel CUT to the changed state, or MOVE/pop elements live on the held set? This is
   direct evidence for our delta-chain vs Phase-3 layer-move decision) · 1 free pick (the video's
   most distinctive motion moment).
5. **Per-event fields (all required):** timestamp · beat/narration context (one line of what's
   being said — transcripts from the earlier passes exist for some videos; reuse, never
   re-transcribe whole videos) · mover (camera vs element vs both) · direction + rough magnitude
   (% of frame width/sec) · easing (snap/spring/linear/hold) · move duration (frames or s) ·
   entrance style (pop / slide / draw-on / grow / none) · does the motion land ON a spoken word? ·
   **SFX at the event** (check the extracted audio: whoosh / pop / boing / stamp / none — frames
   can't hear; the audio track is part of the feel) · text treatment if text (typeface class:
   marker/sans/serif, weight, case, color, outline) · what stays idle vs active ·
   **the extracted frame filenames the observation is based on** (an event with no cited frames is
   a FAILED extraction — no describing footage you didn't pull).
6. **Per-video rollup:** median hold length · % of holds with camera motion · % with element
   motion · entrance-vocabulary counts · transition inventory · how charts/maps behave · type
   observations · the 3 most re-usable motion mechanics, each tied to the beat type it served.
7. **AUDIO rollup (full pass over the extracted audio track — co-equal deliverable, not a field):**
   - **Music:** present at all? continuous bed vs per-act? mood/genre per act (tension / farce /
     gravity / neutral) and WHERE it changes (chapter boundaries? reveals? — the board already
     noted Magnates' scored beat per boundary; measure whether Crayon/HeyHistorically do this);
     approximate level under the VO (barely-there vs assertive); does music DROP OUT anywhere
     (silence as a device — before a reveal, on human cost)?
   - **SFX:** inventory (whoosh / pop / stamp / boing / ding / riser / record-scratch / ambient) ·
     density (SFX events per minute, roughly) · what CLASSES of motion get SFX vs stay silent ·
     whether SFX ever lands without motion (audio-only emphasis).
   - The synthesis produces an **audio grammar** alongside the motion grammar: beat type → music
     mood + SFX treatment, weighted toward Crayon.
8. Each agent writes its findings to
   `channels/the-second-take/visual-kit/research/motion-logs/<channel>--<video-slug>.md`
   (structured tables, not prose).

9. **Spot-check before synthesis:** for each video, the synthesizer re-pulls the frames for 2
   randomly chosen reported events and confirms the observation matches — a hallucinated finding
   poisons the whole grammar; a video failing its spot-check gets its findings re-extracted or
   dropped (reported honestly).

## Synthesis → the three homes (surgical, never appended)

Cross-video synthesis produces a **MOTION GRAMMAR TABLE** — narration-type/beat → camera treatment +
entrance treatment + device behavior + energy — weighted toward Crayon; HeyHistorically/OverSimplified
mechanics only where they fit our stills+engine reality; Kurzgesagt findings marked aspirational and
adopted only for entrances/type. Learn the mechanic, never clone the execution (July-2025 rule).
Then route every learning to exactly ONE home:
- **Niche-agnostic mapping** → `universal.md` — a NEW compact **§13a-iii "Motion direction"**
  (do NOT bloat §13a-i; it is binding law and stays as-is; §13a-iii is its motion-layer sibling).
- **Channel dial** → `channels/the-second-take/visual-kit/visual-grammar.md` (a short motion
  section in the staging law) + **values** into `visual-kit/motion-tokens.json` (spring damping,
  amplitudes, sizes, the observed type direction).
- **Mechanical rules** → `.claude/skills/render-builder/scripts/build_motion.py` derivation (e.g.
  beat→camera mapping refinements, entrance rules) + sync `references/motion-schema.md` if a field's
  derivation changes. Judgment/taste NEVER goes in code.

## Font follow-through (needs only the engine, do it in this task)

From the teardown's type observations, pick 4–5 candidate faces in the observed family (marker/
hand for cards+titles per the locked recipe; check what captions actually use — likely a heavy
sans). Render the SAME caption frame + stat-card frame in each candidate via the engine
(`engine/still-video.mjs` on a tiny hand-made motion.json), publish ONE comparison artifact
(big images, click-to-enlarge), and CHECKPOINT for the user's pick → write the winner into
`motion-tokens.json`. Font files: prefer faces available on this Windows machine or free
(OFL-licensed) files added under `engine/public/fonts/` + loaded via @font-face; note licensing.

## Close-out

decisions.md entry (what was measured, the grammar's key rows, what went to which home);
CLAUDE.md status line (integrate); reference-channels.md "Next steps" updated (this closes the
"frame-level visual terminal" open item for motion). Named follow-ups: (1) A/B-validate the grammar
on the 56s slice render when it exists (one dimension at a time), then lock the approved slice as
the motion gold exemplar; (2) **engine audio layer (SFX + music)** — informed by the audio grammar:
a CC0/OFL SFX kit (whoosh/pop/stamp/boing) fired as `<Audio>` stingers from motion.json events, and
a mood-mapped royalty-free music bed with VO ducking + boundary changes, both authored as motion.json
data (see the audio-layer design sketch in the 2026-07-08 decisions entry when it lands).

## Guardrails

Watch/analyze only — no channel cloning language in any doc; timebox ~12 events/video, do not
transcribe or frame-dump whole videos; explicit git paths; if the video tools fail on a video after
one quality reduction + one retry, swap the video rather than fighting it; report honestly which
videos/events were actually analyzed vs skipped.
