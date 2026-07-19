# Motion+Audio Teardown Execution Plan

> **STATUS: COMPLETE 2026-07-08** (commits `1545077` grammar→three homes + `0450dc1` Ink Free lock).
> Ran with deviations, all logged in `decisions.md` 2026-07-08: a parallel session independently ran
> the same teardown (its logs absorbed as double-coverage; convergence replaced the spot-check step);
> session-limit crashes cost the Pirates + Prohibition-part-1 logs (10/11 chunks delivered); audio
> upgraded to the Gemini backend; cut stats measured mechanically via scene-detection; fixed-POV
> camera law added user-directed. Next steps live in CLAUDE.md "Next up".

> **Spec:** `docs/handoffs/2026-07-08-motion-teardown-prompt.md` (method, templates, guardrails) +
> `docs/handoffs/2026-07-08-motion-teardown-PICKUP.md` (approved video set). This plan is deliberately
> thin — it only fixes the execution shape the spec leaves open. Research task, not code; no TDD cycle.

**Goal:** Extract a measured motion grammar + audio grammar from 7 approved reference videos and route
the findings into their three homes (`universal.md §13a-iii`, `visual-grammar.md` + `motion-tokens.json`,
`build_motion.py`), then run the font auditions to user checkpoint.

**Depth (agreed with user 2026-07-08):** chunked agents, not more videos — ~140 events / ~1,500 frames.

| Video | Agents | Split | Events | Audio rollup |
|---|---|---|---|---|
| Crayon — Rockefeller `sMH8WchxQR8` | 2 | runtime halves | 13/chunk (26) | part-1 agent, full track |
| Crayon — Singapore `y51JjcymEAY` | 2 | runtime halves | 13/chunk (26) | part-1 agent, full track |
| Crayon — Palantir `GSkySDNmjV8` | 2 | runtime halves | 13/chunk (26) | part-1 agent, full track |
| HeyHistorically — Pirates `mtdqhaX44YQ` | 1 | — | 13 | same agent |
| HeyHistorically — Disappeared 8× `F0_d1xjk2to` | 1 | — | 13 | same agent |
| OverSimplified — Prohibition `AAGIi62-sAU` | 2 | runtime halves | 13/chunk (26) | part-1 agent, full track |
| Kurzgesagt — Scariest Place `yDAAlojz8NU` | 1 | — | 8–10, entrances+typography ONLY | SKIP (out of scope; per-event SFX field only) |

Per-chunk event quota = the spec's standard template (3 cuts · 3 entrances · 2 camera-during-hold ·
1 chart · 1 emphasis · 1 transition · 1 held-set evolution · 1 free pick). Two chunks of one video =
double samples of every category, which is the depth goal. Kurzgesagt quota: 5 entrances · 3 typography
treatments · 1 chart/diagram · 1 free pick (type/entrance-related).

**Output:** `channels/the-second-take/visual-kit/research/motion-logs/<channel>--<slug>--partN.md`
(single-agent videos omit `--partN`). Structured tables per the spec's per-event fields; burst sampling
mandatory; frame-filename citations mandatory.

## Tasks

- [ ] **1. Configure claude-video-vision to reduced quality (~480p)** in the main session BEFORE any
  agent downloads (known failure: high quality chokes the tools). Verify config sticks.
- [ ] **2. Pull runtimes** for the 7 ids (yt-dlp `--print duration`) to compute chunk boundaries
  (0–50% / 50–100%, ±15s overlap tolerance at the seam).
- [ ] **3. Launch 11 background subagents** (single message, concurrent) with the spec's extraction
  template + per-chunk time range + quota + output path. Monitor; a spun-out agent gets ONE nudge,
  then its video gets reassigned/downscoped. Agents that fail after quality-reduction + 1 retry:
  swap/drop and report honestly.
- [ ] **4. Merge chunk rollups → per-video rollups**; dedupe seam-boundary events.
- [ ] **5. Spot-check 2 events/video** (re-pull the cited frames, confirm the observation). A video
  failing spot-check → re-extract or drop, reported.
- [ ] **6. Synthesize** the motion grammar table + audio grammar (Crayon-weighted; Kurzgesagt marked
  aspirational, entrances/type only; learn-the-mechanic-never-clone). Route to exactly three homes
  per the spec §"Synthesis". curate-doc discipline on every doc touched.
- [ ] **7. Font auditions** via `engine/still-video.mjs` (4–5 candidates from observed type classes;
  local/OFL faces; same caption frame + stat-card frame each) → ONE comparison artifact (big images,
  click-to-enlarge lightbox) → **CHECKPOINT #2: user picks** → winner into `motion-tokens.json`.
- [ ] **8. Close-out** per the spec: decisions.md entry, CLAUDE.md status (integrate), reference-channels.md
  next-steps, delete the PICKUP file, note the two named follow-ups (56s-slice A/B; engine audio layer).
  Commit with EXPLICIT `git add <paths>` only — parallel terminals active; never touch `_chain-test/`.
