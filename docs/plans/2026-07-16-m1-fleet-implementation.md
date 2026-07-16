# Month-1 Fleet — Implementation Plan (TDD, wave-ordered) — FINAL

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (or
> `superpowers:executing-plans`) to implement this plan task-by-task, strict TDD (failing test
> first, minimal green, refactor). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Turn the approved architecture (`m1-fleet-architecture-final.md`, Waves 0–6) into a
buildable, dependency-ordered task list that removes the four things blocking the kb flywheel from
turning unattended and safely: (1) harden the approval boundary so a *human tap / signature* — not a
spoofable git-author string — authorizes action; (2) stand up a phone transport (Telegram +
GitHub-merge); (3) close the grader → promotion loop and prove a cloud-only cycle; (4) onboard the
first non-Claude worker (**Codex CLI only** this month) behind that boundary. This plan is the
sequenced, test-first realization of the architecture's build inventory, adjusted by Daniel's final
decisions (below).

**Daniel's final decisions folded in (override the architecture where they conflict).**
1. **Gemini is deferred entirely** (privacy — the free tier trains on submitted data). The month-1
   non-Claude worker is **Codex CLI only**. The `sync_skills` adapter *pattern* and
   `docs/onboarding/one-off-agent.md` stay **generic** so Gemini or any CLI can join later; every
   Gemini-specific build item (keys, runner guards, settings, `render_gemini`) is dropped. A
   one-line governance note records that Gemini is deferred and why.
2. **Telegram bot-token custody = DESKTOP** (Windows Credential Manager). The desktop
   interactive-poll cadence owns `getUpdates` and all Telegram I/O. PC-off time-critical approvals
   use the signed **GitHub-mobile-merge** channel. The cloud tier never holds the bot token (so no
   `api.telegram.org` cloud allowlist entry is needed).
3. **Web research is fleet-wide and unrestricted.** Nothing in this plan implies agents cannot fetch
   the web. The *only* isolation is **process isolation of the approval-minting poller**: the
   process that holds the bot token and mints possession approvals never ingests untrusted external
   web content in the same process/run.
4. **faceless-youtube is out of month 1.** No cadence is added; `orgs/faceless-youtube` is not
   touched (Daniel iterates his local copy). The ≥3-projects requirement is met by
   **faceless-youtube (existing, idle) + `orgs/kb-ops` (new) + `orgs/atlas-prep` (new)**; roles are
   exercised on **kb-ops and atlas-prep only**. Architecture item 4.6 is dropped.
5. **Adopted defaults:** dedicated protected **`approvals`** branch (O2); promotions key on
   **`(worker, project, task_type, tier)`** (O7); **novel/first-time T3 → signed channel only**
   (O9); the Codex runner **fails loud (wake-me) on stale auth and never falls back to the metered
   API** (O8); Daniel **personally reviews `approvals.py`** before it is load-bearing (O1).

---

## Revision note (what changed vs. the draft, and why)

This FINAL applies the two review lenses (repo-reality + ordering-safety). The load-bearing changes:

- **PR-open transport made git-transport-only (was `gh pr create`).** The draft minted signed-channel
  approvals with `gh pr create`, which needs a locally-authenticated GitHub REST token — the exact
  credential ordering-law 4 forbids in every agent env. Fixed per tier: the **cloud** leg opens the
  `approval/<id>` PR through the **claude.ai GitHub-App git integration** (credential lives in the
  claude.ai platform, not the VM env); the **desktop** leg **pushes the `approval/<id>` branch over
  its SSH deploy key and delegates PR creation** (to the cloud/app leg or to Daniel) — it never runs
  `gh` with a local token. No agent env gains an `api.github.com` allowlist entry. (repo-reality
  BLOCKER 1 / ordering-safety BLOCKER 2)
- **Carve-out re-keyed to the real cadence `nightly-review` (there is no `dashboard-regen`).** The
  root `HEARTBEAT.md` cadence is `nightly-review`, and it commits `dashboards/ memory/ queue/
  ledgers/`. A dashboards-only carve-out would be voided every run by the own-card `queue/` write and
  the `ledgers/dispatch/` row. The carve-out is now scoped to `cadence:nightly-review` with an
  **explicit write allow-list** — `dashboards/**`, own memory shard `memory/<agent-id>.md`,
  `ledgers/dispatch/**`, and the **own cadence card's `queue/` state transition** — while
  `ledgers/grades/**` and `ledgers/activity/**` remain **excluded verbatim**. (repo-reality MAJOR 3)
- **Wave-0 no longer verifies a signed approval that does not yet exist.** The pinned keyring (1.7),
  the protected `approvals` ref (1.6), and any signed record (1.2/1.4) are all built in Wave 1. Task
  0.5 is split: **0.5a** (Wave 0) proves the cloud-only *dispatch* cycle + carve-out-acts-alone;
  **0.5b** (a post-1.7 re-run) proves offline signed-approval honoring. Exit-criterion 1 is split to
  match. (ordering-safety BLOCKER 1)
- **Signer-identity check corrected to a two-part test.** A GitHub web-UI/mobile merge commit is
  signed by GitHub's **web-flow key** (UID `GitHub <noreply@github.com>`), *not* by Daniel. Matching
  the key's bound identity against Daniel's `humans.yaml` entry always fails; accepting "any valid
  web-flow signature" accepts a merge by anyone with merge access. The sound gate is **(a)** signature
  GOOD under the pinned web-flow key AND **(b)** the merge **commit author-email ∈ humans.yaml**,
  backstopped by branch-protection restrict-merge-to-Daniel (1.6). A `valid-sig + non-allowlisted
  author → reject` test is added. (ordering-safety MAJOR 3)
- **`approved_by_human()` removal now migrates its test.** Removing the function orphans
  `tests/test_approvals.py::test_approved_by_human_end_to_end` (+ its `_git`/`_make_repo`/
  `_approved_card` helpers), which would error and fail the "all pytest green" exit. 1.2 explicitly
  deletes/rewrites it. (repo-reality MAJOR 2)
- **gpg is a guarded test dependency, not a hard one.** Sign/verify tests now `skipif` gpg is absent
  and ship a pre-signed fixture repo, matching the existing suite's `-c commit.gpgsign=false` stance.
  (repo-reality MAJOR 4)
- **Dedicated `approvals` ledger kind** added to `ledger.KINDS` (a script edit, agent-editable — not
  governance) so the Telegram audit trail does not pollute `ledgers/activity/**` (the reconcile input
  and a carve-out-excluded integrity stream). Reconcile keys only on Inspector-authored activity
  rows. (repo-reality MINOR 5 / ordering-safety MINOR 5)
- **Trust-anchor invariant re-audited for the Codex env** at 5.8 and 5.9 (it did not exist at 1.10).
  (ordering-safety MAJOR 4)
- **`decide()` emits an `assurance_class`** (`T3-novel` signed-only vs `T3-established`
  fast-lane/possession-eligible); 2.4 consumes it; a first-ever-T3 → no-possession-button test is
  added. (ordering-safety MINOR 6)
- Minor wording/coverage fixes: pre-commit-hook claim removed (sync is manual / nightly `--check`);
  scaffold test asserts **≥1** tiered cadence; nightly.md prose edits are explicitly merged to `ops`.
  (repo-reality MINOR 6/7/8)

---

## Ordering law (binding on the whole plan)

1. **Approvals hardening (Wave 1: I1 + I3 + T10) lands on `main` BEFORE any non-Claude agent gets
   ops-push access.** Codex Phase B (5.9) is hard-gated behind the Wave-1 exit.
2. **All `governance/**` and `CLAUDE.md` / spec / `HEARTBEAT.md`-on-`main` changes are
   human-committed proposals.** Agents may only PROPOSE the exact text (write it into the PR body or
   a `docs/proposals/*.md` scratch file); a human commits it. This covers `risk-tiers.md`,
   `card-schema.md`, `humans.yaml`, `graders.yaml`, `security-rules.md`, and every root/project
   `HEARTBEAT.md` cadence entry that must be human-authored to earn standing authorization.
3. **No agent handles a credential as an object** (create / read-store / modify). Every token,
   identity, GPG-key, SSH-key, branch-permission, and Task-Scheduler-registration step is a HUMAN
   GATE.
4. **Trust-anchor invariant holds:** no agent environment is provisioned with a REST-API-capable
   (`Contents: write` / Merge / PR-write **token in the environment**) GitHub credential. Agents use
   **git-transport-only** access (desktop: SSH deploy key; cloud: the claude.ai GitHub-App git
   integration, whose credential lives in the claude.ai platform, not the VM env). This is what makes
   the web-flow signature a sound human-vs-agent discriminator. **Consequence for PR-open:** no agent
   env runs `gh`/REST with a local token; the cloud leg opens PRs through the claude.ai GitHub-App
   integration, and the desktop leg only *pushes a branch* over its deploy key and delegates the
   PR-open. This invariant is audited at **1.10** (Claude envs) and re-audited at **5.8 and 5.9**
   (the newly-provisioned Codex env).

**Branch discipline (per CLAUDE.md).** All AGENT-BUILDABLE code lands on work branch
**`claude/m1-fleet`** and reaches `main` via **PR** (never a direct push to `main`). Each wave
closes with one PR (or a small PR per sub-area) that Daniel reviews and merges. Scripts/tests are
durable content → they live on `main` after merge; the desktop checkout stays on `ops` and picks up
merged code via `git merge main --no-edit`. **Prose that a cloud routine reads at runtime
(`routines/nightly.md`, `routines/roles/*`) must be merged `main → ops` explicitly** — the cloud
routine checks out `ops` and reads its own instructions from there, so a change merged only to `main`
would leave the routine running stale prose. Coordination artifacts (cards, ledgers, cadence *runs*)
are `ops`-branch writes under the usual pull-rebase-push rule. **HUMAN GATE** steps are never done
by an agent — they are listed in sequence with exact instructions for Daniel.

---

# Wave 0 — Cloud-leg proof + carve-out (unblocks the running loop; no ordering deps)

