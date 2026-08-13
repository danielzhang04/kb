"""Shared TEST fixture support for the image-generation scripts (pytest auto-imports this).

P3 (2026-08-12) made the pre-gen review gate class-agnostic: a plate, environment, prop, crowd
exemplar, pose/expression primitive or in-batch card may not seed a scene without an all-pass
record in `<kit>/_staging/review.json`. Every batch fixture therefore needs the channel's standing
library to be REVIEWED, which is the normal state of a channel that has run its Pass-1 gate once.

`stamp_all_pass` writes exactly what `stamp_review.py --figures` would have written, in the shape
`forge.figure_review_record` reads. It lives here rather than in each test file so one definition
of "reviewed" serves every suite — a per-file copy is how the board and the gate drift apart.

The gate's REFUSALS are proved by tests that deliberately skip this helper (or stamp a failing or
stale record); the helper only supplies the reviewed baseline the other assertions assume.

WHERE a fixture stamps is not a detail. `Kit(<real kit>).staging` is the CHANNEL'S OWN
`_staging`, so a fixture that builds a real Kit and forgets to re-point `staging` writes
`reviewer: fixture` all-pass records straight into the production review store — which is P3's
gate, held open by a test run, undoing any deliberate curation on the next run. That is not
hypothetical: 73 such rows were found in the-second-take's live store on 2026-08-12. So this
file now enforces what it used to merely assume:

  * `isolate_staging(kit)` is the ONE way a fixture points a Kit at per-test staging.
  * `stamp_all_pass` REFUSES a staging dir inside the live channel tree.
  * an import-time guard makes any open() of a live `_staging` path — read or write — and any
    WRITE anywhere under `channels/` raise, naming the offending path. Reads of the live
    bible / registry / refs stay allowed: digest-true stamps are read off the real refs, which
    is the 8c design and unchanged.
"""
import builtins
import io
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forge          # the gate's own digest reader, so a fixture can never disagree with it

# <repo>/orgs/faceless-youtube/channels — the live channel tree these suites read from and must
# never write to. Derived from this file's own location, exactly as every test file derives its
# KIT_DIR, so a worktree and the primary checkout each guard their own tree.
LIVE_CHANNELS = os.path.normcase(os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), *([os.pardir] * 4), "channels")))


def _live_kind(path, mode="r"):
    """`None` if this open() is fine, else WHY it is not — a live-staging touch or a live write."""
    try:
        p = os.path.normcase(os.path.abspath(os.fspath(path)))
    except TypeError:                      # a file descriptor: never a path into the live tree
        return None
    if not (p == LIVE_CHANNELS or p.startswith(LIVE_CHANNELS + os.sep)):
        return None
    rel = p[len(LIVE_CHANNELS):].split(os.sep)
    if "_staging" in rel:
        return "the LIVE review staging of a real channel"
    if any(c in mode for c in "wax+"):
        return "the LIVE channel tree"
    return None


def _refuse_live(path, mode="w"):
    kind = _live_kind(path, mode)
    if kind:
        raise RuntimeError(
            f"test fixture touched {kind}: {os.path.abspath(path)}\n"
            f"Tests read the real bible/registry/refs but own NO live state: point the Kit at "
            f"per-test staging with conftest.isolate_staging(kit) (or pass a tmp_path dir to "
            f"stamp_all_pass). Writing here stamps P3's production review gate open.")


def _install_live_guard():
    """Fail loud at the moment of the offence, naming the test's own path — a post-hoc diff of the
    store names only the suite. Installed at import so COLLECTION-time module bodies are covered
    too; `conftest.py` is imported by nothing but a pytest run."""
    if getattr(builtins.open, "_kb_live_guard", False):
        return
    _orig = builtins.open

    def guarded(file, mode="r", *args, **kwargs):
        _refuse_live(file, mode)
        return _orig(file, mode, *args, **kwargs)

    guarded._kb_live_guard = True
    guarded._kb_orig_open = _orig
    builtins.open = guarded
    io.open = guarded          # `Path.read_text`/`Path.write_text` go through this name, not builtins


_install_live_guard()


def isolate_staging(kit):
    """Re-point a real `Kit` at fresh per-test staging. EVERY fixture that builds a Kit over the
    real kit dir calls this — `Kit.staging` otherwise IS the channel's production review store."""
    kit.staging = os.path.join(tempfile.mkdtemp(), "_staging")
    os.makedirs(kit.staging)
    return kit


def _pngs(target):
    if os.path.isfile(target):
        return [target] if target.lower().endswith(".png") else []
    out = []
    for base, _dirs, files in os.walk(target):
        out.extend(os.path.join(base, f) for f in files if f.lower().endswith(".png"))
    return out


def stamp_all_pass(staging_dir, *targets, reviewer="fixture", date="2026-08-12", verdict="pass"):
    """Record an all-pass review verdict for every PNG under `targets` (files or dirs).

    Keyed by FILE STEM — the one key shape the store uses for every asset class — with
    `canonical_sha256` read off the bytes on disk, so the record is current by construction.
    Merges additively into any existing store, exactly as the real writer does. Returns the store.
    """
    path = os.path.join(staging_dir, "review.json")
    _refuse_live(path)                     # a stamp is the one write that would open P3's gate
    try:
        with open(path, encoding="utf-8") as f:
            store = json.load(f)
    except (OSError, ValueError):
        store = {}
    if not isinstance(store, dict):
        store = {}
    figures = store.setdefault("figures", {})
    for target in targets:
        if not target or not os.path.exists(target):
            continue
        for frame in _pngs(target):
            figures[os.path.splitext(os.path.basename(frame))[0]] = {
                "canonical_sha256": forge.frame_digest(frame),
                "expression_sha256": None,
                "verdicts": {"rig": verdict, "flat-cel-hazard": verdict},
                "reviewer": reviewer,
                "date": date,
            }
    os.makedirs(staging_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=1)
    return store


def stamp_kit(k, *extra):
    """The reviewed-channel baseline: every ref the kit ships, plus any per-test frames."""
    return stamp_all_pass(k.staging, os.path.join(k.kit, "refs"), *extra)
