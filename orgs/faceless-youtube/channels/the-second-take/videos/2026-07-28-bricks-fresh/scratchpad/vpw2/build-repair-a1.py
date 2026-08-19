import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "shots.json"
MANIFEST = ROOT / "assets" / "voiceover.manifest.json"
OUT = ROOT / "scratchpad" / "vpw2" / "repair-A1.json"
SCRATCH = ROOT / "scratchpad" / "vpw2" / "lint-scratch-A1.json"

data = json.loads(SHOTS.read_text(encoding="utf-8"))
timings = json.loads(MANIFEST.read_text(encoding="utf-8"))["pieces"][0]["word_timings"]
shots = data["long_form"]["shots"]

# Re-cut against the forced-alignment stream. L66 remains the fixed A2 seam at token 408.
starts = [
    0, 6, 15, 21, 27, 35, 40, 46, 53, 61, 68, 72, 81, 86, 90, 94,
    98, 102, 108, 114, 122, 130, 138, 145, 152, 159, 168, 175, 181,
    186, 193, 197, 200, 205, 211, 221, 222, 228, 234, 242, 243, 253,
    260, 268, 273, 278, 286, 293, 301, 310, 315, 323, 332, 336, 345,
    350, 356, 362, 368, 374, 379, 385, 392, 396, 404,
]
assert len(starts) == 65

