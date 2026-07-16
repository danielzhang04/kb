# Proposal — Trace retention: distilled-vs-raw + GC policy (D0.8)

> **Status: PROPOSAL (governance-adjacent).** This file records the retention/GC policy for the
> Flight-Recorder trace permalinks so Daniel can adopt or amend it. Per the Ordering law, governance
> and policy text is human-committed — an agent only PROPOSES the exact wording here; it does not
> enact a GC job.

## What gets committed

Per Daniel's locked decision **Q10**, a dispatch's trace is committed **distilled**, not raw:

- **Raw JSONL transcripts stay LOCAL.** The multi-MB Claude Code session JSONL (and its
  `subagents/` sidecars) are never committed. They live only in the local Claude Code project dir.
- **The committed artifact is the distilled static render** — a single self-contained
  `traces/<card-id>/index.html` (inline CSS, no external assets, offline-openable). Tool payloads
  whose serialized size exceeds the distill threshold (`DISTILL_THRESHOLD_BYTES`, currently 2048
  bytes) are elided to a one-line summary; turn structure, tool names, and the subagent spawn tree
  are preserved. This keeps the repo's trace history small and reviewable while the full byte-for-byte
  record remains recoverable locally for the retention window below.

## Where it lives and how it is written

- Path shape: `traces/<card-id>/index.html` (one stable permalink per dispatch card).
- Committing a trace is a **runtime `ops`-branch coordination write** (`git pull --rebase origin ops`
  → stage only `traces/<card-id>/` → commit → push; a rejected push means re-read, reconcile, retry).
  In **D0 the daemon renders to the local path only and does not commit** — the commit path is opt-in
  and reserved for the D2 governed-write era.

## Proposed GC policy (for Daniel to ratify)

1. **Committed distilled traces** under `traces/` are retained for **180 days** from the dispatch
   date, then pruned by a human-ratified cadence chore (a card, not an ambient cron), keeping the last
   distilled trace per still-open card regardless of age.
2. **Local raw JSONL** is the operator's own; suggested local retention is **30 days** or until disk
   pressure, whichever comes first. Nothing in the repo depends on raw availability after distillation.
3. **Never commit raw.** If a raw transcript is ever needed in-repo for an incident review, it is
   attached to a specific review card as a distilled excerpt, not committed wholesale.
4. **Threshold changes are policy.** Adjusting `DISTILL_THRESHOLD_BYTES` changes what leaves the local
   box; treat it as a governance change (proposed here, human-committed).

## Open questions

- Retention windows (180d / 30d) are placeholders pending Daniel's call.
- Whether pruned trace dirs are hard-deleted or moved to a `traces/_archive/` tombstone index.
