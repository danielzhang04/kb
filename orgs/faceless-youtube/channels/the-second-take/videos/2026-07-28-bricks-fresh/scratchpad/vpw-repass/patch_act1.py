import json, sys

PATH = "videos/2026-07-28-bricks-fresh/shots.json"

with open(PATH, encoding="utf-8") as f:
    d = json.load(f)

shots = d["long_form"]["shots"]
by_id = {s["id"]: s for s in shots}

# ---- new field values, keyed by shot id ----
# each entry: dict of fields to OVERWRITE on the existing shot dict.
# id/duration_s/vo_ref/vo_text/source/synthetic are left untouched.

NEW = {}

NEW["L01"] = dict(
    shot_class="personified-character",
    stage="era-livingroom", stage_role="base",
    still_prompt=(
        "`pc-boxy`, `expr-delighted`, planted centre on a low walnut-veneer table, stubby arms "
        "out to the sides. Seen from shag-carpet level looking slightly up, so the machine reads "
        "enthroned over the room: foreground the thick mustard shag running to the frame edge "
        "with the near couch arm cropping the lower-left corner, midground the low table carrying "
        "pc-boxy flanked by a fat orange lava lamp stage-left and a chunky silver boombox "
        "stage-right, background a brown corduroy couch and the picture rail running along a wall "
        "left completely blank. Warm lamp amber from a domed table lamp pooling across the shag, "
        "mustard-brown-cream palette throughout, the single red accent on the machine's power stud."
    ),
    notes=(
        "Opening peak. Era established through a personified machine rather than a date card; a "
        "low shag-level vantage enthrones it rather than defaulting to house eye-level frontal."
    ),
)

NEW["L02"] = dict(
    shot_class="idiom-pun",
    figures={"crowd": True},
    still_prompt=(
        "Beyond a chrome rail crossing low across the frame, a roller-rink lobby packed shoulder "
        "to shoulder with 1980s skaters in shoulder-padded jumpsuits and white hi-tops. Shot from "
        "floor level looking up: foreground the chrome rail and a cropped ticket-booth corner "
        "stage-left, midground the skaters' shoulders and grinning faces turned up and shouting "
        "over the music, background their teased blonde and copper hairdos stacked so high they "
        "fill the entire upper third of the frame like a hedge, thickest dead centre where one "
        "enormous blonde tower rises past the frame top. Chequer-tile floor underfoot, glowing "
        "pink and teal wall panels beyond the crowd, teal-pink-cream palette, flat even rink light."
    ),
    notes=(
        "Mass action: the era IS the mass, so it is staged as one rather than personified by a "
        "single stand-in. Crowd expression and attitude authored in prose (grinning, shouting) "
        "since a crowd carries no seeded expression. Low upward vantage makes the hair loom, which "
        "is the payload."
    ),
)

NEW["L03"] = dict(
    shot_class="ironic-counterpoint",
    figures={"crowd": True},
    still_prompt=(
        "Seen from a high vantage at the back of a hotel function room, looking down across the "
        "crowd toward an empty awards dais: foreground a wall of raised applauding hands and "
        "shoulders fills the lower third, midground a velvet rope crossing the room, background "
        "the dais itself stage-right under one hard overhead spot — an oversized display board "
        "angled on it, its face completely blank and unlettered, a lectern beside it with nobody "
        "behind it. Beyond the dais a pleated gold curtain wall and banquet tables run back "
        "through the depth. Gold-cream palette against a warm near-black room shadow, dim ambient "
        "light against the one hot spot on the empty dais."
    ),
    notes=(
        "Hook peak. Seen from over the crowd rather than the floor so the empty dais reads as the "
        "whole room's focus. The figureless dais across ~3.8s IS the argument: a standing ovation "
        "aimed at nobody is the scam nobody has heard of. No scam imagery yet, the VO has not "
        "disclosed it."
    ),
)

NEW["L04"] = dict(
    shot_class="diegetic-device",
    still_prompt=(
        "A suburban high-street electronics shop seen at a receding oblique angle along the empty "
        "dawn pavement: foreground the wet paving stretching away toward the shop, midground its "
        "half-raised shutter over a window stacked with beige computer cartons under a striped "
        "awning, a parked hatchback at the kerb further along stage-right, background the pavement "
        "continuing past a cropped lamp post at the frame edge. Cool blue dawn air with one warm "
        "amber shop-glow spilling out from under the shutter, blue-taupe-amber palette. Propped in "
        "that doorway light, a chalk sandwich board carrying the single chalked line '1983'."
    ),
    notes=(
        "Diegetic dateline; '1983' is the script's own year, quoted rather than gestured at. "
        "Figureless for ~2.5s and earned: the subject is the date and the shopfront, not a "
        "person. Oblique receding vantage instead of a dead-on elevation."
    ),
)

