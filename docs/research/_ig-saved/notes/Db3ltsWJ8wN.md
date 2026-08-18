# Db3ltsWJ8wN — Composio 8-agent-harness benchmark (Pi Agent wins)
- post: https://www.instagram.com/p/Db3ltsWJ8wN/ | author: @Wassim Younes | published: 20260810 | duration: 34s

## What's demonstrated
A creator reacts to a Composio (@composio on X) benchmark thread that ran DeepSeek V4 Flash through 8 agent harnesses on 30 agentic tasks, then zooms into the GitHub README for the winning harness, "Pi Agent" (pi.dev). The video is screen-capture of the actual X thread + bar charts, not a live coding demo — no task execution is shown, only Composio's published results and the Pi repo's README.

## Concrete mechanism
Not a mechanism video — it's a benchmark readout. Composio ran the same 30 tasks through each harness on the same underlying model (DeepSeek V4 Flash) and measured pass rate, cost/task, and median time/task. The distinguishing claim is that the harness (orchestration layer) — not the underlying model — is what drives cost/quality/speed differences.

## Named tools / repos / models / APIs
- Composio (@composio on X) — ran the benchmark [frame]
- DeepSeek V4 Flash — the model used across all harnesses [frame, audio]
- Pi Agent Harness — pi.dev, npm v0.84.1, Discord community badge [frame]
  - github.com/earendil-works/pi-coding — "interactive coding agent CLI" [frame]
  - github.com/earendil-works/pi-agent — "runtime with tool calling and [state?] management" [frame, text partially obscured]
  - github.com/earendil-works/pi-ai — "unified multi-provider LLM API (OpenAI, Anthropic...)" [frame]
- Other harnesses named in the chart: Oh My Pi, Claude Code, Codex, Deep Agents (by LangChain), Prime Agent, Hermes Agent, OpenCode [frame]
- x.com/composio/status... — the source thread (URL shown truncated, not fully readable) [frame]

## Specific claim / result
First chart ("Tasks passed of 30 across 8 agent harnesses"): Pi Agent 20 passed, Oh My Pi 17, Claude Code 16, Codex 16, Deep Agents 16, Prime Agent 15 (+6 not graded), Hermes Agent 14, OpenCode lowest [frame].
Second chart (narrower 4-harness comparison — Hermes, Pi, Prime, Deep Agents): Pi Agent 66.7% pass rate / $0.012 per task / 132s median; Prime Agent 62.5% / (cost obscured by finger in frame, caption claims $0.045) / 242s median; Deep Agents 53.3% / $0.018 / 187s; Hermes Agent 50.0% / $0.017 / 176s [frame, caption]. Note: caption's tweet text ("Pi Agent passed 20 of 30 tasks... Prime Agent passed 15 of 24 valid runs") differs slightly from the pass-rate percentages in the second chart — these appear to be two different Composio threads/tests being spliced together in the video.

## Novel / buildable moments (with timestamps)
- 00:00–00:09 — the two Composio bar charts are a ready-made harness-selection reference: if picking an orchestration layer for a coding/agent task, Pi Agent claims best pass-rate/cost/speed tradeoff on this benchmark.
- 00:22–00:33 — Pi's own repo splits cleanly into 3 composable packages (pi-coding CLI, pi-agent runtime, pi-ai multi-provider API layer) — worth studying as a reference architecture for a lightweight harness, especially the pi-ai unified LLM API package.

## Transcript highlights
- 00:00 "The most efficient harness just came out. It's called PI agent."
- 00:03 "This beat every harness on finishing all tasks, but as well as the cheapest token usage as well."
- 00:08 "It has the highest rate of finishing tasks at the lowest cost, as well as the time to finish them."
- 00:21 "People are realizing that the harness, the way it orchestrates, the way it operates, will be the main reason why you're able to finish tasks more optimally at the lowest cost."

## Reliability
Substantive — grounded in a real, named benchmark source (Composio) and a real, verifiable open-source repo (earendil-works/pi-agent on pi.dev), with actual chart numbers read off-screen rather than just claimed in the caption; the "comment HARNESS I'll send" CTA is a mild lead-magnet wrapper but the on-screen data itself is concrete and traceable.
