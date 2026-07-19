# ECC import wave 1 — design (2026-07-19)

Approved by Daniel 2026-07-19 (chat). Source of scope: `../atlas-design/2026-07-16-ecc-import-tiers.md`
(reviewed/approved 2026-07-16), "suggested first wave" subset. ECC quarry pinned at
`C:\Users\danie\.claude\plugins\cache\ecc\ecc\2.0.0` (v2.0.0, hook scripts under `scripts/hooks/`).

## Goal

Import the approved ECC Tier-1 first-wave items as kb-native artifacts, executed as **real carded
fleet work** through `queue/` with fresh-context Inspector grading — producing the first genuine rows
in `ledgers/grades/` and waking the (built but inert) grading → promotion → reconcile loop.

Settled decisions:
- **ECC stays outside kb.** kb builds its own retargeted versions; ECC's user-scope hooks are
  disabled for kb sessions only (W1.0). Only kb-native hooks fire in kb.
- **Wave split:** wave 1 = the five cards below. Wave 2 (GateGuard classifier retarget,
  `config-protection`, `strategic-compact`, save-session template, delivery-gate flip-to-block) is
  **filed as cards now, built only after Daniel's wave-1 review checkpoint** (`depends-on` chained).
- **Enforcement mode:** `block-no-verify` blocks from day one; `delivery-gate` lands warn-mode,
  flip-to-block is a wave-2 card.
- **Execution mode:** in-chat orchestration over real cards (chat option A): orchestrator files
  cards via `scripts/cards.py` and assigns owners per `governance/model-routing.yaml`; Opus-and-below
  workers (model self-reported + transcript-verified) execute; the `inspector` curated skill grades
  each card fresh-context via `scripts/grade.py`; `scripts/reconcile.py` runs at the end as the
  first-ever reconcile with real data.

## Cards (wave 1 — all T2)

| # | Card | Content |
|---|---|---|
| W1.0 | ECC scope-off + kb hook-layer bootstrap | Create `kb/.claude/settings.json`: disable ECC's hooks for kb sessions (mechanism verified against ECC `run-with-flags.js` — env `ECC_DISABLED_HOOKS`/profile gating — not assumed) and establish the kb hook wiring later cards attach to. Live verification: GateGuard no longer fires in a kb session. |
| W1.1 | `loop-design-check` | ECC skill → `skills/imported/`, exit conditions retargeted to kb cards + grade ledger (§8.1 judgment layer). |
| W1.2 | `delivery-gate` + `growth-log` | Stop hook retargeted to `memory/<agent-id>.md`, **warn-mode**; growth-log content standard ("Next time I see [signal], I will [action]"; failures > achievements; dedupe-before-write) alongside. |
| W1.3 | `block-no-verify` | Hook blocking `--no-verify` / `core.hooksPath` overrides, **block-mode**. Protects `.githooks/` integrity. |
| W1.4 | CI validators + provenance schema | `check-unicode-safety`, `scan-supply-chain-iocs`, `validate-skills` retargeted to kb's `skills/` tree; `provenance.schema.json` aligned to kb provenance tiers. Lands under `scripts/` (`governance/` is human-edited only; Daniel may relocate the schema at merge time). |

## Mechanics

- **Isolation:** all work in worktree `kb-worktrees/ecc-import` on branch `claude/ecc-import-w1`
  (from `origin/main` e948ec4). Ops writes (cards, ledgers) through the ops worktree with
  pull-rebase/push discipline. The dashboard checkout is never touched. `kb/.claude/settings.json`
  ships on the work branch — nothing changes for any session until Daniel merges.
- **Provenance:** every imported artifact carries frontmatter (`source: ecc@2.0.0/<path>`,
  import date, tier `imported`); every skill passes `scripts/scan_skill.py`.
- **No worker commits:** orchestrator reviews diffs, runs tests, commits.

## Human gates (one at a time, at their plan positions)

1. §6 read-through per skill before `imported/` → `curated/` promotion.
2. Merge of `claude/ecc-import-w1` — branch stays local until Daniel takes it.
3. Wave-2 go/no-go after reviewing wave-1 results + grades.

## Verification

- pytest suite stays green; `scan_skill.py` clean on each imported skill.
- Live: ECC hooks stop firing in a kb session; kb warn-mode hooks visibly emit; `block-no-verify`
  actually blocks a test `--no-verify` attempt in the worktree.
- `reconcile.py` end-of-wave pass validates the new grade rows (grader identity, paired activity rows).

## Consistency sweep (end of wave)

Re-check for duplication/drift: growth-log standard vs `agent-rules.md` memory wording, validator
overlap with `scan_skill.py`, dead references. Any constitution/`governance/` change becomes a
**proposal to Daniel**, never an agent edit. Keep new files short and single-purpose.
