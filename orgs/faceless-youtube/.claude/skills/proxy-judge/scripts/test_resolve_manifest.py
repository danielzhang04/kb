#!/usr/bin/env python3
"""Plain-assert tests for resolve_manifest (no pytest).

Run: python test_resolve_manifest.py
"""
import pathlib
from resolve_manifest import resolve

ROOT = pathlib.Path(__file__).resolve().parents[4]  # repo root (faceless-youtube)


def test_resolves_story_paths():
    r = resolve("story", "the-second-take", ROOT)
    assert r["grammar"].name == "storytelling-grammar.md"
    assert r["grammar"].exists()
    assert r["voice"].name == "example-scripts.md"
    assert r["voice"].exists()
    assert r["calibration"].name == "calibration-set.md"
    assert "verdict-only" in r["gates"]


def test_unknown_facet_raises():
    try:
        resolve("does-not-exist", "the-second-take", ROOT)
    except KeyError:
        return
    raise AssertionError("expected KeyError for unknown facet")


if __name__ == "__main__":
    test_resolves_story_paths()
    test_unknown_facet_raises()
    print("OK: test_resolve_manifest (2 tests passed)")
