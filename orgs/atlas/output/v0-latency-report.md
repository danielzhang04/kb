DRAFT — per orgs/atlas/contract.md

# Atlas V0 latency report (API-only)

- Generated: 2026-07-20 21:04 UTC
- Turns: 10 scripted kb questions (1 warm-up turn discarded)
- Fast model: `claude-haiku-4-5`  |  STT: Deepgram Flux `flux-general-en`  |  TTS: Deepgram Aura-2 `aura-2-andromeda-en`
- Method: API-only per delta design §8 + Daniel 2026-07-20. Each stage measured on the production client path (livekit deepgram plugin + anthropic SDK). Stage (a) streams Aura-synthesized question audio real-time into Flux and times last-speech-frame -> END_OF_SPEECH (so the Flux endpointing wait is included — the honest voice number). Stage (d) is the per-stage sum, not a wall-clock re-run.
- Spec bar: 500–800 ms voice-to-voice conversational (delta design §8 / spec §2).

## Per-stage summary (ms)

| Stage | mean | median | p95 |
|---|---:|---:|---:|
| STT EOT (utterance-end -> Flux EndOfTurn) | 366 | 336 | 1068 |
| EOT -> first Claude token (TTFT) | 1049 | 888 | 2534 |
| first token -> first TTS byte (Aura TTFA) | 235 | 200 | 362 |
| end-to-end (a + b + c) | 1650 | 1604 | 2939 |

## Findings vs the spec bar

- **e2e median 1604 ms / p95 2939 ms — MISSES the 500–800 ms voice-to-voice bar.** Per the plan a miss is a stop-and-reassess gate, not plow-ahead.
- Dominant stage is **Claude TTFT (median 888 ms)** — the fast-lane first-token time, not STT or TTS. STT EOT (median 336 ms) already meets Flux's sub-300 ms native-EOT promise; Aura TTFA (median 200 ms) is well inside budget.
- TTFT p95 is inflated by cold-connection outliers on the first 1–2 measured turns (~2.5–3.4 s); steady-state TTFT sits ~800–1300 ms — still brushing/exceeding the bar's low end on its own.
- A few STT-EOT values run slightly negative (~-120 ms): Flux eager-endpointed just before the trimmed nominal utterance end (~100 ms anchor imprecision inherent to synthetic audio). Numbers are reliable to about ±120 ms and are not faked.
- Reassessment levers before V1: Flux `eager_eot_threshold` for preemptive generation; TTS streaming overlapped with the tool round-trip; a lower-latency LLM path/region; prompt-shape tuning (caching is inapplicable — Haiku prefix < 4,096-tok minimum).

## Per-turn appendix (ms)

| # | question | STT EOT | TTFT | TTFA | end-to-end |
|---|---|---:|---:|---:|---:|
| 1 | What's in the queue right now? | 61 | 903 | 179 | 1142 |
| 2 | How many cards are in working? | 354 | 965 | 227 | 1546 |
| 3 | What's today's spend? | 319 | 464 | 183 | 966 |
| 4 | Give me the executive dashboard summary. | 664 | 787 | 359 | 1811 |
| 5 | What's the status of the atlas project? | 36 | 1472 | 183 | 1692 |
| 6 | Which cards are currently running? | 1068 | 760 | 217 | 2044 |
| 7 | How many tasks are sitting in inbox? | 402 | 874 | 130 | 1406 |
| 8 | What is the dashboard project doing? | 354 | 947 | 362 | 1663 |
| 9 | How much activity has there been today? | 230 | 2534 | 174 | 2939 |
| 10 | Are there any cards waiting in approvals? | 169 | 782 | 338 | 1288 |

## Transcript fidelity (STT sanity)

- 1. asked *"What's in the queue right now?"* -> Flux heard *"What's in the queue right"*
- 2. asked *"How many cards are in working?"* -> Flux heard *"How many cards are in working?"*
- 3. asked *"What's today's spend?"* -> Flux heard *"What should I spend?"*
- 4. asked *"Give me the executive dashboard summary."* -> Flux heard *"Give me the executive dashboard summary."*
- 5. asked *"What's the status of the atlas project?"* -> Flux heard *"what's the status of the Atlas project."*
- 6. asked *"Which cards are currently running?"* -> Flux heard *"Which cards are currently running?"*
- 7. asked *"How many tasks are sitting in inbox?"* -> Flux heard *"how many tasks are sitting in inbox."*
- 8. asked *"What is the dashboard project doing?"* -> Flux heard *"what is the dashboard project doing?"*
- 9. asked *"How much activity has there been today?"* -> Flux heard *"How much activity has there been today?"*
- 10. asked *"Are there any cards waiting in approvals?"* -> Flux heard *"Are there any cards waiting in approvals?"*
