# Tranche A derivation — 27 shots

Selected: L26–L28, L49–L50, L60–L62, L66–L68, L78, L91, L100–L101,
L107–L109, L160–L162, L183–L184, L190–L191, L205, L215.

Mandatory dogfood is covered: L60 receives only its stale qt-wiles STEP-1 figure
and composite redo (its picked place remains); L61 receives its authored retry.

VPW coverage is 17 shots: 13 anon_foreground→named/crowd conversions
(L49, L50, L66, L67, L100, L101, L107–L109, L160–L162, L191), three
over-cap restages (L28, L62, L68), and prose-vs-seed L91. This exceeds the
six-conversion and two-over-cap minima.

Risk-5 is exercised by L184 (hq-banker + qt-wiles) and L191
(hq-banker + auditor-rep); their only parent pulls are L183 and L190.

Eight new recurring-place candidate batches are represented: L26, L49, L66,
L100, L107, L160, L183, L190. Four standalone one-gen places are L78, L91,
L205, and L215. L60 deliberately is not counted as a place batch: its existing
picked plate stays by ruling.

Dependency closure check: parsed the full forge batch seed slate, treating a
seed named `_staging/Lnn.png` as parent edge `Lnn → child`, then checked every
selected edge. All selected parents are included: L26→L27→L28, L49→L50,
L60→L61→L62, L66→L67→L68, L100→L101, L107→L108→L109,
L160→L161→L162, L183→L184, and L190→L191. No selected edge relies on an
unverified out-of-tranche parent (closure_missing=0). The first, third, and
fourth chains are regenerated end-to-end.

Cost (pre-retry): canonical 1×$0.134 + STEP-1 7×$0.039 + recurring candidates
16×$0.134 + standalone plates 4×$0.134 + delta/composites 14×$0.134 + L60
redo 1×$0.134 = $5.097 (43 requests). The wave-plan 15% contingency is $0.765,
for a $5.862 recommended cap, below $7.

Excluded: L97 is verify-only (clean pixels; manifest binding defect). L02, L03,
and L197 are reserved for the final word-sync tranche because they alter the
shot list.

Forge compatibility note: the literal brief command now requires `--out` before
it resolves. Re-running its full batch with `--out C:\NUL` preserved the $0,
no-persisted-output behavior, emitted the complete seed slate, and ended with
the expected 39 SEEDING-LAW violations.
