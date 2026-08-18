# Dbn6ElTvw_W — 5 free Claude Code plugins
- post: https://www.instagram.com/p/Dbn6ElTvw_W/ | author: @Nick Saraev | published: 20260804 | duration: 57s

## What's demonstrated
A talking-head + screen-graphic video walking through 5 Claude Code plugins/tools: OmniRoute (a multi-provider AI router), claude-mem (persistent cross-session memory), Headroom (a local prompt-compression proxy), an official Anthropic "Claude Code Setup" plugin (scans a codebase and recommends/prunes hooks/skills/subagents/MCP servers), and task-observer (a meta-skill that watches your Claude Code sessions and auto-drafts/improves other skills). Each segment shows a mocked-up terminal/UI graphic (not a live unedited screen recording — these are stylized product-card renders) plus, for claude-mem and task-observer, real GitHub README screenshots with repo names and star history visible.

## Concrete mechanism
- OmniRoute: sits in front of Claude Code as a router; when your usage limit runs out it auto-switches the active model to the next-best from a large catalog of providers (icons shown: OpenAI, Anthropic, Gemini, xAI Grok, DeepSeek, Mistral, Qwen, Meta Llama, Groq, NVIDIA, MiniMax, Cohere, Perplexity, HuggingFace, Together, Fireworks, Cloudflare, Baidu, +220 more). A "Switching model..." UI shows it cycling between GLM-5.0, Kimi, Gemini, Claude Code cards.
- claude-mem: a persistent memory-compression system built specifically for Claude Code; README states it "seamlessly preserves context across sessions by automatically capturing" project state (text cuts off on-screen).
- Headroom: a local proxy/CLI (`headroom wrap claude`) that sits between "Your agent/app" (Claude Code, Cursor, Codex, LangChain, Agno, Strands, or custom code) and the LLM provider. Pipeline shown on-screen: prompts/tool outputs/logs/RAG results/files → Headroom (runs locally, data stays local) → CacheAligner → ContentRouter → CCR, branching into SmartCrusher (JSON), CodeCompressor (AST), and Kompress-v2-base (text, HF) → cross-agent memory / "headroom learn" / MCP → compressed prompt + retrieval tool → LLM provider (Anthropic, OpenAI, Bedrock, ...). Terminal shows it launching a local proxy on port 8787 and routing Claude Code's API calls through it.
- Claude Code Setup (official Anthropic plugin): scans the codebase and prints custom-agent/skill token costs (e.g. a `code-reviewer` custom agent at 335 tokens; skills `doc-helper` 48, `pr-description` 37, `documentation` 36, `commit-message` 32, `debugging` 29 tokens) and a `/context` breakdown of total context usage by category (system prompt, system tools, custom agents, skills, messages, free space, autocompact buffer, each with token counts/percentages). Separately shows it authoring/trimming an `agent_prompt.md` file down to a lean Summary/Instructions/Constraints template, removing unneeded sections labeled "fluff."
- task-observer: described in its own GitHub README as "One Skill to Rule Them All" — a meta-skill that runs alongside your Claude Code work, watches what you do, and (1) drafts new skill candidates from repeated patterns and (2) suggests edits to existing skills based on corrections/preferences you express. Shown running as a background "Observing tasks" panel next to a live Claude Code task checklist (Reading project files → Searching codebase → Editing components → Running tests → Rendering video → Committing changes), ticking off each step.

## Named tools / repos / models / APIs
- OmniRoute — router product, "251 AI Providers — 90+ Free" [frame, 00:07-00:09]; provider icon grid: OpenAI, Anthropic, Gemini, xAI Grok, DeepSeek, Mistral, Qwen, Meta Llama, Groq, NVIDIA, MiniMax, Cohere, Perplexity, HuggingFace, Together, Fireworks, Cloudflare, Baidu [frame, 00:07-00:09]; model-switch cards show GLM-5.0, Kimi, Gemini, Claude Code [frame, 00:11-00:13]; "Free-Tier Budget" chart lists providers Kimi, Gemini, LongCat, Cerebras, NVIDIA, and one more (partially legible) [frame, 00:14-00:15]
- claude-mem — GitHub repo `thedotmack/claude-mem`, "Persistent memory compression system built for Claude Code," Apache-2.0, marked "#1 Repository Of The Day" trending, star-history graph rising toward ~80K stars [frame, 00:18-00:22]
- Headroom — local CLI/proxy tool, terminal shows `headroom wrap claude`, "Proxy already running on port 8787," internal components CacheAligner, ContentRouter, CCR, SmartCrusher, CodeCompressor, Kompress-v2-base [frame, 00:24, 00:28-00:30]; explicitly compatible with Claude Code, Cursor, Codex, LangChain, Agno, Strands [frame, 00:28]
- Claude Code Setup — described in voiceover as "an official anthropic plugin" [audio 00:33-00:37]; terminal screenshots show `/agents`, `/skills`, and `/context` command output with per-item token costs [frame, 00:35, 00:37]
- task-observer — GitHub repo README titled "task-observer - One Skill to Rule Them All," CC-BY-4.0 license, references "Augmented Expertise methodology" as the framework it's built on, claims compatibility reported with "Hermes and Openclaw" agent setups [frame, 00:47]
- A separate "Welcome, Chelsea" connectors screenshot shows toggles for Asana, Atlassian, Canva, Figma, Granola, Linear, Supabase, captioned "Sub-Agents" / "MCP" — appears to be generic stock UI illustrating the MCP concept rather than a literal Claude Code Setup screen [frame, 00:39-00:41]

