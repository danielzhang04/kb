# Executive Dashboard
_Generated: 2026-07-21 06:09 UTC by dispatcher-cloud_

## Action required
Human-owned cards waiting in `queue/inbox/` (`queue/approvals/` signed folder: empty):
- **6a5e482a-3b8707b5** — kb-ops — `decide:budget-gate-measures-nothing` (T3): the daily budget gate is structurally measuring nothing (image spend never lands in `ledgers/cost/`, so it always passes); `governance/` is human-edited, so this needs Daniel's decision.
- **6a5d6b23-12ddfee2 / -05204b15 / -4c98aec0 / -17e8d1be** — kb-ops — `approve:oauth-gate-g1..g4` (T3): one-time human OAuth setup for the Google Workspace MCP server.
- **6a5c7274-635d84bf** — kb-ops — `flip delivery-gate warn->block` (T2): blocked pending Daniel's ecc-import wave-1 checkpoint.
- **faceless-youtube PR #41** (+ fyt-video-run-test companion) — awaiting merge; Poyais video parked at GATE 3 (thumbnail auth / L17 / publish approval all need Daniel).

## Queue
| state | count |
|-------|-------|
| inbox | 8 |
| working | 4 |
| done | 54 |
| approvals | 0 |

_(Inbox count includes this nightly card `6a5f0cef-53d31df4` at `state: working`, and a stale done-card — see Anomalies. No `working/` card is >48h old.)_

## Last 24h
- **Cadences:** `nightly-review` dispatched today (`6a5f0cef-53d31df4`, this run) and yesterday (`6a5dbb3e-295a9d2b`).
- **Cost:** today **$0.94** / $5.00 daily cap → **$4.06 remaining** (7 gemini-image calls, Poyais thumbnail regen round 2, Daniel-ordered). Yesterday $0.54. (Note: only image spend is ledgered; subscription steps log $0.00 — see the open budget-gate decision card.)
- **Notable results:** Atlas **V1 "HANDS" wave COMPLETE** — all three human gates (A/B/C) passed at the desk; PR #44 merged (aa35b00) and **rolled out to prod** (Atlas view live on 127.0.0.1:5317 with live worker passthrough verified). Two Gate-C findings fixed same-session. Inspector graded atlas cards 95–97 across the board. Suites green: atlas 132, fleet 530, dashboard 1551.

## Projects
- **atlas** — V1 "Hands" wave complete + prod rollout done (2026-07-21); V2 "Trust" planning awaits Daniel's go/no-go. 4 conversation-rules cards in `working/` (owner claude-boss, opened 02:04 UTC today, on branch claude/atlas-voice-rules).
- **faceless-youtube** — PR #41 (post-render tail + fyt-runner + workflow segments) READY TO MERGE, must land with the fyt-video-run-test companion; Poyais parked at GATE 3 awaiting Daniel; fyt-run-001 (wells-fargo) parked entirely.
- **kb-ops** — scaffolded 2026-07-16; no active "Now" work; open human-owned decision/approval cards listed under Action required.

## Anomalies
- **Stale done-card in inbox:** `6a5dbb3e-295a9d2b` (yesterday's nightly-review) sits in `queue/inbox/` with `state: done` — never moved to `queue/done/`. Cosmetic; inflates the inbox count by one.
- 4 atlas `working/` cards (`14eb8f69-*`) opened 2026-07-21 02:04 UTC — **not stale** (<48h), left in place.
- Preamble: **OK**. Skills sync (`sync_skills.py --check`): **clean, no drift**.