NEW["L05"] = dict(
    shot_class="personified-character",
    still_prompt=(
        "`pc-boxy`, `expr-surprised`, small in an open cardboard shipping crate packed with pale "
        "straw, stubby arms over the crate rim. Seen from slightly above looking down into the "
        "crate, as if just unpacked: foreground the straw and crate rim filling the lower frame, "
        "midground pc-boxy sitting in the packing, background oatmeal-grey steel shelving "
        "receding stage-left and a leaning stack of flat cartons stage-right under a bare bulb on "
        "a flex throwing one hard pool of light straight down onto the crate. Oatmeal-grey-cream-"
        "amber palette, the single red accent on a tape strip across the crate lip."
    ),
    notes="Newness staged as a machine still in its packing crate rather than a date.",
)

NEW["L06"] = dict(
    shot_class="crowd-multiplication",
    figures={"crowd": True},
    still_prompt=(
        "A `prop-beige-pc` unit alone on a lit turntable plinth, front panel to the viewer. Seen "
        "from just behind the plinth looking out, as if from the display's own vantage: "
        "foreground the plinth edge and warm display light pooling around the unit, midground a "
        "full-height plate window crossing the frame, background beyond the glass a packed crowd "
        "pressing shoulder to shoulder with palms flat on the pane, faces open and hungry. "
        "Cream-teal-amber palette, warm display light on the plinth against flat grey daylight "
        "outside."
    ),
    notes=(
        "Crowd is a genuine mass; the beat's subject is the wanting, so the crowd carries the "
        "authored expression and the machine stays an unpersonified object — the craze belongs to "
        "the people pressing at the glass, not to a machine reacting to them. Recast from "
        "`pc-boxy` to plain `prop-beige-pc`, matching the same unpersonified-object convention "
        "already used for mass/scale beats at L08 and L15."
    ),
)

NEW["L07"] = dict(
    shot_class="literal",
    figures={"crowd": True},
    still_prompt=(
        "A `prop-beige-pc` unit sits on a shop counter top, front panel turned to the far side. "
        "Seen low, along the counter surface looking toward the till: foreground the counter top "
        "and a cropped till corner at the lower-right, midground fistfuls of banknotes thrust "
        "across the counter from customers crowded three deep against it, arms eager and "
        "impatient, the notes never overlapping the unit, background a pegboard wall of coiled "
        "cables and a queue rope running back stage-left. Cream-brown-teal palette, even shop "
        "light."
    ),
    notes=(
        "'Anybody with money' is a genuine mass performing a real physical action (buying), so the "
        "beat is literal and carried by the crowd reaching for the unit rather than by an object "
        "reacting to them — recast from personified `pc-boxy` (smug reaction) to a plain "
        "`prop-beige-pc`; the true subject of this line is the buyers, not the machine."
    ),
)

NEW["L08"] = dict(
    shot_class="idiom-pun",
    figures={"crowd": True},
    still_prompt=(
        "Seen low, looking up along a shop aisle: foreground a cropped end-cap unit cutting the "
        "lower-right corner, midground white slat shelving stage-right with one whole shelf swept "
        "bare and a wire basket tipped over on the floor, background four `prop-beige-pc` units "
        "sailing overhead across the top of the frame trailing loose polystyrene chunks, over a "
        "rear-zone press of shoppers who have ducked in behind the shelving with their arms up and "
        "their eyes wide. Cream-oatmeal-amber palette, flat strip light."
    ),
    notes=(
        "The idiom drawn as a physical event; the reaction is carried by the mass it happens over, "
        "whose attitude is authored in prose. Low worm's-eye vantage catches the units sailing "
        "overhead, which is the payload."
    ),
)

NEW["L09"] = dict(
    shot_class="ironic-counterpoint",
    figures={"crowd": True},
    still_prompt=(
        "Seen from a high oblique vantage across the street, looking down the length of a "
        "shuttered shop's night queue: foreground a sodium street lamp and rooftop edge at the "
        "upper frame, midground a shuttered shop door at the near end with a dense line of "
        "grinning figures in bulky 1980s coats and padded ski jackets camped on folding stools and "
        "in sleeping bags, hoods up against the cold, background the queue running back along the "
        "pavement and around the far corner out of sight. Night-blue palette warmed by the one "
        "sodium lamp's amber pool, a cropped rubbish bin at the lower-left."
    ),
    notes=(
        "Anachronism is the joke: a modern launch queue staged in period dress, and the queue is "
        "genuinely a mass. High oblique vantage shows the queue's full length, arguing scale."
    ),
)

