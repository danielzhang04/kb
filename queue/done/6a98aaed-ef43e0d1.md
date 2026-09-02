---
schema-version: 1
id: 6a98aaed-ef43e0d1
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-kb\d270c80a-9230-4497-bef2-2569f438a803\scratchpad\prospecting
risk-tier: T1
owner: codex-worker
claim-token: aab334e3036d8525
state: done
approval: null
workflow: 01a06458-3ebc-7cd1-91ff-2884f57de066
depends-on: []
variant-group: null
role: work
session-id: 6a98a9f7-fc4cb825
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

> ENVIRONMENT NOTE (overrides any remembered kb rule): this working directory is a standalone
> scratch git repo, NOT the kb repository. There is no `scripts/preamble.py`, no STOP file, no
> queue, no ledgers here and none are required. Do NOT look for them and do NOT emit a wake-me
> card about them. Start the task immediately.

\# Research brief r5: open-source and template landscape (web research; ONE report `./report-r5-oss-landscape.md`)
\## Context (same for both slices)
Daniel is building a personal prospecting + outreach system on private infrastructure:
finder = LinkedIn (Premium, hand-driven or assisted at human pace) + company-list sources;
enrichment rented (Hunter/Snov-class); sequencing OWNED on the Gmail API (drafts approved, then
scheduled staggered sends, in-thread follow-ups, reply classification, labels); volume 0-50
emails/day; use cases = coffee chats / interview ins at target companies, curiosity networking,
alumni, occasional sales. Example: 200 NYC VC firms -> one associate + one director each ->
emails -> personalized first touch -> follow-ups. He wants to MINE what practitioners have
already built rather than invent: architectures, data models, prompts, personalization
techniques, cadence numbers, cleaning rules, tooling, and reusable code.

\## Task
The best BUILT artifacts for a research->personalize->Gmail-sequence outreach system: open-source
repos (any age if still excellent), agent-framework examples (LangGraph/CrewAI/OpenAI Agents/
Anthropic cookbook), n8n/Make/Clay templates that are exportable, MCP servers/CLIs for Gmail/Sheets/
Hunter/Snov/PDL/Playwright, and prompt/personalization libraries. Verdict per item: PULL-CODE /
PULL-DESIGN / INSPIRATION. End with: the architecture the best ones converge on (stages, data model,
where LLM judgment sits vs deterministic code) and the 5 artifacts to pull first, ranked.

\## Depth rule (binding)
Daniel does NOT want a catalog. Find the genuinely EXCELLENT sources only: 8-12 items total, each
one you would personally build from. Reject anything generic, vendor-marketing, or shallow. For each
item spend your effort on WHAT IS REUSABLE (the actual data model, prompt, cadence logic, cleaning
rule, adapter, or workflow steps), quoted or reconstructed precisely enough that a builder needs no
second visit. Stop at 40 minutes. Cite URL + seen-date. Mark UNVERIFIED where needed. No code.

## Result

FAILED: orphaned — dispatch parent died before completion (model gpt-5.6-sol, started 2026-09-02T22:58:03Z, log C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a98a9f7-fc4cb825.jsonl)

Last log lines:

{"type":"item.completed","item":{"id":"item_22","type":"web_search","id":"exec-d26297ca-b3fa-4964-b637-bf073a732d82","query":"","action":{"type":"other"}}}
{"type":"item.started","item":{"id":"item_23","type":"web_search","id":"exec-be48cb48-ef6d-4306-8d28-424d561b29ad","query":"","action":{"type":"other"}}}
{"type":"item.completed","item":{"id":"item_23","type":"web_search","id":"exec-be48cb48-ef6d-4306-8d28-424d561b29ad","query":"'class Campaign('","action":{"type":"other"}}}
{"type":"item.started","item":{"id":"item_24","type":"web_search","id":"exec-e22537ab-12df-4d74-af42-31b385bce862","query":"","action":{"type":"other"}}}
{"type":"item.completed","item":{"id":"item_24","type":"web_search","id":"exec-e22537ab-12df-4d74-af42-31b385bce862","query":"'class QueueSlot('","action":{"type":"other"}}}