P = {
"L01": "A two-level suburban mall opens beneath a broad ribbed skylight, its cream terrazzo concourse bending past oak kiosks and a sunken planter court. Period shoppers occupy several distances between balcony rails and shop portals, with the nearest group below kiosk height and the far groups reduced by the architecture; mustard, rust, cream, and muted teal sit under amber fixtures while electronics windows supply the only cool light.",
"L02": "The skylit mall, curved concourse, planter court, and tiered balconies hold their geometry. Across those levels the shopper mass now shares a buoyant pose, with a handful of high-volume 1980s hairstyles repeating from the kiosk line to the upper rail; only this changes; everything else exactly as established.",
"L03": "The same atrium keeps its long concourse, oak kiosks, balcony gaps, and shoppers distributed across both levels. A chunky maze-chase arcade cabinet now claims the near-right bay, its cool screen showing a yellow disk inside a simple maze; only this changes; everything else exactly as established.",
"L04": "A 1983 electronics shop stretches from a low display plinth through offset islands to a wall of boxed machines, leaving the upper shopfront and ceiling grid open. `pc-boxy`, `expr-deadpan`, stands on the central plinth at modest scale, face panel clear toward the aisle, while curious buyers gather beyond two intervening counters; cream, oak, rust, and muted teal are warmed by task lamps, with cyan confined to monitor glass.",
"L05": "The shop's staggered islands, high ceiling grid, boxed-machine wall, and clear aisle remain fixed around `pc-boxy`, `expr-deadpan`. Buyers now collect in compact groups behind the second display island, leaning toward the new machine while its face panel stays unobstructed; only this changes; everything else exactly as established.",
"L06": "The 1983 shop still runs from plinth to display islands to the boxed-machine wall, with `pc-boxy`, `expr-deadpan`, holding the aisle sightline. The front shelf bays now show clean separated purchase gaps among the remaining beige units; only this changes; everything else exactly as established.",
"L07": "A long retail hall becomes a floor balance: a compact island of repeated `prop-beige-pc` units rests on the left platform while a buyer queue bends around counters on the larger right platform. Brass structure near the camera gives way to oak islands and then high cream arches, so the eager crowd occupies several measured layers beneath a largely open ceiling; amber, cream, rust, and muted teal lead, with blue only in powered screens.",
"L08": "The retail hall keeps its brass balance structure, oak islands, high arches, computer island, and layered buyer queue. The platform now sinks beneath demand while the finite computer side rises light and sparse; only this changes; everything else exactly as established.",
"L09": "A modern showroom is an austere rust-coloured chamber with a tall cream pedestal isolated between widely spaced rope stanchions and a high blank wall. One black-glass smartphone stands upright on the pedestal beneath a single amber pool, a white charging cable curling along the floor; every product and wall surface is blank and unlettered.",
"L10": "A technician's workshop is organized by a broad oak bench, a cable trench, and shelving that steps back between square posts. `pc-boxy`, `expr-thinking`, and a full-silhouette `prop-drive` share the middle of that bench at readable scale, the machine's face panel turned clearly toward the drive; cream, tobacco brown, and muted teal sit under warm task light, with one cool monitor pool.",
"L11": "The workshop's oak bench, cable trench, square posts, and stocked shelving remain unchanged around `pc-boxy`, `expr-thinking`, and the full `prop-drive`. The computer is now powered down, its monitor glass dark and the former cool pool extinguished; only this changes; everything else exactly as established.",
"L12": "The same bench line and deep shelving bays hold `pc-boxy`, `expr-thinking`, beside the full `prop-drive`, both silhouettes clear against the cream work wall. A cutaway window now reveals blank file cards and amber application tiles retained inside the drive; only this changes; everything else exactly as established.",
"L13": "A demonstration alcove is built around a waist-high cream block, two offset storage racks, and a tall empty wall that gives the device room to read. One full-silhouette `prop-drive` occupies the block with an amber chamber visible inside; oak, cream, tobacco brown, and muted teal are lit by a directional task lamp and a restrained monitor reflection.",
"L14": "The demonstration block, offset racks, tall wall, and full `prop-drive` stay fixed. A neat stack of blank cream file cards now sits securely inside the amber chamber; only this changes; everything else exactly as established.",
"L15": "The same alcove keeps its clear device silhouette, open wall, and storage-rack depth, with the blank file cards already inside. One closed rust portfolio bearing a small brass heart-shaped lock now rests beside those files; only this changes; everything else exactly as established.",
"L16": "A warehouse-like computer showroom runs through repeated oak arches, pallet bays, and a high cream ceiling. One `prop-beige-pc` paired with one `prop-drive` begins a line of matched pairs, while eager buyers wait beyond the last arch in overlapping groups; warm cream, oak, amber, rust, and muted teal frame one conspicuously empty pairing slot.",
"L17": "The arched showroom and its finite row of computer-drive pairs remain intact. The waiting buyer mass now extends through the last two bays and around the far counter, outnumbering the available pairs; only this changes; everything else exactly as established.",
"L18": "A retail contest platform sits inside a tall circular market hall, ringed by stepped oak seating and cream arches with a clear central void. `pc-boxy`, `expr-smug`, holds stage-left facing right and `rival-pc`, `expr-skeptical`, holds stage-right facing left; they share one plane, matched face-panel eye-line, and equal relative head scale, both faces unobscured across a full stride of space.",
"L19": "The circular hall, stepped seating, cream arches, and two machine rivals remain on their shared plane with matched face-panel eye-line and scale. One thick brass contest rope now divides the open platform between them; only this changes; everything else exactly as established.",
"L20": "The market ring stays fixed around `pc-boxy`, `expr-smug`, and `rival-pc`, `expr-skeptical`, their shared plane, eye-line, and relative head scale preserved. A low pallet of repeated `prop-drive` units now occupies the unlit service edge outside the contest circle; only this changes; everything else exactly as established.",
"L21": "A loading hall is structured by parallel timber posts, high clerestory windows, and carton lanes that converge on a bright dock door. `drive-maker`, `hold-both-hands`, `expr-smug`, stands within the middle bay carrying one `prop-drive` level at chest height, his clear face well below the tall doorway; restrained coin stacks collect at the loading plinth while cream, brown, rust, and muted teal hold under amber lamps.",
"L22": "A timber market arcade turns through three awning bays, stacked tool racks, and a generous open aisle. `drive-maker`, `action-offering`, `expr-smug`, works the middle stall at modest scale, offering one `prop-drive`; pick heads, shovel blades, and drive units fill the counter, while hopeful buyers queue beyond two post lines with simple grins.",
"L23": "A deep packing warehouse is divided into five rack aisles around one oak inspection table, with upper wall and ceiling space left clear above the inventory grid. One closed cream drive carton sits on the table while thousands of matching cartons occupy ordered bays toward the rear wall; a single attached count card carries the supplied literal '26,000'.",
"L24": "The five warehouse aisles, inspection table, and ordered carton field remain fixed. The lone carton is now open, exposing one dense red-clay brick beneath its folded flaps; only this changes; everything else exactly as established.",
"L25": "The same rack geometry and open sample carton hold, its red-clay brick visible against the cream packaging. Additional open cartons now reveal the same brick payload at measured intervals along the nearest two aisles; only this changes; everything else exactly as established.",
"L26": "An oak labelling bench spans the lower edge of a tall carton wall, leaving a clear band of warehouse structure above it. One sealed cream carton faces the viewer beside a red-clay brick and packing strap, its product panel bearing the supplied literal 'HARD DRIVE'.",
"L27": "A top-down world-shipping table fills a broad dispatch room: one cluster of cream cartons leaves the warehouse token along branching copper routes toward several blank port blocks. The room's outer floor remains open around the route network, and the carton faces turn edge-on so their glyph panels are hidden; warm oak and cream carry the map while the red-clay cargo is implied by one cutaway sample at the origin.",
"L28": "A cast-free Colorado assembly hall works at full occupancy beneath sawtooth roof bays, with parallel conveyors crossing the floor, component racks defining side aisles, and assembly workers distributed beyond two machine rows. Warm cream, oak, rust, and muted teal sit under amber task lamps, with cool light confined to test monitors; above the entrance, a cream owner board in dark warm-brown ink (#241a12) bears the supplied literal 'MINISCRIBE'.",
"L29": "The factory's tall machine lanes and overhead service bridges create a deep central aisle with open roof volume above. `miniscribe-rep`, `action-powerstance`, `expr-smug`, stands midway down that aisle at a scale subordinate to the machinery, three-quarter face clear above the conveyor; drive trays and component bins keep the plant visibly active under warm industrial light.",
"L30": "The machine lanes, service bridges, active conveyor, and `miniscribe-rep`, `action-powerstance`, `expr-smug`, remain in place. A simple brass silhouette of Colorado now mounts on the side wall behind the clear-faced company figure; only this changes; everything else exactly as established.",
"L31": "A prototype bay opens between drafting tables, overhead cable trays, and a long window wall. `terry-johnson`, `action-present`, `expr-deadpan`, stands beside a waist-high oak bench, presenting an early drive with his face clear and his body occupying less space than the surrounding lab; cream, oak, muted teal, and amber practical light define the founder's working world.",
"L32": "The approved assembly hall opens into a finished-goods wing where roof trusses span parallel conveyors, component racks, and three loading bays. `terry-johnson`, `action-present`, `expr-delighted`, and `miniscribe-rep`, `action-powerstance`, `expr-smug`, share the aisle crossing on one plane, one eye-line, and matching head scale, both faces clear; focused workers populate the distant bays.",
"L33": "The assembly hall, clear floor lanes, named-cast partnership, and worker activity hold. Completed `prop-drive` units now fill every waist-high dispatch conveyor between the rack rows; only this changes; everything else exactly as established.",
"L34": "The same production wing and conveyor grid hold `terry-johnson` and `miniscribe-rep` on one plane at matched eye-line and head scale. Buyer teams now occupy the far loading bays behind pallet stacks, their eager posture readable across several dock openings; only this changes; everything else exactly as established.",
"L35": "Using the approved conference-room variant, a long oak table points toward winter windows, flanked by repeated teal chairs and high blank cream walls. `miniscribe-rep`, `action-offering`, `expr-smug`, and `ibm-suit`, `action-offering`, `expr-skeptical`, meet through the two-person `handoff` on one mid-room plane, at one eye-line and matching head scale, both faces clear around the blank contract folder.",
"L36": "The long table, winter windows, repeated chairs, and two matched figures remain fixed around the folder handoff. A warm-gold revenue block now rises from the table's center bearing the supplied literal '125 MILLION', only this changes; everything else exactly as established.",
"L37": "The conference-room depth and shared figure geometry remain intact around the warm-gold block marked '125 MILLION'. Ordered contract folders now extend along the table toward the window end, turning one deal into a sustained business run; only this changes; everything else exactly as established.",
"L38": "The approved assembly hall is viewed from its loading wing, where high roof trusses span pallet lanes, dispatch conveyors, and three dock doors. `miniscribe-rep`, `action-present`, `expr-smug`, stands on a low side platform at mid-distance, face clear but secondary to the hall, while customer teams occupy separate bays behind railings and shipped `prop-drive` cartons fill the lanes.",
"L39": "The warehouse's high racks, three dock bays, customer teams, carton lanes, and modestly scaled `miniscribe-rep` remain fixed. One exceptionally large blank buyer order lands on the central dispatch stand as the Compaq beat, with its surface ruled but unlettered; only this changes; everything else exactly as established.",
"L40": "The same shipping hall and customer activity hold around the blank buyer order. A warm-gold revenue tower now rises from the reserved dispatch bay bearing the supplied literal '600 MILLION', only this changes; everything else exactly as established.",
"L41": "A long accounting gallery is built around a broad oak ledger desk, symmetrical filing walls, and a high band of empty cream plaster. On the desk, a gold revenue tower and a slightly taller stack of blank warm-orange conversation tiles form the modern comparison, while a polished ledger waits beneath them with ruled pages and blank writing fields; amber lamps warm the suspiciously perfect arrangement.",
"L42": "The accounting gallery, filing walls, comparison towers, and polished blank ledger remain fixed. The immaculate top page now lifts at one corner to reveal a dense red false layer underneath; only this changes; everything else exactly as established.",
"L43": "The same long gallery and exposed red layer hold beneath the comparison towers. A brass rewind mechanism now draws the ledger's page stack backward through four tabbed sections, every tab blank and unlettered; only this changes; everything else exactly as established.",
"L44": "Using the approved conference-room variant, the long table runs toward winter windows beneath a wide band of blank wall. One towering IBM order stack at the table's far end has been cut down to a thin remainder, while empty chairs and untouched cream folders preserve the decision-room scale; the scene stays in muted cream, tobacco brown, teal, and cold window light.",
"L45": "A vast assembly floor extends through four lamped workstation banks toward distant loading doors, with overhead trusses leaving substantial open volume. A genuine employee mass occupies staggered aisles in a grim, planted attitude while one station in every four sits dark and vacant; warm industrial cream and brown drain toward olive and winter grey.",
"L46": "The factory exit lane runs between a stopped conveyor, repeated door frames, and pale winter light beyond the loading court. `terry-johnson`, `walk-right`, `expr-crestfallen`, holds a departing step midway through the architecture, face clear in three-quarter view and body modest against the tall doors; the vacated plant stretches behind him in muted cream, olive, and tobacco brown.",
"L47": "A stripped executive suite is defined by an oversized empty desk, tall filing walls, and a long unused carpet path to the doorway. `miniscribe-rep`, `action-slump`, `expr-worried`, occupies the middle of that path beneath the room's scale, face clear beside a nearly empty drive tray; amber light is thin against cream, brown, and muted teal.",
"L48": "An oak conference chamber extends from a brass table rail to tall panelled walls and a shaded window, with an empty executive chair reserved at the far end. `hq-banker`, `action-offering`, `expr-skeptical`, and `miniscribe-rep`, `action-offering`, `expr-worried`, share one mid-room plane through the `handoff`, meeting one eye-line at matching head scale with both faces and the blank rescue folder clear.",
"L49": "The conference chamber, reserved chair, blank-folder handoff, and matched two-figure geometry hold. One warm-gold rescue block now occupies the table beside them bearing the supplied literal '20 MILLION', only this changes; everything else exactly as established.",
"L50": "The panelled chamber and two figures remain fixed around the folder and the block marked '20 MILLION'. The empty executive chair now slides from the far end to the banker's side of the table; only this changes; everything else exactly as established.",
"L51": "A deep executive office opens from an oak desk through filing bays to a tall window, leaving a clear pool around one empty high-backed chair. `hq-banker`, `action-present`, `expr-deadpan`, stands beside the desk at mid-scale, presenting that vacant seat while a sealed blank dossier rests on the blotter; the candidate remains a shape defined by absence.",
"L52": "A tall executive suite is organized by a low oak dais, broad wall panels, repeated office doors, and generous ceiling space. `qt-wiles`, `action-powerstance`, `expr-smug`, stands newly revealed on the dais at mid-scale, square to camera with face clear, his steel-grey business suit set against warm cream, oak, amber, and muted teal.",
"L53": "The suite's wall panels, repeated doors, oak dais, and clear-faced `qt-wiles`, `action-powerstance`, `expr-smug`, remain fixed. A tiny crooked restaurant table with cold plates now occupies one corner of the dais; only this changes; everything else exactly as established.",
"L54": "The executive world and Wiles's modest place inside it hold, with the miniature failing table still at the dais edge. Three blank restaurant doorways now open along the far office wall, each revealing a different failing dining room; only this changes; everything else exactly as established.",
"L55": "A failing restaurant kitchen stretches from a stainless pass through two prep islands to a high service doorway, its shelves and amber heat lamps creating real depth around an open central lane. `tv-chef`, `point-at-thing`, `expr-worried`, stands beside the pass at mid-scale, face clear as he points toward a collapsed risotto mound, two untouched plates, and one smoking pan.",
"L56": "A business office mirrors the kitchen's long geometry: an oak document pass leads through file islands to a muted-teal doorway beneath a high cream wall. `qt-wiles`, `point-at-thing`, `expr-smug`, occupies the chef's former position at mid-scale, face clear as he points to blank turnaround files; his ordinary steel-grey suit and the surrounding finance workspace make the comparison legible.",
"L57": "A broad executive records room is built around an oak desk, a brass turntable, and filing bays that continue beneath tall blank walls. `qt-wiles`, `hold-paper-by-sides`, `expr-skeptical`, stands behind the desk at mid-scale holding one blank cream statement, face clear above the page, while a tired risotto bowl sits separately on the turntable.",
"L58": "The records room, filing bays, Wiles, held blank statement, and brass turntable remain fixed. The turntable now presents a neat stack of blank quarterly statement pages where the risotto faced the viewer; only this changes; everything else exactly as established.",
"L59": "The same tall records room and clear-faced `qt-wiles`, `hold-paper-by-sides`, `expr-skeptical`, remain around the statement stack. The oak desk now extends through the filing bays into a conference-length plane, making the business system larger than the figure; only this changes; everything else exactly as established.",
"L60": "An office corridor branches around a central octagonal lobby, with one warm-oak doorway opening into a furnished executive room and five blank wall bays reserved around the bend. `qt-wiles`, `action-present`, `expr-smug`, stands beside the first threshold at modest scale, face clear as he presents the room under amber lamps and muted-teal cabinetry.",
"L61": "The branching corridor, furnished first office, blank wall bays, and `qt-wiles`, `action-present`, `expr-smug`, remain fixed. Several additional warm-oak company doorways now occupy the reserved bays around the lobby, each revealing a distinct office interior; only this changes; everything else exactly as established.",
"L62": "A giant business map table occupies a high-ceilinged planning room, its ochre roads and muted-teal water crossing between chunky unlettered company tokens. `qt-wiles`, `3q-turn-right`, `expr-smug`, stands along the lower table edge with face visible above the rim, his body subordinate to the map and the surrounding open room.",
"L63": "The planning room, broad map, company tokens, and clear-faced Wiles hold. One factory token now sits on a Colorado-shaped block far across the table from an office token by the southern California coast; only this changes; everything else exactly as established.",
"L64": "The wide map and separated Colorado and southern-California tokens remain fixed beneath the planning room's open ceiling. A single copper phone line now spans the table between those two tokens; only this changes; everything else exactly as established.",
"L65": "A cast-free late-1980s Los Angeles office is arranged from an oak desk and active multi-line telephone through filing bays to a second worktable beneath tall venetian windows. Broad cream wall panels and an open strip of carpet give the room breathing space; amber afternoon light warms honey oak, tobacco brown, rust, and muted teal, while every wall, folder, glass panel, and desktop stays blank and unlettered, leaving ownership intentionally ambiguous.",
}

