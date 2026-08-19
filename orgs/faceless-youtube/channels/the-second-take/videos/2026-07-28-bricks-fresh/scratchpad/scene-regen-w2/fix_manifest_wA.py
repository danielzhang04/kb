import json

p = 'C:/Users/danie/kb-clones/bricks-arc/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/manifest.json'
d = json.load(open(p, encoding='utf-8'))

KIT = "channels/the-second-take/visual-kit/refs"
VID = "channels/the-second-take/videos/2026-07-28-bricks-fresh"

def canon(char): return f"{KIT}/{char}/{char}.png"
def base(name): return f"{KIT}/base/{name}.png"
def env(name): return f"{KIT}/env/{name}.png"
def lib(name): return f"{VID}/assets/library/{name}.png"

entries = {
 "L01": dict(
   technique="(b) Seeded composition -- locked character(s) in composed environment",
   seeds=[{"path": canon("pc-boxy"), "role": "canonical", "character": "pc-boxy"},
          {"path": base("expr-delighted"), "role": "expression", "character": "pc-boxy"}],
   retry_cause=None,
   sha="de3bff31d5630813a98a06dd74cd1476a895d676ef0573693f7f93ff948e526f",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). `pc-boxy` canonical + `expr-delighted` seeded directly, no pose primitive. Round-1 clean, no retry needed."),
 "L02": dict(
   technique="(c) Character-free scene -- cast-free composition",
   seeds=[{"path": lib("crowd-exemplar"), "role": "crowd", "character": None}],
   retry_cause="r1 defect (fidelity: unrequested lettering) fixed by exact replace -- from: \"with a cropped ticket-booth corner stage-left\" -> to: \"with a cropped ticket-booth corner stage-left, its window glass bare and blank, no signage, no lettering, no text of any kind on the booth\" (changed_spans: 1)",
   sha="046946793d1ac5519c3d068ae9c70b40807486a9e0254a41a6bc4fca8e553d03",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). RETRY overlay `L02-fix-w2` (forge-retry-overlay@2, defect: content); promoted from _staging/L02-fix-w2.png to canonical assets/scenes/L02.png."),
 "L03": dict(
   technique="(c) Character-free scene -- cast-free composition",
   seeds=[{"path": lib("crowd-exemplar"), "role": "crowd", "character": None}],
   retry_cause="r1 defect (rig: crowd hair/head-tone bounded-variety over the 2-3 cap) fixed by exact replace -- from: \"foreground a wall of raised applauding hands and shoulders fills the lower third, midground\" -> to: \"...fills the lower third, every crowd figure sharing the same two flat head tones and the same one repeating hairstyle silhouette across the whole group, midground\" (changed_spans: 1)",
   sha="add3397af9d76af1d037f389e25d4d7982b5823917af469afaa55f71f9edfeb5",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). RETRY overlay `L03-fix-w2` (forge-retry-overlay@2, defect: content); promoted from _staging/L03-fix-w2.png to canonical assets/scenes/L03.png."),
 "L04": dict(
   technique="(c) Character-free scene -- cast-free composition",
   seeds=[{"path": env("lettering-marker-italic"), "role": "environment", "character": "lettering-marker-italic"},
          {"path": env("scene-style-tile"), "role": "style-anchor", "character": "scene-style-tile"}],
   retry_cause="r1 defects (fidelity: unrequested 'SALE' tag; style: '1983' lettering in a digital/printed font, not marker-hand; rig: shutter drawn with hairline ridge lines finer than rig outline) fixed by ONE combined exact replace spanning the shutter/cartons/lettering clauses (changed_spans: 1) -- see retry-overlay-wA.json#L04 for the full from/to.",
   sha="cb6f36a550e4d59ecee01dad21aa03ad3841ff2be348081eedce066ad28fc947",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). LETTERING -- text-bearing prompt; SS5 exemplar `lettering-marker-italic` derived. STYLE TILE -- cast-free frame; SS5 anchor `scene-style-tile` derived. RETRY overlay `L04-fix-w2` (forge-retry-overlay@2, defect: content); promoted from _staging/L04-fix-w2.png to canonical assets/scenes/L04.png."),
 "L05": dict(
   technique="(b) Seeded composition -- locked character(s) in composed environment",
   seeds=[{"path": canon("pc-boxy"), "role": "canonical", "character": "pc-boxy"},
          {"path": base("expr-surprised"), "role": "expression", "character": "pc-boxy"}],
   retry_cause=None,
   sha="a7ddce096386fa8e891456e2ecf577d21c44cb6887476a82f4045d13d906c2b1",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). `pc-boxy` canonical + `expr-surprised` seeded directly. Round-1 clean, no retry needed."),
 "L06": dict(
   technique="(b) Seeded composition -- locked character(s) in composed environment",
   seeds=[{"path": lib("crowd-exemplar"), "role": "crowd", "character": None},
          {"path": env("prop-beige-pc"), "role": "prop", "character": "prop-beige-pc"}],
   retry_cause=None,
   sha="ed1aed150e0e7c2ee97e8e5e8f60e95bb9d1ae56183ef975289f5668bfcb2ecb",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). Re-authoring recast this shot's subject from `pc-boxy` to plain `prop-beige-pc` (unpersonified-object convention, matching L08/L15) -- seeds updated accordingly from the stale pre-re-author entry. `prop-beige-pc` match-prop canonical + crowd-exemplar seeded. Round-1 clean, no retry needed."),
 "L07": dict(
   technique="(b) Seeded composition -- locked character(s) in composed environment",
   seeds=[{"path": lib("crowd-exemplar"), "role": "crowd", "character": None},
          {"path": env("prop-beige-pc"), "role": "prop", "character": "prop-beige-pc"}],
   retry_cause=None,
   sha="ca3c647a717ef9e34f8cfdfe580662a3efdefc176dbd3fb4d4eaedb5b95a0dd8",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). Subject is `prop-beige-pc` (unpersonified object) per re-authored still_prompt, not pc-boxy as the stale pre-re-author entry had. `prop-beige-pc` match-prop canonical + crowd-exemplar seeded. Round-1 clean, no retry needed."),
 "L08": dict(
   technique="(c) Character-free scene -- cast-free composition",
   seeds=[{"path": lib("crowd-exemplar"), "role": "crowd", "character": None},
          {"path": env("prop-beige-pc"), "role": "prop", "character": "prop-beige-pc"}],
   retry_cause=None,
   sha="be7c05dc2f606933874cf81b03d1c96104e3e90fbd1072379e1cdf51cd19c201",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). `prop-beige-pc` match-prop canonical + crowd-exemplar seeded (four flying units, matching the shot's established design). Round-1 clean, no retry needed."),
 "L09": dict(
   technique="(c) Character-free scene -- cast-free composition",
   seeds=[{"path": lib("crowd-exemplar"), "role": "crowd", "character": None}],
   retry_cause="r1 defect (fidelity: unrequested 'CLOSED' sign on the shutter, not authored anywhere in still_prompt) fixed by exact replace -- from: \"midground a shuttered shop door at the near end with a dense line of grinning figures\" -> to: \"midground a bare unlettered shuttered shop door, no sign, no text, no lettering anywhere on the shutter, at the near end with a dense line of grinning figures\" (changed_spans: 1)",
   sha="a22a148da86d8aaf6a127182f738d0c59bb0fd015cce5670a7512f83af106452",
   notes="Regen under 2026-08-18 Act-1 re-author (worker A, wave 2). RETRY overlay `L09-fix-w2` (forge-retry-overlay@2, defect: content); promoted from _staging/L09-fix-w2.png to canonical assets/scenes/L09.png."),
}

touched = []
for s in d['shots']:
    sid = s.get('shot_id')
    if sid in entries:
        e = entries[sid]
        s['technique'] = e['technique']
        s['seeds'] = e['seeds']
        s['retry_cause'] = e['retry_cause']
        s['parent_depth'] = 0
        s['lineage'] = 0
        s['flagged'] = False
        s['notes'] = e['notes'] + " sha256=" + e['sha'] + "."
        touched.append(sid)

open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=1))
print("updated structural fields for:", sorted(touched))
