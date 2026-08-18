# DcD9cjRtNdm — Apollo - self-hosted open-source voice agent
- post: https://www.instagram.com/p/DcD9cjRtNdm/ | author: @We Explore AI | Artificial Intelligence News & Tools | published: 20260815 | duration: 31s

## What's demonstrated
A slide-deck-style reel (no narration audio detected — the video track has `has_audio: true` but the transcription came back empty, so any voice/music is not carried in words; all substance is in the on-screen text cards) walking through "Apollo," a self-hostable voice agent. It shows mocked device-conversation transcripts ("Hey, Apollo." → reminders, memory saves) then a 3-part architecture breakdown (body/brain/console) and a features grid, ending on an install command and domain.

## Concrete mechanism
Apollo splits into three owned pieces: **the body** (firmware flashed onto whatever microcontroller/board with a mic, speaker, and WiFi you put on your desk), **the brain** (voice turns, memory, tools, and schedule handled inside a single Cloudflare Durable Object), and **the console** (a dashboard "live from your worker" showing everything it knows/plans). Memory is described as "recalled by meaning, not by text," implying semantic/embedding-based retrieval rather than literal string search. Tool access goes through MCP to connect to services the user already has. It also has an "always on" mode tuned for short spoken answers rather than a chat-window UX.

## Named tools / repos / models / APIs
- Apollo — the product name, "Your personal desk agent" [frame]
- heyapollo.dev — project site [frame]
- `npx create-heyapollo` — install/setup command [frame]
- Cloudflare — "in your own Cloudflare account"; brain runs as a Durable Object; console served "live from your worker" (Cloudflare Workers) [frame]
- MCP — "Your tools: Connects over MCP to the services you already use" [frame]
- Developer credited in the manifest caption (not shown on-screen in these frames): Valentín Galfré

## Specific claim / result
No quantified benchmark or number — this is a product/architecture pitch, not a result claim. Concrete functional claims shown on-screen: it can set device-local timers ("Remind me in 20 minutes... Done. I'll tell you at 18:40. 18:40 · timer armed on the device"), save free-text memories and recall them later, do web search condensed to "one actionable sentence," and delegate real repository work to "an isolated engine" (a coding agent) that "reports back out loud."

## Novel / buildable moments (with timestamps)
- 00:07–00:13 — the three-part split (body = firmware on cheap hardware / brain = single Durable Object holding voice+memory+tools+schedule / console = worker-hosted dashboard) is a clean, buildable reference architecture for a self-hosted voice-agent-on-a-desk-device project.
- 00:19–00:24 — feature grid is essentially a scoped MVP feature list: Memory, Web search, Reminders, MCP tool access, Coding-agent delegation, Always-on short-answer mode — worth lifting directly as a target feature set.
- 00:10–00:13 — "memory · recalled by meaning, not by text" is a specific, testable design claim (vector/semantic memory vs. keyword) worth verifying against the actual repo if pursued.

## Transcript highlights
No spoken transcript was recovered (audio track present but Whisper returned zero segments — likely background music or no speech). On-screen text quotes instead:
- 00:01 "Hey, Apollo."
- 00:03 "Build an agent you can pick up."
- 00:08 "'Hey, Apollo. Remind me in 20 minutes to take the bread out.' / 'Done. I'll tell you at 18:40.'"
- 00:12 "'I left the spare keys in the workshop drawer.' / 'Saved. Ask me when you need it.'"
- 00:15–00:16 "The body: The firmware, on whatever board you put on your desk." / "The brain: Voice turns, memory, tools and schedule in a single Durable Object."
- 00:19 "An agent with a body. Not everything has to be a chat window."
- 00:27 "npx create-heyapollo — heyapollo.dev"

## Reliability
Substantive — no "comment X for the repo" gate; the install command and domain are given directly on-screen, and the architecture claims (Cloudflare Durable Object, MCP tool access, firmware/brain/console split) are specific enough to be checked against the real repo rather than vague hype.
