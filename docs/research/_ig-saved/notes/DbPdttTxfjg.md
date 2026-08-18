# DbPdttTxfjg — Building WITH Claude - the hidden folder/structure
- post: https://www.instagram.com/p/DbPdttTxfjg/ | author: @Akash | Claude code & AI Agents | published: 20260726 | duration: 5s

## What's demonstrated
This "video" is a single static infographic held on screen for 5 seconds with no audio track (`has_audio: false`) and no motion — effectively a saved image exported as a short clip, not a demonstration. The infographic is titled "anatomy of a .claude/ folder — EVERY FILE. WHAT IT DOES. WHY IT MATTERS." and lays out a full annotated file tree of a `.claude/` project folder with a one-line explanation next to every entry.

## Concrete mechanism
Not applicable — nothing is demonstrated in motion; this is a reference diagram of Claude Code project-folder conventions, not a walkthrough of building or using one.

## Named tools / repos / models / APIs
All items below are read directly off the static infographic [frame]:
- `CLAUDE.md` — "where Claude actually lives"
- `CLAUDE.local.md` — "your rules. keep it under 200 lines"
- `.gitignore` — "block *.local* and your secrets"
- `.mcp.json` — "MCP servers. root only, no nesting"
- `.claude/` — "the brain. everything below loads"
  - `skills/` — "model-invokable. Claude picks them" → example skills `ui-ux-pro-max/` ("design intelligence on tap"), `remotion/` ("edit videos programmatically")
  - `agents/` — "subagents. own context window" → example agents `code-reviewer.md` ("senior reviewer for every PR"), `debugger.md` ("hunt the bug in isolation"), `security-auditor.md` ("scan for vulns and secrets")
  - `commands/` — "slash commands. legacy but live" → `commit.md` ("analyze diff, write commit msg")
  - `hooks/` — "shell scripts that always fire" → `format-on-save.sh`, `block-dangerous-bash.sh` ("block rm -rf and force-push"), `desktop-notify.sh` ("ping me when Claude finishes")
  - `plugins/` — "first-class in 2026. /plugin:cmd" → `claude-finance/` ("official Anthropic plugin. 6 agents")
  - `rules/` — "glob-scoped, loads on match" → `api.md` ("fires only inside src/api/**")
  - `output-styles/` — "response shape on tap" → `terse.md` ("code only. no prose")
  - `statusline` — "bottom-bar. branch, model, tokens"
  - `settings.json` — "permissions, model, hook registry"
  - `settings.local.json` — "your machine, gitignored"

## Specific claim / result
No benchmark or number — the only concrete factual claim is that `claude-finance` is "an official Anthropic plugin" with "6 agents." Not independently verified from this video.

## Novel / buildable moments (with timestamps)
- 00:00 (the whole clip is one static frame) — the infographic itself is a directly reusable checklist for structuring a `.claude/` folder: `rules/` as glob-scoped auto-loading context (vs. always-loaded CLAUDE.md), `hooks/block-dangerous-bash.sh` as a concrete safety-hook example, and `output-styles/terse.md` as a response-shaping mechanism — all worth comparing against kb's own `.claude/` setup for gaps.

## Transcript highlights
No audio track. On-screen text substitutes:
- "anatomy of a .claude/ folder — EVERY FILE. WHAT IT DOES. WHY IT MATTERS."
- "SUPER DEVS AREN'T WRITING BETTER PROMPTS. THEY HAVE A BETTER .CLAUDE/."
- "Comment 'MAP' I'll send it."

## Reliability
Thin as a *video* (it is a static image with a "comment MAP and I'll send it" lead-magnet CTA, no live demonstration, no audio, no proof any of it works) — but the infographic content itself is dense, specific, and plausible rather than vague filler; treat it as a reference checklist to spot-check, not as evidence of a working system.
