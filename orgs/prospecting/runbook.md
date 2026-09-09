# Daniel-only P6 promotion runbook

1. Merge the reviewed P6 branch to protected main; record the merge SHA.
2. Confirm P1 `--verify-recorded` and P2–P5 manifests, then run the P6 gate on the merged SHA.
3. Use the existing reviewed promotion ceremony to promote that merged SHA to the VM ops checkout; do not hand-copy files or move a mutable branch tip.
4. Run `sync_daemon_dirs.py --check` for its existing `agents/` and `orgs/*/workflows/` mirrors. It does not deploy `HEARTBEAT.md`. If Daniel has committed the cadence blocks, promote that protected-main commit through the scheduler's existing human-owned deployment path and verify the live source SHA separately.
5. Run the preflight with its supported arguments only:
   `py -3 scripts/prospecting/deploy_preflight.py --desktop-host <reviewed-desktop-host> --expected-merge-sha <merged-sha> --root <repo-root>`.
   Stop on any nonzero check; never paste a key, token, or assertion into an argument. The preflight does not accept a store path.
6. On the desktop, run campaigner scan and status, confirm the machine stays awake, confirm no global suppression, then stage the exact T1 batch without sending:
   `py -3 -m scripts.prospecting.approval.cli approve-batch --store <desktop-db> --campaign <campaign-id> --mailbox <mailbox-id> --stage-root <repo-root>`.
   Record only the emitted `card_ref` (an `approval/<card-id>` ref) and `scope_hash`; the command never accepts assertion bytes or keys.
7. In the kb dashboard, approve that exact `card_ref` and `scope_hash` with WebAuthn, then return the same pinned `approval/<card-id>` ref. Materialize on the desktop:
   `py -3 -m scripts.prospecting.approval.cli materialize --store <desktop-db> --card-ref approval/<card-id> --stage-root <repo-root>`.
   Inspect the returned count, scope hash, and scheduled window; explicitly enable only that T1 campaign.
8. Observe the first next-morning sends. On warning, bounce threshold, mismatch, Tailscale loss, sleep, or unexpected count, globally pause. Do not catch up.
9. Roll back by globally pausing sends first, then use the existing promotion ceremony to restore the previous immutable release. Re-run scan/status; never unconsume an approval.

## Live T1 gate (human)

Approve the batch via the kb WebAuthn dashboard channel, allow the next-morning sends, verify them in Gmail, then reply `P6 live pass`.

## Operator gates

Run these commands on the reviewed desktop only. They resolve the SQLite store under
`%LOCALAPPDATA%\kb-prospecting`; do not supply a store path or place capture/profile files in git.
Write the campaign ask to a desktop-local text file under that fixed root, then pass its path
with `--ask-file`; never place an ask on the command line.
Vendor keys exist only in Daniel's desktop user environment: `HUNTER_API_KEY`,
`SNOV_CLIENT_ID`, `SNOV_CLIENT_SECRET`, `PDL_API_KEY`, and `APIFY_TOKEN`.

| Gate | Command |
| --- | --- |
| P2: create draft campaign | `py -3 -m scripts.prospecting.operator campaign new --ask-file <desktop-ask.txt> --sender-profile <desktop-profile.json> --lanes manual,snov_domain` |
| P2: capture manual input | `py -3 -m scripts.prospecting.operator capture add --campaign <campaign-id> --file <desktop-captures.csv>` |
| P2: build the list | `py -3 -m scripts.prospecting.operator list --campaign <campaign-id> --lanes manual --max-people 50` |
| P2: attach and compare vendors | `py -3 -m scripts.prospecting.operator vendors attach --providers hunter,snov`, then `py -3 -m scripts.prospecting.operator bakeoff run --campaign <campaign-id> --contacts 50`, then `py -3 -m scripts.prospecting.operator bakeoff report --campaign <campaign-id>`. The selected provider names and A/B report mapping are retained only in `%LOCALAPPDATA%\kb-prospecting\operator-vendors.json`; `--snov-account-credit-ceiling N` explicitly updates the durable Snov ceiling without removing other desktop settings. Without the attachment, list, bake-off, and executor commands refuse and name the attach command. |
| P6: email-first fill | `py -3 -m scripts.prospecting.operator fill --campaign <campaign-id> --target-per-firm 2 --max-candidates-per-firm 6 --reserve-firms <desktop-reserve.csv>`, then `py -3 -m scripts.prospecting.operator executor run`. Point Datasette at the desktop SQLite `deliverable_v1` view; it contains only selected people with a confident email. |
| P3: prepare personalizations | `py -3 -m scripts.prospecting.personalizer.cli prepare --campaign <campaign-id> --sender-profile <desktop-profile.json> --output <desktop-job.json> --store %LOCALAPPDATA%\kb-prospecting\store.sqlite`, then `py -3 -m scripts.prospecting.personalizer.cli personalize --campaign <campaign-id> --sender-profile <desktop-profile.json> --model-response <desktop-response.json> --store %LOCALAPPDATA%\kb-prospecting\store.sqlite` |
| P4: campaign sweep | `py -3 -m scripts.prospecting.campaigner.cli sweep` with the reviewed desktop Gmail adapter attached |

The capture CSV headers are `kind`, `linkedin_url`, `name`, `first_name`, and optional
`location`. `kind` is `person` or `company`; LinkedIn URLs are normalized by the capture
lane. Every operator command emits IDs and counts only. `executor run [--once]` drains
the desktop queue after adapters have been attached; it is never a substitute for the
P4 human Gmail gate.

P6 domain discovery sends Snov only a domain and page, persists a validated resolved domain as the missing company homepage, then applies title rules locally. `vendors attach --title-exclusions "a,b,c"` replaces the durable local function-exclusion list (an empty string disables it); excluded titles remain observations but cannot enter the deliverable. It
follows at most four pages per firm by default (`fill --max-pages-per-firm N` overrides it);
an exhausted empty domain is reported as `short` with shortfall reason `no_candidates`, not as pending discovery.
