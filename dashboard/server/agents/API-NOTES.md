# Agents API notes

`GET /api/agents/:id` is a declaration-inspection endpoint for declared `agents/<id>.md` files.
It returns the authored instruction Markdown, its declaration path, repo-contained codebase/project
relationships, related org workflow summaries, and a truthful `howItRuns` state.

`howItRuns.runner === null` means the declaration is not runner-bound. `command` is always `null`:
this API never publishes a shell command or spawns a provider. P1 exposes no Composer HTTP or UI
surface; interactive work remains on the retained Terminal and run-detail surfaces.

Workflow summaries in the agent detail use the canonical org-definition scanner shared with
`GET /api/workflows`; they do not reinterpret legacy root-registry prose as executable definitions.
