"""Unit tests for the animation-menu loader/validator (plain-assert; repo has no pytest)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from menu import load_menu, valid_animation


def test_loads_and_has_both_families():
    m = load_menu()
    assert set(m["families"]) == {"cutout", "engine"}, m["families"].keys()


def test_every_cutout_entry_declares_an_asset_contract():
    m = load_menu()
    for name, entry in m["families"]["cutout"]["animations"].items():
        assert entry.get("asset"), ("cutout animation missing asset contract", name)


def test_valid_animation_gate():
    m = load_menu()
    assert valid_animation(m, "cutout", "slide") is True
    assert valid_animation(m, "cutout", "teleport") is False   # not on the menu
    assert valid_animation(m, "engine", "type-on") is True


def test_malformed_menu_raises():
    import json, tempfile
    bad = {"schema": "x", "families": {"cutout": {"animations": {"x": {"engine": "y"}}}}}  # no asset
    p = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(bad, p); p.close()
    try:
        load_menu(p.name); assert False, "should have raised"
    except ValueError:
        pass


def main():
    for fn in [test_loads_and_has_both_families, test_every_cutout_entry_declares_an_asset_contract,
               test_valid_animation_gate, test_malformed_menu_raises]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
