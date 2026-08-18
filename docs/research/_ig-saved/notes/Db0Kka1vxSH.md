# Db0Kka1vxSH — Open-sourced creative agency built of AI agents
- post: https://www.instagram.com/p/Db0Kka1vxSH/ | author: @Alex AI | published: 20260809 | duration: 20s

## What's demonstrated
This is a fully produced animated infographic (game-like pixel-art vignettes, not a screen recording) promoting `msitarzewski/agency-agents`, a repo of pre-written specialist AI agent personas (270 agents / 17 divisions) meant to plug into Claude Code and other coding agents. It shows: the repo's GitHub stats, the division/roster breakdown, the fact that each agent is a single `.md` file with a defined workflow + success metrics, the CLI install path (`install.sh --tool claude-code`, dropping files into `~/.claude/agents`), a `brew install agency-agents` alternative with a native desktop installer app, and the MIT license terms.

## Concrete mechanism
Each "agent" (e.g. Frontend Developer, UI Designer, Ad Creative Strategist, Reddit Community Builder, Reality Checker) is authored as one markdown file containing a personality/workflow/success-metrics spec. Installing the repo places these `.md` files into the target tool's agent directory — shown explicitly as `~/.claude/agents` for Claude Code, with the video also claiming compatibility with Cursor, Codex, and Gemini (icons for all four shown side by side). Two install paths are shown on-screen: (1) a terminal command `./scripts/install.sh --tool claude-code`, which lists installed files like `frontend-developer.md`, `ui-designer.md`, `ad-creative-strategist.md`; and (2) `brew install agency-agents`, which launches a native desktop app (checkbox list: Frontend Developer, UI Designer, Ad Creative Strategist, Reddit Community Builder, Reality Checker → "Install All" button) supporting macOS/Windows/Linux, letting a user select individual agents rather than installing all 270 at once.

## Named tools / repos / models / APIs
- `msitarzewski/agency-agents` — GitHub repo name, shown directly on-screen [frame, 00:03 and 00:19]
- Claude Code — target install destination `~/.claude/agents`, shown as an install target icon alongside Cursor, Codex, Gemini [frame, 00:12-00:15]
- Cursor, Codex, Gemini — shown as alternate install targets (icon row) [frame, 00:12-00:15]
- "Agency Agents" desktop app — installer GUI, macOS/Windows/Linux [frame, 00:14-00:16]
- Named example agents: Frontend Developer, UI Designer, Ad Creative Strategist, Reddit Community Builder, Reality Checker [frame, 00:10-00:16]
- Division names shown in a roster list: Healthcare, Finance, Product, Academic, Spatial, Support, Project Mgmt, Paid Media, Testing, Sales, Design, Security, GIS, Game Dev, Marketing, Engineering (+ 1 more, 17 total) [frame, 00:06-00:07]

## Specific claim / result
Repo stats shown on a ticking counter graphic: stars climb from 7,613 → 128,817 → 139,604 (final displayed figure) [frame, 00:03-00:05]; "22,798 forks" and "MIT" license stated in on-screen header text [frame, 00:03-00:04] (a forks figure is also visible cropped at the very end, reading "2,798," likely the tail of "22,798"). Agent count: 270 agents total across 17 divisions [frame, 00:00, 00:06-00:07]; roster breakdown shown: 15 → 261 → final count per-division numbers scroll (Healthcare 3, Finance 5, Product 5, Academic 6, Spatial 6, Support 7, Project Mgmt 7, Paid Media 9, Testing 10, Sales 10, Design 12, Security 13, GIS 13, Game Dev 21, Marketing 36, Engineering 58) [frame, 00:06-00:07]; also stated "58 engineers, 36 marketers, 10 designers" [frame, 00:08]. Voiceover claims "over 124,000 stars" (undercuts the on-screen 139,604 figure slightly — narration and graphic don't perfectly match, graphic is higher).

## Novel / buildable moments (with timestamps)
- 00:10-00:11: "Each agent is one .md file" with workflow + success metrics — a clean, portable spec format worth adopting for a dev-platform agent catalog.
- 00:12-00:13: Single install script with a `--tool` flag that targets multiple coding assistants (claude-code, cursor, codex, gemini) from one source repo — a reusable pattern for cross-tool agent distribution.
- 00:14-00:16: A native desktop installer with per-agent checkboxes (not "install all 270") — addresses the real problem of roster bloat; worth stealing the UX for any internal agent-catalog installer.
- 00:17-00:18: MIT license positioning ("fork it, sell the work") — explicit framing that the entire roster is commercially forkable, notable if evaluating repos to build on top of.

## Transcript highlights
- 00:00-00:02 — "So someone built an entire AI agency and open sourced it."
- 00:02-00:06 — "It's called the agency with over 124,000 stars on GitHub."
- 00:06-00:10 — "So this has a full roster of specialist agents, front-end designers, ad writers, reddit community wizards, each with its own personality and process."
- 00:12-00:14 — "It plugs straight into cloud code and there's even a desktop app"
- 00:14-00:16 — "that installs your dream team in one click."
- 00:16-00:18 — "You just became an AI agency owner for free."

## Reliability
Substantive relative to the format — the repo name, install command, and file structure are all directly legible on-screen, not withheld behind a comment-gate for the core facts. Still carries a comment-for-repo CTA at the end and the video is a stylized ad/motion-graphic (not a real screen capture), so exact numbers (stars/forks) may be stale, rounded, or dramatized for the visual; the underlying repo and install mechanism are corroborated by two separate on-screen mechanisms (CLI + desktop app) so the core claim (a real, installable multi-agent repo) reads credible, not thin grift.
