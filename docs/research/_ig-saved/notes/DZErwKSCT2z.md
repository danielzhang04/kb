# DZErwKSCT2z — Claude Code + Codex - build a UI on your subscription
- post: https://www.instagram.com/p/DZErwKSCT2z/ | author: @RANDY ROBERTS | published: 20260602 | duration: 70s

## What's demonstrated
A talking-head creator pitches a workflow idea: build your own web/app UI that talks back and forth with Claude Code or Codex CLI (via your existing subscription) instead of an app that calls the model API and burns metered credits. The video illustrates the idea entirely with generic, non-functional mockup screenshots (a "Morning board" dashboard, a "Content pipeline" kanban, a "Projects at a glance" table, an "Approvals" queue, an animated cost-comparison bar chart) — no real product, app, or repo is ever shown running or named on screen.

## Concrete mechanism
Per narration: instead of vibe-coding an app that hits a model API directly (accruing metered per-call API credits), you build a UI/dashboard that shells out to / talks to the Claude Code or Codex CLI processes you already pay a flat subscription for. The mocked "Approvals" screen implies a human-in-the-loop pattern where agent-drafted posts/notes need a click-through Approve before going live. The mocked "Projects" and "Content pipeline" screens imply the dashboard polls/tracks state (stage, last-touch, next action, artifact counts) across many concurrent subagents. No implementation detail (how the UI talks to the CLI, what protocol, polling vs streaming, auth) is shown or spoken.

## Named tools / repos / models / APIs
- Claude Code [audio, spoken repeatedly; also shown as a labeled node "Claude Code" in a "One UI, any harness" diagram frame]
- Codex [audio + frame, same diagram, labeled node "Codex"]
- No GitHub repo, product name, or specific library is shown or spoken anywhere in the video — all UI mockups are unbranded/fictional (dashboard names like "Auralabs," "Auratoids," "The Code Garden" appear to be placeholder/demo content, not a real shipped product).

## Specific claim / result
Animated bar-chart overlay shows illustrative "vibe-coding hits the API" monthly credit-cost figures escalating ($247 → $886 → $1,480 → $400 shown across different chart frames, inconsistent/non-linear, clearly a generic stock motion-graphics template rather than a measured result) contrasted against "$0 extra/mo — flat, on your plan" for the CLI-subscription approach. No real dollar figures, no actual measured cost comparison — these are illustrative graphic-template numbers, not benchmarked data.

## Novel / buildable moments (with timestamps)
- 00:21-00:26 — "One UI, any harness" diagram: a single custom UI as the hub, with Claude Code, Codex, and "+ any CLI" as interchangeable spokes — worth building as an actual abstraction layer (a UI that shells to whichever coding-agent CLI is configured, rather than being locked to one vendor's API).
- 00:39-00:45 — "Every project, at a glance" mockup: a table of active projects with Stage / Last Touch / Next / Artifacts columns — a concrete, buildable dashboard schema for tracking many parallel agent runs.
- 00:46-00:55 — "Watch your agents" diagram: agents run → feeds back → you steer → surfaced, framed as "persistent & personal" — a reusable control-loop pattern (steer/approve loop over long-running background agents) worth adapting for a kb-style dashboard.
- 00:56-01:01 — "Approvals" mockup with per-item Approve/Edit buttons for agent-drafted posts/notes — a concrete UI pattern for gating agent output before publish.

## Transcript highlights
- 00:00-00:04 — "I think I found a scary good, scary simple thing to do with Claude Code and Codex. Let me know if you do this already"
- 00:16-00:21 — "Well, it's perfectly fine, safe and sound, to create something that works back and forth with Codex or Claude Code"
- 00:28-00:36 — "You already pay for the subscription, you might as well use it, and I think it's a superior workflow for me anyway"
- 00:51-00:57 — "if you're using this stuff like me, you sometimes got maybe up to a hundred different sub agents going off and you can't tell what's going on"
- 01:04-01:09 — "If you're interested tap in I'll share some more stuff. Let me know if this sounds cool. Take care"

## Reliability
Thin as a demonstration — the entire video is generic motion-graphics UI mockups with no real product, repo, or code ever shown; the cost numbers on the animated chart are template placeholder figures, not a measured result. The underlying idea (build a UI wrapping your Claude Code/Codex CLI subscription instead of paying metered API credits) is a legitimate, buildable concept, but the video itself proves nothing and ends on a soft "tap in, I'll share more" engagement hook rather than delivering a repo or setup.
