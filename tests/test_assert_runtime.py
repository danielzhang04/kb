"""Phase R1.4 -- scripts/assert_runtime.py, the runner's runtime pre-exec gate."""
import cards
import assert_runtime


def _card(tmp_path, *, runtime=None, drop_runtime=False):
    c = cards.new_card("kb", "a", "t", "T1", body="## Work order\n\nx\n")
    if runtime is not None:
        cards.stamp_routing(c, runtime, "some-model")
    if drop_runtime:
        c.meta.pop("runtime", None)
        c.meta.pop("model", None)
    p = cards.save(c, tmp_path / "queue")
    return p


def test_assert_passes_on_matching_runtime(tmp_path):
    p = _card(tmp_path, runtime="codex")
    assert assert_runtime.main(["assert_runtime.py", str(p), "codex"]) == 0


def test_assert_fails_loud_on_mismatch(tmp_path):
    p = _card(tmp_path, runtime="claude")
    # A claude-routed card asserted against codex -> the runner must REFUSE it.
    assert assert_runtime.main(["assert_runtime.py", str(p), "codex"]) == 1


def test_assert_passes_on_legacy_card_without_runtime(tmp_path):
    # A card with no `runtime` field (legacy) -> no assertion, backward-compatible.
    p = _card(tmp_path, drop_runtime=True)
    assert assert_runtime.main(["assert_runtime.py", str(p), "codex"]) == 0


def test_assert_null_runtime_is_allowed(tmp_path):
    # A fresh card carries runtime: None (never routed) -> allowed, not a refusal.
    p = _card(tmp_path)  # runtime defaults to None
    assert assert_runtime.main(["assert_runtime.py", str(p), "codex"]) == 0


def test_assert_bad_args_returns_usage_error(tmp_path):
    assert assert_runtime.main(["assert_runtime.py"]) == 2


def test_assert_missing_card_returns_shim_error(tmp_path):
    missing = tmp_path / "queue" / "inbox" / "nope.md"
    assert assert_runtime.main(["assert_runtime.py", str(missing), "codex"]) == 2
