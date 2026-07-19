from prune_workspace import prune


def _make_channel(tmp_path):
    ch = tmp_path / "chan"
    (ch / ".workspace" / "style").mkdir(parents=True)
    (ch / ".workspace" / "style" / "scratch1.png").write_text("x", encoding="utf-8")
    (ch / "style-bible.md").write_text("locked", encoding="utf-8")  # a locked, named asset
    return ch


def test_prune_removes_workspace(tmp_path):
    ch = _make_channel(tmp_path)
    removed = prune(str(ch))
    assert not (ch / ".workspace").exists()
    assert any(".workspace" in r for r in removed)


def test_prune_keeps_locked_assets(tmp_path):
    ch = _make_channel(tmp_path)
    prune(str(ch))
    assert (ch / "style-bible.md").exists()
    assert (ch / "style-bible.md").read_text(encoding="utf-8") == "locked"


def test_prune_noop_when_no_workspace(tmp_path):
    ch = tmp_path / "chan"
    ch.mkdir()
    assert prune(str(ch)) == []
