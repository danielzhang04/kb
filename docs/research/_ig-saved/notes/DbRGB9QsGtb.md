# DbRGB9QsGtb — Pinchtab - browser control for any agent via HTTP API
- post: https://www.instagram.com/p/DbRGB9QsGtb/ | author: @Marc Kaz | published: 20260726 | duration: 16s

## What's demonstrated
A screen-recording of the PinchTab GitHub README (github.com/pinchtab/pinchtab) with a talking-head creator narrating over it. The repo README shows the project tagline "Browser control for AI agents — Small Go binary · HTTP API · Token-efficient," a description that it's a standalone HTTP server giving AI agents direct control over Chrome, and a benchmark table comparing PinchTab against "agent-browser" on end-to-end agent-loop token cost. No live demo of the tool running is shown — it's a README read-through.

## Concrete mechanism
Per the on-screen README text: PinchTab runs as a standalone HTTP server (single Go binary, no deps) that agents talk to over a plain HTTP API instead of a framework SDK. For day-to-day use it's installed as a user-level daemon so multiple agent tool invocations can reuse the same browser control plane running in the background, rather than each spinning up a fresh browser session. Narration additionally claims (audio only, not shown on screen) "stealth injection" and a "real-time dashboard," and a "multi-instance orchestrator" — none of these three specific mechanisms are visually demonstrated, only named in voiceover.

## Named tools / repos / models / APIs
- PinchTab — github.com/pinchtab/pinchtab [frame, shown directly as on-screen link and as the README title]
- Release badge v0.15.0 [frame]
- Go CI badge showing "failing" [frame]
- License: Apache 2.0 [frame]
- Benchmark comparison target: "agent-browser" (a different, unnamed-in-detail tool/library) [frame]
- Anthropic API (used as the benchmark's cost-metering basis) [frame, in table caption "Measured end-to-end agent-loop token cost (Anthropic API)"]

## Specific claim / result
On-screen benchmark table, "Cost cheaper" / "Fewer requests" vs agent-browser:
- Basic Haiku (10 steps): 9.5% cheaper, 23.0% fewer requests
- Extended Haiku (24 steps): 19.6% cheaper, 31.1% fewer requests
- Extended Sonnet (24 steps): 20.3% cheaper, 29.4% fewer requests
(Caption also claims "Page snapshots for ~800 tokens (13x cheaper than screenshots)" and "Smart diff mode" — these are NOT visible in the captured frames, only in the IG caption text, so they are unverified against the video itself.)

## Novel / buildable moments (with timestamps)
- 00:00-00:15 — Real, working numeric benchmark (cost % and request-count % vs a rival tool) published directly in a repo README — a good pattern to copy for any internal tool comparison page (show cost/step deltas, not just prose claims).
- 00:00 — "standalone HTTP server ... user-level daemon, allowing agent tools to reuse the same browser control plane" is a reusable architecture idea: a persistent local browser-control daemon shared across all agent processes instead of spinning a new browser context per agent run.

## Transcript highlights
- 00:00-00:08 — "what's up guys so this is a high-performance browser automation bridge and multi instance"
- 00:09-00:15 — "orchestrator with advanced stealth injection and a real-time dashboard let's go"

## Reliability
Substantive and credible for the parts actually shown on screen — real repo, real version tag, real (if modest) percentage benchmarks in a comparison table, Apache 2.0 licensed, direct link given (no "comment for repo" gate). Caveat: the CI badge visibly reads "failing," and several narrated capabilities (stealth injection, multi-instance orchestrator, real-time dashboard) are spoken but never shown on screen, so those specific claims are unverified from the video alone.
