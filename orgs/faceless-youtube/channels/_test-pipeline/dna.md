# Channel DNA — What Happens To You  (TEST FIXTURE — safe to delete)

> Throwaway fixture for the end-to-end pipeline integration test (idea → script → metadata → shots).
> Not a real channel. Niche chosen to differ from `_test-metadata` (business) and `_test-eng`
> (engineering), and to exercise a stylized-animation visual path.

## Identity

- **Channel name:** What Happens To You
- **Niche:** what-if
- **One-line promise:** Every video puts *you* inside one impossible, terrifying scenario and walks your body through exactly what happens, second by second.
- **Original angle / POV:** Signature format "The Countdown" — a second-person, real-time survival clock. Not "what if X happened to the world" (cosmic) — always "what happens to *you*, right now, in this body."
- **Audience / region / language:** US, English

## Doctrine (universal.md §1a — one lever per channel, never per video)

- **Locked emotional lever:** Morbid awe / dread — personal-scale, "vicarious body-in-extremity" (the Zack D. lane).
- **Named refusals:** No cosmic-scale awe scenarios (that's a different lever/channel). No real-death depiction or gore — dread by *simulation and suggestion*, never graphic bodies. No geopolitical/real-war hypotheticals (defamation + a different lever).

## Format

- **Primary format:** long-form, shorts as the viral funnel
- **Target length:** 10–18 min primary (what-if band; documentary-dread lane)
- **Shorts per long-form:** 3–6 (what-if cadence band; the shorts are the reach engine)
- **Cadence:** 1 long-form/week + 3–4 shorts staggered after
- **Recurring structure:** in-media-res hook (you are already inside it) → the setup (how you got here) → the countdown begins → body-system failures in sequence → mid-video re-arm (the twist that makes it worse) → the withheld final second → dread close

## Voice & style

- **Voice ID (locked):** JBFqnCBsd6RMkjVDRZzb  (placeholder — George)
- **Tone:** calm, clinical second-person narration ("you"); measured, never campy; let the scenario carry the dread
- **Script/voice register (locked):** dread (opt-in — this is a Zack-D dread channel), but delivered
  **plain and concrete**: every beat carries a real physical fact or mechanism and the dread comes from
  the *accurate scenario*, never from trailer-voice portent. Banned: empty menace ("the water is
  deciding when it ends"), "everything you know is wrong," bare countdown beats. Payload first, dread as
  the register on top. See universal.md §1-P + §1d-R.
- **Narrator persona (locked):** the calm field-guide — an unshowy expert who has watched this happen
  many times and walks you through it in a level, second-person voice. Never breathless, never campy;
  the composure is what makes the scenario land. Write toward this person on every line (§1d-V).
- **Humor dial (locked):** dark-dry (a sparse `dry-sprinkle` variant). At most a beat or two per video,
  only the kind that rides the calm register — dry, dark asides about a *mundane* detail (the radio
  still playing; the door being "very insistent"), never about the danger or the death. The survival
  payload stays 100% sincere. Rules in §1d-V.

### Voiceover config (machine-read by the `voiceover` skill)
```yaml
voice_id: JBFqnCBsd6RMkjVDRZzb   # locked channel voice (George placeholder)
model_id: eleven_multilingual_v2
stability: 0.6                    # dread lever: steady, low, clinical
similarity_boost: 0.8
style: 0.1                        # keep exaggeration low — the scenario carries it
use_speaker_boost: true
speed: 0.98
output_format: mp3_44100_128
```

- **Script rules:** hook <5s (first frame already mid-scenario); value in 7s; second-person throughout; withheld peak in final 20%; emotional payoff not a lesson; `[B-ROLL]`/`[PAUSE]` markers; humanized. Full doctrine in `universal.md`.
- **Visual style:** stylized 3D / flat-vector animation (Zack-D-adjacent), high-contrast cinematic lighting, saturated-but-dark palette (deep indigo + hazard-orange accent), second-person POV framing (over-the-shoulder / first-person limbs), impossible physics rendered as clean stylized animation — NOT photoreal. Suggestion over depiction for anything bodily. Locked signature.
- **Visual register (locked):** stylized-signature — a locked flat-vector/3D style-token on every
  frame (abstract what-if scenario → illustrated, never photoreal, never the uncanny semi-photoreal AI
  B-roll middle). Per universal.md §13.

## Branding

- **Thumbnail style:** single figure (silhouette or stylized POV) mid-scenario against a dark field, hazard-orange accent, one clear anomaly, ≥50% negative space, ≤3-word overlay, no gore
- **Banner / profile:** dark indigo field, hazard-orange "What Happens To You" wordmark
- **Naming conventions for titles:** "What Happens To You If…" / declarative punchline-first; second person; no numbered lists; no question marks

## Guardrails specific to this channel

- Dread by simulation, not gore: never render graphic injury, real death, or bodies-in-extremity; the horror is anticipation and physics, shown stylized. YMYL-adjacent medical claims stay general and non-advisory.

## Status

- **Created:** 2026-07-02
- **Autonomy stage:** inherits project Stage 0
- **Monetization progress:** subs 0 / 1,000 · watch hours 0 / 4,000