> Ordering within the wave is load-bearing: the `nightly-review` carve-out (0.4) must be committed on
> `main` **and merged into the `ops` tree** BEFORE the Run-now verification (0.5a), or the nightly
> `nightly-review` cadence queues into `approvals/` instead of acting alone and the "regenerated
> dashboards (today's date)" criterion fails.
>
> **Signed-approval honoring is NOT verified in Wave 0.** The pinned keyring, the protected
> `approvals` ref, and any signed record are all Wave-1 artifacts. Wave 0 proves only the cloud-only
> *dispatch* cycle (0.5a); offline signed-approval honoring is proven at **0.5b**, a re-run scheduled
> **after 1.7**.

### HUMAN GATE 0.1 — Verify the branch-push toggle
- [ ] At claude.ai routines docs, confirm the **"Allow unrestricted branch pushes"** toggle exists
  and is the mechanism that lets a routine `git push origin ops` (a non-`claude/`-prefixed branch).
  If the toggle has been renamed/removed, capture the current equivalent before 0.2. This is a
  post-cutoff fact a doc edit cannot confirm.
- [ ] While in the routines docs, confirm the mechanism by which a routine can **open a pull request**
  without a REST token in the VM env (the claude.ai GitHub-App git integration). This is the transport
  the signed-channel PR-open (1.4 / 2.4) depends on; capture the current capability/limitation. If the
  integration cannot open PRs, the cloud leg falls back to "push `approval/<id>` branch + notify Daniel
  to open/merge" (same as the desktop leg) — record which applies.

### HUMAN GATE 0.2 — Configure the cloud routine `kb-nightly-dispatcher`
- [ ] claude.ai → routine: grant clone access to the **private `kb`** repo only.
- [ ] Permissions → enable **"Allow unrestricted branch pushes" for `kb`** (the I4 fix).
- [ ] Environment → Network = **Trusted**; **Setup script** installs **`pyyaml`** and **ensures
  `gpg` is present** (the cloud VM is the one env where gpg is guaranteed for signed-approval
  verification; desktop/CI treat gpg as optional, see 1.2/1.3/1.5); **Connectors: remove all**.
- [ ] Confirm the routine holds **no `api.github.com` and no `api.telegram.org` env credential** — PR
  creation goes through the claude.ai GitHub-App integration, not a VM-resident token (trust-anchor
  invariant).
- [ ] Repositories = `kb`; schedule **daily 02:00 local**; prompt = "Read `routines/nightly.md` and
  follow it exactly"; model selector = intended dispatcher model.

### Task 0.3 — `routines/nightly.md`: pyyaml fallback + confirm `ops` target  *(AGENT-BUILDABLE)*
**Goal.** Make the cloud routine resilient to a VM missing `pyyaml` and confirm every push targets
`ops`. `routines/nightly.md` is durable content (not `governance/`), so an agent may edit it via PR.

**Files touched:** `routines/nightly.md` (edit step 1–2 area; add a pyyaml-ensure line before step 3).

**Failing test first:** add `tests/test_nightly_routine.py::test_routine_ensures_pyyaml_and_targets_ops`
— read `routines/nightly.md`, assert it contains a `pip install pyyaml` (or `python -m pip install
pyyaml`) fallback line AND that every `git push` mention targets `ops` (regex: no `git push` line
references `main`). (Doc-as-contract test, mirrors the repo's habit of asserting on routine prose.)

**Implementation.** Insert a step 2a: "If `python -c "import yaml"` fails, run `python -m pip install
--user pyyaml` then re-check; on repeated failure write a wake-me card and STOP." Confirm step 6's
push is `git push origin ops` (already correct — assert, don't change semantics).

**Verification.** `python -m pytest tests/test_nightly_routine.py -q` green; manual re-read.

**Merge-to-ops (REQUIRED).** After this PR merges to `main`, merge `main → ops` (`git merge main
--no-edit`, push `ops`) so the cloud routine reads the updated prose from its `ops` checkout. The
0.5a Run-now must be on the post-merge `ops` tree.

**Commit message:** `fix(routine): pyyaml fallback + assert ops-only push in nightly dispatcher`

### HUMAN GATE 0.4 — Commit the `nightly-review` carve-out (agent PROPOSES text)
- [ ] Agent deliverable (on `claude/m1-fleet`, in `docs/proposals/risk-tiers-carveout.md`): the
  **verbatim** carve-out clause for `governance/risk-tiers.md`, scoping the **`cadence:nightly-review`**
  action to **T1 acts-alone** for any trigger, with writes limited to an **enumerated allow-list**:
  - `dashboards/**`
  - the own memory shard `memory/<agent-id>.md`
  - `ledgers/dispatch/**` (the cadence's own dispatch rows)
  - the **own cadence card's `queue/` state transition** (moving *its own* card to `queue/done/` with
    a `## Result`) and emitting **wake-me cards into `queue/inbox/`** (queueing, not acting)
  - **excluded verbatim:** `ledgers/grades/**` and `ledgers/activity/**` (integrity streams), plus
    any write to another agent's memory shard, `governance/**`, `orgs/*/contract.md`, or any project
    work tree.

  Any write outside the enumerated scope voids the carve-out → reverts to queues-for-me. Rationale
  note in the proposal: `nightly-review` inherently commits `dashboards/ memory/ queue/ ledgers/`
  (per the root `HEARTBEAT.md` prompt), so the allow-list must name the own-card `queue/` write and
  the `ledgers/dispatch/` row or the carve-out is self-voiding.
- [ ] **Daniel** commits that clause into `governance/risk-tiers.md` on **`main`**, then merges
  `main` into `ops` so the carve-out is present in the `ops` working tree **before 0.5a**.

### HUMAN GATE 0.5a — Run the cloud-only DISPATCH verification checklist (D6, Wave-0 scope)
- [ ] Trigger **Run now** on the routine; confirm green; **open the transcript** (green ≠ success).
- [ ] On desktop confirm: fresh `ledgers/dispatch/dispatcher-cloud-<today>.tsv`; regenerated
  `dashboards/executive.md` + `dashboards/handover.md` (today's date); the cadence card in
  `queue/done/` with a `## Result`; the ops-advancing commit was **authored in the cloud**
  (author/timestamp vs run time); Task Scheduler `kb-desktop-dispatcher` stayed **Disabled**; the
  push landed on `ops` directly.
- [ ] Confirm the carve-out **acted alone**: the `nightly-review` cadence card went straight to
  `queue/done/` (NOT to `queue/approvals/`), and no write landed outside the 0.4 allow-list
  (in particular, `ledgers/grades/**` and `ledgers/activity/**` were untouched by the run).
- [ ] This gate does **not** verify signed approvals (no keyring/ref/record exists yet). The
  "cloud-only cycle proven" milestone's signed-approval clause is deferred to **0.5b**.

### HUMAN GATE 0.5b — Prove offline signed-approval honoring in the cloud VM (RE-RUN, after 1.7)
- [ ] **Precondition:** Wave-1 tasks 1.2/1.4 merged to `main` (and `main → ops`), the protected
  `approvals` ref exists (1.6), and `governance/web-flow.gpg` is pinned (1.7). Schedule this re-run at
  the Wave-1 exit, not in the Wave-0 session.
- [ ] Stage one real signed approval (Daniel merges an `approval/<id>` PR into `approvals` — the
  web-flow-signed action), then trigger a cloud **Run now**. Confirm the run calls
  `approvals.py verify_signed_approval` and that it returns `(True,"ok")` by `git verify-commit`
  against the pinned keyring **offline** (no `api.github.com`).
- [ ] If the cloud VM cannot run `git verify-commit` (no gpg despite 0.2), record **"approval-honoring
  is desktop-only"** (this gates the PC-off flywheel promise) and proceed — desktop remains the
  signed-approval authority.

---

# Wave 1 — Approval-boundary hardening (I1 + I3 + T10) — GATES Waves 3–5 ops access

> Everything here reworks `scripts/approvals.py` and its one production consumer (`routines/nightly.md`
> step 4b). The current `approvals.py` uses a **local git-author** check (`%an` via `git log -S`) and
> an online-trusting model (its own header says "GitHub branch protection … is the enforced gate");
> Wave 1 replaces that with an **offline web-flow-signature** gate on a dedicated protected `approvals`
> ref, folds `action`+`target` into the hash, and splits verification into two named entry points.
> **1.2 and 1.9 must land in the same PR** (renaming the entry point without migrating the routine
> silently stops approval-honoring).

### Task 1.1 — `approval_payload(card)` canonical serializer (I3)  *(AGENT-BUILDABLE)*
**Goal.** One deterministic function producing the I3 canonical payload —
`action` + `target` + `work_order_of(body)` — shared by the verifier (1.2) and the PR-minter (1.4),
so both channels bind the **same** hash.

**Files touched:** `scripts/approvals.py` (add `approval_payload(card: cards.Card) -> str` and
`payload_hash(card) -> str`; keep existing `content_hash`, `work_order_of` unchanged and reuse them).

**Failing tests first** (`tests/test_approvals.py`, new cases):
- `test_payload_binds_action_and_target`: two cards with identical work-order prose but different
  `action` (or `target`) produce **different** `payload_hash` (today's `content_hash(work_order_of)`
  would collide — proves the fold-in).
- `test_payload_is_order_stable`: same card serialized twice → identical hash; whitespace/key-order
  in frontmatter does not change it (payload is built from the three fields explicitly, not raw YAML).

**Implementation.** `approval_payload` returns e.g.
`"action:{action}\ntarget:{target}\nwork-order:\n{work_order_of(body)}"` (target normalized: if it
is a list, join with `,`; POSIX separators). `payload_hash = content_hash(approval_payload(card))`.

**Verification.** `python -m pytest tests/test_approvals.py -q` green for the two new cases.

**Commit message:** `feat(approvals): canonical I3 payload binding action+target+work-order`

### Task 1.2 — Rewrite `approvals.py`: offline signed-ref verification + two entry points  *(AGENT-BUILDABLE)*
**Goal.** Replace the local-author / online model with the corrected trust chain. Keep `verdict()`'s
pure shape (it is well-tested); rewire the git-facing wrapper. **Remove `approved_by_human()` and
migrate its test** (see below) so the suite stays green.

**Files touched:** `scripts/approvals.py`; `tests/test_approvals.py` (delete/rewrite the
`approved_by_human` end-to-end test + its helpers).

**Failing tests first** (`tests/test_approvals.py`):
- `test_verify_signed_approval_offline_ok`: build a git repo where the approval-record commit carries
  a **web-flow-style signature verifiable against a test keyring** (fixture keyring in
  `tests/fixtures/`); `verify_signed_approval()` returns `(True,"ok")`. **`@pytest.mark.skipif` when
  the `gpg` binary is absent** (see gpg-guard note).
- `test_unsigned_or_agent_pushed_rejected`: an ordinary (unsigned) commit introducing the record →
  reject with a signature-failure reason.
- `test_keyring_missing_fails_closed`: no keyring present → **reject** (must never "skip → pass").
- `test_valid_signature_wrong_author_rejected` **(NEW — the real residual threat):** a commit with a
  GOOD web-flow signature but a **merge-commit author-email NOT in `humans.yaml`** → **reject**. This
  is the "anyone with merge access" case; today only the no-signature case is tested.
- `test_forged_author_without_signature_rejected`: author string matches an allowlisted human but no
  valid signature → reject (proves the `author.login`/`%an` trust is gone).
- `test_assurance_field_roundtrip`: a `possession`-class record presented to `verify_signed_approval`
  is rejected; `verify_telegram_approval` accepts a valid possession record and stamps
  `assurance: possession`.
- Keep every existing `verdict()` / `work_order_of()` test green (regression guard).
- **Delete or rewrite `test_approved_by_human_end_to_end` and its `_git`/`_make_repo`/`_approved_card`
  helpers** (they call `approvals.approved_by_human`, which this task removes; leaving them errors the
  suite). The laundering assertion they covered is re-expressed in 1.5's T10 merge-topology test, and
  the legit-approval assertion is re-expressed by `test_verify_signed_approval_offline_ok`, so no
  coverage is lost.

**Implementation.**
- Remove `approved_by_human()` and its `git log -S%an` binding, and delete the module-header claim
  that "GitHub branch protection … is the enforced gate" (the enforcement is now the offline
  signature). Add:
  - `verify_signed_approval(card_path, repo_root) -> (bool, reason)`. All conditions fail **closed**:
    1. record on the protected `approvals` ref;
    2. the introducing/merge commit is **web-flow-signed and verified offline** via the 1.3 wrapper
       (`git verify-commit` inside a scratch `GNUPGHOME` seeded from `governance/web-flow.gpg`) —
       proves **GitHub** performed the merge, not a local agent;
    3. **two-part identity check (corrected):** **(a)** the signature is GOOD under the *pinned
       web-flow key* (whose own UID is `GitHub <noreply@github.com>` — do NOT try to match the key's
       identity to a human), AND **(b)** the **merge-commit author-email ∈ `governance/humans.yaml`**
       (the human who clicked merge). Both required; branch-protection restrict-merge-to-Daniel (1.6)
       is the third leg. Matching the *key's* identity against a human, or accepting any valid
       signature regardless of author, is explicitly wrong;
    4. recomputed `payload_hash(card)` (1.1) matches the record's `approval`;
    5. `now() < expires` and within `MAX_AGE`.
  - `verify_telegram_approval(card_path, repo_root) -> (bool, reason)`: possession-class checks —
    record `assurance: possession`, hash match against re-read card, `from.id` allowlist already
    enforced at mint time (2.1), tier admissibility (**never novel/first-time T3** per O9), expiry.
- Add an `assurance:` field to the record schema (`signed` | `possession`); downstream execution and
  the weekly audit read it.
- `verdict()` stays pure; both entry points funnel their final decision through it (extend its
  signature only if needed for `assurance`, keeping existing tests green).

**gpg-guard note (applies to 1.2, 1.3, 1.5).** gpg is **optional** on desktop/CI and **guaranteed
only in the cloud VM** (0.2). Every test that creates or verifies a real signature must
`@pytest.mark.skipif(shutil.which("gpg") is None, reason="gpg not installed")` **and** the suite must
also ship a **pre-signed fixture git repo** (`tests/fixtures/signed-approval/`) so the non-signing
assertions (hash binding, author-email allowlist parsing, fail-closed paths) run everywhere. This
mirrors the existing suite's `-c commit.gpgsign=false` stance (test_approvals.py line 105) — the
environment is not assumed to have signing configured. Month-1 exit #7 ("all pytest green") must hold
on a box without gpg (skips, not errors).

**Verification.** Full `tests/test_approvals.py` green (with gpg: signing tests run; without gpg:
they skip and fixture-based tests still run); `verdict()` regression cases unchanged.

**Commit message:** `feat(approvals): offline web-flow signed-ref gate; two-part identity; drop online/author trust`

### Task 1.3 — Offline web-flow verify wrapper  *(AGENT-BUILDABLE)*
**Goal.** A small, testable helper that imports `governance/web-flow.gpg` into a scratch
`GNUPGHOME` and runs `git verify-commit` (requires the `gpg` binary; the Wave-0 setup ensures it in
the cloud VM, desktop/CI treat it as optional per the gpg-guard note).

**Files touched:** `scripts/approvals.py` (private `_verify_commit_signature(sha, repo_root) ->
(bool, signer_identity|None, author_email|None)`), or a new `scripts/gpgverify.py` if cleaner. Returns
the **author email** alongside the signature verdict so 1.2's two-part check has both inputs from one
call.

**Failing tests first:** `test_verify_wrapper_ok` (signed commit against fixture keyring → True +
identity + author-email; `skipif` no gpg), `test_verify_wrapper_bad_sig` (tampered → False),
`test_verify_wrapper_no_gpg` (simulate missing binary via a monkeypatched PATH → fails closed with a
clear reason, not a crash — this test runs everywhere).

**Implementation.** Create a temp dir as `GNUPGHOME`, `gpg --import governance/web-flow.gpg`, then
`git -c gpg.program=gpg verify-commit --raw <sha>`; parse `VALIDSIG` / signer; read author email via
`git show -s --format=%ae <sha>`. Never leak the temp dir; `errors="replace"`; on `FileNotFoundError`
(no gpg) return `(False, "gpg unavailable", None)`.

**Verification.** `python -m pytest tests/test_approvals.py -k verify_wrapper -q` green (signing cases
skip without gpg; the no-gpg case always runs).

**Commit message:** `feat(approvals): offline gpg verify wrapper (scratch GNUPGHOME + pinned keyring + author-email)`

### Task 1.4 — Dispatcher approval-PR pre-staging helper  *(AGENT-BUILDABLE)*
**Goal.** When a card is routed to `approvals`, compute its `payload_hash`, write the record with the
hash pre-computed (so Daniel never types a 64-char hash), and **open a PR `approval/<card-id>` → the
`approvals` ref via git-transport only**. The agent **opens** (or, on desktop, only **pushes the
branch and delegates the open**) but **cannot merge** — the merge is Daniel's web-flow-signed action
(the gate).

**PR-open transport (per tier — trust-anchor invariant, NOT `gh`):**
- **Cloud leg:** push `approval/<card-id>` over the claude.ai git integration and open the PR through
  the **claude.ai GitHub-App integration** (credential lives in the claude.ai platform, not the VM
  env). Confirmed capable at 0.1; if not, fall back to the desktop mechanism.
- **Desktop leg:** push `approval/<card-id>` over the **SSH deploy key** and **delegate PR creation**
  — emit a notify (2.4) asking Daniel (or the cloud/app leg) to open the PR. The desktop env **must
  never run `gh`/REST with a local token** (it holds only a deploy key). Opening a PR is a REST write;
  the deploy key cannot do it, and provisioning a token would violate ordering-law 4.

**Files touched:** new `scripts/stage_approval.py` (function `stage(card_path, repo_root, opener) ->
pr_ref_or_branch`, where `opener` is an injected callable — `open_pr` for the cloud/app path or
`push_branch_and_notify` for the desktop path — so the helper never hard-codes a transport). Wired
from the dispatcher/notify path (2.4).

**Failing tests first:** `test_stage_writes_record_with_hash` (record on the `approval/<id>` branch
carries `approval == payload_hash(card)`, `assurance: signed`, `expires`); `test_stage_never_merges`
(the helper issues no merge call — assert on the command list via a fake runner);
`test_stage_desktop_delegates_open` (with the desktop `opener`, the helper pushes the branch and calls
notify, and issues **no** PR-open/REST call — assert on the fake runner); `test_stage_cloud_opens_pr`
(with the cloud `opener`, the helper calls the injected `open_pr`, still no merge).

**Implementation.** Build the record dict, write `approvals/<card-id>.yaml`, commit on
`approval/<card-id>`, then invoke the injected `opener`. Return the PR ref (cloud) or branch ref
(desktop) for the notify formatter.

**Verification.** unit tests green (git/opener shelled through injectable runners so tests stay
hermetic and no real network/token is touched).

**Commit message:** `feat(approvals): stage signed-channel approval PR (git-transport only, per-tier opener)`

### Task 1.5 — Adversarial + git-topology tests (T10)  *(AGENT-BUILDABLE)*
**Goal.** The security-critical integration tests that need real git topology, kept in one file.

**Files touched:** `tests/test_approvals_topology.py` (new).

**Tests (write first, then ensure 1.2–1.4 satisfy them; signing cases `skipif` no gpg + a pre-signed
fixture backstops the non-signing assertions):**
- **T10 merge-topology (re-expresses the old laundering test):** a `main → ops` (or `approval/<id> →
  approvals`) merge binds the approval to the **true signing commit**, not a later unrelated commit
  touching the file (the laundering case the old `-S` test covered, re-expressed for the signed
  model).
- **T10 frontmatter-field assertion:** `git show <sha>:<path>` — the hash now binds `action`+`target`
  (change a frontmatter field after signing → verification fails).
- **valid-signature + non-allowlisted author → reject** (the residual threat, also in 1.2);
  unsigned/agent-pushed → reject; expiry + future-date → reject; forged author without signature →
  reject; **keyring-missing → fail-closed (not skip→pass)**.

**Verification.** `python -m pytest tests/test_approvals_topology.py -q` green (skips without gpg).

**Commit message:** `test(approvals): T10 merge-topology + frontmatter-binding + valid-sig-wrong-author + fail-closed`

### HUMAN GATE 1.6 — Provision the protected `approvals` branch
- [ ] Create branch `approvals`; branch protection: **require PR**, **require signed commits**,
  **restrict merge to Daniel** (this is part of the human-vs-agent discriminator — **NOT deferred**;
  it is the third leg alongside the offline signature and the author-email allowlist).
- [ ] Leave **`enforce_admins` OFF** for now (deferred until per-agent identities — step 25 in the
  architecture / Wave-6 backlog).

### HUMAN GATE 1.7 — Import + pin `governance/web-flow.gpg`
- [ ] Import GitHub's web-flow key (fingerprint `968479A1AFF927E37D1A566BB5690EEEBB952194` plus prior
  published keys from `https://github.com/web-flow.gpg`) into `governance/web-flow.gpg`; commit on
  `main`. Note a key-rotation refresh checkpoint. (Trust anchor = a human decision.) The key's own
  UID is `GitHub <noreply@github.com>` — it proves *GitHub merged*, not *who* merged; the "who" is the
  merge-commit author-email checked against `humans.yaml` (1.2 step 3b).
- [ ] After this commits to `main`, this is the precondition that unblocks **0.5b**.

### HUMAN GATE 1.8 — `governance/humans.yaml`: GitHub logins + verified emails (agent PROPOSES)
- [ ] Agent proposes the patch: add Daniel's **GitHub-verified email(s)** (the address the web-flow
  merge commit is authored with — this is what 1.2 step 3b matches) and GitHub login(s); annotate the
  existing bare author names (`Daniel Zhang`, `danielzhang04`) as **advisory only** (no longer a trust
  input for the signed channel). **Daniel** commits it on `main`. Note: the current `humans.yaml`
  `humans:` list holds git-author *names*; the signed path needs *emails*, so this gate adds a new
  field (e.g. `emails:` / per-human `github_email:`) that 1.2 reads — the schema addition must be
  reflected in the 1.2 verifier.

