# Gate-1 board for the codex-image-engine arc: P1 probe evidence for Daniel's go/no-go.
# Reuses the image-generation skill's shared board module (CSS/JS incl. the standing lightbox).
import io, os, sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.normpath(os.path.join(
    SCRATCH, "..", "orgs", "faceless-youtube", ".claude", "skills", "image-generation", "scripts"))
sys.path.insert(0, SKILL)
import build_review_artifact as B  # noqa: E402

S = lambda *p: os.path.join(SCRATCH, *p)

CARDS = [
    dict(sid="RAW CAPABILITY", label="probe2 · no seed", cls="fox watercolor",
         flagged=False, reason="",
         vo="Real diffusion output on the codex subscription — the engine exists.",
         anim="2.9MB PNG, 1198x1313. Tool: image_gen__imagegen, prompt-only.",
         path=S("probe2.png")),
    dict(sid="SEED (input)", label="qt-wiles canonical", cls="STEP-1 card",
         flagged=False, reason="",
         vo="The exact bricks canonical passed as referenced_image_paths.",
         anim="refs/qt-wiles/qt-wiles.png, 1696x2528, sha 261d569d…",
         path=S("seeds", "figA-qt-wiles.png")),
    dict(sid="C · IDENTITY HOLD", label="1 seed → new pose", cls="verdict: STRONG",
         flagged=False, reason="",
         vo="Costume, tie bar, hair, hooded eyes, line style all held; zero iteration.",
         anim="Output 1672x941. Boss-confirmed by eye.",
         path=S("out", "probeC-identity-hold.png"),
         canon=[("seed", S("seeds", "figA-qt-wiles.png"))]),
    dict(sid="E1 · FIGURE + PROP", label="2 seeds", cls="verdict: STRONG",
         flagged=False, reason="",
         vo="Figure and prop seed both honored in one frame.",
         anim="Output 1672x941.",
         path=S("out", "probeE1-figure-plus-prop.png")),
    dict(sid="E2 · TWO FIGURES", label="3 seeds", cls="verdict: STRONG + flag",
         flagged=True,
         reason="Unrequested in-image text: literal 'TOTE RACK / STAGE-LEFT' sign minted from "
                "staging-direction language. Happened in EVERY gen this session — house-style risk #1.",
         vo="Both identities held, zero cross-seed bleed.",
         anim="Output 1672x941. Seed ceiling probed separately: hard cap = 5, clean server error.",
         path=S("out", "probeE2-two-figures.png")),
    dict(sid="D1 · ASPECT 16:9", label="prompt-steered", cls="ratio 1.7500",
         flagged=False, reason="",
         vo="Requested 16:9 @1344x768 → got 1659x948. Ratio lands; literal WxH never honored.",
         anim="Exact resolution varies run to run — downstream needs resize-to-canvas.",
         path=S("out", "probeD1-16x9.png")),
    dict(sid="D2 · ASPECT 2:3", label="prompt-steered", cls="ratio 0.6656",
         flagged=False, reason="",
         vo="Requested 2:3 @832x1248 → got 1023x1537. Same story: ratio yes, pixels no.",
         anim="Omit aspect prose entirely and you get an arbitrary ratio.",
         path=S("out", "probeD2-2x3.png")),
    dict(sid="G1 · REGISTER, BARE", label="era prompt, no style suffix", cls="ink R−B −6.5",
         flagged=True,
         reason="Ink measured COOL (−6.5 vs +18 target from pinned #241a12) — wrong direction. "
                "Also over-rendered: ambient shading, gradients vs flat-cel spec.",
         vo="Real bricks scene prompt, proper seeds, no house-style suffix.",
         anim="Output 1122x1402 (no aspect prose → arbitrary ratio).",
         path=S("out", "probeG1-noSuffix.png")),
    dict(sid="G2 · REGISTER, SUFFIX", label="era prompt + house-style suffix", cls="ink R−B +7.9",
         flagged=True,
         reason="Right direction but ~44% of target magnitude (+7.9 vs +18); gradients and soft "
                "shading persist. Raw output will NOT pass the era battery — calibration or "
                "normalization required. Register risk is real, as briefed at kickoff.",
         vo="Same scene, house-style suffix appended.",
         anim="Output 1672x941 — suffix's aspect clause also fixed the ratio.",
         path=S("out", "probeG2-withSuffix.png")),
    dict(sid="H · POLICY", label="named real figure", cls="no refusal",
         flagged=True,
         reason="Volunteered a 'DEFENSE COUNSEL' nameplate — unprompted set-dressing text again.",
         vo="Named convicted business figure + explicit fraud framing: full compliance, no likeness dodge.",
         anim="163s, longest call of the session.",
         path=S("out", "probeH-wiles-named.png")),
]

for c in CARDS:
    c.setdefault("invariants", None)
    c.setdefault("canon", None)
    assert os.path.isfile(c["path"]), c["path"]

page, nb = B.build(
    CARDS,
    "GATE 1 — codex image engine: capability probe",
    "8 gens, subscription-billed, $0 API · identity/multi-seed STRONG · seed cap 5 (absolute paths) · "
    "aspect ratio-steerable not pixel-exact · register short of era target · no policy refusal · "
    "flagged cards = the three design risks",
    1400, 82)
out = os.path.join(SCRATCH, "gate1-board.html")
io.open(out, "w", encoding="utf-8").write(page)
print("board:", out, "%.1f MB page" % (os.path.getsize(out) / 1e6))
