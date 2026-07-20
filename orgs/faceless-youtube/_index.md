# faceless-youtube — index

Live working tree imported into kb on 2026-07-19 (git history archived out-of-repo at
`C:\Users\danie\faceless-youtube.git-archive`).

- [STATE](STATE.md) — current state (agents keep this current)
- [contract](contract.md) — autonomy policy for this project (publish is Stage-0 human-gated)
- [HEARTBEAT](HEARTBEAT.md) — recurring cadences
- `raw/` — ingest inbox (dump anything) · `wiki/` — structured knowledge · `output/` — deliverables

## Authoritative project router

The project's own **[CLAUDE.md](CLAUDE.md)** is authoritative for all per-video work — its
operating-law, channel structure (`channels/<channel>/`), skill set (`.claude/skills/`, 17 skills),
and render engine (`render/remotion/`) predate the kb import and govern the pipeline. This kb
wrapper adds coordination (STATE/contract/HEARTBEAT) around it, not over it.
