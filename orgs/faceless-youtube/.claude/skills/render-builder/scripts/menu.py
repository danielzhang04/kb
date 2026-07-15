"""Loads + validates the animation menu (the single source of truth). See references/animation-menu.json."""
import json, os

_DEFAULT = os.path.join(os.path.dirname(__file__), "..", "references", "animation-menu.json")


def load_menu(path=None):
    with open(path or _DEFAULT, encoding="utf-8") as f:
        m = json.load(f)
    fams = m.get("families", {})
    for fam_name, fam in fams.items():
        for anim_name, entry in fam.get("animations", {}).items():
            if fam_name == "cutout" and not entry.get("asset"):
                raise ValueError(f"cutout animation '{anim_name}' missing required 'asset' contract")
            if not entry.get("engine"):
                raise ValueError(f"animation '{anim_name}' missing required 'engine' impl")
    return m


def valid_animation(menu, source, anim_type):
    return anim_type in menu.get("families", {}).get(source, {}).get("animations", {})