NEW["L10"] = dict(
    shot_class="personified-character",
    still_prompt=(
        "`pc-boxy`, `expr-talking`, one stubby arm holding its own hinged side panel open like a "
        "coat to show the bay behind it, where a single `prop-drive` sits seated and lit. Seen "
        "from slightly above the desk, looking down into the open bay: foreground a mug cropped "
        "at the lower-left, midground a chunky keyboard and pc-boxy centre frame with the panel "
        "held wide, background a coiled cable looping away stage-left across a plain desk top. "
        "Cream-teal-umber palette, one warm desk lamp raking from stage-right, the single red "
        "accent on the drive's activity stud."
    ),
    notes="Mechanism made legible through the personified machine rather than a cutaway diagram.",
)

NEW["L11"] = dict(
    shot_class="personified-character",
    stage="bedside-table", stage_role="base",
    still_prompt=(
        "`pc-boxy`, `expr-delighted`, on a bedside table stage-right, a `prop-drive` hugged "
        "between both stubby arms like a locket, its own screen face dark. Seen from the foot of "
        "the bed looking toward the nightstand: foreground the rumpled blanket corner running "
        "across the bottom of frame, midground the unmade bed reaching back stage-left, "
        "background the bedside table and a curtained window beyond. Warm amber bedside lamp "
        "against deep blue night, blue-amber-cream palette."
    ),
    notes="Memory staged as something held rather than explained.",
)

NEW["L12"] = dict(
    shot_class="ironic-counterpoint",
    stage="bedside-table", stage_role="delta", changed_elements=["+ bedside lamp goes out, room to deep blue dark, drive keeps its amber glow"],
    still_prompt=(
        "`pc-boxy` on the bedside table stage-right with the `prop-drive` hugged between both "
        "stubby arms, the rumpled blanket foreground, the unmade bed reaching back stage-left, "
        "the curtained window beyond, blue-amber-cream palette, seen from the foot of the bed as "
        "established. Only this changes: the bedside lamp is out and the whole room has gone deep "
        "blue dark, with the drive alone still carrying its warm amber glow; everything else "
        "exactly as established."
    ),
    notes="The point of the line is what survives the dark, so the dark is the single change.",
)

NEW["L13"] = dict(
    shot_class="symbolic-stand-in-object",
    stage="drive-vault", stage_role="base",
    still_prompt=(
        "A `prop-drive` blown up to the size of a chest of drawers, standing square on a bare "
        "floor with one deep drawer pulled fully out toward the viewer: buff card folders packed "
        "upright, a biscuit tin of loose photographs wedged at one end and a leaning stack of "
        "cassette cases at the other. Seen from a low three-quarter angle looking up, so the "
        "object towers: foreground a cropped rug edge running across the bottom of frame, "
        "midground the open drawer at chest height, background the drive-cabinet's flat cream "
        "body rising past the frame top. Cream-buff-teal palette, even frontal light."
    ),
    notes=(
        "Figureless by design for ~2.5s: the subject of the line is the object's contents, not a "
        "person. Opens the `drive-vault` stage rather than standing as its own seedless root — "
        "L14 continues the same object as its one-change delta."
    ),
)

NEW["L14"] = dict(
    shot_class="reaction-shot",
    stage="drive-vault", stage_role="delta", changed_elements=["+ second drawer slides open, pc-boxy presses it shut with a flat-armed press"],
    still_prompt=(
        "`pc-boxy`, `expr-caught`, beside the oversized `prop-drive` cabinet as established, seen "
        "from the same low three-quarter angle looking up at the towering cabinet, "
        "cream-buff-maroon palette, even frontal light. Only this changes: a second drawer has "
        "slid open at hip height and pc-boxy leans the flat of both stubby arms against its face, "
        "pressing it shut so whatever sits inside stays hidden behind the drawer front; "
        "everything else exactly as established."
    ),
    notes=(
        "Punchline beat: the machine that remembers everything is the one caught out, so the "
        "reaction lands on the cast member the line is about. pc-boxy has no hands, so its stance "
        "is authored as a flat-arm press against the drawer face rather than any grip or pull, and "
        "only the face-panel expression is seeded. Chained onto L13's base as the vault's one "
        "change (a drawer sliding open and pc-boxy's reaction), rather than standing as its own "
        "seedless root — corrects the prior authoring, which described the same beat as a "
        "free-standing shot with a 'shoving' action verb that read as a gripped pull on a rig "
        "that has no fingers to grip with."
    ),
)

