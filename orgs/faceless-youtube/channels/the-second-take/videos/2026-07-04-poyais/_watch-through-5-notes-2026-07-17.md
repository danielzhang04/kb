# Watch-through №5 notes — R9 render (2026-07-17)

Daniel's verbatim feedback on `assets/final.mp4` (R9, 528.13s). Stable IDs W01–W12 for the R10
round. Groupings: VISUAL (arrow, regens), AUDIO (music, SFX), VO (cut artifacts — systemic).

## VISUAL

- **W01 — Prince-of-Poyais arrow (L27/L28 span):** "Arrow during prince of poyais should be
  smaller and thinner, and equidistant between macgregor and the label. Right now it overlaps
  with the label which is weird."
- **W06 — "70 sailors" shot regen (crowd rig):** "Regen '70 sailors' shot. I thought I already
  told you to do that. Not just regen, change prompt because the characters don't fit the crowd
  rig right now." *(R9 left a residual mustached figure on the 70-settlers shot — flagged
  advisory then; now a full prompt-rewrite + regen order.)*
- **W07 — Colombia/Peru/Chile shot regen (rig + style):** "I thought I told you to redo the
  Columbia, Peru, Chile shot because the characters are off rig and the background art style
  doesn't match. That means review the prompt, write it through the skill or separately, re run
  image gen and check, then slot it in. If you need, make it a seeded gen. These characters
  should all be on our character rig but with their country costumes. That applies to the other
  shots I've mentioned too."
- **W08 — "half of them didn't make it home" shot regen:** "From way earlier, the shot where
  half of them didn't make it home, that needs a regen too, that's off crowd rig."

## AUDIO — music

- **W02 — post-prince music transition:** "The music feels like it cuts abruptly right after
  the prince scene and changes abruptly. Have it be a much longer fade, and end earlier. And
  the new track coming in here should fade in a little."
- **W05 — music volume:** "Reduce music volume throughout again. Not by too much."
- **W12 — all music fade-outs (systemic):** "Across the board, make the music fade outs
  longer/start earlier, they all feel too abrupt. Actually plan and do it right this time yeah?
  Don't just try to make small changes by hand, we've built out skills for a reason."

## AUDIO — SFX

- **W03 — halo "ahh" over floating book:** "The SFX over the book is bad. I want the 'ahh' to
  play over the duration of the floating book shot. If the SFX you have loaded is too short to
  do so, go to an audio editor and overlap 2-3 of them (not full audio, start is full, then
  each successive one overlays only it's back 2/3 or something otherwise it sounds like its
  re running... it's the same tone so it should connect fine. Right now you have played the
  audio track 3 times in a row over the floating book and next two scenes. That's incorrect.
  Also I liked the previous 'ahh' SFX better than this one. Revert to that."
  → one composite sustained bed (crossfaded copies), scoped to the floating-book shot ONLY,
  built from the PREVIOUS halo asset (pre-R8 `halo_vocal`, not `halo_vocal-2`).
- **W04 — five-star slam SFX:** "Remove the smash SFX over the 5 stars." (the R9 `boom`.)

## VO — cut artifacts (systemic; root-cause REQUIRED before fixing)

- **W09 — "Cracked":** "voiceover still has a little cut after the title card of voice."
- **W10 — "Canceled the grant on the spo---t":** "That's what it sounds like. We can keep the
  SFX out but the voiceover has to be continuous."
- **W11 — many sites:** "'Shot himself', 'home' both have weird voiceover cuts. Plenty more
  died on the 'way', 'way' has a weird voiceover cut. Didn't come after 'Macgregor' also weird
  voiceover cut. 'Alive' same thing. 'Paris instead', same thing. 'On trial for fraud', same
  thing. Did you not run the voiceover gen through our skills correctly? Is it a render issue?
  Why is it fucked up. There's many more of the same issues across the board."
  → cited sites: cracked (post-card) · on the spot · shot himself · home · way (plenty more
  died on the way) · after MacGregor (didn't come) · alive · Paris instead · on trial for
  fraud. Symptom class: audible discontinuity at word boundaries. Prime suspects: R8
  sentence-gap law splices in breath.py; R9 re-synth splice joins; splice fade length.
  **Deliverable: evidenced root cause + fix through the owning skill, not hand-patched audio.**
