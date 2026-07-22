---
name: multi-source-synthesis
description: Use whenever the user supplies two or more content sources and wants one combined decision, recommendation, ranking, comparison, verdict, guide, plan, report, strategy, or list rather than separate summaries. Sources may include links, videos, articles, PDFs, images, audio, local files, connected documents, or pasted notes. Typical cues include "combine these", "synthesize these", "they contradict", "go through these and tell me which", and adding sources to an earlier synthesis. Skip for a single source or open-ended research with no user-supplied sources.
---

# Multi-Source Synthesis

Turn many sources plus the user's directives into one goal-shaped deliverable. Use the runtime's native tools and bounded subagents; do not assume Claude- or Codex-specific tool names.

## Intake

Identify the goal, requested deliverable, sources, user directives, hard guardrails, and whether this continues an existing synthesis project. Ask only targeted questions when one of those is materially unclear.

Normalize sources as either references (URLs or paths) or user-provided content with a short label. For connected documents, use the available document/drive connector. If a source type cannot be opened in the current runtime, mark it inaccessible and continue; never fabricate its contents.

## Project and cache

Store durable results in a user-approved `synthesis-reports/<project-slug>/` location with:

- `briefs.json` — goal-specific source briefs
- `report.md` — the combined deliverable
- `sources.txt` — the complete source list

For a continuing project, confirm the project when matching is ambiguous. Reuse cached briefs only for the same goal, merge old and new sources, and analyze only uncached sources.

## Execution engine

Choose the first engine the current runtime supports:

1. **Workflow acceleration:** If a `Workflow` tool is available, run `synthesis-workflow.js` from this skill directory. Pass an actual object containing `goal`, `directives`, `sources`, `cachedBriefs`, and `scratchDir`. The script returns `reportMarkdown`, `briefs`, and `plan`.
2. **Native orchestration:** Otherwise use bounded runtime-native subagents. Batch sources across the available agent slots instead of spawning one agent per source without a limit. Each analyzer returns the brief schema below. Then produce a plan, examine it through three distinct goal-specific lenses, let those lenses critique/build on one another, and reconcile one final deliverable. The main agent remains responsible for source coverage and guardrail validation.

The optional JavaScript engine contains Claude Workflow instructions and must not be executed unless that tool exists. The native path is the Codex-compatible equivalent and should produce the same logical artifacts.

## Brief contract

Each source brief must include:

- source id, reference, and type
- accessibility and confidence
- what the source is and how it bears on the goal
- substantive claims, reasoning, and relevant sequence or decision process
- key takeaways with locators where available
- notable specifics and a self-contained markdown write-up

Failed or inaccessible sources are logged and skipped, not treated as fatal.

## Plan, synthesize, reconcile

The plan must state the literal deliverable format, three useful synthesis lenses, soft preferences, hard guardrails, and how user-provided knowledge is weighted. Adapt the lenses to the goal—for example evidence integrator / skeptic / decision architect, not generic personas.

Each lens proposes a grounded answer citing source ids, then explicitly notes agreements, disagreements, and improvements. Reconcile their strongest supported reasoning into one deliverable. Verify live constraints such as current price or availability when tools permit; otherwise label them unverified. End with a guardrail check of met, unmet, or unverifiable.

## Deliver

Write the briefs, report, and source list to the approved project location. If a connected document service is available and the user wants it, create the formatted document in a confirmed folder; otherwise keep the markdown artifact. Return the deliverable summary, artifact locations, analyzed/reused/inaccessible counts, and unmet or unverifiable guardrails.

If a humanizer capability is available, apply it to prose. Otherwise apply the principles directly: plain specific language, no promotional filler, vague attribution, formulaic rhetorical patterns, or unnecessary repetition.

## Runtime notes

- Use runtime-native file, web, PDF, image, audio/video, and connector tools. Capability names differ between Claude and Codex.
- Video/audio analysis is optional and capability-dependent. An unavailable media tool makes that source inaccessible, not the entire synthesis.
- Mid-run additions require a rerun. Cached briefs keep this bounded.