### Task 1.9 — `routines/nightly.md` migration (LOCKSTEP with 1.2)  *(AGENT-BUILDABLE, same PR as 1.2)*
**Goal.** Keep the one production consumer correct. Step 4b currently calls
`approvals.py approved_by_human`; line 18–19 assert "the approval hash binds only the `## Work order`
prose, not frontmatter fields." Both are made stale by 1.2/1.1.

**Files touched:** `routines/nightly.md` (step 4b + the line-18/19 note).

**Failing test first:** extend `tests/test_nightly_routine.py` —
`test_routine_uses_new_verifier_and_hash_note`: assert step 4b references `verify_signed_approval`
(not `approved_by_human`) and that the hash note says the hash binds **action + target + work
order** (not "only the `## Work order` prose").

**Implementation.** Rewrite 4b: "verify with `approvals.py verify_signed_approval` (signed channel)
or `verify_telegram_approval` (possession channel per `assurance:`); treat any exception or False as
reject → wake-me, never proceed." Update the note: the hash binds `action`+`target`+work-order —
re-read all three as authoritative.

**Merge-to-ops (REQUIRED).** This prose is read by the cloud routine from its **`ops`** checkout.
After the 1.2/1.9 PR merges to `main`, merge `main → ops` (`git merge main --no-edit`, push `ops`)
**before** the next cloud run — otherwise the routine still executes the old step-4b prose calling
`approved_by_human`, which 1.2 has removed (it would error every night).

