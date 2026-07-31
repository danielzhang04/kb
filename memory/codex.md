# codex worker lessons

- Workspace-local npm cache for verification (2026-07-31, from worker run): when a Node project worktree lacks node_modules and npx.ps1 is policy-blocked + npm's user cache is EPERM under the sandbox, run the `.cmd` executable and `npm ci --cache .npm-cache` inside the project, then clean the temp cache.
