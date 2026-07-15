---
name: multi-source-synthesis
description: Use whenever the user gives you two or more content sources together and wants them merged into ONE combined result, not summarized separately. Sources can be any mix of links, YouTube videos, articles, PDFs, images, audio, local files, Google Docs, or the user's own pasted notes. The combined result is a single decision, recommendation, ranking, comparison, verdict, conclusion, guide, plan, report, strategy, or list weighing all sources together. Typical cues are "go through these N and tell me whether/which X", "combine these into one decision/recommendation", "watch/read all of these and build one guide", "they contradict, give me ONE conclusion", "synthesize these", "add these new links to the synthesis we did before". The defining signal is many user-supplied inputs collapsing into one shared deliverable, so always prefer this over handling each source individually. Skip only for a single video/article (use the video skill) or open-ended web research with no sources provided (use deep-research).
---

# Multi-Source Synthesis

This skill turns many sources (plus the user's own knowledge and rules) into ONE collective, goal-shaped deliverable. You (the main agent) orchestrate intake, source/project resolution, and delivery; the heavy fan-out analysis and the multi-perspective synthesis run inside a Workflow script.

## Files & locations (resolve these at runtime — do not hardcode)
- **Orchestration script:** `synthesis-workflow.js`, which sits in **this skill's own directory**. When this skill loads you are told its base directory ("Base directory for this skill: ..."). Build the absolute path `<that base directory>/synthesis-workflow.js` and pass it as the Workflow `scriptPath`. (Do not assume a fixed path — it differs per machine/install.)
- **Project storage root:** a `synthesis-reports` folder in the user's home directory, i.e. `~/synthesis-reports/` (on Windows that resolves to `C:\Users\<you>\synthesis-reports\`). One folder per project, each holding `briefs.json`, `report.md`, `sources.txt`. Create it if missing.

## Pipeline
**Intake/clarify → Resolve sources → Resolve project → Run workflow (Analyze → Plan → Draft → Discuss → Reconcile) → Persist & deliver.**

---

## Phase 0 — Intake & clarify (ALWAYS first)
Before running anything, look at what the user gave you: the **goal**, the **sources**, any **directives** (their own knowledge / preferences / rules), and which **project** (if continuing). Decide whether you have enough to help *specifically*.

If the goal is vague, the deliverable shape is unclear, guardrails are implied but unspecified, or sources are missing → **ask targeted clarifying questions** (use `AskUserQuestion`). Cover: goal clarity; what the deliverable should be / look like; any hard guardrails (counts, budget, must-include sources, source weighting); and anything only the user knows. Propose sensible defaults. **Do not over-ask if everything is already clear.** Then show a one-line "here's what I'll do" and proceed.

## Phase 1 — Resolve sources
Accept sources in any of these forms and normalize them:
- **Inline list** pasted in chat → one entry per link/path.
- **A local file** → Read it, extract links/paths (one per line).
- **A Google Doc / Drive link** → load Drive MCP tools via `ToolSearch` (`search_files`, `read_file_content` / `download_file_content`), open the doc, and extract every link inside.
- **User-provided knowledge** → any text the user wants treated as a source.

Build a normalized `sources` array:
- Links/paths → pass as plain **strings** (type is auto-detected in the workflow).
- User-provided knowledge → pass as an **object** `{ type: "user-provided", ref: "user knowledge: <short label>", content: "<the text>" }`.

## Phase 2 — Resolve the project (caching / incremental re-runs)
Projects are folders under `~/synthesis-reports/<slug>/`.
- If the user **names a project or points to a folder**: locate it. **Match folder names loosely** (by name / goal keywords). One clear match → use it and tell the user which (e.g. "continuing project: building-a-tech-stack-for-content-creation"). Multiple plausible matches or none → **ask the user to confirm/pick** (`AskUserQuestion`). Never silently grab the wrong one.
- **Continuing an existing project**: read its `briefs.json` and pass it as `cachedBriefs` so already-analyzed sources are reused, not re-analyzed. Merge the new sources with the prior `sources.txt`. Pass **all** sources (old + new) to the workflow — it skips any whose `ref` already has a cached brief.
- **New project**: derive a slug from the goal; create the folder when saving results (Phase 4).
- ⚠️ Briefs are **goal-specific** — only reuse briefs from the **same project**. Never reuse across different goals.

## Phase 3 — Run the workflow
Invoke the **Workflow** tool with (pass `args` as an actual JSON object, NOT a JSON-encoded string — otherwise the script sees no sources and exits immediately):
- `scriptPath`: the absolute path to `synthesis-workflow.js` in this skill's base directory (see Files & locations above).
- `args`:
  ```json
  {
    "goal": "<the clarified goal>",
    "directives": "<all the user's directives / knowledge-as-rules, raw text>",
    "sources": [ "<link or path>", { "type": "user-provided", "ref": "...", "content": "..." } ],
    "cachedBriefs": [ /* contents of briefs.json, or [] */ ],
    "scratchDir": "<the current session scratchpad path>"
  }
  ```
The workflow: analyzes each new source in parallel (auto-detecting video / audio / website / pdf / image / text / user-provided and using the right tool), reuses cached briefs, then a planner designs the deliverable + 3 tailored synthesizer roles and classifies directives into soft preferences vs hard guardrails, then runs **draft → discuss/build → reconcile**, validates hard guardrails, and returns `{ reportMarkdown, briefs, plan }`.

Watch progress via `/workflows`. Failed sources are logged and skipped, not fatal.

## Phase 4 — Persist & deliver
1. **Save to the project folder** (`~/synthesis-reports/<slug>/`): write `briefs.json` (the returned `briefs`), `report.md` (the returned `reportMarkdown`), and update `sources.txt`. Create the folder if new.
2. **Ask the user which Google Drive folder** the deliverable should go in. Match the folder loosely via Drive `search_files`; confirm if unsure. (If Google Drive is not connected in this environment, skip the Doc and just keep the local markdown, telling the user.)
3. **Create a Google Doc** with the report content in that folder. Convert the markdown to simple HTML and pass it as `text/html` to Drive `create_file` (load it via `ToolSearch`) — it converts to a real Google Doc with formatting. Return the Doc link.
4. **Chat summary**: the deliverable in brief, the Google Doc link, the local backup path, and counts (sources analyzed / reused, any inaccessible, any unmet or unverifiable hard guardrails). Run this summary through the **humanizer** skill before sending it.

---

## Dependencies (this skill needs these in whatever environment runs it)
- **Claude Code** with the **Workflow** tool and subagents (this is a Claude Code skill; it will not run in the Claude desktop *chat* app's Skills panel).
- **Node** (the Workflow engine runs the JS script).
- For **video/audio** sources: the **claude-video-vision** plugin. Without it, those sources are skipped (other formats still work).
- For the **Google Doc** delivery step: a connected **Google Drive**. Without it, the skill keeps the local markdown instead.

## Notes
- **Formats handled:** YouTube/video, audio, websites, PDFs, images (incl. text-in-image), local text/md/docx, and user-provided knowledge.
- **Adding sources later:** re-run the project with the expanded list — cached briefs make it cheap (only new sources are analyzed, then everything is re-synthesized).
- **Mid-run additions:** not live-injectable. Either re-run after it finishes (cheap, via caching) or stop the workflow, add the sources, and resume (`resumeFromRunId`) so completed analyses return from cache.
- **Guardrails:** the planner separates soft preferences from hard guardrails; hard ones are validated against the final deliverable. Constraints needing live data (price/availability) are verified via web where possible and flagged "unverifiable" otherwise.
- **Humanized output:** every text-producing agent in the workflow (source briefs, synthesizer drafts, the build/debate, the moderator's discussion summary, and the final deliverable) invokes the **humanizer** skill on its prose to strip AI-writing tells before returning. The orchestrator also humanizes the final chat summary. If you edit the workflow, keep the humanization step on any new prose-producing stage.
