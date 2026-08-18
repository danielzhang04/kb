# DcGxs-_NiNA — Fable 5 UGC ad generation
- post: https://www.instagram.com/p/DcGxs-_NiNA/ | author: @Simonas Diponas | published: 20260816 | duration: 41s

## What's demonstrated
A real, step-by-step screen recording (not just talk) of connecting a UGC-ad-video platform called **UGCdrop** to a Claude-family chat interface via a custom MCP connector, then prompting it in plain English to batch-generate 10 UGC-style ad videos. The video shows the actual UGCdrop settings page, the actual MCP-server URL and tool list, the actual "Add custom connector" dialog, the actual chat response text describing the batch run, and the actual resulting video thumbnails (using the creator's own face) in UGCdrop's render library.

## Concrete mechanism
1. Go to ugcdrop.com/settings → Account Settings → the "MCP" tab, which shows a card titled "UGCdrop MCP Server" ("Connect Claude, ChatGPT, Cursor, or any MCP-compatible AI client to UGCdrop...") with an OAuth server option ("Sign in with your UGCdrop account — no API key needed") and a Remote MCP server URL to copy.
2. In the Claude-family chat client, open the "+" menu → Connectors → Manage connectors → Add connector → Add custom connector, give it a name ("ugcdrop"), and paste the MCP server URL into the "Remote MCP server URL" field (OAuth Client ID/Secret left optional).
3. Once connected, ugcdrop shows up alongside other already-connected connectors (Google Drive, Higgsfield mcp, VidIQ, Claude in Chrome, Salesforge).
4. Select the **Fable 5** model in the chat, type "make 10 UGC videos please," and the assistant calls the MCP tools itself to batch-render 10 videos in one session, landing in ugcdrop.com/studio's "recent renders" list — no video editor, no manual per-video UI work.

## Named tools / repos / models / APIs
- **UGCdrop** (ugcdrop.com) — the UGC-ad-video generation platform; its Settings page, Studio, and "recent renders" library are all shown directly [frame 00:07-00:12, 00:31-00:34]
- **UGCdrop MCP Server** — OAuth-based remote MCP server; URL visible on screen: `https://sozcfaviphwqfaqaonqy.supabase.co/functions/v1/mcp` [frame 00:11-00:12]
- **UGCdrop MCP available tools** (read directly off the settings page): `get_credits` (check remaining Studio credits), `list_hook_videos` (browse hook clips, search/tags/pagination), `list_saved_demos`, `preview_render_cost` (dry-run credit cost for a Studio job), `generate_videos` (render Studio videos, spends credits), `get_session_status` (poll a running render session) [frame 00:12, 00:24]
- **Claude** (Anthropic) — the "Add custom connector" dialog is explicitly Claude/Anthropic-branded ("Connect Claude to your data and tools... Only use connectors from developers you trust. Anthropic does not control which tools developers make available...") [frame 00:20]
- **Fable 5** — the model selected in the chat dropdown for this task, with an in-app tooltip: "Fable 5 is the most capable model and draws down usage much faster than Opus 4.8" [frame 00:24-00:25]
- **Opus 4.8** — named only as the comparison point in that same tooltip [frame 00:24]
- Pre-existing connectors visible (already toggled on in this account, not demonstrated in depth): **Google Drive**, **Higgsfield mcp**, **VidIQ**, **Claude in Chrome**, **Salesforge** [frame 00:16-00:17]
- **Seedance** — named only in the on-screen caption cost comparison at the very start, not otherwise discussed [frame 00:00]

## Specific claim / result
- On-screen caption overlay (not spoken, present for the whole video): "100 UGC with Seedance – $148" vs. "100 UGC with Fable 5 – $1.32."
- Chat response text (visible but partially blurred) reports on this specific run: "10/10 done, zero failures, zero retries... All 10 in one session: ugcdrop.com/studio → 'Claude MCP batch 3 - fix test'... Render times [down] in the 10-22 second range, no outliers. Batch reliability went from 80% → 100%..." — i.e., a claimed reliability improvement from a prior 80% success rate to 100% on this batch, with per-video render times of 10–22 seconds. This is the app's own self-reported summary text, not independently verified.

## Novel / buildable moments (with timestamps)
- 00:06–00:23 — Full concrete recipe for exposing any SaaS product's core actions as an MCP server (OAuth-based, no API key needed) and wiring it into Claude/Fable via "Add custom connector" — directly reusable pattern for any of our own tools we'd want Claude to drive conversationally instead of through a UI.
- 00:12, 00:24 — The specific MCP tool-naming convention shown (`get_credits`, `preview_render_cost`, `generate_videos`, `get_session_status`) is a clean, minimal example of a cost-aware, pollable batch-job MCP surface — worth mirroring for any tool where we want dry-run cost preview + async job status baked into the MCP contract itself.
- 00:24–00:30 — A single natural-language prompt ("make 10 UGC videos please") triggering a full batch render via MCP tool orchestration, completing in ~30 seconds — demonstrates that once an MCP surface exists, no custom orchestration code is needed on the client side.

## Transcript highlights
- 00:03–00:06 — "This is insane for UGC, bro, look at this."
- 00:06–00:11 — "Go to UGCDrop.com, click on Settings, Account Settings, MCP, copy this link, go to Cloud and click this plus." (narrator says "Cloud," clearly meaning "Claude")
- 00:15–00:20 — "Select Connectors, Add Connector, and add a custom connector. Add UGCDrop right here and paste the link right here. Select Fable 5."
- 00:25–00:30 — "ask it to make 10 UGC videos and it will be done in like 30 seconds. Then click on this link, go to your recent renders and you'll have all of the videos ready."
- 00:33–00:40 — "You can use your own face, other creators' faces, post it on social media and drive traffic to your website."

## Reliability
Substantive and directly verifiable — not a thin lead-magnet. Every named step is actually shown on screen (real settings page, real MCP URL, real tool list, real connector dialog, real chat prompt/response, real generated video thumbnails using the creator's own face). The two numeric claims (the $148 vs $1.32 cost comparison caption, and the "80% → 100% reliability" chat summary) are the app's/creator's own self-reported figures and are not independently verified within the video, so treat those specific numbers with some skepticism even though the workflow itself is clearly real and reproducible. Minor lead-magnet element: "comment 'guide' for the setup" at the end, but this doesn't gate anything already shown.
