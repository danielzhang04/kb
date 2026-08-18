# DcIFWCWM13f — Open-source on-device voice dictation (Wispr Flow killer)
- post: https://www.instagram.com/p/DcIFWCWM13f/ | author: @Angelo Trifanoff | published: 20260817 | duration: 35s

## What's demonstrated
Creator shows an open-source macOS dictation app called **Talkify**, opening its GitHub repo page, then its marketing landing page, then a latency-benchmark screen comparing it against several other dictation tools, then a live demo dictating a prompt into what looks like his own personal Claude Code usage-tracking dashboard. The core pitch: Talkify runs fully on-device using Apple's new SpeechAnalyzer API (macOS 26), so nothing leaves the machine, unlike cloud dictation apps.

## Concrete mechanism
Talkify hooks into Apple's SpeechAnalyzer engine (new in macOS 26, the same engine behind Notes/Journal live transcription) rather than bundling its own Whisper model. Per the landing-page text shown on screen: hold a hotkey to speak, the audio goes to Apple's on-device speech engine, and text is inserted directly into whatever field you were typing in ("Hold your key and ... voice to the sp[eech engine] ... introduced in mac[OS 26] ... behind Note[s]/Journal. Let go and [it] goes straight in[to] [what you] were typing in."). It claims no model spin-up delay because it "warms it up at launch."

## Named tools / repos / models / APIs
- **Talkify** — GitHub repo, org/user shown as "tornikegomareli" (top-left breadcrumb reads "…kegomareli / Talkify"), public repo, main branch, 11 branches, 9 tags [frame 00:01-00:07]
- **Apple SpeechAnalyzer** — new macOS 26 on-device speech-to-text API, described on Talkify's own site as what powers it [frame 00:12-00:13]
- **Wispr Flow** — named competitor, spoken and on-screen as the app Talkify is claimed to beat [audio 00:00-00:03, frame 00:12]
- **superwhisper** — competing local dictation app, shown in the latency benchmark bar chart ("Standard EN, local") [frame 00:17]
- **Voice Ink (VoiceInk)** — competing dictation app, shown in benchmark chart and again at the bottom of a later frame [frame 00:16-00:17]
- **MacWhisper** (Large v3 Turbo) — competing app using Whisper large-v3-turbo, shown in benchmark chart [frame 00:17]
- **Whisper** (unnamed default variant) — another bar in the same chart, labeled "Wis[per] ... Def[ault]" [frame 00:17]
- **Claude / Opus 4.8** — the personal usage dashboard he dictates into shows "Favorite model: Opus 4.8" and is captioned "What's up next, Angelo?" — looks like a custom Claude Code usage tracker, not named explicitly [frame 00:18-00:23]
- Repo link itself not fully readable in frame (URL bar not shown); only the GitHub breadcrumb is visible

## Specific claim / result
On-screen "Talkify Latency Bench" tool shows a median-latency comparison across engines with Talkify's bar shortest (fastest); one frame shows "128 ms" as a number near the top of the benchmark UI, implied to be Talkify's median dictation latency, beating superwhisper, Voice Ink, Whisper default, and MacWhisper (Large v3 Turbo) [frame 00:15-00:17].

## Novel / buildable moments (with timestamps)
- 00:15–00:17 — Talkify ships its own in-app "Latency Bench" tool that benchmarks itself against competitor dictation engines live, with a bar chart and median-ms numbers. Worth stealing as a pattern: any tool making a speed claim should ship a self-contained, screenshot-able benchmark UI.
- 00:12–00:14 — Building directly on Apple's SpeechAnalyzer (macOS 26) instead of bundling a Whisper model is the actual differentiator claimed — worth checking whether that API is usable for any of our own on-device transcription needs (e.g., video-vision plugin's local whisper backend could potentially be swapped/compared).
- 00:18–00:23 — The creator's own screen shows a personal Claude Code usage-tracking dashboard ("What's up next, Angelo?") with session/message/token counts, streaks, peak hour, and favorite model — a self-built observability surface for his own Claude Code usage. Buildable idea independent of Talkify itself.

## Transcript highlights
- 00:00–00:03 — "Somebody just killed WhisperFlow with an open source project."
- 00:03–00:05 — "It's called Talkify."
- 00:05–00:07 — "It went up about seven days ago and you can use it in about a minute."
- 00:09–00:12 — "Now, what this can do that the voice to text on Mac and all the WhisperFlow apps can't do..."
- 00:14–00:18 — "...is that everything stays local on your computer as it runs local AI models."
- 00:24–00:26 — "And to be honest, I'm gonna be using this every day now instead of WhisperFlow."
- 00:26–00:31 — "Now, if you want the link, comment repo down below and I'll send you my list along with the GitHub link."

## Reliability
Substantive, not pure grift: the video actually shows the real GitHub repo, the real landing page copy, and a real in-app benchmark screen with numbers — though the repo URL itself is never fully readable and getting it still requires commenting "REPO" for the DM link (mild lead-magnet pattern layered on top of genuine content).
