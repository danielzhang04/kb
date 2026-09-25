# Executive Dashboard
_Generated: 2026-09-25 06:16 UTC by dispatcher-cloud_

## Action required
- **1 approval waiting** — `65d8f246-8a461521` | figment | *GATE A eye-gate — operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed* | **T3**. A T3 gate requires Daniel's dashboard/WebAuthn-signed approval before figment curation to 40 can proceed.

## Queue
| state | count |
|---|---|
| inbox | 116 |
| working | 3 |
| approvals | 1 |
| done | 1613 |

## Last 24h
- **Cadences run:** `nightly-review` dispatched 2026-09-25 (card `6ab6117a-b6c77610`, this run) and 2026-09-24 (card `6ab4bfba-40e8790d`). Dispatcher emitted 1 card this run.
- **Cost:** $0.00 API-billed logged for 2026-09-25 (subscription steps log 0.0); 2026-09-24 logged one `nightly-review` row at $0.00. Budget: **$30.00/day ceiling, ~$30.00 remaining** — no API spend recorded.
- **Notable:** daemon-dir drift gate (nightly step 2b) again reports one ops-only file drift and its checker script is still absent from `ops` — 13th consecutive open wake-me card (see Anomalies). `sync_skills --check` clean.

## Projects
- **atlas** — Omni-interface foundation + adversarial remediation complete locally on `codex/atlas-enhancements-20260820` (280a67a9 + unstaged re-reviewed diff); diff >400 lines so contract requires Daniel review before commit. V1 "Hands" shipped/merged (PR #44) and live on 127.0.0.1:5317; V2 "Trust" awaits Daniel go/no-go.
- **faceless-youtube** — PARKED, no active work. STATE.md stale (2026-07-19); real last activity was the Bricks Variant-D arc in an external clone (`claude/bricks-variant-vd`, 4bc82dc2, pushed).
- **figment** — One resumable `pipeline` command drives anchor→…→video with gate halts; detail/video now real gradeable stages; single gate writer, single per-era prompt composer, plan-time budget preflight, precedence-resolved ledger. Pins repaired, Qwen3-VL captioning + skin-texture style LoRA wired. GATE A eye-gate approval pending (see Action required).
- **kb-ops** — Production VM `kb` LIVE on release `e8ac49ad` (PR #203 + PR #204 merged, deployed 2026-09-23 05:55Z). Daemon-internal 5-min schedule tick proven live 2026-09-23; daily drain promoted 19 bundles; ops linear, next drain base `052c8355`.
- **prospecting** — P1–P8 built across integrated worktrees, **all branches UNPUSHED**. P8 affinity gate 953/953 at HEAD 52067386; live-tested against real desktop store (campaign `camp_3147b42db58c4c15`), all Gate P8-B criteria green.

## Anomalies
- **Daemon-dir drift + missing checker script (13th open card).** `scripts/sync_daemon_dirs.py` is present on `origin/main` but absent from `origin/ops`, so the literal step-2b command fails (EXIT=2); run via main's copy in refs-fallback mode it reports one ops-only file `orgs/kb-ops/workflows/acceptance-run.md`. Filed `wake-daniel-2026-09-25-sync-daemon-dirs-drift`; twelve identical priors remain open. Desktop `--sync`/`--prune` fix owed. Gate reports only — dispatch not blocked.
- **Stale working/ cards (>48h).** `6a6bc3dd-5494006b` (kb-ops, `iter-smoke-t2`, owner codex-worker) last touched 2026-07-30 (~57 days). `d126c410-9bc54280` (figment, owner figment-expand) last touched 2026-09-07 (~18 days).
- **Malformed card frontmatter.** `queue/working/d126c410-9bc54280.md` has an unquoted colon in its `action:` value, so `yaml.safe_load` refuses it (ScannerError). It should be quoted or re-minted to stay machine-parseable.
- No preamble failures this run; `sync_skills --check` clean.