# The cadence repair moves these already-authored compositions onto the spoken beats one slot later.
old_p = P.copy()
P.update({
    "L45": "A vast assembly building appears as a long sectional world: the IBM order stack at one end has collapsed into a thin ledge while conveyors and lamped workstation banks descend toward a dark loading court. The architecture, rather than a person, carries the company's cliff edge in drained cream, tobacco brown, olive, and winter grey.",
    "L46": old_p["L45"],
    "L47": old_p["L46"],
    "L48": old_p["L47"],
    "L49": old_p["L48"],
    "L50": old_p["L49"],
    "L51": old_p["L50"],
    "L52": old_p["L51"],
    "L53": old_p["L52"],
    "L54": old_p["L53"],
    "L55": old_p["L55"],
    "L56": "The failing kitchen keeps its stainless pass, two prep islands, high doorway, and clear-faced `tv-chef`, `point-at-thing`, `expr-worried`, at mid-scale. The entire failed dinner service now occupies the pass as a collapsed risotto mound, two untouched plates, and one smoking pan; only this changes; everything else exactly as established.",
    "L57": old_p["L56"],
    "L58": old_p["L57"],
    "L59": old_p["L58"],
    "L60": old_p["L59"],
    "L61": old_p["L60"],
    "L62": old_p["L61"],
    "L63": old_p["L62"],
    "L64": old_p["L63"],
    "L65": old_p["L65"],
})
assert set(P) == {f"L{i:02d}" for i in range(1, 66)}

