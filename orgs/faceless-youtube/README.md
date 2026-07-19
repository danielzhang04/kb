# Faceless YouTube

An automated, faceless AI YouTube content business run mainly in Claude.

## For humans

- **Read the dashboard:** open `index.html` in a browser — it's the human-readable view of the whole
  project (decisions, research, pipeline, costs).
- **Everything is plain files.** The markdown files are canonical; the HTML is a generated view.

## For Claude / any agent

- Start a Claude Code session **inside this folder** — `CLAUDE.md` auto-loads and tells you the rules
  and which files to read for which task. Start there.

## Layout

- `CLAUDE.md` — the router, auto-loaded every session (start here)
- `knowledge/` — general, cross-niche research, rules, decisions, tool stack
- `channels/<name>/` — one folder per channel/niche (copy `_TEMPLATE/` to start one)
- `.claude/skills/` — the pipeline skills
- `logs/` — autonomous run reports

## Status

Infrastructure established 2026-07-01. First channel committed 2026-07-02: **The Second Take**
(finance/economics explainer, niche `business-money`); its visual identity is picked and awaiting lock.
See `CLAUDE.md` → *Current status* and `knowledge/decisions.md` for the live picture.

## Setup

Copy `.env.example` to `.env` and fill in API keys as you connect tools. Never commit `.env`.