**Verification.** `tests/test_nightly_routine.py` green; must be in the **same PR** as 1.2; merged to
`ops` before the next cloud run.

**Commit message:** `fix(routine): migrate nightly 4b to verify_signed_approval + I3 hash note`

### HUMAN GATE 1.10 — Enforce the trust-anchor invariant on Claude envs (agent PROPOSES the doc note)
- [ ] **Daniel** audits every **Claude** agent environment (desktop runners, cloud routine) and
  confirms **no `Contents: write` / REST-API / PR-write GitHub token** is present in the env; desktop
  workers use SSH deploy keys; the cloud routine opens PRs via the claude.ai GitHub-App integration
  (platform-held credential, not a VM env token).
- [ ] Agent proposes the invariant text for `governance/security-rules.md` (include the PR-open
  consequence: no agent env runs `gh`/REST with a local token; cloud uses the App integration, desktop
  pushes-a-branch-and-delegates); **Daniel** commits it on `main`. Note the invariant is **re-audited
  for the Codex env at 5.8 and 5.9**.

**Wave-1 exit criterion (H-gate):** 1.1–1.10 merged to `main`/verified **before** any ops-push
credential is minted for a non-Claude agent (gates 5.9). At the exit, run **0.5b** (offline
signed-approval honoring) now that 1.6/1.7 exist.

---

# Wave 2 — Transport (Telegram: possession approvals + digests + wake-me) — DEPENDS ON 1.1–1.2

> Consumes `approval_payload`/`payload_hash` (1.1), `verify_telegram_approval()` + the `assurance:`
> field (1.2), and the per-tier PR-open opener (1.4). **Token custody = DESKTOP** (decision 2): the
> desktop interactive-poll cadence and desktop dispatcher own all Telegram I/O; the cloud tier holds
> no token and uses the signed GitHub-merge channel for PC-off. **Process-isolation invariant
> (decision 3):** the poller process that holds the bot token and mints possession approvals never
> ingests untrusted external web content in the same run — web research elsewhere in the fleet is
> unrestricted.

### Task 2.1 — `scripts/telegram_poll.py`  *(AGENT-BUILDABLE)*
**Goal.** Ingest taps and mint possession approvals, STOP-gated, idempotent.

**Files touched:** new `scripts/telegram_poll.py`; new `tests/test_telegram_poll.py`.

**Failing tests first** (all with a **fake Telegram transport** — no network):
- `test_from_id_allowlist_enforced`: a `callback_query` from a non-allowlisted `from.id` is rejected,
  no approval minted.
- `test_hash_prefix_verified_against_reread_card`: `callback_data` carries `card_id|decision|
  hash_prefix(8-hex)`; the poller re-reads the card, recomputes full `payload_hash`, and rejects on
  prefix mismatch (quarantines the card).
- `test_mints_possession_record`: valid tap → record with `assurance: possession` written to
  `queue/approvals/`, offset advanced.
- `test_stop_gated`: with `STOP` present, `poll()` performs no `getUpdates` and no mint.

**Implementation.** `poll(repo_root, transport, offset)`: preamble/STOP check first; `getUpdates
(offset)`; filter `callback_query`/`message`; verify `from.id ∈ humans.yaml telegram_id`; parse
`callback_data`; re-read card + verify full hash vs prefix; mint `assurance: possession` record;
`answerCallbackQuery` + `editMessageText`; advance offset (2.3). Transport is injected (real impl
reads the token from **Windows Credential Manager**, never as a repo object). Docstring states the
process-isolation invariant.

**Verification.** `python -m pytest tests/test_telegram_poll.py -q` green.

**Commit message:** `feat(telegram): possession-approval poller (allowlist + hash + STOP-gated)`

### Task 2.2 — `scripts/telegram_send.py`  *(AGENT-BUILDABLE)*
**Goal.** Outbound `sendMessage` + inline-keyboard helper.

**Files touched:** new `scripts/telegram_send.py`; `tests/test_telegram_send.py`.

**Failing tests first:** `test_inline_keyboard_callback_data_shape`
(`callback_data == f"{card_id}|{decision}|{hash_prefix}"`, ≤64 bytes); `test_send_uses_injected_transport`
(no real network in tests).

**Implementation.** `send(transport, chat_id, text, buttons=None)`; buttons build the callback_data
from `payload_hash(card)[:8]`. Token from Credential Manager in the real path.

**Verification.** unit tests green.

**Commit message:** `feat(telegram): send + inline-keyboard helper (64-byte callback_data)`

### Task 2.3 — git-native `update_id` cursor + dedicated approvals audit ledger  *(AGENT-BUILDABLE)*
**Goal.** Idempotency across stateless restarts; an audit trail that does **not** pollute the
integrity-relevant `ledgers/activity/**` stream.

**Files touched:** `scripts/ledger.py` (**add `"approvals"` to `KINDS`** — a script edit, agent-
editable, not governance); cursor file `ledgers/approvals/telegram-cursor` on `ops`; append to
`ledgers/approvals/<agent>-<date>.tsv` via `ledger.append(repo_root, "approvals", agent, record)`;
`tests/test_ledger.py` (extend for the new kind); `tests/test_telegram_poll.py`.