## Specific claim / result
- OmniRoute: "up to 1.6 billion free tokens every single month" (voiceover) [audio 00:13-00:16]; on-screen text says "200 FREE" and "251 AI Providers — 90+ Free" / "264 providers, 90+ with a free tier, 11 free forever" (small print) [frame, 00:07-00:08].
- claude-mem: star-history graph shows growth from near-zero to ~80K GitHub stars over roughly Oct–April [frame, 00:20-00:22].
- Headroom: voiceover claims "same results with way fewer tokens" via compression, no specific percentage given [audio 00:29-00:33].
- Claude Code Setup: voiceover claims it "scans your entire code base and actually recommends the best hooks, skills, sub-agents, and even MCP servers" and "removes all of the unnecessary and useless fluff" [audio 00:33-00:45].
- task-observer: README states "In the first three months of using this meta-skill, it logged and applied over 600 improvements across my 40 skills, most of which were themselves created based on observations by the meta-skill" [frame, 00:47].

## Novel / buildable moments (with timestamps)
- 00:07-00:09: A unified router exposing 250+ model providers behind one endpoint, with automatic failover on rate-limit — worth studying for any multi-provider LLM gateway.
- 00:14-00:15: A "Free-Tier Budget" dashboard tracking remaining free-tier quota per provider — a concrete UI pattern for a cost/usage dashboard.
- 00:28-00:30: Headroom's pipeline diagram (CacheAligner → ContentRouter → CCR → SmartCrusher/CodeCompressor/Kompress-v2-base) is a legible reference architecture for building a local prompt-compression proxy that's agent/framework-agnostic.
- 00:35-00:37: Claude Code's native `/context` command breaking down token usage by category (system prompt, tools, custom agents, skills, messages, free space, autocompact buffer) — directly useful for auditing context budget in this kb repo's own Claude sessions.
- 00:43-00:45: The "official Anthropic plugin" pattern of writing/trimming a lean `agent_prompt.md` (Summary/Instructions/Constraints, explicit "remove fluff") is a reusable template shape for kb's own agent prompt files.
- 00:47-00:51: task-observer's core loop — passively observe agent sessions, draft new skill files from repeated patterns, and suggest edits to existing skills — is directly relevant to kb's existing skill-authoring workflow (superpowers:writing-skills) and could inform an automated skill-gap-finder.

## Transcript highlights
- 00:00-00:03 — "Don't use cloud code unless you've installed these five plugins."
- 00:03-00:09 — "The first is OmniRoute, which gives cloud code almost unlimited usage by connecting to over 200 free AI API providers."
- 00:13-00:16 — "giving up to 1.6 billion free tokens every single month."
- 00:23-00:25 — "The third is called Headroom. This sits between you and your AI model and only passes through the parts that actually matter,"
- 00:33-00:37 — "The fourth is Cloud Code Setup, which is an official anthropic plugin that scans your entire code base"
- 00:37-00:43 — "and actually recommends the best hooks, skills, sub-agents, and even MCP servers to fit your project."
- 00:45-00:49 — "And finally, Task Observer. They'll watch how you work, learn your style,"
- 00:49-00:53 — "and constantly improve your other skills in the background for you entirely automatically."

## Reliability
Substantive relative to the format — every plugin is named on-screen (not withheld) and 2 of the 5 (claude-mem, task-observer) are corroborated with real GitHub README screenshots including repo identity and license, and Headroom's architecture is shown in enough diagram detail to be independently verifiable/buildable. Numeric claims (1.6B free tokens/month, "600 improvements" for task-observer) come from the products' own marketing copy or voiceover and aren't independently verified in-video. Still ends with a standard "comment X for the link" CTA, so exact repo URLs for OmniRoute and Headroom are not directly legible on-screen (only claude-mem's `thedotmack/claude-mem` and task-observer's are readable).
