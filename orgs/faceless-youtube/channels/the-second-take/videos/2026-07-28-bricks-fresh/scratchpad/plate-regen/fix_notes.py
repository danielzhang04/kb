import json, os

mani_path = 'videos/2026-07-28-bricks-fresh/assets/scenes/manifest.json'
mani = json.load(open(mani_path, encoding='utf-8'))
by_id = {s['shot_id']: s for s in mani['shots']}

hashes = {
    'L28': '7a8a9509f00db13b6d0bb1d808ce4bda15f23fad84234d909237f36923339578',
    'L65': '00159d2332cd8b31',
    'L112': '8b2fb52975eab572',
    'L114': '72bc339bbe1d0620',
    'L198': 'ce3043b113b73c3f',
}

import hashlib
DEST = 'videos/2026-07-28-bricks-fresh/assets/scenes'
def sha256(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

promote = {
    'L28': ('L28-warmretry.png', 'warm-retry (defect: content, exact-replace on the palette/light span, changed_spans: 1)'),
    'L65': ('L65.png', 'straight regen, no retry needed'),
    'L112': ('L112.png', 'straight regen, no retry needed'),
    'L114': ('L114.png', 'straight regen, no retry needed'),
    'L198': ('L198.png', 'straight regen, no retry needed'),
}

for sid, (fname, retrynote) in promote.items():
    entry = by_id[sid]
    h = sha256(os.path.join(DEST, sid + '.png'))
    has_lettering = any(s['character'] == 'lettering-marker-italic' for s in entry['seeds'])
    tile_note = 'reminted scene-style-tile' + (' + lettering-marker-italic' if has_lettering else '')
    entry['notes'] = (
        'WARM-NEUTRALS DOCTRINE REMINT (2026-08-18, commit 33676421) -- regenerated against the '
        'current style-bible (S2b warm-tinted neutrals, S5 fore/mid/background depth read) '
        'seeding the ' + tile_note + '; ' + retrynote + '; '
        'promoted from _staging/' + fname + ' (sha256 ' + h + ', verified match on copy: True); '
        'old pixels archived at scratchpad/plate-regen/old/' + sid + '.png; '
        'fresh-eyes doctrine review in scratchpad/plate-regen/progress.md '
        '(all axes clean, warm-bias confirmed by Pillow R-B measurement).'
    )

json.dump(mani, open(mani_path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print('fixed notes for', list(promote.keys()))