NEW["L15"] = dict(
    shot_class="crowd-multiplication",
    figures={"crowd": True},
    still_prompt=(
        "Seen from a high vantage looking down a showroom aisle: foreground the near plinth "
        "corner cropped at the lower-left, midground eight `prop-beige-pc` units standing in a "
        "receding double row on low plinths stage-left and stage-right, each with its front bay "
        "open and one `prop-drive` seated inside it, background a chrome barrier at the far end "
        "of the aisle where a crowd clusters in the entrance, craning in, cheerful and impatient. "
        "Cream-teal-umber palette, flat even ceiling light."
    ),
    notes="Scale as argument: the repeated bay is the point, the crowd is the demand.",
)

NEW["L16"] = dict(
    shot_class="staged-interaction",
    stage="pc-ring", stage_role="base",
    figures={"crowd": True},
    still_prompt=(
        "`pc-boxy`, `expr-annoyed`, planted low and wide in the near corner stage-left, front "
        "panel squared toward the far corner. Facing it in the far corner stage-right, "
        "`rival-pc` — a slate-grey desktop case built on the same boxy no-hand form, its own "
        "cartoon eyes and mouth set into its front panel, `expr-annoyed` to match. Seen ringside "
        "from a low angle looking up at both, so the two cases loom: foreground a cropped ring "
        "post at the right edge, midground the two machines holding one plane at a matching eye "
        "line and equal relative head scale, three slack ropes crossing between them, background "
        "a corner stool at each post and, beyond the ropes, a dense crowd roaring with arms up "
        "under one hard overhead ring light. Umber-cream-teal palette."
    ),
    notes=(
        "The public fight staged as a bout so the next cut can leave it for the quiet money. NEW "
        "CAST, mint owed at Pass-1: `rival-pc`'s pinned form is stated ONCE here (slate-grey case, "
        "same no-hand boxy build as `pc-boxy`) and re-described nowhere else — mint the canonical "
        "from this clause. Neither machine has hands, so the bout is staged as bodies squared off "
        "and planted rather than a glove contact; the prior authoring's laced boxing gloves bled a "
        "human hand-rig onto a handless character (and cast an unregistered 'rival personified "
        "computer' with no canonical at all) — both are corrected here."
    ),
)

NEW["L17"] = dict(
    shot_class="staged-interaction",
    stage="pc-ring", stage_role="delta", changed_elements=["+ the two cases lunge together into a panel-to-panel shoving scrum"],
    figures={"crowd": True},
    still_prompt=(
        "`pc-boxy` and `rival-pc` on the canvas inside the three slack ropes as established, the "
        "roaring crowd beyond, seen from the same low ringside angle, umber-cream-teal palette "
        "under the hard overhead ring light. Only this changes: the two machines have lunged "
        "together at centre canvas, front panels locked flat against each other in one straining "
        "shoving scrum, stubby arms and legs braced wide; everything else exactly as established."
    ),
    notes=(
        "Rivalry resolved as one comic collision so the beat lands inside its 3s hold; the shove "
        "is body-to-body since neither case has hands to grapple with."
    ),
)

NEW["L18"] = dict(
    shot_class="personified-character",
    still_prompt=(
        "`drive-maker`, `expr-deadpan`, `carry-by-handle`, walking a loaded hand truck of flat "
        "cartons down a service ramp. Seen from the loading dock looking down the ramp's length: "
        "foreground a bollard cropped at the lower-right, midground drive-maker descending "
        "stage-right with the hand truck, background a breeze-block wall running the full width "
        "behind him, a roller shutter half down stage-left, bins and a pallet stack through the "
        "depth, a bright strip of plaza sky over the roofline the only trace left of the crowd. "
        "Umber-brown-amber palette, cool shade with one warm bulb over the shutter."
    ),
    notes=(
        "Departure from the ring: the suppliers are staged behind the fight, not inside it. "
        "`drive-maker` enters on the line that names the hard drive manufacturers; MiniScribe is "
        "not disclosed until L28, so the industry actor carries these beats rather than "
        "`miniscribe-rep`. His pinned canonical outfit is registry-held (already minted); nothing "
        "here re-describes it. High dock-level vantage down the ramp instead of a level frontal "
        "walk-by."
    ),
)