def clear_stage(sh):
    for key in ("stage", "stage_role", "changed_elements", "place_anchor"):
        sh.pop(key, None)

stage_changes = {
    "L21": ("drive-maker-reveal", "base", None),
    "L22": ("supply-stall", "base", None),
    "L23": ("brick-hook", "base", None),
    "L24": ("brick-hook", "delta", ["~ sample carton opens to reveal one red-clay brick"]),
    "L25": ("brick-hook", "delta", ["+ matching brick payload appears in selected aisle cartons"]),
    "L28": ("miniscribe-plate", "base", None),
    "L44": (None, None, None),
    "L45": (None, None, None),
    "L46": (None, None, None),
    "L47": ("factory-exit", "base", None),
    "L48": (None, None, None),
    "L49": ("hq-bailout", "base", None),
    "L50": ("hq-bailout", "delta", ["+ 20-million rescue block on the conference table"]),
    "L51": ("hq-bailout", "delta", ["~ empty executive chair moves to the banker's side"]),
    "L52": ("turnaround-chair", "base", None),
    "L53": ("wiles-reveal", "base", None),
    "L54": ("wiles-reveal", "delta", ["+ miniature failing-restaurant table on the dais"]),
    "L55": ("kitchen-rescue", "base", None),
    "L56": ("kitchen-rescue", "delta", ["+ entire failed dinner service on the pass"]),
    "L57": ("wiles-match", "base", None),
    "L58": ("quarterly-statements", "base", None),
    "L59": ("quarterly-statements", "delta", ["~ turntable rotates from risotto to statement stack"]),
    "L60": ("quarterly-statements", "delta", ["~ oak desk extends into a conference-length plane"]),
    "L61": ("many-sanctums", "base", None),
    "L62": ("many-sanctums", "delta", ["+ repeated company doorways around the lobby"]),
    "L63": ("remote-map", "base", None),
    "L64": ("remote-map", "delta", ["~ Colorado factory token moves away from the Los Angeles office token"]),
}

