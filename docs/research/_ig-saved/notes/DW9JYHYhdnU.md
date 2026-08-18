# DW9JYHYhdnU — Claude Managed Agents
- post: https://www.instagram.com/p/DW9JYHYhdnU/ | author: @Taki Wong | AI For Business | published: 20260410 | duration: 129s

## What's demonstrated
A talking-head creator ("Day 16 of the Valuable AI Series") walks through Claude's "Managed Agents" feature in the Claude Console (platform.claude.com), including a real screen recording of an external monitor showing the actual product UI: the agent-quickstart URL, a YAML agent config with an MCP-server-backed tool list, and a template browser. He frames it as a replacement for three prior ways of building agents (no-code platforms like n8n/Zapier, raw Claude Code, and a harness he calls "OpenClaw"), then shows creating an agent from a natural-language spec via the Console.

## Concrete mechanism
Managed Agents lets a user describe an agent in plain language (or start from a template), and the Console scaffolds the agent config, backend, database, and security automatically. The screen recording shows the actual mechanics: a YAML `name/description/model/system` block, an `mcp_servers` list (each with `name` + `url`, e.g. Notion, Slack) referenced by `tools:` entries of `type: mcp_toolset` with a `default_config.permission_policy` (seen as `always_allow`), plus an `agent_toolset` type for built-in tools. Agent creation also has an API path: `POST https://api.anthropic.com/v1/agents` with a JSON body (`name`, `model`) returning an `agent_id` (e.g. `agent_01JR4kW9`), which can then be invoked from a terminal session against a specific company/target.

## Named tools / repos / models / APIs
- Claude Managed Agents — Console section under Build, sidebar shows: Quickstart, Agents, Sessions, Environments, Credential vaults [frame]
- `platform.claude.com/workspaces/default/agent-quickstart` — the actual URL shown in an address-bar autocomplete [frame]
- `POST https://api.anthropic.com/v1/agents` — agent-creation API endpoint, headers `x-api-key`, `anthropic-version`, `content-type` [frame]
- Models referenced in on-screen configs: `claude-opus-4-6` (Merges & Acks / deal-analyst agent), `claude-sonnet-4-6` (Support Agent template) [frame]
- MCP servers wired into the Support Agent template: Notion (`mcp.notion.com`), Slack (`mcp.slack.com`) [frame]
- Template gallery (real names + one-line descriptions, all read off the "Browse templates" screen) [frame]: Blank agent config, Structured extractor, Support agent, Feedback miner (Slack+Notion → Asana tasks), Support-to-eng escalator (Intercom → Jira), Deep researcher, Field monitor (blog scan → summary), Incident commander (Sentry alert → Linear issue + incident channel), Sprint retro facilitator (Linear sprint → summarized threads), Data analyst (spreadsheet workbook)
- Alternatives named as the "traditional 3 ways" to build agents: n8n / Zapier (no-code), Claude Code, "OpenClaw" (shown with a red-lobster mascot logo) [audio, frame]

## Specific claim / result
No quantified benchmark (no %, $, or pass-rate figures) — this is a feature walkthrough, not a benchmark video. The headline claim is qualitative/hyperbolic: "Claude just released another feature that will replace entire engineer teams and it also single-handedly wiped out hundreds of startups" [audio, 00:00].

## Novel / buildable moments (with timestamps)
- 00:35 — the YAML agent-config shape (name/description/model/system + mcp_servers + tools with per-tool `permission_policy`) is a directly reusable schema pattern for any "define an agent as declarative config, then run a session against it" system.
- 01:10 — real product screen recording confirms `platform.claude.com/workspaces/default/agent-quickstart` and a Console nav item literally called "Managed Agents" with Quickstart/Agents/Sessions/Environments/Credential vaults sub-items — worth checking directly if this Console surface is usable for kb's agent roster.
- 01:16–01:33 — the template gallery is a ready-made checklist of common agent archetypes (structured extractor, support-to-eng escalator, incident commander, sprint retro facilitator) worth comparing against kb's own agent catalog for gaps.

## Transcript highlights
- 00:25 "Managed Agents is Claude's new feature that allows you to build entire AI agents without even knowing how to code."
- 00:32 "It sets up everything for you, including the database, the backends, the security."
- 00:42 "First, you could use a no-code tool like N8n or Zapier, but the problem with that is that it breaks all the time."
- 01:01 "Or number three, you can use a harness like OpenClaw, but... you don't really have a lot of data privacy and the security is not the best."
- 01:28 "You can build agents for all sorts of things like managing your inbox and calendar, responding to customer inquiries, and even spying your competitors ads and contents."

## Reliability
Mixed — the hype framing ("killed hundreds of startups") and the closing "Comment Claude for the full guide" CTA are lead-magnet trappings, but the video is not thin: it includes an actual screen recording of a physical monitor running the real Claude Console UI with consistent, specific details (breadcrumb steps, YAML schema, MCP server config, template names/descriptions) that read as a genuine product demo rather than fabricated slides. Worth treating the UI details as real and checking the Console directly rather than trusting the framing.