NEW["L19"] = dict(
    shot_class="idiom-pun",
    still_prompt=(
        "`drive-maker`, `expr-greedy`, `hold-both-hands`, both hands on the shaft of a long "
        "garden rake, dragging a knee-deep drift of loose banknotes toward himself into a growing "
        "heap at his boots. Seen low, from behind the drift of notes looking up: foreground loose "
        "banknotes cropped along the very bottom of frame, midground drive-maker planted centre "
        "pulling the rake toward camera, background a bare loading bay — breeze-block walls, a "
        "shuttered bay door, flat cartons stacked to the ceiling stage-left and stage-right so the "
        "money lies in a canyon of stock. Green-brown-amber palette, one hard work lamp from "
        "stage-right."
    ),
    notes="The idiom is the beat, so the rake is real and a body is doing the raking.",
)

NEW["L20"] = dict(
    shot_class="idiom-pun",
    stage="supply-stall", stage_role="base",
    figures={"crowd": True},
    still_prompt=(
        "`drive-maker`, `expr-smug`, `action-present`, behind a plank counter stage-right, "
        "holding a pick and a shovel out across the counter toward the buyers. Seen at a "
        "three-quarter angle across the stall rather than square-on: foreground a water butt "
        "cropped at the lower-left, midground the counter with drive-maker and the reaching "
        "prospectors, background a canvas awning overhead, barrels and coils of rope stacked "
        "behind him, a bare brown hillside beyond. A press of grinning prospectors in muddy hats "
        "and mud-caked coats reaches up for the tools from the far side of the counter. "
        "Ochre-brown-cream palette, hard high sun."
    ),
    notes=(
        "The line names the sellers, so the seller is the seeded foreground and the diggers are "
        "the mass. His canonical late-century dress is deliberately left unchanged behind a "
        "frontier stall: the anachronism IS the pun."
    ),
)

NEW["L21"] = dict(
    shot_class="idiom-pun",
    stage="supply-stall", stage_role="delta", changed_elements=["+ open iron money box on the counter, packed with coin"],
    figures={"crowd": True},
    still_prompt=(
        "`drive-maker`, `expr-smug`, `action-present`, behind the plank counter as established, "
        "the three-quarter stall view, prospectors still pressing in on the far side, "
        "ochre-brown-cream palette under hard high sun. Only this changes: a heavy iron money box "
        "now stands open on the counter at his elbow, packed to the brim with coin; everything "
        "else exactly as established."
    ),
    notes="Where the money actually sits, added as one element rather than narrated.",
)

NEW["L22"] = dict(
    shot_class="personified-character",
    still_prompt=(
        "`brick-foreman`, `back-to-viewer`, small in the one lit opening along a long row of "
        "roller-shutter loading bays receding at an oblique angle rather than square-on. Every "
        "other shutter down the row is down with its face left completely blank; foreground the "
        "wet concrete apron and a cropped kerb puddle at the lower frame, midground the row of "
        "shutters running back diagonally into the depth, background warm amber light spilling "
        "from that single open bay across the apron toward the viewer under a low grey sky. "
        "Umber-amber-cream palette."
    ),
    notes=(
        "Company kept anonymous: the VO has not named it yet, so nothing on this frame does "
        "either. Deliberately NOT `drive-maker`: this beat's company is the perpetrator, and "
        "reusing the industry actor here would put the same face on the fraudster and on the "
        "rival that later buys the wreck. The man in the bay is the packer the next three cuts "
        "follow. Shot at a receding oblique along the shutter row rather than a dead-on "
        "elevation, so the anonymity reads as one small bay in a long indifferent line."
    ),
)

NEW["L23"] = dict(
    shot_class="reaction-shot",
    stage="packing-bay", stage_role="base",
    still_prompt=(
        "`brick-foreman`, `expr-deadpan`, `action-shrug`, stage-left, shrugging square to the "
        "viewer beside a shoulder-high stack of sealed brown cartons on a wooden pallet. Camera "
        "holds slightly off-centre on him rather than a mirrored symmetric frame: foreground a "
        "pallet corner cropped at the lower-right, midground brick-foreman and the carton stack, "
        "background a breeze-block wall carrying a bare bracket with nothing hung on it, a wooden "
        "trestle bearing a tape roll and a knife stage-right, running back into the bay's depth. "
        "Umber-brown-cream palette, flat even work light."
    ),
    notes=(
        "Aside beat played as a shrug to camera — the one deliberate use of direct frontal address "
        "in this act, since the joke is aimed straight at the viewer. `brick-foreman` enters here, "
        "on the act he performs for the rest of the video; the cartons stay sealed because the VO "
        "has not opened them. Opens the `packing-bay` stage: the same trestle and wall carry the "
        "next two cuts as its base, replacing the prior authoring's free-standing shot that left "
        "L24-L25's shared set undeclared as a chain."
    ),
)

