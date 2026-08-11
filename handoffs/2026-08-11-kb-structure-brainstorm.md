# kb-structure brainstorm handoff — 2026-08-11

**Topic:** Brainstorm (boss session, Fable 5) of a new repo/file structure for kb — platform vs
knowledge base vs projects — driven by (1) the cloud migration (fleet compute moving to the
Hetzner VM) and (2) more projects coming. Conversation with Daniel converged on a candidate
design; two codex workers (prior-art research + adversarial critique) were dispatched and were
STILL RUNNING at session close. No ruling from Daniel yet, no spec written, no implementation.

## The converged candidate design (Daniel-steered, NOT yet approved)

Daniel's stated goal state, in his words distilled: offload work run through kb (workflows,
agent runs, daemon) to the cloud because local can't carry the fleet plus interactive VS Code
Claude terminals; dashboard becomes a tailnet web app = his control surface; he keeps building
platform code AND iterating on projects locally in VS Code; more projects coming; he considered
and REJECTED both (a) an external knowledge-base tool and (b) moving his own terminals to the
cloud via Remote-SSH (explored, then narrowed: "I don't need to migrate vscode/local terminal
compute").

1. **Two repos.** `kb-platform` = layer-1 code (`dashboard/`, `atlas/`, `broker/`, `scripts/`,
   `tests/`, `evals/`, `templates/`, `routines/`, `.agents/` — exact boundary is an OPEN question,
   see critique brief) — local dev, merge to main, VM auto-pulls, rebuilds SPA, systemd restart.
   `kb` data repo = layer 2 (coordination: `queue/`, `ledgers/`, `memory/`, `handoffs/`,
   `dashboards/`, `governance/`, `agents/`) + layer 3 (knowledge/projects: `orgs/`, `docs/`,
   `skills/`) together — cloned on the VM (authoritative home, daemon's DASHBOARD_REPO_ROOT)
   and on the desktop (dev client). GitHub = single hub.
2. **Compute split.** Fleet on VM; Daniel's interactive Claude terminals stay LOCAL.
3. **Freshness model.** Layer-2 stays git with pull-rebase-push (optimistic concurrency; stale
   writes get rejected, never land silently); VM becomes the dominant `ops` writer; Daniel reads
   live coordination state via the dashboard (VM's checkout), local clone = cache; trajectory =
   local coordination writes move to the dashboard HTTP write API so the VM converges toward
   single-writer of `ops`. Content changes need NO daemon restart (daemon reads repo fresh; VM
   checkout auto-pulls on cadence/webhook + executor pulls before running). Platform code changes
   DO deploy (automated, seconds).
4. **Media exile** (independent of the split, can start pre-cutover): render artifacts/working
   sets out of git to S3-compatible object storage (Hetzner) with manifests in git. git-LFS
   rejected (self-mirror complexity). Measured: `orgs/` = 6.9 GB on disk vs 173 MB git pack —
   ~96% of weight is untracked working sets.
5. **Projects stay in the kb data repo** as `orgs/<project>/`; per-project repos (federation)
   deferred until a concrete trigger (external collaborator, per-project access control, media
   scale post-exile).
6. **No external KB tool** — git IS the knowledge store (agent file-native access, sync, merge
   semantics, governance seams). Optional later: derived search index service reading the
   checkout; never a second store of record.
7. **Sequencing:** everything AFTER the pending cloud-migration Wave-3 cutover (runbook assumes
   current shape). Media exile is independent and may start earlier.
8. **Single-writer rule generalizes across sites:** one writer per project target whether local
   terminal or cloud workflow — same law FYT already enforces between local terminals.

## Open rulings Daniel still owes (present ONE at a time, context-first)

1. Explicit A/B/C ruling — the conversation *assumed* B (two repos) but he never said "go".
   (A = monorepo + hygiene; B = platform/data split; C = full federation.)
2. Hub/credential choice: GitHub as single origin with push credential ON the VM (design assumes
   this; it REVERSES the current deliberate no-GitHub-creds-on-VM stance — bare-mirror pushed
   from desktop) — credentials are human-only, so this is his either way.
3. Sequencing confirmation + whether media exile starts pre-cutover.

## Codex workers IN FLIGHT at close (harvest these FIRST on resume)

Dispatched 2026-08-11 22:13 UTC via `scripts/codex_dispatch.py`, both `--sandbox read-only`,
cwd = repo root, 45-min timeout. Results are durable regardless of this session: each lands a
`done` card on ops (owner codex, project kb-ops) + a final-message file. If the dispatch parents
died (session restart), the NEXT dispatch's startup sweep publishes the cards; the out-files
and JSONL logs exist either way.

| Worker | Dispatch/thread id | Model | Final message file |
| ------ | ------------------ | ----- | ------------------ |
| Prior-art research (GitOps splits, git-as-queue limits, workflow-platform state layouts, agent memory practice, DVC/LFS/object-store, solo-VM deploy) | `6a7b9e7f-fc3db183` | gpt-5.6-terra | `%LOCALAPPDATA%\kb-codex-dispatch\logs\6a7b9e7f-fc3db183.last.md` |
| Adversarial critique of the design (BLOCKER/MAJOR/MINOR + steelman alternatives incl. "keep monorepo, deploy a subtree" + SHIP verdict) | `6a7b9e84-b9f50765` | gpt-5.6-sol (xhigh) | `%LOCALAPPDATA%\kb-codex-dispatch\logs\6a7b9e84-b9f50765.last.md` |

Briefs (full context each worker got): scratchpad of session 61379a4a —
`C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-kb\61379a4a-3b5a-4fd0-9cff-d5e66669e7ee\scratchpad\brief-prior-art.md` and `brief-adversarial-critique.md`. If the scratchpad was
cleaned, the cards carry the work orders. Follow-ups: `codex_dispatch.py --prompt-file <f>
--follow-up <thread-id>` (model auto-re-pinned from threads.json).

Aliveness check if unsure: markers under `%LOCALAPPDATA%\kb-codex-dispatch\pending\`
(`pid` = dispatch parent, `codex_pid` = worker tree; NEVER match on codex.exe process name) +
JSONL log mtime.

### What WORKED (with evidence)
- **Grounding survey before brainstorming** — tracked-file counts per layer (`git ls-files`:
  orgs 1153 / dashboard 461 / platform total ~700), pack size 173 MB, `du` 6.9 GB orgs — these
  numbers settled the media-exile question decisively mid-conversation.
- **`DASHBOARD_REPO_ROOT` seam probe** — grep confirmed the daemon is repo-root-parameterized
  throughout `dashboard/server/` → the platform/data split is architecturally cheap. This fact
  carried the whole design.
- **Both codex dispatches launched clean** — pending markers present with live pids at close
  (evidence: marker JSONs quoted above).

### What Did NOT Work (and why)
- **Foreground `du -sh */` at kb root** — exceeds the 120 s Bash timeout (6.9 GB of media);
  run it in background or scope it. (It completed fine in background.)
- Nothing else failed; this was a design/dialogue session with no builds.

### What Has NOT Been Tried Yet
- Reading/synthesizing the two worker reports against the candidate design.
- Writing the design spec (`docs/superpowers/specs/2026-08-11-kb-structure-design.md` or dated
  on pickup day) — brainstorming-skill flow was at "present design → get approval"; approval
  never given because Daniel asked for research + critique first (correct call).
- Deciding the exact split boundary for `.agents/`, `routines/`, `templates/`, `evals/`,
  `skills/`, `governance/card-schema.md` (schema-shared surfaces). The critique worker was
  explicitly aimed at this; use its findings.
- Repo-root junk sweep candidates spotted: `Usersdaniekbtest-tmp-forge/` (mangled-redirect
  spill, known hazard pattern), stray `AppData/`, `__pycache__/`. Not urgent, not started.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `handoffs/2026-08-11-kb-structure-brainstorm.md` | DONE | this handoff (only repo write of the session) |
| `memory/claude-boss.md` | DONE | 2026-08-11 lessons appended (same commit) |
| scratchpad `brief-prior-art.md`, `brief-adversarial-critique.md` | DONE | worker briefs, outside repo |
| No other repo files touched. Main checkout untouched on `claude/bricks-doctrine-reset` (dirty with the bricks arc — belongs to another terminal, left alone). | | |

### Exact Next Step
1. Read the two `.last.md` worker outputs (paths above; if missing, check
   `queue/done/` on ops for cards with `workflow: 6a7b9e7f-fc3db183` / `6a7b9e84-b9f50765`,
   or the JSONL logs).
2. Synthesize: fold confirmed critique findings + prior-art evidence into the candidate design
   (revise, don't defend). Grade the workers' claims against the repo where cheap.
3. Present Daniel the revised design + the three open rulings, ONE at a time, context-first.
4. On his approval: write the spec per brainstorming skill step 6, then invoke writing-plans.
   The split executes as its own arc AFTER Wave-3 cutover (see cloud handoff below).

### Load list
- `handoffs/2026-08-11-kb-structure-brainstorm.md` (this file)
- `handoffs/2026-08-07-cloud-migration-wave1-done.md` (on ops — VM facts, cutover sequencing,
  Daniel's full-kb-scope + quiescent-window rulings; the structure arc sequences AFTER its Wave 3)
- `%LOCALAPPDATA%\kb-codex-dispatch\logs\6a7b9e7f-fc3db183.last.md` (research report)
- `%LOCALAPPDATA%\kb-codex-dispatch\logs\6a7b9e84-b9f50765.last.md` (critique report)
- `memory/claude-boss.md` (2026-08-11 section)
- Skill to invoke on pickup: none required until synthesis is done; then `superpowers:brainstorming`
  flow resumes at "present design", followed by `superpowers:writing-plans` after approval.
