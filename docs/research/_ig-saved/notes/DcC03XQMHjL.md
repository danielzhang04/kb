# DcC03XQMHjL — Google writing skills for all AI agents
- post: https://www.instagram.com/p/DcC03XQMHjL/ | author: @Angelo Trifanoff | published: 20260815 | duration: 44s

## What's demonstrated
A talking-head creator scrolls live through a real GitHub repository (breadcrumb reads "gle / skills," i.e. google/skills, Public, Apache-2.0 licensed) titled "Agent Skills," narrating that Google has open-sourced over 100 "Agent Skills" plug-ins that install straight into Claude Code and Codex. The scroll shows the actual README: an install command, a long categorized "Available Skills" list (Getting started with Google Cloud, Multi-product solution skills, AI/ML, Infrastructure, Databases, Well-Architected Framework, Security and identity, Web and mobile, Advanced [Google Ads]), an "Additional Google skills" section, and a "Plugins" table giving per-harness install commands for Claude Code, Codex, and "Antigravity CLI."

## Concrete mechanism
The repo ships as installable "skills" bundles that plug into existing agent harnesses rather than being a standalone app. On-screen install commands: `npx skills add google...` (top-level installer, generic), and per-harness plugin-marketplace commands shown in the "Plugins" table: Claude Code — `claude plugin marketplace add <plugin>@google-plugins`; Codex — `codex plugin marketplace add g...` (cut off on screen); Antigravity CLI — `agy plugin install https://git...` (cut off on screen). Narration explains that among the 100+ skills, a subset are Google-infrastructure-specific (GCP/GKE/BigQuery-flavored) while others are general-purpose everyday-workflow skills — specifically calling out a Google Ads MCP-based skill that lets Claude connect directly to a Google Ads account to inspect what's broken, pull analytics, and suggest improvements, and a separate Google Analytics skill for anyone building SaaS/websites with AI.

## Named tools / repos / models / APIs
- google/skills — GitHub repo, "Agent Skills," Public, Apache-2.0 [frame, breadcrumb + README header + license badge]
- `skills.sh` install script badge shown in README [frame]
- `npx skills add google...` — top-level install command [frame]
- Claude Code plugin marketplace: `claude plugin marketplace add <plugin>@google-plugins` [frame, Plugins table]
- Codex plugin marketplace: `codex plugin marketplace add g...` [frame, Plugins table, command truncated on screen]
- Antigravity CLI: `agy plugin install https://git...` [frame, Plugins table, command truncated on screen]
- Google Ads MCP / "Google Ads API MCP Server Installation," "Google Ads API Account..." skills [frame, Available Skills list]
- Google Analytics skill(s) — "Getting Started [with] Google Analytics Admin," "Getting St[arted with] Google Analytics Data" [frame, Available Skills list]
- Agent Development Kit (ADK) Skills, Genkit Skills, Firestore Skills, Flutter Skills, Dart Skills, Android Skills [frame, Additional Google skills list]
- BigQuery AI & ML, Gemini API in Agent Platform, Gemini Enterprise Agent Platform, LiveAPI Service Skill [frame, Available Skills list]
- GKE-family skills (Workload Scaling, Troubleshooting, Reliability, Networking, Batch, Basics, AI/ML) [frame, Infrastructure section]

## Specific claim / result
"Over 18,000 stars, completely free" (spoken claim, matches the repo's visible popularity framing but the star count itself is not directly visible as a number in the captured frames — it's asserted in narration only). Repo shows "9 Branches," "0 Tags" and recent commit activity ("Adds IMA DAI S[DK]...", "chore:...", "feat(plu[gin])...") confirming it's an active, real, currently-maintained repository, not a stale or fake project.

## Novel / buildable moments (with timestamps)
- 00:20-00:24 — Google Ads MCP skill: point Claude directly at a live ad account to diagnose what's broken and pull analytics — a concrete, buildable pattern for any agent that needs read/analyze access to a marketing/analytics platform via MCP rather than a bespoke API wrapper.
- 00:22-00:34 — The "Plugins" install table (Agent harness → Install command, one row each for Claude Code / Codex / Antigravity CLI) is a good template pattern to copy for any kb-internal tool that wants one README section covering multi-harness installation instead of harness-specific docs scattered across files.
- 00:14-00:20 — The category taxonomy itself (Getting started / Multi-product solutions / AI-ML / Infrastructure / Databases / Well-Architected Framework / Security / Web-mobile / Advanced) is a reusable structure for organizing a large internal skills library.

## Transcript highlights
- 00:00-00:05 — "In case you missed it, Google has open sourced over 100 skills that you can plug straight into cloud [sic, "Claude"] code. It's called agent skills"
- 00:07-00:11 — "and it has over 18,000 stars, completely free. One command on cloud code and they're in, and it's the same exact thing with Codex"
- 00:19-00:24 — "if you run ads, there's literally a Google MCP skill in there, so you can hook up cloud to Google ads"
- 00:24-00:29 — "You can literally point cloud straight at your ad account and ask what's broken, look at analytics, and improve your Google ads"
- 00:34-00:39 — "Now if you want the link for this, comment repo down below, and I'll send you my list along with a GitHub link"

## Reliability
Substantive — a real, actively-maintained, Apache-2.0 GitHub repo is shown in detail on screen (URL breadcrumb, README, categorized skill list, per-harness install table), which is far more concrete than most reels in this batch. The single weak point is the closing hook ("comment repo below and I'll send you the link") gating the actual repo URL behind an engagement action rather than posting it directly, and the claimed star count (18,000+) is spoken but not independently confirmed by a visible number in the frames captured.
