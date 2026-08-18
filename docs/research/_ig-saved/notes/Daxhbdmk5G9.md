# Daxhbdmk5G9 — Prompt caching - cheapest win in the stack
- post: https://www.instagram.com/p/Daxhbdmk5G9/ | author: @Hashin | published: 20260714 | duration: 10s

## What's demonstrated
A pure animated infographic (no talking head, no voiceover — only background music) titled "Prompt Caching," attributed to @technicallyhash, illustrating "same call, ten times, two ways to pay." It runs an animated side-by-side simulation of 10 identical calls to a model: a "NO CACHE" path that re-sends the full prompt every call, and a "CACHED" path that reuses a cached prefix and only pays for the delta. Nothing is actually run against a live API — it's a scripted/animated counter ticking through the two totals.

## Concrete mechanism
Per the on-screen diagram: the "NO CACHE" path re-sends ~12k tokens (a fixed full prompt) on every one of the 10 calls, so cost and token count climb linearly and reach the full price each time. The "CACHED" path routes each call through a "CACHE" node between "your app" and "model" — it reuses the cached stable prefix and pays only for the changed/delta tokens, so per-call cost and latency stay far lower after the first call. The animation explicitly narrates the mechanism via on-screen captions: "no cache re-sends the whole prompt every call," "cached serves the repeated prefix instantly," "cache the stable prefix, pay only for what changes."

## Named tools / repos / models / APIs
- Claude Code [frame, in the closing tag line "PROMPT CACHING · CLAUDE CODE · ANTHROPIC API"]
- Anthropic API [frame, same closing tag line]
- No specific SDK call, code snippet, or config flag is shown anywhere — the entire demo is a conceptual cost/token visualization, not real code.

## Specific claim / result
Animated running totals across 10 calls, end state at CALL 10/10:
- NO CACHE: cost $1.00, tokens 120,000 (cumulative)
- CACHED: cost $0.10, tokens 6,000 (cumulative)
- Final banner: "same output · 10x cheaper" / "same output, one dollar versus ten cents"
These are illustrative simulated numbers (round token/cost figures scaling linearly), not a measured benchmark from a real run.

## Novel / buildable moments (with timestamps)
- 00:00-00:09 — The "your app → CACHE → model" node diagram is a clean, reusable way to visually explain prompt caching's mechanism (stable prefix reused, only delta re-sent/re-priced) — worth reusing as an internal explainer graphic for onboarding people onto Claude prompt caching.
- 00:07-00:08 — Explicit framing "cache the stable prefix, pay only for what changes" is a good one-line design rule to bake into any prompt-engineering checklist for kb agents (put static context/instructions first, dynamic per-call content last, to maximize cache-hit prefix length).

## Transcript highlights
No speech — the video has no voiceover transcript (audio track is music only). On-screen text captions carry the substance instead:
- "same call, ten times. two ways to pay."
- "why does one cost ten times more?"
- "no cache re-sends the whole prompt every call"
- "cached serves the repeated prefix instantly"
- "cache the stable prefix, pay only for what changes"
- "same output · 10x cheaper"
- Closing CTA: "comment CACHE and i'll dm you the setup"

## Reliability
Thin as a technical demo but directionally accurate: it's a pure animated numbers-graphic with no real code, API call, or benchmark shown — the 10x figure and dollar amounts are illustrative round numbers from a template, not a measured result. The underlying claim (prompt caching gives large cost/latency wins by reusing a stable prefix) is real and well-established, but nothing in this specific video proves it beyond a stylized chart, and it ends on the standard "comment X and I'll DM you the setup" lead-magnet hook.
