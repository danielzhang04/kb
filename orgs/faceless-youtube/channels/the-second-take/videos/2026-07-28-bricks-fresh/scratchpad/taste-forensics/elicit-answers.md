# G0 elicitation answers — Daniel (verbatim record)

Recorded by boss session 2026-08-11/12. Answers given by panel/beat, not strictly by qid;
qid mapping noted in brackets by the boss, never inside Daniel's text. Board 1 = P01–P07.
Board 2 (P08–P12) pending.

Panel context for readers: P07 was expanded during this G0 session at Daniel's direction
(fix rounds 2–4: old L215 brick-in-box, L28-r1probe place-plate probe, then the full
11-frame L28 probe family — commits 095656d, c585b09, b1d34d8) before he closed it with
"Nevermind here."

## Session 1 — board 1 (P01–P07), verbatim

P01:
- I like the money delta chain. The hollowed out one is fun. I like the "rewind" shot.
- The six shots read as a little repetitive. Bigger thing is, I just don't like the plate itself. I want space to be bigger/less cramped, text to be black, look a little more like a factory instead of a small room with nothing on the shelves.
- Crowd rig, (1) Outfits should align with the setting and time. I.E Business room, should be business attire. Factory, should be factory worker attire. (2) I don't want crowd rig to all be just bald and cream. They should have hair and skin tone, and facial expressions that match the setting and time and situation. However, don't slip back into prior rig problems

P02:
- L36 is okay. L35 because there is more going on, it's a more unique shot. Also, something like this background (not exactly this) could be a better plate for MiniScribe HQ. So staging.
- L35 palette may be a little too cool. It's fine for a shot, but I don't want the entire video to be cool palette. Perhaps we go back (a little bit back) to the slightly warm channel profile that we had back during Poyais.
- L38, character is off rig (ear). Also, I don't like that facial expression. Remove it from the expression asset library

P03:
L27:
- Staging for the not named shot is fine. It just has 5 fingers (in a pose that wasn't seeded from anything), and the character is cream and bald. It's not a cast character. Doesn't make sense.

L29:
- I don't love the named one either. I think in general, there could be a little more detail in the backgrounds and just shots in general. Not too much detail, but a little more.
- Unnamed one, unnamed because the facial expression isn't seeded from any existing one, and I don't like the background, as I said in P01. You should take a look at the seeding logic.

L30/31:
- I don't believe I chose this shot. The "named" one is off. Terry eyes aren't seeded from the character itself, they are crowd rig bead eyes. Also characters are too big. Also, mountains in the back don't make sense.
- I think, as I suggested before now, perhaps we can reinstate the slightly warm channel palette from the Poyais era, perhaps not as warm but these shots I think are too monotone almost.
- Unnamed one was unnamed, because there's again, slightly too little detail, and the shot doesn't really match the text

P04:
L32:
- I don't think I named this one. I think I named a different one. But I like the shot, it's fun and unique. The plates are burning on HOT.
Unnamed one because (1) base cream, bald character. (2) I don't like that facial expression either. Get rid of it from the asset expression base library

L33:
- Don't love the named one. Again, crowd rig I want hair, skin tone, without fucking up rigging.
- Unnamed one, hair is off rig and again, the plate itself. Perhaps we should build, for image gen, a wave for human review of plates, all characters in poses and expressions, objects, and whatever, BEFORE actual image gen starts. If that isn't already the case, which I think it might be

L36:
- Changed my mind. I think the not named one better. It's just the facial expression on the guy is a little too strong. Maybe he could be celebrating instead of super smug smiling. That expression doesn't even look like smug, it looks like he's a villain

P05:
L38:
- Mentioned prior. Unnamed because facial expression. And the big guy in named is the COMPAQ character, in unnamed, he's nobody. And the art style/color is a little off

L39:
- Unnamed because shot is way too cool, colors are off. And character isn't seeded from any library pose, thus he's off rig. Again, did we loosen character, expression, skin tone, poses, rigging, because there's a bunch of shots in the new gen that are random and thus fucked.

L44, 45, 46, don't love any to be honest

P06:
L47:
- Named staging is better, lighting is good, warmer. Unnamed, nothing in the background, cool, and I don't like the plate inside, again.
- Again, I don't want really warm. I just don't like the monotone cool.

L48:
- Named, shot is interesting. Depicts the scene. Unnamed place I don't like again. AND the expression isn't seeded off asset expressions and is thus off.

L50:
- Honestly both are fine, but neither is great.

P07:
- Nevermind here.

## Session 2 — board 2 (P08–P12), verbatim

P08:
L07:
- Staging for chosen is better. However, again with the crowd rig
- Unchosen, crowd is off rig, proportions wise. And I like the slightly more detail in chosen

L10:
- Chosen is just better. Good staging and lighting, does well for the shot.
- Unchosen, nothing going on there, I don't like the staging of the environment either, and crowd rig problems
- Note that when I talk about detail, I'm talking more about the shots where it's environment based or a literal scene. For the prop-focus or non-human focus/non environment focus shots, that's not necessarily a problem

L19:
- Chosen, "raking it in" is good. Warmer. However, since the pose isn't seeded, the guy has four fingers which is a problem. Also, one center character foreground, can be character rig instead of crowd rig

- Unchosen just. I don't know. I guess it's the cooler palette, staging is a little off, and characters all have noses

L20:
- The comparison here is off. But the chosen one is just good. However, crowd rig problems like before, but it's a good shot.


P09-11:
- Honestly, I think my earlier feedback covers all of the feedback I would give here across the board too.

## Boss qid mapping + flags (not Daniel's words)

- P01 → Q1–Q4 (chain vs place-children, plate, crowd rig). P02 → Q5–Q8. P03 → Q9–Q14
  (then-and-now L25–L31 chunk incl. Q11 rewording). P04 → Q15–Q20 (incl. Q17). P05 → Q21–Q26
  (incl. Q23). P06 → Q27–Q30 (incl. Q29). P07 → Q31–Q33 (closed "Nevermind here" after the
  17-frame expansion).
- LIKED-LIST CORRECTIONS (supersede spec Input data for these beats): L30/31 "I don't believe
  I chose this shot"; L32 "I don't think I named this one. I think I named a different one";
  L36 verdict REVERSED (now prefers the not-named frame).
- DIRECTIVES RECORDED, NOT EXECUTED (read-only until G2; each becomes proposal input):
  remove the L38 expression from the expression asset library (stated twice — also at P04 L32);
  reinstate slightly-warm Poyais-era channel palette ("a little bit back", "not as warm");
  crowd-rig hair/skin-tone/setting-appropriate outfits without regressing rig discipline;
  bigger/less-cramped factory-like plates, black text on plates; pre-gen human review wave for
  plates/poses/expressions/objects; investigate seeding logic (unseeded poses/expressions/
  fingers reaching output = off-rig).
- OPEN QUESTIONS DANIEL ASKED (Track C must answer mechanically): "did we loosen character,
  expression, skin tone, poses, rigging?" — and whether a pre-gen asset review gate already
  exists (C-6 stamp covers staged figures; coverage of plates/expressions/objects to be
  confirmed by the routing trace).
- Session 2 flags: P09–P11 (and by extension P12/Q45/Q47 keep-questions) closed by blanket
  "earlier feedback covers all of the feedback I would give here across the board too" —
  keep-side qualities therefore derive from his positive statements, not per-panel answers.
  L20 "the comparison here is off" = board pairing defect noted (does not invalidate his
  verdict on the chosen frame). Detail preference SCOPED: applies to environment/scene
  shots, explicitly NOT to prop-focus/non-human/non-environment shots.