NEW["L24"] = dict(
    shot_class="literal",
    stage="packing-bay", stage_role="delta", changed_elements=["+ a red clay brick lowered into an open carton on the trestle"],
    still_prompt=(
        "`brick-foreman`, `expr-deadpan`, `hold-one-hand`, at the trestle in the breeze-block "
        "packing bay as established, the same off-centre camera hold, umber-brown-cream palette "
        "under the flat work light. Only this changes: he lowers one red clay brick in one hand "
        "toward an open flat carton set square on the trestle, the brick the largest single "
        "object in frame at chest height, its rough clay face and frog hollow catching the light, "
        "a second open carton waiting stage-right; everything else exactly as established."
    ),
    notes=(
        "The one place literal is the honest choice: a real physical object doing a real physical "
        "thing. Second cut of the `packing-bay` chain — the trestle and wall from L23 carry "
        "forward, so the prompt spends its weight on the brick alone. [F-05]"
    ),
)

NEW["L25"] = dict(
    shot_class="literal",
    stage="packing-bay", stage_role="delta", changed_elements=["+ carton taped shut, stencilled 'HARD DRIVE'"],
    still_prompt=(
        "`brick-foreman`, `expr-deadpan`, `hold-one-hand`, at the trestle in the packing bay as "
        "established, the same off-centre camera hold, the red clay brick and the flat cartons as "
        "established, umber-brown-cream palette under the flat work light. Only this changes: the "
        "carton in front of him is taped shut and its top face now carries the stencilled words "
        "'HARD DRIVE'; everything else exactly as established."
    ),
    notes=(
        "Supplied literal quoted from the script's own wording. Third and final cut of the "
        "`packing-bay` chain, at its ≤2-delta cap. [F-05]"
    ),
)

NEW["L26"] = dict(
    shot_class="map-plan-view",
    still_prompt=(
        "A flat top-down world map laid out across a concrete floor, oceans in pale teal and "
        "landmasses in cream, every landmass left completely blank and unlettered. Nine small "
        "sealed brown cartons stand upright on it: one on the west coast of North America, two in "
        "western Europe, three across South East Asia, one on the eastern tip of South America, "
        "one in southern Africa and one on the east coast of Australia. A single red thread runs "
        "from one point in the middle of North America out to each carton in turn. "
        "Umber-teal-cream palette, flat even overhead light, the map filling the frame edge to "
        "edge."
    ),
    notes=(
        "Register shift to a plan view for the distribution beat; figureless because the subject "
        "is the spread, not a person."
    ),
)

NEW["L27"] = dict(
    shot_class="ironic-counterpoint",
    still_prompt=(
        "`brick-foreman`, `expr-deadpan`, `hold-one-hand`, one hand fisted in a canvas dust "
        "sheet, hauling it off the front face of a shrink-wrapped pallet stack that towers over "
        "him. Seen from a low angle looking up at the stack: foreground a cropped forklift tine "
        "at the lower-left, midground brick-foreman stage-right pulling the sheet, background the "
        "exposed wrap catching the light in flat planes as half the sheet still drapes across the "
        "top of the stack, an empty concrete bay running back behind him to a shuttered door. "
        "Umber-cream-amber palette, one cold skylight shaft from above and a warm bulb over the "
        "shutter."
    ),
    notes=(
        "Act close: the cover comes off, staged as a physical act rather than a title card. A low "
        "angle lets the stack loom over him at the reveal rather than sitting level with it."
    ),
)

assert set(NEW.keys()) == {f"L{n:02d}" for n in range(1, 28)}, "must cover exactly L01-L27"

changed_ids = []
for sid, fields in NEW.items():
    s = by_id[sid]
    # drop stage/stage_role/changed_elements if not supplied this round but existed before,
    # only when we intend a real removal — here every id that had a stage keeps declaring it.
    for k in ("stage", "stage_role", "changed_elements", "figures"):
        if k not in fields and k in s:
            del s[k]
    s.update(fields)
    changed_ids.append(sid)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")

print("patched", len(changed_ids), "shots:", changed_ids)
