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

import yaml

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


def test_stage_writes_record_with_hash(tmp_path):
    repo, card, path = _make_card(tmp_path)
    runner = FakeRunner()
    ref = stage_approval.stage(path, repo, opener=lambda b, r, run: "pr-ref", runner=runner)
    assert ref == "pr-ref"

    record_path = repo / "approvals" / f"{card.meta['id']}.yaml"
    assert record_path.exists()
    data = yaml.safe_load(record_path.read_text(encoding="utf-8"))
    assert data["approval"] == approvals.payload_hash(card)
    assert data["assurance"] == "signed"
    assert "expires" in data and data["expires"]


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
