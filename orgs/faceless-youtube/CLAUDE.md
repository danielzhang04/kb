# Faceless YouTube — Project Guide (CLAUDE.md)

**The router.** Auto-loaded at the start of every session in this folder. It tells you what this
project is and **which files to read for which task** — a fresh terminal knows nothing except what is
in this file and what it reads from disk. Read it fully, then follow its routing.

**The operating law is binding and loads with this file:**

@knowledge/operating-law.md

## What this is

An automated **faceless YouTube content business, run mainly in Claude.** Idea → script → voice →
visuals → render → publish → analytics, built as file-based skills, using external APIs only where
Claude genuinely cannot compete (voice, visuals, render, upload). Goal: **maximize revenue at modest
cost.**

This top level is **niche-agnostic infrastructure.** Specific channels/niches each live in their own
`channels/<name>/` folder — channels are *data*, not code.

## Where things stand

- **Live status** (what's built, what's in flight): `docs/STATUS.md` — **keep it current**
  (operating-law §A self-maintain); it is a doc, integrated in place, not an append-log
- **Resume state** for in-flight work: the newest `fyt`-scoped handoff in the kb repo-root
  `handoffs/` directory (per `handoffs/README.md`)
- **What we decided and why**: `knowledge/decisions.md`

## Read this for that

**Do NOT auto-read every other file — it wastes context.** Read on demand, by task:

| When the task is… | Read first |
| --- | --- |
| Strategy / choosing a niche / channel planning | `knowledge/research/niches.md`, `knowledge/research/format.md`, `knowledge/playbook.md` |
| Starting a NEW channel | `channels/_TEMPLATE/` (structure) + `knowledge/playbook.md`, then create `channels/<name>/` |
| ANY per-video work on a channel | that channel's `channels/<name>/dna.md` (niche, voice, style, rules) |
| Doing the RESEARCH for a picked idea (deep path) | that channel's `dna.md` Pipeline block + the picked brief in `idea-backlog.md` + `.claude/skills/researcher/` (directs the native `deep-research` skill) → writes `videos/<slug>/research.md` |
| Writing / editing a SCRIPT | picked idea brief in `idea-backlog.md` + `videos/<slug>/research.md` (if present) + channel `dna.md` + `knowledge/research/niche-playbooks/universal.md` + the `<niche>.md` playbook + `knowledge/playbook.md`. **Long-form → `long-form-writer`; shorts → `shorts-writer`.** |
| Ideation / titles | channel `dna.md` + `channels/<name>/idea-backlog.md` + `knowledge/research/niches.md` + `niche-playbooks/universal.md` + the `<niche>.md` playbook |
| Tools, APIs, cost, setup, keys | `knowledge/stack.md` |
| Publishing / upload | `knowledge/playbook.md` (policy, quota, audit-gate) + `knowledge/stack.md` |
| Analytics / performance review | `channels/<name>/performance.md` (read + write) |
| "What did we decide / why?" | `knowledge/decisions.md` |
| Building or fixing a skill | `.claude/skills/README.md` (skill list + design rules) |
| Business/policy rules, cadence, economics | `knowledge/playbook.md` |
| How to work here (process law) | `knowledge/operating-law.md` — already imported above |

If a prompt doesn't match a row, use judgment: consult the *File map* below and pull what's relevant.

## Pipeline

**One-time per channel:** niche → branding → lock one voice ID → (skip avatar by default) → write
`dna.md`, including the **`Pipeline` block** (`research` / `topic_scouting` / `long_form`) that routes
the channel through the deep or plain path.

**Per video, deep path** (e.g. The Second Take): idea (`idea-generator`) → **[HUMAN GATE: pick + edit
idea]** → `researcher` → `long-form-writer` → `shorts-writer` → `metadata-writer` →
`visual-prompt-writer` → `motion-planner` → [`voiceover` ∥ `image-generation` ∥ `audio-director`] →
`render-builder` → compliance + QA gate → publish → analytics.

**Per video, plain path** (`research: none`): idea → [pick] → `long-form-writer` → `shorts-writer` → …
(skips the researcher).

Architecture + reasoning: `index.html` §6 and
`docs/superpowers/specs/2026-07-03-research-driven-pipeline-design.md` (why the deep/plain split
exists).

## Non-negotiables

Policy and legal realities that protect the channel. **Detail + sources: `knowledge/playbook.md`.**

- **Autonomy is Stage 0** — a human approves every publish. Never skip the audit gate; an unaudited
  OAuth app uploads everything locked to private. (Ramp + promotion criteria: `playbook.md`.)
- **Every video needs materially different, original substance** — the July-2025 "inauthentic
  content" penalty is *whole-channel* demonetization. No templated near-duplicates, no cloning a
  rival.
- **Licensed assets only** — no unlicensed footage/music, no scraped-repost or clip formats.
- **Disclose AI/synthetic content** where required.
- **Never** spin up extra Google Cloud projects to multiply upload quota — it violates ToS and
  suspends everything.

## File map

- `CLAUDE.md` — this router (auto-loaded)
- `knowledge/operating-law.md` — process law: how we work (imported here; binding)
- `index.html` — human dashboard (generated view; update on material changes)
- `README.md` — human orientation
- `knowledge/` — general, cross-niche knowledge
  - `playbook.md` — business & policy law: originality bar, compliance, quota, cadence, economics
  - `stack.md` — tools, APIs, secrets location, costs
  - `decisions.md` — append-only decision log
  - `research/` — `niches.md`, `format.md`, `tools.md`, `niche-playbooks/`
- `channels/` — one folder per channel (channels are *data*, not code)
  - `_TEMPLATE/` — copy to start a channel: `dna.md`, `performance.md`, `idea-backlog.md`, `videos/`
- `.claude/skills/` — pipeline skills + skill design rules (see the README there)
- `docs/STATUS.md` — live status; dated handoffs/pickups live at kb repo-root `handoffs/` (fyt scope)
- `docs/superpowers/specs/` + `plans/` — design specs and implementation plans
- `logs/` — autonomous run reports
- `.env` — secrets (git-ignored; see `.env.example`)

## Conventions

- Skill names are **unique to this project** (e.g. `idea-generator`, `long-form-writer`) so they never
  shadow global skills.
- Video folders: `channels/<name>/videos/YYYY-MM-DD-slug/`.
- Defaults: US/English audience (best RPM), voiceover-led (not cloned-avatar), long-form as the
  earner with Shorts as a funnel. Overridable per channel in `dna.md`; reasoning in `playbook.md`.
- Commit meaningful changes to git — the history is part of the memory.
