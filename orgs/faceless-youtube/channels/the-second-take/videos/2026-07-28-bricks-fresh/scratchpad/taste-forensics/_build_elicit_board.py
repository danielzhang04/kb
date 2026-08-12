#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Deterministic builder for the Phase-0 taste-elicitation board (bricks taste-forensics wave).

Reads (never writes) :
  - taste-forensics/beat-map.json          (Task 0)
  - taste-forensics/generations-index.json (Task 0)
  - videos/2026-07-28-bricks-fresh/shots.json          (current Gen-C prose)
  - git show <GEN_B_SNAPSHOT>:.../shots.json           (Gen-B prose, never rendered)
  - render pixels: assets/** archives, assets/scenes, visual-kit/_staging parked candidates,
    and committed board HTML data-URI embeds (only where they are the sole source of a frame).

Writes:
  - taste-forensics/elicit-board.html    (board 1 - the 6c2 second tenth)
  - taste-forensics/elicit-board-2.html  (board 2 - first tenth + old-generation arc)
  - taste-forensics/elicit-questions.json

Every count rendered into the HTML is derived here and assert-guarded; nothing is hand-authored.
Run:  python _build_elicit_board.py    (from anywhere; paths are absolute-resolved)
"""

from __future__ import annotations

import base64
import hashlib
import html as htmlmod
import io
import json
import os
import re
import subprocess
import sys
from collections import OrderedDict

from PIL import Image

# --------------------------------------------------------------------------------------
# 1. CONFIG
# --------------------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO_DIR = os.path.abspath(os.path.join(HERE, os.pardir, os.pardir))          # .../2026-07-28-bricks-fresh
CHANNEL_DIR = os.path.abspath(os.path.join(VIDEO_DIR, os.pardir, os.pardir))   # .../the-second-take
REPO_ROOT = os.path.abspath(os.path.join(CHANNEL_DIR, *[os.pardir] * 4))       # worktree root
VIDEO_REL = os.path.relpath(VIDEO_DIR, REPO_ROOT).replace("\\", "/")

# assets/** and the pre-reset board HTMLs are gitignored machine-local: they live only in the MAIN
# checkout. Pixels are read from there, read-only. Anything present in this worktree wins.
MAIN_CHECKOUT = r"C:\Users\danie\kb"
PIXEL_ROOTS = [
    VIDEO_DIR,
    os.path.join(MAIN_CHECKOUT, VIDEO_REL.replace("/", os.sep)),
]
KIT_STAGING_ROOTS = [
    os.path.join(CHANNEL_DIR, "visual-kit", "_staging"),
    os.path.join(MAIN_CHECKOUT, "orgs", "faceless-youtube", "channels", "the-second-take",
                 "visual-kit", "_staging"),
]

GEN_B_SNAPSHOT = "52b17ab"   # last Gen-B commit whose shots.json is byte-identical to d1f771a
RESET_COMMIT_DATE = "2026-08-06"  # d680fda - the 246-shot doctrine re-author

SIZE_LIMIT = int(15.5 * 1024 * 1024)

# Encoding ladder: lightbox fidelity is defended first, grid-thumb quality is spent first.
# (controller ruling: drop thumb quality -> then split boards -> never shrink lightbox fidelity)
LADDER = [
    dict(lb_max=1376, lb_q=88, th_max=700, th_q=80),
    dict(lb_max=1376, lb_q=88, th_max=620, th_q=74),
    dict(lb_max=1376, lb_q=88, th_max=520, th_q=68),
    dict(lb_max=1376, lb_q=84, th_max=480, th_q=64),
]

# --------------------------------------------------------------------------------------
# 2. GROUND TRUTH - Daniel's lists, copied verbatim from the spec "Input data" block
#    (orgs/faceless-youtube/docs/superpowers/specs/2026-08-11-bricks-taste-forensics-design.md).
#    Never re-inferred.
# --------------------------------------------------------------------------------------

# Old full-video board (pre-reset generation, 214 shots): L05-16, L19-44, L49/50, L76-88,
# L111, L113, L164, L212-215.
OLD_LIKED = (set(range(5, 17)) | set(range(19, 45)) | {49, 50} | set(range(76, 89))
             | {111, 113, 164} | set(range(212, 216)))
# p6b board (new doctrine, first tenth L01-L25): L1-18 except 07 and 10; L21-25.  -> 21/25
P6B_LIKED = (set(range(1, 19)) - {7, 10}) | set(range(21, 26))
# 6c2 board (new doctrine, second tenth L26-L50): L26, L28, L35, L37, L40-43, L49.  -> 9/25
C6C2_LIKED = {26, 28, 35, 37, 40, 41, 42, 43, 49}

P6B_RANGE = set(range(1, 26))
C6C2_RANGE = set(range(26, 51))
NEW_LIKED = P6B_LIKED | C6C2_LIKED

# spec "First-pass signal" 1, verbatim: the six shots seeded on L28's place plate.
PLACE_CHILDREN_SPEC = ["L29", "L33", "L44", "L46", "L47", "L48"]

TAG_OPTIONS = [
    ("a", "too basic"),
    ("b", "character is the base rig instead of the character"),
    ("c", "character is off-rig"),
    ("d", "cast rig in the background where a crowd was wanted"),
    ("e", "other - name it"),
]

# --------------------------------------------------------------------------------------
# 3. LOADING
# --------------------------------------------------------------------------------------


def die(msg):
    raise SystemExit("BUILD FAILED: " + msg)


def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def lnum(s):
    m = re.match(r"^L(\d+)", s or "")
    return int(m.group(1)) if m else None


def resolve(rel, roots):
    for root in roots:
        p = os.path.join(root, rel.replace("/", os.sep))
        if os.path.exists(p):
            return p
    return None


def git_show(rev, relpath):
    out = subprocess.run(["git", "show", "%s:%s" % (rev, relpath)], cwd=REPO_ROOT,
                         capture_output=True)
    if out.returncode != 0:
        die("git show %s:%s failed: %s" % (rev, relpath, out.stderr.decode("utf-8", "replace")[:300]))
    return out.stdout.decode("utf-8")


def load_ctx():
    beats = load_json(os.path.join(HERE, "beat-map.json"))
    gens = load_json(os.path.join(HERE, "generations-index.json"))
    cur = load_json(os.path.join(VIDEO_DIR, "shots.json"))["long_form"]["shots"]
    genb = json.loads(git_show(GEN_B_SNAPSHOT, VIDEO_REL + "/shots.json"))["long_form"]["shots"]
    ctx = dict(
        beats=beats,
        by_id={b["beat_id"]: b for b in beats},
        gens={g.get("beat_id", g.get("id")): g for g in gens},
        cur={s["id"]: s for s in cur},
        genb={s["id"]: s for s in genb},
    )
    return ctx


# --------------------------------------------------------------------------------------
# 4. DERIVATION - liked / disliked membership, straight off the ground-truth lists
# --------------------------------------------------------------------------------------


def old_ids(row):
    cands = row.get("old_L_candidates") or ([row["old_L"]] if row.get("old_L") else [])
    return [n for n in (lnum(c) for c in cands) if n]


def status_of(row):
    """-> (old_status, new_status) each in {'named','not-named','not-boarded'}."""
    olds = old_ids(row)
    if not olds:
        old_st = "not-boarded"
    else:
        old_st = "named" if any(n in OLD_LIKED for n in olds) else "not-named"
    n = lnum(row.get("new_L") or "")
    if n is None or n not in (P6B_RANGE | C6C2_RANGE):
        new_st = "not-boarded"
    else:
        new_st = "named" if n in NEW_LIKED else "not-named"
    return old_st, new_st


def derive_sets(ctx):
    """All beat partitions used to select panels. Everything derived, nothing listed by hand."""
    d = dict(c6c2_disliked=[], c6c2_liked=[], p6b_disliked=[], new_liked_old_not=[],
             audit_arc=[], all_status={})
    for row in ctx["beats"]:
        bid = row["beat_id"]
        n = lnum(row.get("new_L") or "")
        old_st, new_st = status_of(row)
        d["all_status"][bid] = (old_st, new_st)
        if n in C6C2_RANGE:
            (d["c6c2_liked"] if new_st == "named" else d["c6c2_disliked"]).append(bid)
        if n in P6B_RANGE and new_st == "not-named":
            d["p6b_disliked"].append(bid)
        if new_st == "named" and old_st != "named":
            d["new_liked_old_not"].append(bid)
        # audit arc = Daniel's old L76-88 range, no new-generation render yet
        if new_st == "not-boarded" and any(76 <= o <= 88 for o in old_ids(row)):
            d["audit_arc"].append(bid)
    for k in ("c6c2_disliked", "c6c2_liked", "p6b_disliked", "new_liked_old_not", "audit_arc"):
        d[k] = sorted(set(d[k]), key=lambda b: lnum(b))
    return d


# --------------------------------------------------------------------------------------
# 5. IMAGE REGISTRY
# --------------------------------------------------------------------------------------

GEN_LABELS = {
    "gen-A-old-214shot-2026-08-04": "gen-A - old 214-shot file",
    "gen-A-old-214shot-orphan-pre-removal": "gen-A - old file (orphan, pre-removal)",
    "gen-B-intermediate-41to248shot-2026-08-05": "gen-B - intermediate 248-shot file",
    "gen-C-new246-p6b-tenth1-2026-08-06": "gen-C - 246-shot file, p6b wave",
    "gen-C-new246-6c2-tenth2-current": "gen-C - 246-shot file, 6c2 wave (current)",
}


def dhash(im):
    return list(im.convert("L").resize((16, 16), Image.LANCZOS).tobytes())


def perceptual_distance(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / 256.0


class Registry(object):
    """Every distinct frame is decoded once, encoded once, and referenced by index.

    Guards: identical key -> same index (anti L1 duplicate lightbox entries); a perceptual
    near-duplicate arriving under a different key is reported and reused, never silently doubled.
    """

    def __init__(self):
        self.items = OrderedDict()      # key -> record
        self.order = []                 # key list, index == lightbox index
        self._hashes = []               # (key, dhash)
        self.collapsed = []             # (new_key, existing_key, distance)

    def add(self, key, loader, caption, gen_tag, date, badges, beat, provenance):
        if key in self.items:
            rec = self.items[key]
            if beat and beat not in rec["beats"]:
                rec["beats"].append(beat)      # one frame can serve two beats after resegmentation
            return rec["idx"]
        raw = loader()
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        dh = dhash(im)
        for okey, odh in self._hashes:
            dist = perceptual_distance(dh, odh)
            if dist < 0.5:
                self.collapsed.append((key, okey, round(dist, 3), gen_tag,
                                       self.items[okey]["gen_tag"]))
                rec = self.items[okey]
                if beat and beat not in rec["beats"]:
                    rec["beats"].append(beat)
                return rec["idx"]
        idx = len(self.order)
        rec = dict(idx=idx, key=key, im=im, caption=caption, gen_tag=gen_tag, date=date,
                   badges=list(badges), beat=beat, beats=[beat] if beat else [],
                   provenance=provenance, size=im.size, sha=hashlib.sha256(raw).hexdigest())
        self.items[key] = rec
        self.order.append(key)
        self._hashes.append((key, dh))
        return idx

    def rec(self, idx):
        return self.items[self.order[idx]]

    def __len__(self):
        return len(self.order)


def encode(im, max_side, quality):
    w, h = im.size
    if max(w, h) > max_side:
        r = max_side / float(max(w, h))
        im = im.resize((max(1, int(round(w * r))), max(1, int(round(h * r)))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue(), im.size


def data_uri(blob):
    return "data:image/jpeg;base64," + base64.b64encode(blob).decode("ascii")


# --------------------------------------------------------------------------------------
# 6. FRAME SOURCING - which pixels exist for a beat, per generation
# --------------------------------------------------------------------------------------


class BoardIndex(object):
    """The boards Daniel reviewed are the authority on WHICH frame he named.

    beat-map.json points at archived PNGs, but for a large minority of cards the archived PNG is a
    different take from the one embedded in the board (repairs that were never promoted back into
    assets/scenes). Anchoring on the board embed and then upgrading to a pixel-matching
    higher-resolution file is the only sourcing rule that cannot show him a frame he never judged.
    """

    def __init__(self):
        self.boards = {}

    def load(self, board_file):
        if board_file in self.boards:
            return self.boards[board_file]
        ap = resolve("scratchpad/" + board_file, PIXEL_ROOTS)
        if ap is None:
            die("board html not found: " + board_file)
        with open(ap, "r", encoding="utf-8") as fh:
            doc = fh.read()
        idx = {}
        for tag in re.findall(r"<img\b[^>]*>", doc):
            m = re.search(r'src="data:image/(\w+);base64,([^"]+)"', tag)
            a = re.search(r'alt="([^"]*)"', tag)
            if not m or not a:
                continue
            raw = base64.b64decode(m.group(2))
            im = Image.open(io.BytesIO(raw))
            prev = idx.get(a.group(1))
            if prev is None or im.size[0] > prev[1][0]:
                idx[a.group(1)] = (raw, im.size, dhash(im))
        self.boards[board_file] = idx
        return idx

    def get(self, board_file, alt):
        return self.load(board_file).get(alt)


BIDX = BoardIndex()

# Every PNG that could hold the full-resolution original of a board embed. Walked once, hashed
# once; the hash table is cached in the OS temp dir keyed by path+size+mtime (pure speed, the
# build is identical without it).
_POOL = {}


def pool_roots():
    """Every root that can hold render pixels. The worktree copy of a path wins where it exists,
    but the main checkout is always walked too: assets/** is gitignored machine-local and its
    archives exist only there."""
    roots = [("assets/", os.path.join(r, "assets")) for r in PIXEL_ROOTS
             if os.path.isdir(os.path.join(r, "assets"))]
    roots += [("visual-kit/_staging/", r) for r in KIT_STAGING_ROOTS if os.path.isdir(r)]
    if not any(p == "assets/" for p, _ in roots) or \
            not any(p.startswith("visual-kit") for p, _ in roots):
        die("pixel pool roots not found: %r" % (roots,))
    return roots


def pool_index():
    if _POOL:
        return _POOL
    cache_path = os.path.join(os.environ.get("TEMP", "."), "elicit_pool_hash_cache.json")
    cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as fh:
                cache = json.load(fh)
        except Exception:
            cache = {}
    Image.MAX_IMAGE_PIXELS = None
    fresh = {}
    for prefix, root in pool_roots():
        for dp, _, fns in os.walk(root):
            for fn in sorted(fns):
                if not fn.lower().endswith(".png"):
                    continue
                p = os.path.join(dp, fn)
                key = prefix + os.path.relpath(p, root).replace(os.sep, "/")
                if key in _POOL:      # worktree copy already indexed; do not double-count
                    continue
                st = os.stat(p)
                sig = "%d:%d" % (st.st_size, int(st.st_mtime))
                hit = cache.get(p)
                if hit and hit[0] == sig:
                    fresh[p] = hit
                    _POOL[key] = (hit[1], tuple(hit[2]), p)
                    continue
                try:
                    im = Image.open(p)
                    dh = dhash(im)
                except Exception:
                    continue
                fresh[p] = [sig, dh, list(im.size)]
                _POOL[key] = (dh, im.size, p)
    try:
        with open(cache_path, "w", encoding="utf-8") as fh:
            json.dump(fresh, fh)
    except Exception:
        pass
    return _POOL


def best_pool_match(dh):
    """(relative key, distance, size, absolute path) of the closest PNG in the pixel pool."""
    best = (None, 1e9, None, None)
    for key, (pdh, size, ap) in sorted(pool_index().items()):
        d = perceptual_distance(dh, pdh)
        if d < best[1]:
            best = (key, d, size, ap)
    return best


def real_renders(row):
    """Render entries that point at a real file on disk (not manifest:/git-show pointers, and not
    a loose visual-kit/_staging/ path - those are documentation-only entries in beat-map.json; a
    staging file only enters automatic panel-surfacing via the established staging_provenance/
    parked_candidates() route, or is deliberately hand-spliced into a panel by path (e.g. the P07
    place-plate probe) rather than picked up generically here."""
    out = []
    for r in row["renders"]:
        p = r["path_or_board"]
        if p.startswith("manifest:") or p.startswith("git show") or p.startswith("visual-kit/"):
            continue
        if not r.get("exists_on_disk"):
            continue
        out.append(r)
    return out


def parked_candidates(row):
    """Unpromoted candidate frames recorded in a manifest entry's staging_provenance."""
    out = []
    seen = set()
    for r in row["renders"]:
        if r.get("review_status") != "parked":
            continue
        for sp in (r.get("staging_provenance") or []):
            f = sp.get("staging_file")
            if not f or f in seen:
                continue
            seen.add(f)
            out.append((f, sp.get("sha256_noted"), r.get("generation_tag"), r.get("date")))
    return out


def gen_family(tag):
    if tag.startswith("gen-A"):
        return "A"
    if tag.startswith("gen-B"):
        return "B"
    return "C"


def board_ref(row, fam):
    """(board html, alt) of the card Daniel reviewed for this beat in this generation."""
    if fam == "A":
        for cand in ([row["old_L"]] if row.get("old_L") else []) + (row.get("old_L_candidates") or []):
            if cand and BIDX.get("full-board.html", "%s current best" % cand):
                return ("full-board.html", "%s current best" % cand)
        return None
    if fam == "C":
        nid = row.get("new_L")
        n = lnum(nid or "")
        if n is None:
            return None
        bf = "p6b-board.html" if n in P6B_RANGE else ("6c2-board.html" if n in C6C2_RANGE else None)
        if bf and BIDX.get(bf, nid):
            return (bf, nid)
    return None


def gap_frame(reg, gid):
    """A beat id with NO beat-map.json row at all (a numbering gap inside an otherwise contiguous
    id range) that still has a card on the old board and a matching file in the pixel pool.
    Returns a registry index, or None if no frame survives anywhere for it - the caller then
    states the absence instead of silently skipping the id (M2: a gap must be disclosed, not
    dropped)."""
    ref = BIDX.get("full-board.html", "%s current best" % gid)
    if ref is None:
        return None
    raw_emb, size_emb, dh_emb = ref
    rel, dist, size, abspath = best_pool_match(dh_emb)
    if 1.0 <= dist <= 5.0:
        die("%s: closest pixel match to its old-board card is ambiguous (distance %.2f)"
            % (gid, dist))
    tag = "gen-A-old-214shot-2026-08-04"
    badge_gap = ("warn", "no beat-map.json entry for this id - recovered directly from the old "
                          "board and pixel pool")
    badge_unknown = ("plain", "named status unknown - not recorded in beat-map.json")
    if dist < 1.0 and size[0] > size_emb[0]:
        date = file_date(abspath)
        return reg.add(key=rel, loader=lambda p=abspath: open(p, "rb").read(),
                       caption="%s - %s" % (GEN_LABELS.get(tag, tag), date),
                       gen_tag=tag, date=date, badges=[badge_gap, badge_unknown], beat=gid,
                       provenance="%s (matches full-board.html card %r at distance %.2f)"
                                  % (rel, "%s current best" % gid, dist))
    return reg.add(key="board:full-board.html#%s current best" % gid, loader=lambda r=raw_emb: r,
                   caption="%s - board copy" % GEN_LABELS.get(tag, tag), gen_tag=tag, date="",
                   badges=[badge_gap, badge_unknown,
                           ("warn", "board copy at %dx%d - no higher-resolution file survives"
                                    % size_emb)],
                   beat=gid, provenance="full-board.html card %r (embedded copy)"
                                        % ("%s current best" % gid))


def disk_entries(row, fam):
    """(date, tag, relpath, expected sha, kind) for every real file beat-map knows about."""
    out = []
    for r in real_renders(row):
        if gen_family(r["generation_tag"]) == fam:
            out.append((r["date"], r["generation_tag"], r["path_or_board"], None, None))
    for f, sha, tag, date in parked_candidates(row):
        if gen_family(tag) == fam:
            out.append((date or "", tag, "visual-kit/_staging/" + f, sha, "parked"))
    out.sort(key=lambda e: (e[0] or "", e[2]))
    return out


def file_date(abspath):
    """The render date of a frame = the mtime of the file, the same basis beat-map's dates use."""
    import datetime
    return datetime.datetime.fromtimestamp(os.path.getmtime(abspath)).strftime("%Y-%m-%d")


def read_rel(path, bid):
    if path.startswith("visual-kit/_staging/"):
        ap = resolve(path.split("/", 2)[2], KIT_STAGING_ROOTS)
    else:
        ap = resolve(path, PIXEL_ROOTS)
    if ap is None:
        die("pixel source missing for %s: %s" % (bid, path))
    with open(ap, "rb") as fh:
        return fh.read()


def frames_for(ctx, reg, bid, families=("A", "C"), all_variants=False):
    """The frame Daniel judged, per generation, at the best resolution that provably matches it.

    all_variants=True additionally returns every other on-disk take beat-map knows about, badged
    as not-the-frame-you-named. Returns lightbox indices, oldest generation first.
    """
    row = ctx["by_id"][bid]
    old_st, new_st = status_of(row)
    out = []
    for fam in ("A", "B", "C"):
        if fam not in families:
            continue
        st = {"A": old_st, "C": new_st}.get(fam, "not-boarded")
        st_badge = {"named": ("named", "you named this one"),
                    "not-named": ("plain", "not named"),
                    "not-boarded": ("plain", "never boarded")}[st]
        ref = board_ref(row, fam) if fam in ("A", "C") else None
        entries = disk_entries(row, fam)
        chosen_path = None
        if ref:
            raw_emb, size_emb, dh_emb = BIDX.get(*ref)
            rel, dist, size, abspath = best_pool_match(dh_emb)
            if 1.0 <= dist <= 5.0:
                die("%s/%s: closest pixel match to board card %r is ambiguous (distance %.2f)"
                    % (bid, fam, ref[1], dist))
            # the generation is fixed by WHICH board the card came from, never by whichever
            # beat-map entry happens to sort first (that mislabels beats with several takes)
            tag = ("gen-A-old-214shot-2026-08-04" if fam == "A" else
                   "gen-C-new246-p6b-tenth1-2026-08-06" if ref[0] == "p6b-board.html" else
                   "gen-C-new246-6c2-tenth2-current")
            date = file_date(abspath) if dist < 1.0 else \
                next((e[0] for e in entries), "")
            if dist < 1.0 and size[0] > size_emb[0]:
                badges = [st_badge]
                if not any(rel == e[2] for e in entries):
                    badges.append(("warn", "full-resolution original found outside beat-map's "
                                           "recorded paths"))
                idx = reg.add(key=rel, loader=lambda p=abspath: open(p, "rb").read(),
                              caption="%s - %s" % (GEN_LABELS.get(tag, tag), (date or "")[:10]),
                              gen_tag=tag, date=(date or "")[:10], badges=badges, beat=bid,
                              provenance="%s (matches %s card %r at distance %.2f)"
                                         % (rel, ref[0], ref[1], dist))
                chosen_path = rel
            else:
                idx = reg.add(key="board:%s#%s" % ref, loader=lambda r=raw_emb: r,
                              caption="%s - %s" % (GEN_LABELS.get(tag, tag), (date or "")[:10]),
                              gen_tag=tag, date=(date or "")[:10],
                              badges=[st_badge, ("warn", "board copy at %dx%d - no higher-"
                                                 "resolution file survives" % size_emb)],
                              beat=bid, provenance="%s card %r (embedded copy)" % ref)
            out.append(idx)
        if not ref or all_variants:
            for date, tag, path, sha_expected, kind in entries:
                if path == chosen_path:
                    continue
                raw = read_rel(path, bid)
                if sha_expected and len(sha_expected) == 64:
                    got = hashlib.sha256(raw).hexdigest()
                    if got != sha_expected:
                        die("sha mismatch for %s (%s != %s)" % (path, got, sha_expected))
                badges = []
                if kind == "parked":
                    badges.append(("warn", "parked candidate - never promoted"))
                if ref:
                    badges.append(("warn", "another take of the same beat - not the frame on "
                                           "the board you reviewed"))
                    badges.append(("plain", "never boarded"))
                else:
                    badges.append(st_badge)
                idx = reg.add(key=path, loader=lambda r=raw: r,
                              caption="%s - %s" % (GEN_LABELS.get(tag, tag), (date or "")[:10]),
                              gen_tag=tag, date=(date or "")[:10], badges=badges, beat=bid,
                              provenance=path)
                if idx not in out:
                    out.append(idx)
    return out


# --------------------------------------------------------------------------------------
# 7. PANEL MODEL
# --------------------------------------------------------------------------------------


class QBook(object):
    def __init__(self):
        self.qs = []

    def add(self, panel, board, text, answer_type, images, beat=None):
        qid = "Q%d" % (len(self.qs) + 1)
        self.qs.append(dict(qid=qid, panel=panel, board=board, beat=beat, images=list(images),
                            question_text=text, answer_type=answer_type,
                            tag_options=([{"key": k, "label": v} for k, v in TAG_OPTIONS]
                                         if answer_type == "tag" else None)))
        return qid

    def get(self, qid):
        return next(q for q in self.qs if q["qid"] == qid)


def vo(ctx, bid):
    return ctx["by_id"][bid]["vo_text"]


def prose_blocks(ctx, bid):
    """(label, text) prose for a beat: current Gen-C authored prompt, and the Gen-B one if it differs."""
    row = ctx["by_id"][bid]
    out = []
    cur = ctx["cur"].get(row.get("new_L") or "")
    if cur and cur.get("still_prompt"):
        out.append(("authored prompt - gen-C, current 246-shot file", cur["still_prompt"]))
    tg = row.get("text_generations") or {}
    if tg.get("still_prompt_differs"):
        gb = ctx["genb"].get(tg.get("id") or "")
        if gb and gb.get("still_prompt"):
            out.append(("authored prompt - gen-B, the 248-shot file this beat passed through as %s "
                        "(first written %s)" % (tg["id"], tg.get("first_commit", "")),
                        gb["still_prompt"]))
    return out


def cell_img(ctx, reg, idx, beat, show_beat=True):
    return dict(kind="img", idx=idx, beat=beat, show_beat=show_beat,
                vo=short(vo(ctx, beat), 54) if show_beat else None)


def cell_prose(title, text, badges, beat=None):
    return dict(kind="prose", title=title, text=text, badges=badges, beat=beat)


def build_panels(ctx, reg, qb, S):
    panels = []

    # ---------------- BOARD 1 : the 6c2 second tenth ----------------------------------
    # Derived membership: the L28-place-plate children are exactly the disliked beats whose
    # current shots.json place matches L28's place; the liked chain is the named run.
    l28_place = ctx["cur"]["L28"]["place"]
    on_same_place = [b for b in S["c6c2_disliked"]
                     if ctx["cur"].get(ctx["by_id"][b]["new_L"], {}).get("place") == l28_place]
    # the six the spec's first-pass signal names as the L28-place children (ground truth, verbatim)
    place_children = [b for b in PLACE_CHILDREN_SPEC]
    for b in place_children:
        assert b in on_same_place, \
            "%s is named as an L28-place child but does not carry place %r" % (b, l28_place)
    place_extra = [b for b in on_same_place if b not in place_children]
    liked_run = [b for b in S["c6c2_liked"]
                 if 40 <= lnum(ctx["by_id"][b]["new_L"]) <= 43]
    assert liked_run, "the named L40-43 run is empty - liked-set derivation is wrong"

    # P01 - repetition contrast
    g_liked = dict(heading="Named on the 6c2 board (%d frames)" % len(liked_run), cols=4, cells=[])
    for b in liked_run:
        g_liked["cells"].append(cell_img(ctx, reg, frames_for(ctx, reg, b, families=("C",))[0], b))
    g_dis = dict(heading="Not named, and all built from the same place image (%d frames)"
                 % len(place_children), cols=3, cells=[])
    for b in place_children:
        g_dis["cells"].append(cell_img(ctx, reg, frames_for(ctx, reg, b, families=("C",))[0], b))
    p = dict(id="P01", board=1,
             title="%d beats in one room, and a %d-beat run" % (len(place_children), len(liked_run)),
             lede=("All %d frames are from the 6c2 tenth, same doctrine, same week. The %d on top "
                   "are ones you named; they carry no shared place at all and were each chained "
                   "off the frame before them. The %d below all sit on one place, "
                   "<code>%s</code>, the plate first drawn for L28.%s"
                   % (len(liked_run) + len(place_children), len(liked_run), len(place_children),
                      htmlmod.escape(l28_place),
                      (" (%s carries the same place and is also un-named, but it is parked for a "
                       "figure defect and sits in a later panel.)" % ", ".join(place_extra))
                      if place_extra else "")),
             groups=[g_liked, g_dis], questions=[])
    imgs01 = [c["idx"] for g in p["groups"] for c in g["cells"]]
    p["questions"] = [
        qb.add("P01", 1, "Looking only at the pictures: what is present in the %d you named that "
                         "you do not find in the %d you did not?"
               % (len(liked_run), len(place_children)), "free", imgs01),
        qb.add("P01", 1, "Across the %d un-named frames: does the shared room read as a repeat to "
                         "you, or not - and if so, is it the room itself or the staging within it?"
               % len(place_children), "free", imgs01),
        qb.add("P01", 1, "Name one rule about re-using a place image you would keep, and one you "
                         "would drop.", "keep-drop", imgs01),
    ]
    panels.append(p)

    # P02 - standalone metaphor frames vs their immediate neighbours
    pair_liked = [b for b in S["c6c2_liked"] if lnum(ctx["by_id"][b]["new_L"]) in (35, 37)]
    pair_dis = [b for b in S["c6c2_disliked"] if lnum(ctx["by_id"][b]["new_L"]) in (36, 38)]
    inter = sorted(pair_liked + pair_dis, key=lambda b: lnum(b))
    g = dict(heading="Four consecutive beats, in script order", cols=4, cells=[])
    for b in inter:
        g["cells"].append(cell_img(ctx, reg, frames_for(ctx, reg, b, families=("C",))[0], b))
    p = dict(id="P02", board=1,
             title="Named and not-named, side by side in the same run",
             lede=("These four beats run back to back. %s are named; %s are not."
                   % (" and ".join(pair_liked), " and ".join(pair_dis))),
             groups=[g], questions=[])
    imgs02 = [c["idx"] for c in g["cells"]]
    p["questions"] = [
        qb.add("P02", 1, "What separates the two you named from the two you did not - subject, "
                         "staging, palette, figure acting, novelty, or something else? A word plus "
                         "a sentence is plenty.", "free", imgs02),
        qb.add("P02", 1, "Do the two you named read as single-idea frames to you, against the "
                         "other two showing the company doing something - and if so, is the "
                         "difference about the idea in the frame, or about how it is drawn?",
               "free", imgs02),
        qb.add("P02", 1, "Of these two kinds of frame, which would you want more of in the "
                         "remaining eight tenths, and which would you cut?", "keep-drop", imgs02),
    ]
    panels.append(p)

    # P03..P06 - every 6c2 not-named beat next to its old-generation frame, with taxonomy tags
    chunk = 4
    groups_of = [S["c6c2_disliked"][i:i + chunk] for i in range(0, len(S["c6c2_disliked"]), chunk)]
    for gi, chunk_beats in enumerate(groups_of):
        pid = "P%02d" % (3 + gi)
        groups = []
        tagq = []
        all_imgs = []
        for b in chunk_beats:
            old_st, new_st = S["all_status"][b]
            idxs = frames_for(ctx, reg, b)
            all_imgs.extend(idxs)
            newest = [i for i in idxs if gen_family(reg.rec(i)["gen_tag"]) == "C"]
            q = qb.add(pid, 1,
                       "Tag the newer frame for %s (%s). Tick every tag that applies; add your own "
                       "words for (e)." % (b, short(vo(ctx, b))),
                       "tag", newest or idxs[-1:], beat=b)
            tagq.append(q)
            groups.append(dict(
                heading="%s - \u201c%s\u201d" % (b, vo(ctx, b)),
                sub="old board id %s (%s) \u2192 new board id %s (%s)"
                    % (ctx["by_id"][b]["old_L"], hstat(old_st), ctx["by_id"][b]["new_L"], hstat(new_st)),
                cols=max(2, len(idxs)),
                cells=[cell_img(ctx, reg, i, b, show_beat=False) for i in idxs],
                prose=prose_blocks(ctx, b), tag_q=q))
        named_old = [b for b in chunk_beats if S["all_status"][b][0] == "named"]
        if len(named_old) == len(chunk_beats):
            q1 = ("For all %d of these beats the older frame is one you named and the newer one is "
                  "not. Beat by beat: is the newer frame actually bad, or just unremarkable next "
                  "to the older one - and if there is something the older frame has that the "
                  "newer one does not, what is it? One line each is fine." % len(chunk_beats))
        else:
            q1 = ("For %d of these %d beats the older frame is one you named (the badges say "
                  "which). Beat by beat: is the newer frame actually bad, or just unremarkable "
                  "next to the older one - and if there is something the older frame has that "
                  "the newer one does not, what is it? Where you named neither, say that."
                  % (len(named_old), len(chunk_beats)))
        p = dict(id=pid, board=1,
                 title="Then and now - %s" % ", ".join(chunk_beats),
                 lede=("Same script beat, both generations. Left is oldest. Labels carry the "
                       "generation and the date only. Tagging a shot: “none — nothing "
                       "wrong with this shot” is a valid answer for any of it."),
                 groups=groups, questions=[], tag_qids=tagq)
        p["questions"] = [
            qb.add(pid, 1, q1, "free", all_imgs),
            qb.add(pid, 1, "From these %d pairs: name one thing the old generation did that you "
                           "want back, and one thing the new generation does that you would drop."
                   % len(chunk_beats), "keep-drop", all_imgs),
        ] + tagq
        panels.append(p)

    # P07 - the MiniScribe HQ beat, every surviving generation of it
    hq = "L28"
    hq_idxs = frames_for(ctx, reg, hq, families=("A", "B", "C"), all_variants=True)
    scratch = resolve("scratchpad/L28-remint-attempt1.png", PIXEL_ROOTS)
    if scratch is None:
        die("scratchpad/L28-remint-attempt1.png not found")
    with open(scratch, "rb") as fh:
        raw = fh.read()
    scratch_idx = reg.add(
        key="scratchpad/L28-remint-attempt1.png", loader=lambda: raw,
        caption="gen-B era - intermediate 248-shot file - 2026-08-05",
        gen_tag="gen-B-intermediate-41to248shot-2026-08-05", date="2026-08-05",
        badges=[("warn", "not in the generation index - recovered from the committed scratchpad"),
                ("plain", "never boarded")],
        beat=hq, provenance="scratchpad/L28-remint-attempt1.png (committed at dfb6903, 2026-08-05)")
    order = hq_idxs[:1] + [scratch_idx] + hq_idxs[1:]
    seen = set()
    order = [i for i in order if not (i in seen or seen.add(i))]
    g = dict(heading="%s - \u201c%s\u201d" % (hq, vo(ctx, hq)), cols=2,
             sub="every frame that has ever existed for this beat, oldest first",
             cells=[cell_img(ctx, reg, i, hq, show_beat=False) for i in order],
             prose=prose_blocks(ctx, hq))
    p = dict(id="P07", board=1,
             title="\u201cThere was a better shot sometime prior\u201d - the MiniScribe beat",
             lede=("You named this beat on both boards, with the note that a better version of it "
                   "existed earlier. These are the %d frames that exist for it."
                   % len(order)),
             groups=[g], questions=[])
    p["questions"] = [
        qb.add("P07", 1, "Which of these is the one you remember as better - or is it none of "
                         "them?", "free", order, beat=hq),
        qb.add("P07", 1, "If you picked one in Q31: what does it have that the current one does "
                         "not?", "free", order, beat=hq),
        qb.add("P07", 1, "Should a company's first appearance be a building, a room, or a person "
                         "- or: it depends (say on what)? A word is enough unless it depends.",
               "free", order, beat=hq),
    ]
    panels.append(p)
    p07_panel, p07_group, p07_qids = p, g, list(p["questions"])

    # ---------------- BOARD 2 : first tenth + the old-generation arc -------------------
    # P08 - the p6b beats you did not name, against their old frames
    groups = []
    tagq = []
    all_imgs = []
    for b in S["p6b_disliked"]:
        old_st, new_st = S["all_status"][b]
        idxs = frames_for(ctx, reg, b)
        all_imgs.extend(idxs)
        newest = [i for i in idxs if gen_family(reg.rec(i)["gen_tag"]) == "C"]
        q = qb.add("P08", 2, "Tag the newer frame for %s (%s). Tick every tag that applies; add "
                             "your own words for (e)." % (b, short(vo(ctx, b))),
                   "tag", newest or idxs[-1:], beat=b)
        tagq.append(q)
        groups.append(dict(heading="%s - \u201c%s\u201d" % (b, vo(ctx, b)),
                           sub="old board id %s (%s) \u2192 new board id %s (%s)"
                               % (ctx["by_id"][b]["old_L"], hstat(old_st),
                                  ctx["by_id"][b]["new_L"], hstat(new_st)),
                           cols=max(2, len(idxs)),
                           cells=[cell_img(ctx, reg, i, b, show_beat=False) for i in idxs],
                           prose=prose_blocks(ctx, b), tag_q=q))
    p = dict(id="P08", board=2,
             title="The %d beats of the first tenth you did not name" % len(S["p6b_disliked"]),
             lede=("The p6b wave scored %d of %d named. These are the %d that were not, each "
                   "beside its old-generation frame. Tagging a shot: “none — nothing wrong "
                   "with this shot” is a valid answer for any of it."
                   % (len(P6B_LIKED), len(P6B_RANGE), len(S["p6b_disliked"]))),
             groups=groups, questions=[], tag_qids=tagq)
    p["questions"] = [
        qb.add("P08", 2, "For each of these: is the newer frame actually bad, or just unremarkable "
                         "next to the rest of the tenth - or neither / both fine?", "free", all_imgs),
        qb.add("P08", 2, "Is there a rule you would write from these %d that would have caught them "
                         "before they were drawn?" % len(S["p6b_disliked"]), "keep-drop", all_imgs),
    ] + tagq
    panels.append(p)

    # P09 - the other direction: named on the new board, not named on the old
    groups = []
    all_imgs = []
    for b in S["new_liked_old_not"]:
        old_st, new_st = S["all_status"][b]
        idxs = frames_for(ctx, reg, b)
        if len(idxs) < 2:
            continue
        all_imgs.extend(idxs)
        groups.append(dict(heading="%s - \u201c%s\u201d" % (b, vo(ctx, b)),
                           sub="old board id %s (%s) \u2192 new board id %s (%s)"
                               % (ctx["by_id"][b]["old_L"], hstat(old_st),
                                  ctx["by_id"][b]["new_L"], hstat(new_st)),
                           cols=max(2, len(idxs)),
                           cells=[cell_img(ctx, reg, i, b, show_beat=False) for i in idxs],
                           prose=prose_blocks(ctx, b)))
    p = dict(id="P09", board=2,
             title="The other direction - named now, not named before",
             lede=("%d beats where the newer frame is one you named and the older one is not. "
                   "Not naming a frame on the old board only means it was not named."
                   % len(groups)),
             groups=groups, questions=[])
    p["questions"] = [
        qb.add("P09", 2, "What did the new generation get right in these?", "free", all_imgs),
        qb.add("P09", 2, "Are these a real improvement, or was the older frame simply never "
                         "something you looked at closely - or neither / both fine?",
               "free", all_imgs),
    ]
    panels.append(p)

    # P10 - the audit-arrival beat: a richer concept that was written and never drawn
    gb_beats = [b for b in S["audit_arc"] if ctx["by_id"][b].get("gen_B_intermediate_finding")]
    gb_ids = []
    for b in gb_beats:
        for r in ctx["by_id"][b]["renders"]:
            m = re.search(r"\(id (L\d+)\)", r["path_or_board"])
            if m and gen_family(r["generation_tag"]) == "B":
                gb_ids.append(m.group(1))
    gb_ids = sorted(set(gb_ids))
    if len(gb_ids) != 1:
        die("expected exactly one gen-B prose id across the audit-arrival beats, got %r" % gb_ids)
    gb_prompt = ctx["genb"][gb_ids[0]]["still_prompt"]
    cells = []
    for b in gb_beats:
        for i in frames_for(ctx, reg, b, families=("A",)):
            cells.append(cell_img(ctx, reg, i, b))
    cells.append(cell_prose(
        "gen-B %s - written 2026-08-05, never drawn" % gb_ids[0], gb_prompt,
        [("warn", "never rendered - prose only"), ("plain", "never boarded")]))
    for b in gb_beats:
        cur = ctx["cur"][ctx["by_id"][b]["new_L"]]
        cells.append(cell_prose("gen-C %s - current text, not yet drawn" % b, cur["still_prompt"],
                                [("warn", "never rendered - prose only"),
                                 ("plain", "this tenth has not been minted")]))
    g = dict(heading="The audit arrives - %s" % ", ".join(gb_beats), cols=2,
             sub="two old-generation frames, then the written concepts that replaced them",
             cells=cells)
    p = dict(id="P10", board=2,
             title="Written, then replaced before anything was drawn",
             lede=("On 2026-08-05 this beat was written as gen-B %s. It was replaced during the "
                   "08-06 re-author before image generation ever reached it, so no pixels exist "
                   "for it anywhere - it survives only as text. The current text for the same "
                   "beat sits beside it." % gb_ids[0]),
             groups=[g], questions=[])
    prose_imgs = [c["idx"] for c in cells if c["kind"] == "img"]
    p["questions"] = [
        qb.add("P10", 2, "Read the two written concepts against each other: which one do you want "
                         "made?", "free", prose_imgs),
        qb.add("P10", 2, "The unrendered one puts a crowd, a dated prop and a place-establishing "
                         "sign into one frame. Is that the level of detail you want in a shot "
                         "description generally, or is it too much for a two-second beat?",
               "free", prose_imgs),
        qb.add("P10", 2, "Name one thing in the unrendered text that the current text should get "
                         "back, and one thing it is better off without.", "keep-drop", prose_imgs),
    ]
    panels.append(p)

    # P11/P12 - the rest of the audit arc: named old frames with no redraw yet
    rest = [b for b in S["audit_arc"] if b not in gb_beats]
    half = (len(rest) + 1) // 2
    for gi, chunk_beats in enumerate([rest[:half], rest[half:]]):
        if not chunk_beats:
            continue
        pid = "P%d" % (11 + gi)
        # M2: the chunk's own id range can contain a beat id with no beat-map.json row at all (a
        # catalog gap, not a beat that was simply not carried in) - close it if a frame survives
        # for it anywhere, else say so explicitly instead of silently dropping it from the count.
        lo, hi = lnum(chunk_beats[0]), lnum(chunk_beats[-1])
        present = set(lnum(b) for b in chunk_beats)
        gap_ids = ["L%d" % n for n in range(lo, hi + 1) if n not in present]
        cells = []
        prose = []
        gap_notes = []
        entries = [("beat", b) for b in chunk_beats] + [("gap", g) for g in gap_ids]
        entries.sort(key=lambda e: lnum(e[1]))
        for kind, b in entries:
            if kind == "beat":
                for i in frames_for(ctx, reg, b, families=("A",)):
                    cells.append(cell_img(ctx, reg, i, b))
                prose.append(("%s - \u201c%s\u201d" % (b, vo(ctx, b)), prose_blocks(ctx, b)))
                continue
            gidx = gap_frame(reg, b)
            if gidx is not None:
                cells.append(dict(kind="img", idx=gidx, beat=b, show_beat=True,
                                   vo="(no beat-map.json entry - script line unknown)"))
                gap_notes.append("%s has no beat-map.json entry; its frame was recovered "
                                 "directly from the old board." % b)
            else:
                gap_notes.append("%s has no beat-map.json entry, and no frame for it survives "
                                 "in the old board or the pixel pool." % b)
        g = dict(heading="%s \u2013 %s" % (chunk_beats[0], chunk_beats[-1]), cols=3, cells=cells,
                 sub="old-generation frames, all named by you; none of these beats has been "
                     "redrawn" + (" (except where a gap note below says otherwise)"
                                  if gap_notes else ""))
        imgs = [c["idx"] for c in cells]
        lede = ("%d beats from the audit stretch. The current file has text for all of them and "
               "pixels for none - they sit in a tenth the pipeline has not reached. Their "
               "written prompts are collapsed under the grid." % len(chunk_beats))
        if gap_notes:
            lede += " " + " ".join(gap_notes)
        p = dict(id=pid, board=2,
                 title="Named on the old board, not yet redrawn (%s\u2013%s)"
                       % (chunk_beats[0], chunk_beats[-1]),
                 lede=lede,
                 groups=[g], questions=[], beat_prose=prose)
        p["questions"] = [
            qb.add(pid, 2, "What do these %d frames (%s\u2013%s) have in common that you want "
                           "the redraws to keep?"
                   % (len(chunk_beats), chunk_beats[0], chunk_beats[-1]), "free", imgs),
            qb.add(pid, 2, "Is there anything here you would now drop?", "keep-drop", imgs),
        ]
        panels.append(p)

    # P13 - the open slot
    p = dict(id="P13", board=2, title="Anything the questions missed",
             lede="One free slot, no picture.", groups=[], questions=[])
    p["questions"] = [
        qb.add("P13", 2, "Going through this board, did you notice anything that none of the "
                         "questions asked about?", "free", []),
    ]
    panels.append(p)

    # Old-board L215 - the final card of the old full-video board (Daniel's OLD-named range runs
    # L212-215; beat-map.json row OLD-L215). It never had a beat-map row or a place on either
    # board until now. Registered last, after every other frame on both boards, purely so this
    # board-1-only addition cannot shift the frame index any board-2 cell already relies on.
    # Sourced with the exact same board-anchored + pixel-match-upgrade rule as gap_frame(): the
    # old board's own embed is the anchor, a higher-resolution pixel-pool match upgrades it only
    # on an unambiguous match, and an ambiguous distance dies loud instead of guessing.
    l215_ref = BIDX.get("full-board.html", "L215 current best")
    if l215_ref is None:
        die("full-board.html card 'L215 current best' not found")
    raw_emb215, size_emb215, dh_emb215 = l215_ref
    rel215, dist215, size215, abspath215 = best_pool_match(dh_emb215)
    if 1.0 <= dist215 <= 5.0:
        die("L215: closest pixel match to its old-board card is ambiguous (distance %.2f)"
            % dist215)
    tag215 = "gen-A-old-214shot-2026-08-04"
    if dist215 < 1.0 and size215[0] > size_emb215[0]:
        l215_idx = reg.add(
            key=rel215, loader=lambda p=abspath215: open(p, "rb").read(),
            caption="%s - old board, final shot (L215)" % GEN_LABELS.get(tag215, tag215),
            gen_tag=tag215, date=file_date(abspath215), badges=[], beat="OLD-L215",
            provenance="%s (matches full-board.html card 'L215 current best' at distance %.2f)"
                       % (rel215, dist215))
    else:
        l215_idx = reg.add(
            key="board:full-board.html#L215 current best", loader=lambda r=raw_emb215: r,
            caption="%s - old board, final shot (L215)" % GEN_LABELS.get(tag215, tag215),
            gen_tag=tag215, date="", beat="OLD-L215",
            badges=[("warn", "board copy at %dx%d - no higher-resolution file survives"
                              % size_emb215)],
            provenance="full-board.html card 'L215 current best' (embedded copy)")
    p07_group["cells"].append(cell_img(ctx, reg, l215_idx, "OLD-L215", show_beat=False))
    old_count_sentence = "These are the %d frames that exist for it." % len(order)
    new_count_sentence = "These are the %d frames that exist for it." % (len(order) + 1)
    assert old_count_sentence in p07_panel["lede"], "P07 lede count sentence not found verbatim"
    p07_panel["lede"] = p07_panel["lede"].replace(old_count_sentence, new_count_sentence)
    for qid in p07_qids:
        qb.get(qid)["images"].append(l215_idx)

    # L28 place-plate probe (visual-kit/_staging/_pre-6c2-archive-2026-08-06/L28-r1probe.png) - the
    # MiniScribe place plate, head-on symmetric camera angle down the center aisle toward the
    # roller door, no figures. It has no board embed anywhere (never boarded), so it is sourced
    # directly as a pool original rather than through the board-anchor+pixel-match-upgrade rule
    # used for L215 above - the same die-loud-if-missing guard gap_frame() uses substitutes for
    # the ambiguous-match guard, since there is no board embed to disambiguate against. Registered
    # last, after every other frame on both boards (including L215 above), so it lands as P07's
    # 6th image and cannot shift any board-2 frame index. real_renders() deliberately excludes
    # this file's beat-map.json documentation entry from automatic panel-surfacing (see that
    # function) so this hand-splice is the only place it is sourced from.
    probe_rel = "visual-kit/_staging/_pre-6c2-archive-2026-08-06/L28-r1probe.png"
    probe_abs = resolve("_pre-6c2-archive-2026-08-06/L28-r1probe.png", KIT_STAGING_ROOTS)
    if probe_abs is None:
        die("pixel source missing for L28 place-plate probe: %s" % probe_rel)
    probe_tag = "gen-C-new246-p6b-tenth1-2026-08-06"
    probe_idx = reg.add(
        key=probe_rel, loader=lambda p=probe_abs: open(p, "rb").read(),
        caption="gen-C era - staging archive - place-plate probe (L28-r1probe)",
        gen_tag=probe_tag, date=file_date(probe_abs), badges=[], beat="L28",
        provenance="%s (never boarded; recovered directly from the pre-6c2 staging archive)"
                   % probe_rel)
    p07_group["cells"].append(cell_img(ctx, reg, probe_idx, "L28", show_beat=False))
    old_count_sentence2 = "These are the %d frames that exist for it." % (len(order) + 1)
    new_count_sentence2 = "These are the %d frames that exist for it." % (len(order) + 2)
    assert old_count_sentence2 in p07_panel["lede"], "P07 lede count sentence not found verbatim"
    p07_panel["lede"] = p07_panel["lede"].replace(old_count_sentence2, new_count_sentence2)
    for qid in p07_qids:
        qb.get(qid)["images"].append(probe_idx)

    # The rest of the L28 place-plate probe family (Daniel: one probe frame wasn't enough - he
    # wants the entire family on the board so he can point at the right one). Every distinct L28
    # render in the same staging directory as the r1probe above, not already shown on P07.
    # L28-retry1.png and L28.png in that directory are sha-identical to frames already on P07
    # (assets/_archive-pre-regen-2026-08-06/L28.png and scratchpad/L28-remint-attempt1.png
    # respectively) and are skipped rather than duplicated. L28-b5V.png is sha-identical to a
    # frame already registered elsewhere on the board (panel P03, reached there via the ordinary
    # board-anchor+pixel-match-upgrade route for a different beat) under the exact same pool key
    # constructed here - reg.add()'s existing exact-key-match dedup returns that index untouched
    # rather than re-reading/re-encoding it. Same sourcing route as r1probe: direct pool original,
    # die-loud if missing, no board embed to anchor against (so no ambiguity check applies).
    # Registered last, after r1probe, in a stable alphabetical-by-filename order.
    probe_family_dir = "_pre-6c2-archive-2026-08-06"
    probe_family_files = sorted([
        "L28-b4R-r1.png", "L28-b4R.png", "L28-b5V.png",
        "L28-composite-probe-distance.png", "L28-composite-probe-empty.png",
        "L28-composite-probe-foreground-props.png", "L28-group-probe-distance.png",
        "L28-plate-probe-empty.png", "L28-pre-anchor.png", "L28-round1-retry.png",
        "L28-tranche-b-repair.png",
    ])
    for fn in probe_family_files:
        rel = "visual-kit/_staging/%s/%s" % (probe_family_dir, fn)
        abspath = resolve("%s/%s" % (probe_family_dir, fn), KIT_STAGING_ROOTS)
        if abspath is None:
            die("pixel source missing for L28 probe-family file: %s" % rel)
        stem = fn[:-4]
        idx = reg.add(
            key=rel, loader=lambda p=abspath: open(p, "rb").read(),
            caption="gen-C era - staging archive - probe (%s)" % stem,
            gen_tag=probe_tag, date=file_date(abspath), badges=[], beat="L28",
            provenance="%s (never boarded; recovered directly from the pre-6c2 staging archive)"
                       % rel)
        p07_group["cells"].append(cell_img(ctx, reg, idx, "L28", show_beat=False))
        for qid in p07_qids:
            qb.get(qid)["images"].append(idx)
    old_count_sentence3 = "These are the %d frames that exist for it." % (len(order) + 2)
    new_count_sentence3 = ("These are the %d frames that exist for it."
                            % (len(order) + 2 + len(probe_family_files)))
    assert old_count_sentence3 in p07_panel["lede"], "P07 lede count sentence not found verbatim"
    p07_panel["lede"] = p07_panel["lede"].replace(old_count_sentence3, new_count_sentence3)
    return panels


def hstat(st):
    return {"named": "named by you", "not-named": "not named",
            "not-boarded": "never boarded"}[st]


def short(s, n=48):
    s = s.strip()
    return s if len(s) <= n else s[:n - 1].rstrip() + "\u2026"


# --------------------------------------------------------------------------------------
# 8. CSS - tokens generated from one dict so every token is defined in all three blocks
# --------------------------------------------------------------------------------------

LIGHT = OrderedDict([
    ("bg", "#f7f6f3"), ("panel", "#ffffff"), ("ink", "#1b1a17"), ("ink-dim", "#5c574e"),
    ("line", "#dedad2"), ("line-strong", "#c3bcaf"), ("accent", "#8a5a2b"),
    ("chip-bg", "#efece5"), ("chip-ink", "#3a3630"), ("named-bg", "#e4efdd"),
    ("named-ink", "#31502a"), ("warn-bg", "#f6e6cf"), ("warn-ink", "#6a4611"),
    ("prose-bg", "#f2f0ea"), ("prose-ink", "#2a2721"), ("q-bg", "#f0f4f8"),
    ("q-ink", "#16202b"), ("q-line", "#c6d4e0"), ("lb-bg", "rgba(24,22,19,.93)"),
    ("lb-ink", "#f4f1ea"), ("shadow", "0 1px 2px rgba(0,0,0,.07)"),
])
DARK = OrderedDict([
    ("bg", "#15140f"), ("panel", "#1d1b16"), ("ink", "#ece7dc"), ("ink-dim", "#a49c8c"),
    ("line", "#33302a"), ("line-strong", "#4b463d"), ("accent", "#d69a5c"),
    ("chip-bg", "#2a2721"), ("chip-ink", "#cfc8ba"), ("named-bg", "#25361f"),
    ("named-ink", "#b9d7a8"), ("warn-bg", "#3b2c14"), ("warn-ink", "#e8c48a"),
    ("prose-bg", "#232019"), ("prose-ink", "#ddd6c8"), ("q-bg", "#1b232b"),
    ("q-ink", "#dbe7f2"), ("q-line", "#33454f"), ("lb-bg", "rgba(8,7,6,.95)"),
    ("lb-ink", "#f4f1ea"), ("shadow", "0 1px 2px rgba(0,0,0,.5)"),
])


# per-element layout variables, set inline with an in-CSS fallback - never theme tokens,
# so they are exempt from the light/dark token completeness check.
LAYOUT_VARS = {"cols"}


def token_block(d):
    return "".join("--%s:%s;" % (k, v) for k, v in d.items())


def build_css(thumb_ratio, thumb_classes):
    assert set(LIGHT) == set(DARK), "token sets diverged"
    css = []
    css.append(":root{%s}" % token_block(LIGHT))
    css.append("@media (prefers-color-scheme: dark){:root:not([data-theme=\"light\"]){%s}}"
               % token_block(DARK))
    css.append(":root[data-theme=\"dark\"]{%s}" % token_block(DARK))
    css.append("""
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
 font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:22px 18px 90px}
h1{font-size:24px;margin:0 0 6px}
h2{font-size:19px;margin:0 0 4px}
h3{font-size:14px;margin:0 0 6px;color:var(--ink-dim);font-weight:600;letter-spacing:.01em}
a{color:var(--accent)}
.head{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;
 margin-bottom:18px;box-shadow:var(--shadow)}
.head p{margin:8px 0 0;color:var(--ink-dim)}
.head .how{color:var(--ink)}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.toc a{background:var(--chip-bg);color:var(--chip-ink);border:1px solid var(--line);
 border-radius:999px;padding:3px 10px;text-decoration:none;font-size:12.5px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;
 margin:0 0 20px;box-shadow:var(--shadow)}
.panel>.lede{color:var(--ink-dim);margin:2px 0 14px}
.qrange{display:inline-block;background:var(--q-bg);color:var(--q-ink);border:1px solid var(--q-line);
 border-radius:6px;padding:2px 8px;font-size:12.5px;font-weight:600;margin-bottom:8px}
.grp{margin:16px 0 6px;padding-top:12px;border-top:1px solid var(--line)}
.grp:first-of-type{border-top:0;padding-top:0}
.grp .sub{color:var(--ink-dim);font-size:12.5px;margin:0 0 8px}
.g{display:grid;gap:12px;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}
@media (max-width:900px){.g{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:620px){.g{grid-template-columns:minmax(0,1fr)}}
figure{margin:0}
.th{display:block;width:100%%;aspect-ratio:%(ratio)s;border:1px solid var(--line-strong);
 border-radius:7px;background-color:var(--chip-bg);background-size:cover;background-position:center;
 cursor:zoom-in;padding:0}
.th:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
figcaption{font-size:12px;color:var(--ink-dim);margin-top:5px;word-break:break-word}
figcaption .beat{color:var(--ink);font-weight:600}
.badge{display:inline-block;border-radius:5px;padding:1px 6px;font-size:11px;margin:3px 4px 0 0;
 border:1px solid var(--line)}
.badge.named{background:var(--named-bg);color:var(--named-ink)}
.badge.warn{background:var(--warn-bg);color:var(--warn-ink)}
.badge.plain{background:var(--chip-bg);color:var(--chip-ink)}
.prosecard{background:var(--prose-bg);color:var(--prose-ink);border:1px dashed var(--line-strong);
 border-radius:7px;padding:10px 12px;min-height:120px}
.prosecard .t{font-size:12px;font-weight:600;color:var(--ink-dim);margin-bottom:6px}
.prosecard p{margin:0;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
 white-space:pre-wrap}
details{margin-top:10px}
summary{cursor:pointer;font-size:12.5px;color:var(--ink-dim)}
details pre{background:var(--prose-bg);color:var(--prose-ink);border:1px solid var(--line);
 border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-word;
 font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:8px 0 0}
.qs{list-style:none;padding:0;margin:14px 0 0}
.q{background:var(--q-bg);color:var(--q-ink);border:1px solid var(--q-line);border-radius:8px;
 padding:10px 12px;margin:8px 0}
.q .qid{font-weight:700;margin-right:8px}
.q .kind{float:right;font-size:11px;color:var(--q-ink);opacity:.7;text-transform:uppercase;
 letter-spacing:.04em}
.tags{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:8px}
.tags li label{display:inline-flex;align-items:center;gap:6px;background:var(--panel);
 border:1px solid var(--line);border-radius:6px;padding:3px 8px;font-size:12.5px;color:var(--ink)}
.note{font-size:12px;color:var(--ink-dim);margin-top:6px}
#lb[hidden]{display:none}
#lb{position:fixed;inset:0;overflow:auto;background:var(--lb-bg);color:var(--lb-ink);z-index:60}
#lbbar{position:sticky;top:0;display:flex;gap:10px;align-items:center;justify-content:space-between;
 padding:8px 12px;background:var(--lb-bg);border-bottom:1px solid rgba(255,255,255,.14)}
#lbcap{font-size:12.5px}
#lbbar button{background:transparent;color:var(--lb-ink);border:1px solid rgba(255,255,255,.35);
 border-radius:6px;padding:4px 10px;font-size:12.5px;cursor:pointer}
#lbwrap{padding:14px}
#lbimg{display:block;margin:0 auto;max-width:100%%;height:auto}
#lb.zoom #lbimg{max-width:none}
""" % dict(ratio=thumb_ratio))
    css.append("".join(thumb_classes))
    return "\n".join(css)


# --------------------------------------------------------------------------------------
# 9. HTML
# --------------------------------------------------------------------------------------


def esc(s):
    return htmlmod.escape(s or "", quote=True)


def render_badges(badges):
    return "".join('<span class="badge %s">%s</span>' % (k, esc(v)) for k, v in badges)


def render_cell(reg, cell, panel_id):
    if cell["kind"] == "prose":
        return ('<div class="prosecard"><div class="t">%s</div><p>%s</p><div>%s</div></div>'
                % (esc(cell["title"]), esc(cell["text"]), render_badges(cell["badges"])))
    rec = reg.rec(cell["idx"])
    beats = " / ".join(rec["beats"]) or "frame"
    label = ""
    if cell.get("show_beat", True):
        label = '<span class="beat">%s</span> “%s”<br>' % (esc(beats),
                                                                    esc(cell.get("vo") or ""))
    return ('<figure><button class="th t%d" data-i="%d" data-p="%s" '
            'aria-label="open %s full size"></button>'
            '<figcaption>%s%s<div>%s</div></figcaption></figure>'
            % (rec["idx"], rec["idx"], esc(panel_id), esc(beats),
               label, esc(rec["caption"]), render_badges(rec["badges"])))


def render_question(q):
    kind = {"free": "one sentence", "tag": "tick tags", "keep-drop": "keep / drop"}[q["answer_type"]]
    body = ('<li class="q" id="%s"><span class="kind">%s</span>'
            '<span class="qid">%s</span><span class="qtext">%s</span>'
            % (q["qid"], kind, q["qid"], esc(q["question_text"])))
    if q["answer_type"] == "tag":
        body += '<ul class="tags">' + "".join(
            '<li><label><input type="checkbox" disabled> (%s) %s</label></li>' % (k, esc(v))
            for k, v in TAG_OPTIONS) + "</ul>"
    body += "</li>"
    return body


def render_panel(reg, p, qmap):
    out = ['<section class="panel" id="%s">' % p["id"]]
    qids = sorted(p["questions"], key=lambda q: int(q[1:]))
    out.append('<div class="qrange">%s \u00b7 answer in the terminal by id: %s</div>'
               % (p["id"], ", ".join(qids)))
    out.append("<h2>%s</h2>" % esc(p["title"]))
    out.append('<div class="lede">%s</div>' % p["lede"])
    for g in p["groups"]:
        out.append('<div class="grp">')
        if g.get("heading"):
            out.append("<h3>%s</h3>" % esc(g["heading"]))
        if g.get("sub"):
            out.append('<p class="sub">%s</p>' % esc(g["sub"]))
        out.append('<div class="g" style="--cols:%d">' % g.get("cols", 3))
        for c in g["cells"]:
            out.append(render_cell(reg, c, p["id"]))
        out.append("</div>")
        for lbl, txt in (g.get("prose") or []):
            out.append("<details><summary>%s</summary><pre>%s</pre></details>"
                       % (esc(lbl), esc(txt)))
        if g.get("tag_q"):
            out.append('<ul class="qs">%s</ul>' % render_question(qmap[g["tag_q"]]))
        out.append("</div>")
    for beat_label, blocks in (p.get("beat_prose") or []):
        for lbl, txt in blocks:
            out.append("<details><summary>%s \u2014 %s</summary><pre>%s</pre></details>"
                       % (esc(beat_label), esc(lbl), esc(txt)))
    panel_qs = [qmap[q] for q in p["questions"] if qmap[q]["answer_type"] != "tag"]
    if panel_qs:
        out.append('<ul class="qs">%s</ul>' % "".join(render_question(q) for q in panel_qs))
    out.append("</section>")
    return "\n".join(out)


# One illustrative example per board, anchored to a real qid that actually renders on that board
# (fixes M9: board 2's header used to cite a board-1 qid). render_board asserts the anchor holds.
HEAD_EXAMPLES = {
    1: ("Q7", "a,c"),
    2: ("Q40", "the new one reads cleaner, nothing else changed"),
}


def head_how(example_qid, example_text):
    return (
        "Answer in the terminal by question id \u2014 \u201c%s: %s\u201d. The checkboxes are there "
        "so you can see the tag set; they do not record anything. Click any frame for its full "
        "size (\u2190 / \u2192 to move through the panel, Esc to close). Frames are labelled with "
        "their generation and date only." % (example_qid, example_text))


def render_board(reg, panels, board_no, boards_meta, stats, css, lb_payload):
    qmap = {q["qid"]: q for q in stats["questions"]}
    mine = [p for p in panels if p["board"] == board_no]
    other = [b for b in boards_meta if b["no"] != board_no]
    ex_qid, ex_text = HEAD_EXAMPLES[board_no]
    assert qmap[ex_qid]["board"] == board_no, \
        "head-how example %s does not belong to board %d" % (ex_qid, board_no)
    parts = []
    parts.append('<meta charset="utf-8">')
    parts.append('<meta name="viewport" content="width=device-width,initial-scale=1">')
    parts.append("<title>%s</title>" % esc(boards_meta[board_no - 1]["title"]))
    parts.append("<style>%s</style>" % css)
    parts.append('<div class="wrap">')
    parts.append('<div class="head"><h1>%s</h1>' % esc(boards_meta[board_no - 1]["title"]))
    parts.append("<p>%s</p>" % boards_meta[board_no - 1]["lede"])
    parts.append('<p class="how">%s</p>' % head_how(ex_qid, ex_text))
    parts.append("<p>This board carries %d of the %d panels and %d of the %d questions; the other "
                 "%d panels are on %s. Every frame here is the frame that was on the board you "
                 "reviewed, matched pixel-for-pixel to its full-resolution original where one "
                 "survives; every count on this page is computed from <code>beat-map.json</code>, "
                 "<code>generations-index.json</code> and the boards themselves at build time.</p>"
                 % (len(mine), len(panels),
                    sum(len(p["questions"]) for p in mine), len(stats["questions"]),
                    len(panels) - len(mine),
                    ", ".join('<a href="%s">%s</a>' % (o["link"], esc(o["short"])) for o in other)))
    parts.append('<div class="toc">%s</div>' % "".join(
        '<a href="#%s">%s \u00b7 %s</a>' % (p["id"], p["id"], esc(short(p["title"], 44)))
        for p in mine))
    parts.append("</div>")
    for p in mine:
        parts.append(render_panel(reg, p, qmap))
    parts.append('<p class="note">Built by <code>_build_elicit_board.py</code> from '
                 '<code>beat-map.json</code> (%d beats) and <code>generations-index.json</code> '
                 '(%d named beats). Frames on this board: %d. Lightbox images are separate, '
                 'higher-resolution copies of the same frames.</p>'
                 % (stats["n_beats"], stats["n_named"], len(lb_payload)))
    parts.append("</div>")
    parts.append('<div id="lb" hidden role="dialog" aria-modal="true" aria-label="full size frame">'
                 '<div id="lbbar"><span id="lbcap"></span><span>'
                 '<button id="lbzoom" type="button">actual size</button> '
                 '<button id="lbx" type="button">close (Esc)</button></span></div>'
                 '<div id="lbwrap"><img id="lbimg" alt=""></div></div>')
    parts.append("<script>%s</script>" % LB_JS.replace("__LB__", json.dumps(lb_payload))
                 .replace("__PAN__", json.dumps(stats["panel_images"])))
    return "\n".join(parts)


LB_JS = r"""
(function(){
var LB=__LB__, PAN=__PAN__;
var lb=document.getElementById('lb'),img=document.getElementById('lbimg'),
    cap=document.getElementById('lbcap'),zoom=document.getElementById('lbzoom');
var list=[],pos=0,open=false;
function show(){var r=LB[list[pos]];if(!r)return;img.src=r.s;img.alt=r.c;
  cap.textContent=r.c+'  ('+(pos+1)+' of '+list.length+')  '+r.p;}
function openAt(panel,i){list=(PAN[panel]||[i]).slice();var k=list.indexOf(i);
  pos=k<0?0:k;lb.hidden=false;lb.classList.remove('zoom');zoom.textContent='actual size';
  open=true;show();lb.scrollTop=0;document.body.style.overflow='hidden';}
function close(){lb.hidden=true;open=false;img.removeAttribute('src');
  document.body.style.overflow='';}
document.addEventListener('click',function(e){
  var t=e.target.closest?e.target.closest('.th'):null;
  if(t){openAt(t.getAttribute('data-p'),parseInt(t.getAttribute('data-i'),10));}
});
document.getElementById('lbx').addEventListener('click',close);
zoom.addEventListener('click',function(){lb.classList.toggle('zoom');
  zoom.textContent=lb.classList.contains('zoom')?'fit to width':'actual size';});
document.addEventListener('keydown',function(e){
  if(!open)return;
  if(e.key==='Escape'){close();}
  else if(e.key==='ArrowRight'){pos=(pos+1)%list.length;show();lb.scrollTop=0;}
  else if(e.key==='ArrowLeft'){pos=(pos-1+list.length)%list.length;show();lb.scrollTop=0;}
});
})();
"""


# --------------------------------------------------------------------------------------
# 10. BUILD + ASSERTS
# --------------------------------------------------------------------------------------


def parse_args(argv):
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--board1-url", default=None,
                    help="href to emit for board 1's cross-link (default: the relative filename "
                         "elicit-board.html - only correct when both boards are hosted side by "
                         "side; pass a real URL once each board is published separately)")
    p.add_argument("--board2-url", default=None,
                    help="href to emit for board 2's cross-link (default: elicit-board-2.html)")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    ctx = load_ctx()
    S = derive_sets(ctx)
    reg = Registry()
    qb = QBook()
    panels = build_panels(ctx, reg, qb, S)
    questions = qb.qs

    # ---- derived asserts on selection ------------------------------------------------
    assert len(P6B_LIKED) == 21, "p6b liked list must be 21 of 25 (spec)"
    assert len(C6C2_LIKED) == 9, "6c2 liked list must be 9 of 25 (spec)"
    assert len(S["c6c2_disliked"]) == len(C6C2_RANGE) - len(C6C2_LIKED), \
        "6c2 not-named count must be the complement of the liked list"
    # every beat Daniel named on a board must land in the matching derived liked set
    for row in ctx["beats"]:
        nb = row["named_by"]
        nb = [nb] if isinstance(nb, str) else list(nb)
        n = lnum(row.get("new_L") or "")
        if any(x.startswith("daniel-named:6C2-board") for x in nb):
            assert n in C6C2_LIKED, "%s named on 6c2 board but not in the liked set" % row["beat_id"]
        if any(x.startswith("daniel-named:P6B-board") for x in nb):
            assert n in P6B_LIKED, "%s named on p6b board but not in the liked set" % row["beat_id"]
    # every not-named 6c2 beat appears on the board and carries exactly one tag question
    tagged = {}
    for q in questions:
        if q["answer_type"] == "tag":
            tagged.setdefault(q["beat"], []).append(q["qid"])
    for b in S["c6c2_disliked"]:
        assert b in tagged, "6c2 not-named beat %s has no taxonomy tag question" % b
        assert len(tagged[b]) == 1, "%s has %d tag questions, expected 1" % (b, len(tagged[b]))
    for b in S["p6b_disliked"]:
        assert b in tagged, "p6b not-named beat %s has no taxonomy tag question" % b
    assert set(tagged) == set(S["c6c2_disliked"]) | set(S["p6b_disliked"]), \
        "tag questions exist for beats outside the not-named sets"
    # panel question budget: 2..4 non-tag questions per panel
    for p in panels:
        n_free = len([q for q in questions if q["panel"] == p["id"] and q["answer_type"] != "tag"])
        assert 1 <= n_free <= 4, "panel %s has %d non-tag questions" % (p["id"], n_free)
    assert len(questions) >= 25, "question count %d below the required 25" % len(questions)
    assert len(set(q["qid"] for q in questions)) == len(questions), "duplicate qids"
    for q in questions:
        assert q["answer_type"] in ("free", "tag", "keep-drop"), q
        assert q["question_text"].strip().endswith(("?", ".")), "unterminated question " + q["qid"]

    # ---- image registry asserts ------------------------------------------------------
    assert len(reg.order) == len(set(reg.order)), "duplicate image keys in the registry"
    for k, ok, dist, tag_new, tag_old in reg.collapsed:
        assert gen_family(tag_new) == gen_family(tag_old), (
            "the same pixels are claimed by two generations: %s (%s) == %s (%s) at distance %.3f "
            "- a provenance error in the inputs, not a board bug" % (k, tag_new, ok, tag_old, dist))
    used = set()
    panel_images = {}
    for p in panels:
        idxs = []
        for g in p["groups"]:
            for c in g["cells"]:
                if c["kind"] == "img":
                    if c["idx"] not in idxs:
                        idxs.append(c["idx"])
                    used.add(c["idx"])
        panel_images[p["id"]] = idxs
        assert len(idxs) == len(set(idxs)), "panel %s repeats a frame" % p["id"]
    all_idx = set(range(len(reg)))
    assert used == all_idx, "unreferenced frames in the registry: %r" % sorted(all_idx - used)

    # boards each carry their own copy of every frame they show
    board_imgs = {1: [], 2: []}
    for p in panels:
        for i in panel_images[p["id"]]:
            if i not in board_imgs[p["board"]]:
                board_imgs[p["board"]].append(i)

    stats = dict(n_beats=len(ctx["beats"]), n_named=len(ctx["gens"]), questions=questions)

    boards_meta = [
        dict(no=1, file="elicit-board.html", link=args.board1_url or "elicit-board.html",
             short="board 1 \u00b7 the 6c2 tenth",
             title="Taste elicitation \u00b7 board 1 \u2014 the 6c2 tenth",
             lede=("The second tenth (%s\u2013%s) scored %d named of %d. This board puts those %d "
                   "not-named frames next to the frames you did name, and next to the "
                   "old-generation frame of the same script beat."
                   % ("L26", "L50", len(C6C2_LIKED), len(C6C2_RANGE), len(C6C2_RANGE) - len(C6C2_LIKED)))),
        dict(no=2, file="elicit-board-2.html", link=args.board2_url or "elicit-board-2.html",
             short="board 2 \u00b7 first tenth + old arc",
             title="Taste elicitation \u00b7 board 2 \u2014 first tenth and the old-generation arc",
             lede=("The first tenth scored %d of %d named. This board carries the %d it missed, "
                   "the beats where the new generation won, and the stretch of old-generation "
                   "frames you named that has not been redrawn yet."
                   % (len(P6B_LIKED), len(P6B_RANGE), len(P6B_RANGE) - len(P6B_LIKED)))),
    ]

    # ---- encode + emit, walking the quality ladder until both boards fit -------------
    chosen = None
    outputs = None
    for setting in LADDER:
        thumbs = {}
        lightbox = {}
        for i in range(len(reg)):
            rec = reg.rec(i)
            # a low-resolution source still gets a lightbox that adds something: the thumb is
            # capped at 1/1.4 of the source width, never at the source width itself.
            th_side = min(setting["th_max"], int(rec["size"][0] / 1.4))
            tb, tsz = encode(rec["im"], th_side, setting["th_q"])
            lbb, lsz = encode(rec["im"], setting["lb_max"], setting["lb_q"])
            assert tb != lbb, "thumb and lightbox bytes identical for frame %d" % i
            assert lsz[0] >= tsz[0] * 1.2, \
                "lightbox (%dpx) not meaningfully larger than the thumb (%dpx) for frame %d" \
                % (lsz[0], tsz[0], i)
            thumbs[i] = tb
            lightbox[i] = (lbb, lsz)
        outputs = {}
        for meta in boards_meta:
            idxs = board_imgs[meta["no"]]
            classes = ["".join('.t%d{background-image:url("%s")}' % (i, data_uri(thumbs[i]))
                               for i in idxs)]
            css = build_css("16/9", classes)
            payload = {}
            for i in idxs:
                rec = reg.rec(i)
                payload[i] = dict(s=data_uri(lightbox[i][0]),
                                  c="%s \u00b7 %s \u00b7 shown at %dx%d of %dx%d"
                                    % (" / ".join(rec["beats"]), rec["caption"],
                                       lightbox[i][1][0], lightbox[i][1][1],
                                       rec["size"][0], rec["size"][1]),
                                  p=rec["provenance"])
            pstats = dict(stats)
            pstats["panel_images"] = {p["id"]: panel_images[p["id"]] for p in panels
                                      if p["board"] == meta["no"]}
            doc = render_board(reg, panels, meta["no"], boards_meta, pstats, css, payload)
            outputs[meta["file"]] = doc
        if all(len(d.encode("utf-8")) <= SIZE_LIMIT for d in outputs.values()):
            chosen = setting
            break
    if chosen is None:
        die("no ladder setting fits under %d bytes per board" % SIZE_LIMIT)

    # ---- output asserts --------------------------------------------------------------
    for fname, doc in outputs.items():
        b = doc.encode("utf-8")
        assert len(b) <= SIZE_LIMIT, "%s is %.2fMB, over the 15.5MB cap" % (fname, len(b) / 1048576.0)
        assert doc.startswith('<meta charset="utf-8">'), "%s: charset is not the first node" % fname
        assert "display:grid" not in doc.split("</style>")[1], \
            "%s: a grid is declared outside the .g rule (responsive fallback would miss it)" % fname
        # every token used is defined, and defined in both dark blocks
        for tok in set(re.findall(r"var\(--([a-z0-9-]+)", doc)):
            assert tok in LIGHT or tok in LAYOUT_VARS, \
                "%s: token --%s used but never defined" % (fname, tok)
        head = doc.split("</style>")[0]
        dark_blocks = re.findall(r"(?:prefers-color-scheme: dark\)\{:root[^{]*|\[data-theme=\\?\"dark\\?\"\])\{([^}]*)\}", head)
        assert len(dark_blocks) == 2, "%s: expected 2 dark token blocks, found %d" % (fname, len(dark_blocks))
        for blk in dark_blocks:
            for tok in LIGHT:
                assert "--%s:" % tok in blk, "%s: --%s missing from a dark block" % (fname, tok)
        assert "#lb{position:fixed;inset:0;overflow:auto" in doc, "%s: lightbox not scrollable" % fname
        assert doc.count('id="lb"') == 1
        # the two boards must reach each other, or half the questions are unreachable
        # (checked against the emitted link, which --board1-url/--board2-url can override
        # away from the default relative filename)
        for om in [m for m in boards_meta if m["file"] != fname]:
            assert 'href="%s"' % om["link"] in doc, \
                "%s: no link to %s" % (fname, om["link"])
        # every question id is rendered exactly once, on exactly one board
    for q in questions:
        hits = [f for f, d in outputs.items() if ('id="%s"' % q["qid"]) in d]
        assert len(hits) == 1, "%s appears on %r, expected exactly one board" % (q["qid"], hits)
        assert hits[0] == boards_meta[q["board"] - 1]["file"], \
            "%s is rendered on the wrong board" % q["qid"]
        for k in q["images"]:
            assert reg.rec(k)["key"], "question %s references an unknown frame" % q["qid"]

    for fname, doc in outputs.items():
        with open(os.path.join(HERE, fname), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(doc)

    manifest = []
    for q in questions:
        manifest.append(OrderedDict([
            ("qid", q["qid"]), ("panel", q["panel"]), ("board", q["board"]),
            ("beat", q["beat"]),
            ("images", [reg.rec(i)["key"] for i in q["images"]]),
            ("question_text", q["question_text"]),
            ("answer_type", q["answer_type"]),
            ("tag_options", q["tag_options"]),
        ]))
    with open(os.path.join(HERE, "elicit-questions.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    # ---- build report ---------------------------------------------------------------
    print("panels: %d  (board 1: %d, board 2: %d)"
          % (len(panels), len([p for p in panels if p["board"] == 1]),
             len([p for p in panels if p["board"] == 2])))
    print("questions: %d  (free %d, keep-drop %d, tag %d)"
          % (len(questions),
             len([q for q in questions if q["answer_type"] == "free"]),
             len([q for q in questions if q["answer_type"] == "keep-drop"]),
             len([q for q in questions if q["answer_type"] == "tag"])))
    print("distinct frames: %d  (board 1: %d, board 2: %d)"
          % (len(reg), len(board_imgs[1]), len(board_imgs[2])))
    print("encode setting: %r" % (chosen,))
    for fname, doc in outputs.items():
        print("%-22s %7.2f MB" % (fname, len(doc.encode("utf-8")) / 1048576.0))
    if reg.collapsed:
        print("near-duplicate frames collapsed (kept one lightbox entry each):")
        for a, b, d, _t1, _t2 in reg.collapsed:
            print("   %s  ==  %s   (distance %.3f)" % (a, b, d))
    print("6c2 not-named beats tagged: %d" % len(S["c6c2_disliked"]))
    print("p6b not-named beats tagged: %d" % len(S["p6b_disliked"]))
    print("audit-arc beats carried:    %d" % len(S["audit_arc"]))
    print("OK")


if __name__ == "__main__":
    main()