for i, sh in enumerate(shots[:65]):
    sid = sh["id"]
    start = starts[i]
    end = starts[i + 1] if i < 64 else 408
    sh["vo_ref"] = " ".join(word for word, _ in timings[start:start + 4])
    sh["duration_s"] = round(timings[end][1] - timings[start][1], 1)
    sh["still_prompt"] = P[sid]
    if sid in stage_changes:
        stage, role, changed = stage_changes[sid]
        clear_stage(sh)
        if stage:
            sh["stage"] = stage
            sh["stage_role"] = role
            if changed:
                sh["changed_elements"] = changed
    sh.pop("hard_cut", None)

# Hard-cut roots created by the recut; they do not invent new stage ids.
for sid in ("L26", "L27", "L44", "L45", "L46", "L47", "L48", "L57"):
    sh = next(x for x in shots[:65] if x["id"] == sid)
    if sid in ("L26", "L27"):
        clear_stage(sh)
    sh["hard_cut"] = True

# Existing approved place variants distribute A1's MiniScribe run across three geometries.
anchors = {
    "L35": "assets/scenes/L84.png",
    "L44": "assets/scenes/L84.png",
    "L45": "assets/scenes/L28.png",
    "L46": "assets/scenes/L28.png",
    "L47": "assets/scenes/L28.png",
}
for sid, anchor in anchors.items():
    sh = next(x for x in shots[:65] if x["id"] == sid)
    sh["place"] = "miniscribe-building"
    sh["place_anchor"] = anchor

