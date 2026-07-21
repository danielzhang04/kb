"""Task 1.4 — dispatcher approval-PR pre-staging helper.

`stage_approval.stage(card_path, repo_root, opener, runner=...)` writes the
`approvals/<card-id>.yaml` record (with the pre-computed I3 `payload_hash`,
`assurance: signed`, `expires`), commits it on branch `approval/<card-id>`, and
then invokes an INJECTED `opener` callable (the per-tier PR-open transport).

Ordering-law 4: the helper NEVER merges and NEVER hard-codes a transport. All
git goes through an injectable `runner` so these tests are fully hermetic — no
network, no real tokens, no real repository state required.
"""
import functools

import approvals
import cards
import stage_approval


class FakeRunner:
    """Records every git invocation; performs no real git/network I/O."""

    def __init__(self):
        self.calls = []

    def __call__(self, args, cwd=None):
        self.calls.append(list(args))
        return None


def _make_card(tmp_path, action="deploy", target="svc-a"):
    repo = tmp_path / "repo"
    (repo / "queue" / "inbox").mkdir(parents=True)
    body = "## Work order\ndo the approved thing\n"
    card = cards.new_card("proj", action, target, "T3", body=body)
    path = cards.save(card, repo / "queue")
    return repo, card, path


def test_stage_writes_record_as_full_card(tmp_path):
    # The record is the FULL CARD the verifier parses + re-hashes, at
    # queue/approvals/<id>.md (cards.STATE_DIR['approved']) — not a flat YAML dict.
    repo, card, path = _make_card(tmp_path)
    runner = FakeRunner()
    ref = stage_approval.stage(path, repo, opener=lambda b, r, run: "pr-ref", runner=runner)
    assert ref == "pr-ref"

    record_path = repo / "queue" / "approvals" / f"{card.meta['id']}.md"
    assert record_path.exists()
    staged = cards.parse(record_path)                     # must parse as a card
    assert staged.meta["state"] == "approved"
    assert staged.meta["assurance"] == "signed"
    # approval == payload_hash recomputed over the SAME record the verifier reads,
    # and over the original card (action+target+work-order are carried unchanged).
    assert staged.meta["approval"] == approvals.payload_hash(staged)
    assert staged.meta["approval"] == approvals.payload_hash(card)
    assert staged.meta.get("expires")
    assert "## Work order" in staged.body                 # body preserved for re-hash


def test_stage_never_merges(tmp_path):
    repo, card, path = _make_card(tmp_path)
    runner = FakeRunner()
    # opener that also drives a push through the runner — still no merge anywhere
    stage_approval.stage(
        path, repo,
        opener=lambda b, r, run: (run(["push", "origin", b], cwd=r), "pr")[1],
        runner=runner,
    )
    flat = [tok for call in runner.calls for tok in call]
    assert not any("merge" in tok for tok in flat), runner.calls


def test_stage_desktop_delegates_open(tmp_path):
    repo, card, path = _make_card(tmp_path)
    runner = FakeRunner()
    notified = []
    opener = functools.partial(stage_approval.push_branch_and_notify,
                               notifier=notified.append)
    ref = stage_approval.stage(path, repo, opener=opener, runner=runner)

    branch = f"approval/{card.meta['id']}"
    assert ref == branch                       # desktop returns the branch ref
    assert ["push", "origin", branch] in runner.calls   # pushed over deploy key
    assert notified == [branch]                # PR-open DELEGATED via notify
    # never a PR-open / REST / gh call
    flat = [tok for call in runner.calls for tok in call]
    assert not any(tok == "gh" or "api.github.com" in tok for tok in flat)


def test_stage_cloud_opens_pr(tmp_path):
    repo, card, path = _make_card(tmp_path)
    runner = FakeRunner()
    opened = []

    def fake_pr_opener(branch):
        opened.append(branch)
        return f"PR:{branch}"

    opener = functools.partial(stage_approval.open_pr, pr_opener=fake_pr_opener)
    ref = stage_approval.stage(path, repo, opener=opener, runner=runner)

    branch = f"approval/{card.meta['id']}"
    assert opened == [branch]                  # injected App-integration opener ran
    assert ref == f"PR:{branch}"
    flat = [tok for call in runner.calls for tok in call]
    assert not any("merge" in tok for tok in flat)   # cloud opener never merges


# --------------------------------------------------------------------------- #
# T2 — open_pr files a merge-gate card (via T1) after opening the PR           #
# --------------------------------------------------------------------------- #

def test_open_pr_files_merge_gate(tmp_path):
    # push (git) -> open (pr_opener) -> file (gate_filer), in that order; the gate
    # is filed against the PR ref the opener returned.
    repo, card, path = _make_card(tmp_path)
    events = []

    def runner(args, cwd=None):
        events.append(("git", args[0]))

    def fake_pr_opener(branch):
        events.append(("open", branch))
        return "PR:foo"

    def rec_gate_filer(**kw):
        events.append(("file", kw))

    ref = stage_approval.open_pr("br", repo, runner,
                                 pr_opener=fake_pr_opener, gate_filer=rec_gate_filer)
    assert ref == "PR:foo"
    kinds = [e[0] for e in events]
    assert kinds == ["git", "open", "file"]          # push BEFORE open BEFORE file
    assert events[0][1] == "push"
    file_kw = events[2][1]
    assert file_kw["target"] == "PR:foo"             # gate keyed on the opened PR ref
    assert file_kw["pr_url"] == "PR:foo"
    assert file_kw["branch"] == "br"


def test_open_pr_gate_filer_default_is_merge_gate(tmp_path, monkeypatch):
    # With no injected gate_filer, the default resolves to merge_gate.file bound to
    # the repo's queue/.
    import merge_gate
    repo, card, path = _make_card(tmp_path)
    runner = FakeRunner()
    recorded = {}

    def fake_file(queue_root, *, target, repo, branch, pr_url, unblocks, **kw):
        recorded.update(target=target, queue_root=str(queue_root), repo=repo,
                        branch=branch, pr_url=pr_url, unblocks=unblocks)
        return "sentinel-card"

    monkeypatch.setattr(merge_gate, "file", fake_file)
    ref = stage_approval.open_pr("br", repo, runner, pr_opener=lambda b: "PR:xyz")
    assert ref == "PR:xyz"
    assert recorded["target"] == "PR:xyz"
    assert recorded["pr_url"] == "PR:xyz"
    assert recorded["branch"] == "br"
    assert recorded["queue_root"].endswith("queue")   # bound to repo's queue/


def test_open_pr_gate_failure_never_breaks_the_open(tmp_path):
    # A gate-filing failure must NEVER undo an opened PR (surfacing is best-effort).
    repo, card, path = _make_card(tmp_path)
    runner = FakeRunner()

    def boom(**kw):
        raise RuntimeError("queue write failed")

    ref = stage_approval.open_pr("br", repo, runner,
                                 pr_opener=lambda b: "PR:ok", gate_filer=boom)
    assert ref == "PR:ok"                              # PR ref still returned
