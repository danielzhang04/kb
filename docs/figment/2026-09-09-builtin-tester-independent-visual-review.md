# Built-in tester independent visual review — 2026-09-09

## Scope and method

Independent research review of the canonical `g01` reference against all five outputs from `creator-001-tensor-tester-first`. I viewed every source with `view_image` at `original` detail. The verdict below is based only on those images; I did not use an external vision model, image judge, or numeric identity score as evidence. Apparent-age comments are visual estimates with normal uncertainty, not statements of fact.

The reference reads as an unambiguously adult woman around the requested early-twenties presentation. Its strongest identity cues are a narrow oval/heart-shaped face and tapered chin; long, narrow almond eyes with an upswept outer contour; a compact straight nose; full, projected bow-shaped lips; and long center-parted black hair.

## Coverage and source integrity

| Source | Dimensions | Bytes | SHA-256 | Viewed |
|---|---:|---:|---|---|
| `g01.jpg` | 1408×768 | 737366 | `e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed` | Yes, original detail |
| `c001-tensor-tester-000000250.png` | 1448×2176 | 3021336 | `9648518e7df5126e501190cc507998577bde28c02c79a08b3e80dc8860272f26` | Yes, original detail |
| `c001-tensor-tester-000000500.png` | 1448×2176 | 3100313 | `d1654451e04a23c03e5ba1aeb157c06ecd65647c731abfb56d7ab3632f5c28c9` | Yes, original detail |
| `c001-tensor-tester-000000750.png` | 1448×2176 | 3494625 | `a1a46d8ab73ff0c95792ead47dd28519bf2e7cae168abbcf85f5dfb053966a70` | Yes, original detail |
| `c001-tensor-tester-000001000.png` | 1448×2176 | 3929273 | `0c05822833d88a43140c6b0395bdc09e201529b3a3a89813561667ab458837f0` | Yes, original detail |
| `c001-tensor-tester-final.png` | 1448×2176 | 3853718 | `c9ac839c4816279e20424dec5b62ccc0eb3502f799c6298b5e4fd1882a180a6a` | Yes, original detail |

Coverage is complete: one reference and five of five candidate outputs.

## Candidate findings

### Step 250 — CULL

- **Reference identity:** Clear mismatch. The candidate has a broader, longer face, heavier jaw, rounder eyes, wider nose and substantially thinner lips. Hair is pulled back and the overall facial structure does not read as `g01` under a styling change.
- **Between-candidate identity:** Also an outlier from every later checkpoint; it reads as a separate person rather than an early rendering of the later face.
- **Adult age:** Unambiguously adult, but appears roughly late twenties to mid-thirties and therefore misses the around-21 presentation.
- **Realism:** Strongest attribute. Skin has plausible pores, under-eye texture, tonal variation and restrained specularity; eyes and hairline are credible.
- **Visible anatomy, lighting, clothing:** Face, neck, shoulders and torso look anatomically coherent. Hands are outside the frame, so hand quality is untested. Soft warm frontal/window light is plausible. The opaque black crew-neck top is intact.

### Step 500 — CULL

- **Reference identity:** Superficially closer in hair and broad presentation, but still a different face: eyes are larger and rounder, the nose and philtrum differ, lips are thinner and less projected, and the jaw is longer and less tapered.
- **Between-candidate identity:** Does not match step 250. It begins the later black-haired, almond-eyed cluster, but its slimmer face and different eye/nose geometry do not hold cleanly into steps 750–final.
- **Adult age:** Clearly adult; reads approximately mid-to-late twenties, with some uncertainty, and older than the requested target.
- **Realism:** Generally photographic, with fine flyaway hair and believable eyes. Skin is slightly too uniform/soft in places but not strongly waxy.
- **Visible anatomy, lighting, clothing:** Visible head, neck, shoulders and torso are coherent. Hands are cropped out. Diffuse window light is credible but flatter than the reference. The black long-sleeve top renders cleanly.

### Step 750 — CULL

- **Reference identity:** Clear mismatch. The candidate's cheeks and lower face are broader, eyes are rounder and less strongly upswept, the nose is wider, and lip/chin geometry differs from `g01`.
- **Between-candidate identity:** Related to steps 500–final at a broad type level, but it has a rounder face and heavier lower cheeks than step 500. It is closer to 1000/final, though still not perfectly stable.
- **Adult age:** Unambiguously adult; reads around the late twenties to early thirties, older than target.
- **Realism:** Credible skin texture, mild under-eye detail, natural stray hairs and fabric. Some smoothing remains, but the image is plausibly photographic at normal viewing size.
- **Visible anatomy, lighting, clothing:** No visible facial, neck, shoulder or torso defect. Hands are not visible. Neutral diffuse light is consistent. Clothing is opaque and intact.

### Step 1000 — CULL

- **Reference identity:** It recovers some relevant styling cues—long center-part hair, upswept lashes, fuller lips and hoop earrings—but the structural identity remains wrong. The face is broader and rounder, the nose wider, the eyes rounder/closer-set in appearance, and the jaw less tapered than `g01`.
- **Between-candidate identity:** Plausibly the same generated person as final, with only small changes in facial width, eye makeup and pose. It is reasonably related to step 750, but not to step 250.
- **Adult age:** Clearly adult; reads roughly mid-twenties to late twenties. This is nearer the requested presentation than the earlier candidates, but still does not convincingly read around 21.
- **Realism:** Good overall. Fine skin texture, cheek color, hair flyaways and directional light read naturally. Skin remains slightly even and polished, but there is no severe plastic or anatomical failure.
- **Visible anatomy, lighting, clothing:** Head, neck, shoulders and torso are coherent. Hands remain outside the crop. Side-window light gives credible falloff. The black top is clean and fully rendered.

### Final — CULL

- **Reference identity:** Closest candidate only in hairstyle, makeup register and general presentation. The same decisive structural differences as step 1000 remain: broader mid/lower face, rounder eyes, wider nose, different mouth projection and a less pointed chin. It does not read as the canonical reference person.
- **Between-candidate identity:** Strong continuity with step 1000 and reasonable continuity with step 750. This late cluster is internally much more stable than the full sequence, but it has converged on the wrong identity.
- **Adult age:** Unambiguously adult; plausibly mid-twenties, with uncertainty. It approaches but does not reliably meet the around-21 target.
- **Realism:** Photographic at normal viewing size. Skin has visible texture and restrained highlights; hair, irises and fabric are coherent. Mild smoothing and an unusually controlled portrait finish remain.
- **Visible anatomy, lighting, clothing:** Visible face, neck, shoulders and torso look coherent. No hands are shown, so neither this checkpoint nor the set validates hands. Window-side light is believable. The opaque black top and jeans are intact, with no garment failure.

## Cross-checkpoint verdict

The sequence does not preserve one person. Step 250 is a distinct identity; step 500 is another material shift; steps 750, 1000 and final increasingly converge on a stable face, but that face is not `g01`. All five are clearly adult and mostly realistic, and none shows a clothing failure or a defect in the anatomy that is actually visible. The standardized crop excludes hands and most full-body anatomy, so those dimensions remain untested.

**Research recommendation: CULL all five for canonical identity use.** No checkpoint merits a held-out generation test because the required same-person match is absent. Steps 1000 and final may be retained only as diagnostic evidence that late training improves internal continuity and presentation realism; that is insufficient for promotion or further identity validation.

Main uncertainty: makeup, expression, focal length and the reference's wider environmental framing can shift perceived facial proportions and age. Those factors do not account for the repeated eye, nose, mouth, jaw and chin differences, so they do not change the cull decision.