**Rationale (was MINOR).** The draft reused kind `activity` "to avoid a `KINDS` change", but
`ledger._shard` writes `activity` rows to `ledgers/activity/<agent>-<day>.tsv` — the exact stream
reconcile (3.2) cross-checks against grade rows and the exact stream the 0.4 carve-out excludes as
integrity-relevant. Injecting telegram-poll rows there would create false unmatched-row noise. A
dedicated `approvals` kind is the clean fix; `KINDS` lives in `scripts/ledger.py`, which agents may
edit. (The stated draft path `ledgers/approvals/telegram-<date>.tsv` was also inconsistent with
`_shard`'s `<agent>-<day>` naming — corrected to `<agent>-<date>`.)

**Failing tests first:** `test_approvals_kind_registered` (`ledger.append(..., "approvals", ...)`
writes under `ledgers/approvals/` and round-trips via `read_day`); `test_cursor_roundtrip`
(read/advance/persist), `test_offset_idempotent_across_restart` (replaying the same `update_id` batch
mints nothing new).

**Implementation.** Add `"approvals"` to `KINDS`; small read/write of the cursor int; audit row
`{ts, update_id, card_id, decision, from_id, result}`.

**Verification.** `python -m pytest tests/test_ledger.py tests/test_telegram_poll.py -q` green;
existing `activity`/`grades`/`dispatch`/`cost` ledger tests unchanged.

**Commit message:** `feat(telegram): dedicated approvals ledger kind + git-native update_id cursor`

### Task 2.4 — Notify-intent wiring + digest formatter  *(AGENT-BUILDABLE)*
**Goal.** One send path for: card → `approvals` (stage the signed PR via 1.4 **and** send a
possession prompt where admissible), wake-me trips, and the morning/mission-control digest. Consumes
the `assurance_class` that `promotion.decide()` emits (3.1) to draw the O9 cutline.

**Files touched:** new `scripts/notify.py`; hook from the dispatcher/nightly flow.

**Failing tests first:**
- `test_novel_T3_stages_signed_pr_no_possession_button`: a routed **first-ever/novel T3** card
  (`assurance_class == "T3-novel"` from `decide()`) stages a signed PR (via the 1.4 per-tier opener)
  and does **NOT** offer a possession button.
- `test_established_tier_offers_possession_button`: a T1/T2 (or `T3-established`) card offers the
  possession button.
- `test_digest_formats_from_dashboard` (digest text derives from `dashboards/executive.md`).

**Implementation.** `notify_pending(card, assurance_class)`: consult the `assurance_class` emitted by
`decide()` (O9 cutline — novelty is decided upstream in `promotion.decide()`, NOT recomputed here),
call `stage_approval.stage(...)` (1.4, with the tier-appropriate opener) and/or `telegram_send.send`
(2.2). `digest()` formats the brief.

**Verification.** unit tests green.

**Commit message:** `feat(notify): route approvals to signed/possession channels by assurance_class + digest`

### Task 2.5 — Rehearsal harness  *(AGENT-BUILDABLE)*
**Goal.** End-to-end (fake-transport) rehearsal of the invariants.

**Files touched:** `tests/test_telegram_rehearsal.py`.

**Tests:** STOP halts polling; offset idempotent across restarts; non-Daniel `from.id` rejected;
hash-mismatch quarantines the card (moves it out of the actionable path, writes a wake-me).

**Commit message:** `test(telegram): rehearsal — STOP, idempotency, allowlist, hash-mismatch quarantine`

### Task 2.6 — Desktop interactive-poll cadence (~2–5 min)  *(AGENT-BUILDABLE)*
**Goal.** The PC-on latency contract: a short-lived, offset-cursor, STOP-gated poll every ~2–5 min
via Task Scheduler, `--tier desktop`, sharing the **one** `getUpdates` offset with the desktop
dispatcher (one-poller-per-bot; cloud never polls concurrently).

**Files touched:** new `scripts/desktop_poll.ps1` (mirrors `desktop_dispatch.ps1`: pinned
interpreter, preamble gate, loud failure, reads token from Credential Manager); a cadence note in
`routines/` documenting the ~2–5 min schedule. Task Scheduler registration itself is HUMAN
(2.7/2.8-adjacent) — the script is agent-built.

**Failing test first:** `test_desktop_poll_script_shape` (assert the PS1 pins the interpreter, runs
preamble before polling, and never bare-`python`) — a prose/shape test like the existing routine tests.

**Verification.** shape test green; manual desktop dry-run under a STOP file confirms no-op.

**Commit message:** `feat(telegram): desktop interactive-poll wrapper (~2-5min, STOP-gated, offset-shared)`

### HUMAN GATE 2.7 — Create the bot (BotFather)
- [ ] @BotFather → create bot (mints the **bot token**); capture Daniel's Telegram `user_id`;
  `/setprivacy` on, disable group joins, restrict to the single private chat.

### HUMAN GATE 2.8 — Place the bot token in DESKTOP Credential Manager
- [ ] Store the bot token in **Windows Credential Manager** on the desktop (never in the repo). The
  desktop is the **sole poller** (one-poller-per-bot). **Do NOT** add `api.github.com` to any agent
  env (the online web-flow path is removed; PR-open uses the App integration / branch-delegate path)
  and **no `api.telegram.org` cloud allowlist** is needed (cloud holds no token). The desktop host
  obeys the process-isolation invariant.

### HUMAN GATE 2.9 — `governance/humans.yaml`: `telegram_id` allowlist (agent PROPOSES)
- [ ] Agent proposes the `telegram_id:` entry; **Daniel** commits it on `main`.

---

# Wave 3 — Grader + promotion loop (needs Wave-0 0.4 carve-out; prevention hardening = month-2+)

> Threat model is honest: v1 reconciliation detects **non-adversarial drift and buggy workers**, not
> a malicious/injected worker that assumes the `inspector@agents.local` identity. Interim integrity
> rests on: **T3 permanently capped** (human-token), **agent-generated task types default
> `queues-for-me`**, **standing-auth main-ref cross-check**, and the **trust-anchor invariant**. Real
> prevention (the `ledgers/grades/**` push ruleset, 3.9) is deferred behind per-agent GitHub
> identities.

### Task 3.1 — `scripts/promotion.py` (`status()` + `decide()`)  *(AGENT-BUILDABLE)*
**Goal.** Pure, recomputed promotion logic keyed on **`(worker, project, task_type, tier)`** (O7).
`decide()` also emits an **`assurance_class`** so downstream notify (2.4) never has to recompute
novelty.

**Files touched:** new `scripts/promotion.py`; `tests/test_promotion.py`.

**Failing tests first:**
- `test_status_bar_floor_window`: autonomous iff **not frozen** AND graded-run count ≥ window (T1 10
  / T2 20 / T3 40) AND none of last `window` below the tier pass-bar (T1 90 / T2 95 / T3 98) AND none
  below the demotion floor (T1 80 / T2 90 / T3 any-fail; below-floor resets the counter).
- `test_T3_capped`: even when the bar is met, `decide()` returns **`queues-for-me (fast-lane)`** —
  T3 never acts alone (risk-tiers.md binding). "Fast-lane" = possession-channel-eligible, not
  autonomous.
- `test_T3_novel_is_signed_only` **(O9 owner — NEW):** a `(worker,project,task_type,T3)` key with
  **no prior grades/approvals** → `decide()` returns `assurance_class == "T3-novel"` (signed channel
  only, **no** possession button). An established T3 key → `assurance_class == "T3-established"`
  (fast-lane/possession-eligible). This makes novelty a declared **output of `decide()`**, not an
  ambiguous responsibility of notify.
- `test_frozen_forces_queues_for_me`: FROZEN present → `queues-for-me` regardless of grades.
- `test_standing_auth_requires_main_ref` (D4 cross-check): the standing-auth branch grants
  acts-alone **only if** the exact cadence block is present on the **`main`** ref
  (`git show main:<heartbeat-path>` contains it); a cadence present only in the `ops` tree does **not**
  grant acts-alone.
- `test_decide_precedence`: FROZEN → queues-for-me; else standing-authorized (carve-out or verified
  main-ref cadence) → acts-alone (T1/T2)/fast-lane (T3); else status==autonomous →
  acts-alone/fast-lane; else queues-for-me (v1 default).

**Implementation.** `status(worker, project, task_type, tier, grades_rows, frozen) -> str`;
`decide(cadence, repo_root, ...) -> {autonomy, assurance_class}` where `assurance_class ∈
{"acts-alone", "possession-eligible", "T3-novel", "T3-established", "signed-only"}` (name the set
precisely in code). Novelty = no prior rows for the key in the grades ledger AND no prior approval
record. Reads the grades ledger (3.3), `ledgers/grades/FROZEN`, `governance/graders.yaml`. The
standing-auth branch shells `git show main:<path>` and requires an exact block match (never trusts the
ops working tree).

**Verification.** `python -m pytest tests/test_promotion.py -q` green.

**Commit message:** `feat(promotion): pure status()/decide() with T3-cap, freeze, main-ref standing-auth, assurance_class`

### Task 3.2 — `scripts/reconcile.py` (desktop-tier only)  *(AGENT-BUILDABLE)*
**Goal.** Weekly cross-check of grade rows against the **Inspector-authored** `ledgers/activity/`
commits; FROZEN writer; quarantine report; wake-me emitter. Desktop-pinned (author cross-check is
meaningless in the cloud tier where every commit is Daniel's identity).

**Files touched:** new `scripts/reconcile.py`; `tests/test_reconcile.py`.

**Failing tests first:** `test_clean_pairs_no_freeze`; `test_fabricated_grade_no_activity_freezes`
(unmatched grade row → writes FROZEN + wake-me); `test_wrong_grader_identity_freezes`;
`test_ignores_non_inspector_activity_rows` (activity rows authored by other identities — e.g. the
Telegram poller wrote to the separate `approvals` kind, but any legacy/other `activity` rows — are
**not** treated as grade evidence: reconcile keys only on Inspector-authored rows, so unrelated
activity does not create false matches or noise); `test_reasserts_frozen_if_sentinel_cleared_without_record`
(sentinel deletion without an authenticated clear-record → re-assert FROZEN + wake-me).

**Implementation.** Reuse the approvals pickaxe/`git log` machinery to attribute grade-row commits;
cross-check against **Inspector-identity** activity rows only (`inspector_id`/`inspector@agents.local`);
write `ledgers/grades/FROZEN` (placed on the protected `approvals`/`grades` ref where feasible —
1.6-adjacent); emit a wake-me card. Guard: refuse to run unless invoked `--tier desktop`.

**Verification.** `python -m pytest tests/test_reconcile.py -q` green.

**Commit message:** `feat(reconcile): weekly grades↔inspector-activity cross-check, FROZEN + wake-me (desktop-only)`

### Task 3.3 — `scripts/grade.py` + pinned grade-row schema  *(AGENT-BUILDABLE)*
**Goal.** Pin the grade-row shape and write paired grade + activity rows.

**Files touched:** new `scripts/grade.py` (or a documented `ledger.append(...,"grades",...)`
convention); `tests/test_grade.py`.

**Failing test first:** `test_grade_row_schema` — a written row has exactly
`{worker, project, task_type, tier, card_id, score(0–100), pass(bool), rubric_version,
inspector_id, ts}` and a **paired** `ledgers/activity/` row (authored under the Inspector identity) is
appended in the same call.

**Implementation.** `record_grade(repo_root, **fields)` validates the schema, appends to
`ledgers/grades/` and `ledgers/activity/` via `ledger.append`.

**Verification.** unit test green.

**Commit message:** `feat(grade): pinned grade-row schema + paired activity append`

### Task 3.4 — `dispatch.py`: wire `promotion.decide()` + `autonomy:` routing  *(AGENT-BUILDABLE)*
**Goal.** Per cadence, call `promotion.decide()`, stamp an `autonomy:` field (and carry
`assurance_class` for notify), route acts-alone → `inbox/` and queues-for-me → `approvals/`.

**Files touched:** `scripts/dispatch.py` (in `run()`, after building each card at lines ~73–84);
`tests/test_dispatch.py`.

**Failing tests first** (extend `tests/test_dispatch.py`):
- `test_acts_alone_routes_to_inbox` / `test_queues_for_me_routes_to_approvals`.
- `test_carveout_excludes_grades_and_activity`: a **`nightly-review`** cadence whose run would write
  under `ledgers/grades/**` or `ledgers/activity/**` **voids** the carve-out → queues-for-me. (Named
  for the real cadence, not the non-existent `dashboard-regen`.)
- `test_carveout_allows_own_card_and_dispatch_ledger`: a `nightly-review` cadence that writes only
  within the 0.4 allow-list (`dashboards/**`, own memory shard, `ledgers/dispatch/**`, own-card
  `queue/` transition) **keeps** acts-alone. (Guards against a too-tight carve-out that self-voids.)
- `test_frozen_forces_queue` (integration with a FROZEN sentinel).

**Implementation.** After `cards.new_card(...)`, compute `decide(cadence, repo_root, today,...)`; set
`card.meta["autonomy"]` and `card.meta["assurance_class"]`; choose the target state (`inbox` vs
`approvals`) before `cards.save`. Keep existing dispatch tests green (the current `run()` signature
and idempotency behavior stay intact).

**Verification.** `python -m pytest tests/test_dispatch.py -q` green (old + new).

**Commit message:** `feat(dispatch): route by promotion.decide(); stamp autonomy/assurance; enforce nightly-review carve-out scope`

### Task 3.5 — Inspector skill/role doc  *(AGENT-BUILDABLE)*
**Goal.** A fresh-context grader skill under `skills/curated/` that emits a grade row + activity row
against an explicit rubric (correctness, scope-adherence, evidence-quality, safety/constraint-
compliance; bars per `risk-tiers.md`).

**Files touched:** `skills/curated/inspector/SKILL.md` (+ references); must pass
`scripts/scan_skill.py` + human read-through. **Mirroring to `.claude/skills` / `.codex` is via the
manual `python scripts/sync_skills.py` run (or caught read-only by the nightly `sync_skills --check`)
— there is no pre-commit hook in this repo.**

**Failing/verification tests:** `python scripts/scan_skill.py skills/curated/inspector` → 0 findings;
`python scripts/sync_skills.py --check` → clean after an explicit `python scripts/sync_skills.py`.

**Commit message:** `feat(inspector): fresh-context grader skill + rubric (scan-clean)`

### Task 3.6 — Consolidated grader tests  *(AGENT-BUILDABLE)*
**Goal.** Ensure the D5 tier-partition + carve-out + freeze invariants are all covered (some land in
3.1/3.2/3.4; this task closes gaps).

**Files touched:** `tests/test_dispatch.py`, `tests/test_promotion.py`, `tests/test_reconcile.py`.

**Tests to guarantee present:** bar/floor/window/T3-cap/T3-novel-signed-only/freeze/standing-auth
main-ref cross-check (promotion); clean/fabricated/wrong-grader/missing-activity/non-inspector-rows →
correct FROZEN behavior (reconcile); acts-alone→inbox, queues→approvals, carve-out
excludes-grades/activity + allows-own-card, frozen, and **unknown-tier → skip + wake-me / no cadence
claimable by both dispatchers** (dispatch tier-partition, D5 #10).

**Implementation note (dispatch tier-partition, D5).** Add to `dispatch.run()` a fail-closed rule: a
cadence whose `tier` is missing/invalid/unknown is **not** scheduled by either dispatcher and raises
a wake-me card. Assert no cadence is claimable by both `cloud` and `desktop`.

**Commit message:** `test(grader): tier-partition, carve-out exclusion, freeze, standing-auth, T3-novel suite`

### HUMAN GATE 3.7 — `governance/graders.yaml` (agent PROPOSES)
- [ ] Agent proposes the grader allowlist (`inspector`); **Daniel** commits it on `main`.

### Task 3.8 — Inspector git identity config (desktop tier)  *(AGENT-BUILDABLE — git config only, no token)*
**Goal.** Configure `inspector@agents.local` as a distinct git author on the desktop tier (the only
place a distinct git author is a grade-integrity signal; cloud commits all carry Daniel's identity).

**Files touched:** a documented `git config` step in the desktop runner / a `routines/roles/inspector.md`
note (no credential handled).

**Verification.** `git config user.email` in the inspector worktree resolves to `inspector@agents.local`.

**Commit message:** `chore(inspector): desktop git identity config (inspector@agents.local)`

### HUMAN GATE 3.9 — Push ruleset on `ledgers/grades/**` — DEFERRED (month-2+)
- [ ] The only real prevention of grade tampering; requires per-agent GitHub identities. Recorded as
  the prerequisite for trusting autonomous grade-driven promotion. Not built in month 1.

### Task 3.10 — Weekly `grades-reconcile` cadence (agent DRAFTS; human commits on `main`)  *(AGENT-BUILDABLE draft)*
**Goal.** Without a scheduled reconcile, the whole detection model is inert.

**Files touched:** root `HEARTBEAT.md` cadence block (human-committed on `main` to earn standing
authorization); agent drafts the exact YAML in the PR body.

**Cadence:** `name: grades-reconcile`, `schedule: weekly:sat`, `tier: desktop`, `risk-tier: T1`,
prompt runs `python scripts/reconcile.py --tier desktop` and confirms it emits FROZEN + wake-me on
unmatched rows.

**Verification.** After Daniel commits, a `dispatch.run(..., "desktop", ...)` on a Saturday emits the
cadence card (covered by a dispatch test using a fixture HEARTBEAT).

**Commit message (agent draft note):** `docs(proposal): grades-reconcile weekly:desktop cadence`

---

# Wave 4 — Role model + DAG + ≥3 project scaffolds (faceless dropped per decision 4)

> Roles are card **stages + prompt templates**, never schedulers. `dispatch.py` stays the only clock.
> The keystone gap is the `depends-on` DAG release. ≥3 projects = faceless-youtube (idle, untouched)
> + kb-ops + atlas-prep; roles are exercised on **kb-ops and atlas-prep only**.

### Task 4.1 — `dispatch.py`: `depends-on` release logic (DAG keystone)  *(AGENT-BUILDABLE)*
**Goal.** Release a child card only when all its `depends-on` cards are `done`, threading their
`## Result` into the child's input.

**Files touched:** `scripts/dispatch.py`; `tests/test_dispatch.py`.

**Failing tests first:** `test_child_blocked_until_deps_done` (child stays `blocked`/unreleased while
a dep is not `done`); `test_child_released_with_results_threaded` (once all deps `done`, child moves
to `inbox` and its body contains the deps' `## Result` text).

**Implementation.** Add a release pass over `queue/` cards with non-empty `depends-on`: check each
dep card's state in `queue/done/`; when all `done`, read their `## Result` (via `cards.parse` +
`work_order_of`-style section extraction) and thread into the child body, then transition
`blocked → inbox`. Keep existing dispatch behavior intact.

**Verification.** `python -m pytest tests/test_dispatch.py -q` green.

**Commit message:** `feat(dispatch): depends-on DAG release with Result threading`

### Task 4.2 — `dispatch.py`: emit role-tagged cards + main-ref standing-auth  *(AGENT-BUILDABLE)*
**Goal.** Per-cadence `role:` default `work` + optional auto `inspect` sibling; set card `role` +
role-identity `owner`; honor a standing-auth cadence **only if present on the `main` ref** (D4).

**Files touched:** `scripts/dispatch.py`; `tests/test_dispatch.py`.

**Failing tests first:** `test_cadence_emits_work_and_inspect_sibling` (a cadence with
`inspect: true` emits a paired `role: inspect` card depending on the work card);
`test_standing_auth_only_from_main_ref` (mirrors 3.1's cross-check at the dispatch level).

**Implementation.** Extend the card-build block (dispatch.py lines ~73–84) to read `cadence.get
("role","work")` and optionally emit an inspect sibling with `depends-on: [work-card-id]`.

**Verification.** dispatch tests green.

**Commit message:** `feat(dispatch): role-tagged cards + auto inspect sibling + main-ref standing-auth`

### Task 4.3 — `routines/roles/{scout,manager,worker,inspector}.md` prompt templates  *(AGENT-BUILDABLE)*
**Goal.** Four prompt templates the executor adopts per card, each with its model tier, read/write
scope, identity, mandate.

**Files touched:** `routines/roles/scout.md`, `manager.md`, `worker.md`, `inspector.md`.

**Failing/verification test:** `test_role_templates_present_and_scoped` — each file exists and
declares a model tier + a read/write scope line (prose-contract test).

**Content.** Scout=Haiku read-only, findings → inert `## Evidence`; Manager=Opus writes real work
orders + sets action/target/risk-tier; Worker=Sonnet/Codex executes on an agent branch;
Inspector=Opus fresh-context grades against the 3.5 rubric.

**Merge-to-ops note.** If any role template is read by a cloud routine at runtime, merge `main → ops`
after this PR merges (same rule as `routines/nightly.md`). Desktop picks these up via `git merge main`.

**Commit message:** `feat(roles): scout/manager/worker/inspector prompt templates`

### Task 4.4 — `cards.py`: `role` enum validation  *(AGENT-BUILDABLE)*
**Goal.** Fold in the deferred minor: validate `role ∈ {scout, manage, work, inspect, consolidate}`.

**Files touched:** `scripts/cards.py` (add `ROLES` tuple + a check in `_validate`);
`tests/test_cards.py`.

**Failing tests first:** `test_invalid_role_rejected` (an unknown role raises `ValidationError`);
`test_default_role_is_work` (unchanged default). Note: `new_card` currently defaults `role: "work"`
(line 60) and `card-schema.md` currently lists only `work|consolidate` — the enum broadens with the
4.7 schema patch.

**Implementation.** `ROLES = ("scout","manage","work","inspect","consolidate")`; in `_validate`, if
`meta.get("role")` set and not in `ROLES` → raise. Keep all existing card tests green.

**Verification.** `python -m pytest tests/test_cards.py -q` green.

**Commit message:** `feat(cards): validate role enum (scout|manage|work|inspect|consolidate)`

### Task 4.5 — Scaffold `orgs/kb-ops/` + `orgs/atlas-prep/`  *(AGENT-BUILDABLE)*
**Goal.** Two new projects via `new_project.py`, with conservative HEARTBEAT cadences (each with an
explicit `tier`) + contracts. kb-ops first (fastest safe path to the first real T1 grades →
bootstraps the grade ledger); atlas-prep exercises a large-context research worker + the T2 bar.

**Files touched:** run `python scripts/new_project.py kb-ops` and `... atlas-prep`; then edit the
generated `orgs/kb-ops/HEARTBEAT.md` + `contract.md` and `orgs/atlas-prep/HEARTBEAT.md` +
`contract.md`. `_index.md` registration is automatic (new_project.py lines 30–34).

**Failing/verification test:** `test_new_projects_scaffolded` — after `create`, both
`orgs/kb-ops/HEARTBEAT.md` and `orgs/atlas-prep/HEARTBEAT.md` exist and **each declares ≥1 cadence,
every one with a `tier`** (the template ships `cadences: []`, so a bare "every cadence has a tier"
assertion passes vacuously even if the agent forgot to add the intended cadences — assert **≥1 tiered
cadence per project**, fail-closed with D5). Cadences: kb-ops T1 desktop self-ops (e.g.
lint/report/dashboard); atlas-prep T2 cloud research-deliverable stopping at a human gate. **No
content-producing or publishing cadence, no external side effect.**

**Note.** Do **not** touch `orgs/faceless-youtube` (decision 4). It counts as the third project by
existing idly.

**Commit message:** `feat(projects): scaffold kb-ops + atlas-prep with ≥1 tiered conservative cadence each`

### HUMAN GATE 4.7 — `governance/card-schema.md`: extend the `role` enum (agent PROPOSES)
- [ ] Agent proposes broadening line-26 `role: work|consolidate` → `scout|manage|work|inspect|
  consolidate`; **Daniel** commits it on `main` (must land with/just before 4.4 so schema and
  validator agree).

---

# Wave 5 — Non-Claude worker onboarding: **Codex only** (Gemini deferred, decision 1) — HARD-GATED behind Wave 1

> The `sync_skills` adapter *pattern* and `one-off-agent.md` stay generic so any future CLI (incl.
> Gemini) can join by filling the template. All Gemini-specific build items are dropped. Codex
> Phase-B ops-push (5.9) is gated behind the Wave-1 exit. **The trust-anchor invariant (ordering-law
> 4) is re-audited for the new Codex env at 5.8 and 5.9** — it did not exist at the 1.10 audit.

### HUMAN GATE 5.0 — Verify Codex tool behavior
- [ ] Confirm against current tool docs, **before** the credential steps: **(a)** `codex exec` runs
  headless honoring ChatGPT-subscription auth in `~/.codex/auth.json` non-interactively (the whole
  Codex leg depends on this); **(b)** `codex login --device-auth` exists. (Gemini/Antigravity checks
  dropped.) These are post-cutoff facts a doc edit cannot confirm.

### Task 5.1 — `sync_skills.py`: `render_codex()` adapter (pattern kept generic)  *(AGENT-BUILDABLE)*
**Goal.** Deterministically render `skills/curated/*` → `.codex/skills-catalog.md` under the same
authoritative-sync + SHA-256 drift-guard model as `.claude/skills`. Keep the adapter dispatch generic
(a `RENDERERS` map) so `render_gemini` can be added later without restructuring — but **only**
`render_codex` ships now.

**Files touched:** `scripts/sync_skills.py` (add `render_codex(repo_root)`, fold its output hash into
`MANIFEST.json` / a codex manifest); `tests/test_sync_skills.py`.

**Failing tests first:** `test_render_codex_writes_catalog` (`.codex/skills-catalog.md` exists,
lists curated skills); `test_codex_catalog_drift_detected` (tampering the catalog is caught by
`check()`); keep existing `.claude/skills` sync tests green.

**Implementation.** A `render_codex` that writes a deterministic catalog + records its SHA-256; extend
`check()` to include the codex catalog. Do not add Gemini.

**Verification.** `python -m pytest tests/test_sync_skills.py -q` green; `--check` clean after sync.

**Commit message:** `feat(sync): render_codex skills catalog under drift-guard (generic renderer map)`

### Task 5.2 — `dispatch.py`: optional `agent:` cadence key  *(AGENT-BUILDABLE)*
**Goal.** A cadence may name a worker `agent:`; the dispatcher writes it into the card `owner` via
`cards.claim(card, agent)` (backward-compatible — absent `agent:` keeps current dispatcher-owner).

**Files touched:** `scripts/dispatch.py` (the `cards.claim(card, agent_id)` call at line 80);
`tests/test_dispatch.py`.

**Failing tests first:** `test_agent_key_sets_owner` (cadence with `agent: codex-worker` → card
`owner == "codex-worker"`); `test_absent_agent_key_keeps_dispatcher_owner` (regression).

**Implementation.** `owner = cadence.get("agent", agent_id)`; claim with it.

**Verification.** dispatch tests green.

**Commit message:** `feat(dispatch): optional agent: cadence key routes card ownership`

### Task 5.3 — `scripts/agent_runner.ps1` (Codex worker)  *(AGENT-BUILDABLE)*
**Goal.** A preamble-gated Task-Scheduler runner mirroring `desktop_dispatch.ps1`, for
`-Agent codex-worker`. **Codex billing guard is enforceable**; **fails loud (wake-me) on stale auth,
never falls back to the metered API** (O8, decision 5).

**Files touched:** new `scripts/agent_runner.ps1`; a shape test in `tests/` (prose/shape).

**Failing/verification test:** `test_agent_runner_shape` — the PS1 (1) pins the interpreter (never
bare `python`), (2) runs preamble before any `codex exec`, (3) asserts `OPENAI_API_KEY` **and**
`CODEX_API_KEY` are **unset** and `~/.codex/auth.json` present, (4) on stale/missing auth writes a
wake-me and exits loud (no metered fallback), (5) re-checks STOP between cards.

**Implementation.** Resolve interpreter once; checkout/pull `ops`; preamble; billing guard; scan
owned cards; `codex exec -` per card; write `## Result` on a `codex/*` branch; log the model id from
`--json` to `ledgers/cost/`; re-check STOP between cards. No Gemini branch. **Git access is
git-transport only** (SSH deploy key; no REST/`Contents: write` token — re-audited at 5.8/5.9).

**Commit message:** `feat(runner): codex worker runner — billing guard, loud-on-stale-auth, STOP-gated`

### Task 5.4 — `.codex/config.toml`  *(AGENT-BUILDABLE)*
**Goal.** Workspace-write, conservative approval, network off by default, secret-path deny-rules.
(`.gemini/settings` dropped.)

**Files touched:** `.codex/config.toml`.

**Verification.** A shape test asserts workspace-write + deny-rules on the credential-store paths.

**Commit message:** `feat(codex): conservative config.toml (workspace-write, secret deny-rules)`

### Task 5.5 — `docs/onboarding/one-off-agent.md` (generic)  *(AGENT-BUILDABLE)*
**Goal.** A reusable onboarding checklist (SSH deploy key + push-ruleset pattern) written **generically**
so Gemini or any future CLI can join by filling it in — explicitly note Gemini is deferred but the
path is the same. **Include the trust-anchor invariant** (git-transport only; no REST/PR-write token
in the agent env) as a mandatory onboarding line.

**Files touched:** `docs/onboarding/one-off-agent.md`.

**Verification.** Human read-through; a link from `_index.md` (optional).

**Commit message:** `docs(onboarding): generic one-off-agent checklist (deploy key + push ruleset + invariant)`

### Task 5.6 — Adapter/runner tests  *(AGENT-BUILDABLE)*
**Goal.** Close coverage: dispatch routing (`agent:`), sync drift including the new codex catalog,
and **preamble-gate → no CLI invocation** (a STOP/preamble failure must mean `codex exec` never runs).

**Files touched:** `tests/test_sync_skills.py`, `tests/test_dispatch.py`, a runner-gate test.

**Commit message:** `test(codex): adapter routing + catalog drift + preamble-gate-no-invoke`

### HUMAN GATE 5.7 — Install + first-login Codex
- [ ] On desktop: `codex login --device-auth` (ChatGPT subscription). Do **not** set
  `OPENAI_API_KEY`/`CODEX_API_KEY`. (No Gemini key creation — deferred.)

### HUMAN GATE 5.8 — Phase A worker git access (SSH deploy key + push ruleset) + INVARIANT RE-AUDIT
- [ ] Provision an **SSH read/write deploy key** on `kb` for the desktop workers (git-transport only
  — **NOT** a `Contents: write` PAT, per the trust-anchor invariant).
- [ ] Provision a **GitHub push ruleset** that blocks direct pushes to `ops` and `main` (require-PR)
  — the key scope alone does not restrict by branch prefix.
- [ ] Store the key via SSH agent / credential helper (never as an object); add a deny-rule on the
  credential-store path; audit it. Phase A = read + own-work-branch (`codex/*`) push only; no
  ops-write credential.
- [ ] **INVARIANT RE-AUDIT (ordering-law 4, mirrors 1.10 for the new env):** confirm the
  `codex-worker` desktop environment holds **no `Contents: write` / REST-API / PR-write GitHub
  token** — git-transport SSH deploy key only. Record the audit result. (The Codex env did not exist
  at the 1.10 audit; this is its first invariant check.)

### HUMAN GATE 5.9 — Phase B ops-push (ONLY after Wave 1 on `main`) + INVARIANT RE-AUDIT
- [ ] After step 1.2/1.9 merged to `main` (and Wave-1 exit reached, incl. 0.5b): grant the scoped
  **ops-push** deploy-key path (still git-transport only); register `codex-worker` in the governance
  identity list; keep its task types `queues-for-me` until grades promote. (Still owner-account-scoped;
  true per-agent GitHub identity = month-2+.)
- [ ] **INVARIANT RE-AUDIT (ordering-law 4):** re-confirm the ops-push grant did **not** introduce a
  `Contents: write` / REST / PR-write token into the `codex-worker` env — the grant is a scoped
  git-transport deploy-key path only. Record the audit result; reference it from the Wave-5 exit.

### HUMAN GATE 5.10 — Register the Codex Task Scheduler task
- [ ] Register `kb-codex-runner` (Disabled until Phase A go-live). (No `kb-gemini-runner` — deferred.)

### HUMAN GATE 5.11 — Governance note: Gemini deferred (agent PROPOSES one line)
- [ ] Agent proposes a one-line note for `governance/security-rules.md` (or the spec): **"Gemini is
  deferred for month 1 on privacy grounds — its free tier trains on submitted data; the month-1
  non-Claude worker is Codex CLI only. The adapter pattern remains generic for a future capped/paid
  or privacy-cleared Gemini path."** **Daniel** commits it on `main`.

---

# Wave 6 — Session steering (optional, low priority)

### HUMAN GATE 6.1 — Omnara or Happy (optional)
- [ ] Optionally install/auth **Omnara** or **Happy** for phone launch/steer of the desktop tier
  (both $0/open-source; Omnara's default relay is SaaS — self-host if boundary-adjacent). Kept
  strictly for live session steering, **never** as an approval carrier.

---

## Month-1 exit criteria

The month is done when all of the following hold:
1. **Cloud-only cycle proven** — split into the two gates that actually exist:
   - **(1a, Wave 0 / 0.5a):** a Run-now cloud dispatch produced a cloud-authored `ops` commit,
     regenerated today-dated dashboards, a `done/` cadence card, with the desktop task Disabled, and
     the `nightly-review` carve-out **acted alone** (card to `done/`, no write outside the 0.4
     allow-list).
   - **(1b, Wave-1 exit / 0.5b):** a post-1.7 re-run verified **one signed approval offline** against
     the pinned keyring (or "approval-honoring is desktop-only" recorded).
2. **Approval boundary hardened on `main`** (Wave 1): `approvals.py` verifies signed-ref approvals
   offline via the pinned keyring using the **two-part identity check** (valid web-flow signature AND
   merge-commit author-email ∈ `humans.yaml`), fails closed on a missing keyring, has no
   online/author-trust path, binds `action`+`target` into the hash, exposes `verify_signed_approval`
   + `verify_telegram_approval`; `approved_by_human` and its test are removed; `routines/nightly.md`
   4b migrated in the same PR **and merged to `ops`**; the protected `approvals` branch requires PR +
   signed commits + restrict-merge-to-Daniel; the trust-anchor invariant is audited (1.10) and
   recorded.
3. **Phone transport live** (Wave 2): a Telegram tap from Daniel's allowlisted `from.id` mints a
   `possession` approval (desktop custody, STOP-gated, offset-idempotent) into a dedicated `approvals`
   ledger kind, digests/wake-me send outbound, and the signed GitHub-merge channel is the PC-off path
   for novel/first-time T3 (`assurance_class == "T3-novel"` → no possession button).
4. **Grader → promotion loop closed** (Wave 3): the Inspector emits schema-pinned grade+activity
   rows; `promotion.decide()` (keyed on worker/project/task_type/tier, T3 capped, T3-novel signed-only
   via `assurance_class`, freeze-aware, main-ref standing-auth) routes cards; `reconcile.py` runs on
   the weekly desktop `grades-reconcile` cadence, keys only on Inspector-authored activity rows, and
   freezes on unmatched rows. (Prevention via `ledgers/grades/**` ruleset explicitly deferred.)
5. **Roles + DAG + ≥3 projects** (Wave 4): the `depends-on` DAG releases children with threaded
   Results; role templates exist; `kb-ops` and `atlas-prep` are scaffolded with **≥1 tiered cadence
   each** and are producing the first real T1/T2 grades; faceless-youtube remains idle/untouched
   (third project).
6. **Codex onboarded behind the boundary** (Wave 5): `render_codex` catalog is drift-guarded; the
   `agent:` key routes cards to `codex-worker`; the runner enforces the billing guard and fails loud
   on stale auth; Phase B ops-push is granted only post-Wave-1; the trust-anchor invariant is
   re-audited for the Codex env at 5.8 and 5.9; Gemini is documented as deferred.
7. **All tests green:** `python -m pytest tests -q` passes (gpg-dependent signing tests **skip**, not
   error, on a box without gpg; fixture-based approvals tests still run), including the new
   approvals-topology, telegram, promotion, reconcile, grade, ledger-approvals-kind, and
   dispatch-partition suites.

**Explicitly NOT in month-1 exit** (carried from architecture §5): per-agent GitHub *account*
identities; grade-tamper *prevention* (ruleset); cryptographic STOP/FROZEN; T3 autonomous execution;
low-latency PC-off possession approvals; any Gemini path; any content-producing/publishing faceless
cadence; `enforce_admins on`.

---

## Build-session execution order (parallel-in-worktrees vs strictly serial)

**Strictly serial spine (do in this order; each gates the next):**
- **Wave 0** (0.1→0.2→0.3→0.4→0.5a) is a serial chain: the carve-out (0.4) MUST precede the Run-now
  proof (0.5a). 0.3 (agent) can be written any time but its value is realized at 0.5a, and its prose
  must be merged `main → ops` before the Run-now. **0.5b is deferred to the Wave-1 exit** (it needs
  1.6/1.7).
- **Wave 1** is the gate for Waves 3–5 ops access. Within Wave 1, **1.1 → 1.2 → 1.9 are one serial
  unit in one PR** (payload before verifier; verifier + routine migrate together, then `main → ops`).
  1.3 feeds 1.2 (do 1.3 concurrently, merge before/with 1.2). 1.4 depends on 1.1 (+ the 0.1 PR-open
  transport confirmation). 1.5 depends on 1.2–1.4. HUMAN GATES 1.6/1.7/1.8/1.10 must all be done
  before the Wave-1 exit but can proceed in parallel with agent coding. **At the Wave-1 exit, run
  0.5b.**
- **Wave-1 exit → Phase B (5.9)** is a hard serial gate.

**Safe to parallelize in separate worktrees (independent file sets, no shared-function edits):**
- **Wave 1 agent tasks split into two worktrees:** worktree A = 1.1+1.2+1.3+1.9 (`approvals.py`,
  `nightly.md`); worktree B = 1.4+1.5 (`stage_approval.py`, topology tests). B consumes A's
  `payload_hash` signature — agree the signature first, then both proceed; B's tests turn green after
  A merges.
- **Wave 2 and Wave 3 are independent of each other** and can run in parallel worktrees once Wave 1's
  1.1–1.2 are merged (Wave 2 depends on them; Wave 3 depends only on Wave-0 0.4). Within Wave 2,
  2.1/2.2/2.3 are independent files (parallel — 2.3 also touches `ledger.py` KINDS, a one-line
  additive edit), 2.4 depends on 2.1+2.2+1.4 **and 3.1's `assurance_class`** (so 2.4 lands after 3.1;
  if Wave 2 runs strictly before Wave 3, gate 2.4 on 3.1 or stub the class), 2.5/2.6 are last.
  Within Wave 3, 3.1/3.2/3.3/3.5 are independent files (parallel); 3.4 depends on 3.1+3.3; 3.6
  depends on 3.1–3.4.
- **Wave 4 shares `dispatch.py` with Wave 3 (3.4) and Wave 5 (5.2)** — serialize all `dispatch.py`
  edits through **one** worktree to avoid churn: land them in the order **3.4 → 4.1 → 4.2 → 5.2**
  (each is an additive edit to `run()`; re-run `tests/test_dispatch.py` after each). Wave-4's
  non-dispatch tasks (4.3 role templates, 4.5 scaffolds) parallelize freely; 4.4 (`cards.py`) is
  independent but must land with/just after the 4.7 schema patch.
- **Wave 5 non-dispatch tasks** (5.1 sync, 5.3 runner, 5.4 config, 5.5 docs) parallelize; 5.2
  (`dispatch.py`) joins the serialized dispatch queue above; 5.6 tests last.
- **Wave 6** is fully orthogonal and optional — any time.

**Recommended session batching:** Session 1 = Wave 0 (serial, through 0.5a) + start Wave 1 worktree A.
Session 2 = finish Wave 1 (A+B), do all Wave-1 HUMAN GATES, **run 0.5b**, hit the Wave-1 exit.
Session 3 = Wave 2 ∥ Wave 3 in two worktrees (dispatch edits serialized; 2.4 gated on 3.1's
`assurance_class`). Session 4 = Wave 4 (dispatch edits continue the serialized queue) + Wave 5 agent
tasks. Session 5 = Wave 5 HUMAN GATES (Phase A + invariant re-audit, then Phase B post-Wave-1 +
re-audit) + Codex go-live. Wave 6 whenever.
