# DbWBUFWNBrh — The only Claude Skill you'll ever need
- post: https://www.instagram.com/p/DbWBUFWNBrh/ | author: @Max Johnson | published: 20260728 | duration: 42s

## What's demonstrated
Pitch for a Claude Code skill called "find-skills" that discovers and installs other agent skills for you. The creator claims an engineer "from the Versailles team" (unclear — possibly mis-transcribed/misheard company name) built a skill that indexes 700,000+ community skills, lets the user describe what they're working on in plain language, filters for "trusted" ones, and auto-installs the result into whichever coding agent (Claude Code, Cursor, Codex, Gemini CLI, Windsurf) is detected on the machine.

## Dashboard / UI-UX observed
The whole video is a screen-recorded animated mockup of the find-skills workflow, cut with talking-head B-roll. Sequence, panel by panel:
- [0:00-0:03] A GitHub-style file view: breadcrumb `skills / skills / find-skills / SKILL.md`, commit metadata bar (author avatars, commit message, hash, "2 weeks ago", History link), Preview/Code/Blame tabs, line/loc count. Renders a metadata table (`name: find-skills`, `description: Helps users discover and install agent skills when they ask questions like "how do I do X"...`) followed by a rendered heading "Find Skills" and one-line description — i.e. this is literally what a SKILL.md frontmatter+body looks like rendered on GitHub.
- [0:06-0:08] A terminal showing `> claude find-skills`, then a live "walking tree" scan counter (files/skills found climbing: 173 files·1 skill → 1,036 files·6 skills), with a dim file-path listing scrolling underneath (e.g. `/root/.claude/skills/skill-creator/meta.json`, `.claude/skills/llm/scripts/run.py`).
- [0:09-0:11] A dark scanning dashboard: header `skills/skills/find-skills/SKILL.md` with a status pill (`• scanning` → `• idle`), a large green counter "SKILLS INDEXED" animating 459,990 → 697,904 → 700,000+, a secondary "installs 212" stat, and a pixel/heatmap grid of green squares labeled "registry crawl · trust filter active — 700,000+ sources".
- [0:12-0:13] A dense tag-cloud/word-grid of individual skill names (seo-audit, ci-helper, api-linter, rails-builder, text-revise, etc.) with a counter ticking down (448,245 → 695,345, direction unclear) and a magnifying-glass circle spotlighting specific tags — visualizing the filtering pass.
- [0:15] A chat-style input box, prompt "what are you working on?", with `> content writing` typed and a suggestion dropdown showing one verified match (`seo-content-audit — Writing · Verified`, checked) and one greyed unverified option (`long-form-drafting`).
- [0:19-0:23] Floating "trust filter" chips: untrusted candidates fade in/out (`the-skill`, `copy-of-copy`, `beta-untested`, `unverified-scraper`, `sketchy-eval`, `placeholder`, `clone-of-agent`) against a "TRUST FILTER" progress bar with SCANNED/TRUSTED footer labels, while trusted picks get checkmarks (`ios-hig-reviewer` ✓, `figma-to-swiftui` ✓).
- [0:25-0:27] A results/install panel: `> find-skills find me claude skills for making a mobile app`, `✓ 703,412 skills indexed`, `✓ 6 trusted matches · mobile app design`, `→ installing to detected agents...`, with a row of 5 target-agent icons (Claude Code, Cursor, Codex, Gemini CLI, Windsurf) that light up with red "installing" dots one by one.
- [0:31] A final checklist: `✓ keep figma-to-swiftui`, `✓ keep tap-target-checker`, `✓ keep app-store-copy`, `✓ keep design-token-sync`, `✓ keep a11y-contrast-audit`, followed by a greyed status log (`fetching manifests / verifying checksums / writing ~/.claude/skills / detecting agents / linking claude code / linking cursor / linking codex / linking gemini cli / linking windsurf`).

This is a well-produced motion-graphics mockup, not a captured screen recording of a real running tool — no URL, app name, or company is ever shown, and the visuals are stylized (particle counters, tag clouds) rather than a literal app UI. Still, the *information architecture* (progressive disclosure: search → trust-filtered candidates → install-across-agents status log) is a clean, buildable pattern for any "skill/plugin marketplace" UI.

## Concrete mechanism
Described mechanism: natural-language intent ("what are you working on") → search across a skill registry → trust/quality filter (excludes "sketchy", "unverified", "clone-of-agent" style low-trust entries) → present top matches → one-command install that writes into every detected agent's skill directory (`~/.claude/skills`, Cursor, Codex, Gemini CLI, Windsurf) simultaneously.

## Named tools / repos / models / APIs
- Claude Code / `claude` CLI — [frame], invoked as `claude find-skills` [audio]
- find-skills (the skill itself, file path `skills/skills/find-skills/SKILL.md`) — [frame]
- Cursor, Codex, Gemini CLI, Windsurf — shown as install targets [frame]
- A Vercel logo splash appears briefly at 0:05 [frame] — likely attribution/hosting for a demo site, not explained in audio
- "700,000+ skills" / "700,000+ sources" registry — [frame + audio], no named registry/URL given

## Specific claim / result
Claims 700,000+ skills indexed and one-command install across 5 agent tools "in literally one command" [audio, 0:28-0:31]. No verifiable source, benchmark, or public link is shown — the counters are animated UI, not a captured live run.

## Novel / buildable moments (with timestamps)
- [0:09-0:11] Live-counting "skills indexed" scan animation over a pixel/heatmap grid — reusable pattern for any registry-crawl progress UI.
- [0:19-0:23] "Trust filter" visualization: candidate chips fade in labeled with quality signals (sketchy/unverified/beta/clone) before the trusted subset survives — a good UX pattern for surfacing a vetting pipeline instead of hiding it.
- [0:25-0:27] Multi-agent install status row (5 icons lighting up as each target gets the skill written) — directly useful pattern for our own cross-agent skill sync problem (kb has the same "sync agents/ catalog" pain noted in memory).

## Transcript highlights
- "An engineer from the Versailles team has built the one skill that finds every other claw code skill for you." [0:04-0:08]
- "It sits on top of a directory of over 700,000 skills... filters out anything sketchy and only surfaces the skills that are genuinely trusted. Then it installs them straight into claw code or whichever agent you have running." [0:08-0:28]
- "The whole setup is done in literally one command." [0:28-0:31]
- "Most people are still picking skills based on a star count and a guess. This one does the entire vetting process for you." [0:33-0:39]

## Reliability
Thin lead-magnet pitch — no working link, no named registry, no company named beyond a garbled "Versailles team" (unverifiable, possibly mis-transcribed), CTA is "comment SKILL for the link." However the UI/UX concept is genuinely worth stealing: the search→trust-filter→multi-agent-install flow and its motion-graphics treatment (live counters, trust chips, per-agent install status) are a clean reference for building an actual skill-marketplace or cross-agent skill-sync dashboard.
