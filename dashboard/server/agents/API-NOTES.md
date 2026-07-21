# Agents API notes

`GET /api/agents/:id` is a declaration-inspection endpoint for declared `agents/<id>.md` files.
It returns the authored instruction Markdown, its declaration path, repo-contained codebase/project
relationships, related org workflow summaries, and a truthful `howItRuns` state.

`howItRuns.runner === null` means the declaration is not runner-bound. In that state the dashboard
may open the existing Composer UI for an interactive planning conversation, but must not label that
as autonomous execution. `command` is always `null`: this API never publishes a shell command or
spawns a provider.

`POST /api/composer/sessions` accepts the closed optional field `agentId`. The server validates it
against a current declaration and returns every workspace with `agent: { id, path, sourceHash }` or
`null`. The binding is durable and inherited by forks; the browser cannot supply a runtime, model,
tools, working directory, declaration path, or hash.

Workflow summaries in the agent detail use the canonical org-definition scanner shared with
`GET /api/workflows`; they do not reinterpret legacy root-registry prose as executable definitions.