# Re-cast the split human-cost sequence on its spoken subjects.
by_id = {x["id"]: x for x in shots[:65]}
by_id["L44"].pop("figures", None)
by_id["L45"].pop("figures", None)
by_id["L46"]["figures"] = {"crowd": True}
by_id["L47"].pop("figures", None)
by_id["L44"]["shot_class"] = "aftermath-palette-turn"
by_id["L45"]["shot_class"] = "ironic-counterpoint"
by_id["L46"]["shot_class"] = "crowd-multiplication"
by_id["L47"]["shot_class"] = "aftermath-palette-turn"
by_id["L48"]["shot_class"] = "ironic-counterpoint"
by_id["L49"]["shot_class"] = "staged-interaction"
by_id["L50"]["shot_class"] = "number-glued-to-object"
by_id["L51"]["shot_class"] = "staged-interaction"
by_id["L52"]["shot_class"] = "ironic-counterpoint"
by_id["L53"]["shot_class"] = "personified-character"
by_id["L55"]["shot_class"] = "personified-character"
by_id["L56"]["shot_class"] = "personified-character"
by_id["L57"]["shot_class"] = "personified-character"

# Notes that described superseded timing/staging are replaced with the repair rationale.
note_updates = {
    "L09": "Positive showroom state replaces the critic-flagged negation; the analogy remains unbranded and figureless.",
    "L21": "Drive-maker reveal stays inside a deep working loading hall; figure scale is subordinate to the architecture.",
    "L22": "The picks-and-shovels idiom is consolidated into one performing-person tableau so four cuts can carry the brick hook.",
    "L23": "First of five faster brick-hook compositions; sourced 26,000 count supported by [F-05].",
    "L24": "The title-joke pause lands on the single-carton brick reveal; one feasible delta.",
    "L25": "Selected open cartons extend the red-clay payload through the aisle without changing the warehouse geometry [F-05].",
    "L26": "Fresh labelling insert on the spoken label beat; `HARD DRIVE` is supplied by the script.",
    "L27": "Fresh world-sale tableau separates distribution from the count reveal; carton label panels are physically hidden.",
    "L32": "The L28 assembly geometry is turned toward its finished-goods wing; two-cast plane, eye-line, and head scale remain explicit.",
    "L35": "Approved L84 conference geometry carries the IBM deal; legal two-cast `handoff` topology remains explicit [F-26] [F-29].",
    "L38": "The L28 assembly geometry is turned toward its loading wing; the company figure is mid-scale inside the larger hall [F-28].",
    "L39": "Compaq/customer payload now lands alone; the 600-million result is withheld until L40.",
    "L40": "The sourced peak literal appears only on its spoken beat [F-28]; the modern comparison remains withheld.",
    "L41": "The modern comparison first appears on the inflation/Reddit beat [F-30] [F-31]; blank ledger prepares the reported-number reversal.",
    "L44": "IBM order reduction is isolated before any employee or Terry consequence; approved L84 conference geometry used [F-26].",
    "L45": "MiniScribe's cliff consequence is isolated before the layoff and Terry disclosures [F-26].",
    "L46": "The plural layoff beat is borne by a genuine employee mass on its own cut [F-26].",
    "L47": "Terry enters only on his named exit words as a fresh base, using the approved L28 factory geometry [F-27].",
    "L48": "Company-trouble bridge precedes the first banker image; no banker is disclosed early.",
    "L49": "Banker entrance begins on the spoken banker clause; legal two-cast `handoff` topology retained [F-27].",
    "L52": "Unnamed-savior setup is consolidated into one architecture-led empty-chair base; Wiles remains undisclosed.",
    "L53": "Wiles enters on his naming words as a fresh base and remains a businessman [F-02].",
    "L54": "Restaurant analogy expands within the held office before the generic chef hard cut.",
    "L55": "Generic kitchen-rescue host uses only registered cast and positive scene facts; no real-person likeness is requested.",
    "L56": "The failed-service payload stays one feasible kitchen delta.",
    "L57": "Hard cut returns to Wiles as an investment banker; the nickname lettering is omitted to avoid premature disclosure.",
}
for sid, note in note_updates.items():
    by_id[sid]["notes"] = note

fragment = {"shots": shots[:65]}
OUT.write_text(json.dumps(fragment, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
SCRATCH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
