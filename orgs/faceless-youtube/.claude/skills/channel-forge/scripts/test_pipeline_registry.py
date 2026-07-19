from pipeline_registry import load_registry, get, list_built, is_built


def test_load_registry_has_stylized():
    ids = [p["id"] for p in load_registry()]
    assert "stylized-compositing" in ids


def test_get_returns_pipeline():
    p = get("stylized-compositing")
    assert p and p["status"] == "built"


def test_get_unknown_is_none():
    assert get("nope") is None


def test_list_built_excludes_planned():
    built = [p["id"] for p in list_built()]
    assert "stylized-compositing" in built
    assert "cinematic-ai-video" not in built  # planned, not built


def test_is_built():
    assert is_built("stylized-compositing") is True
    assert is_built("cinematic-ai-video") is False  # planned
    assert is_built("nope") is False
