---
name: publish-queue
description: Performs the human-gated, idempotent PRIVATE upload of a finished video — the last pipeline stage, after compliance-check. Use when a compliance-passed folder is ready: "publish this video", "upload to YouTube", "run publish-queue", "push the finished video". Preflights (idempotency + compliance PASS + final.mp4), uploads via the youtube-uploader MCP as `private`, writes `publish-record.json`. Uploads are ALWAYS private — only a human in Studio can flip it public, and only a human approves each publish. NOT for assembling video (`render-builder`) or the pre-publish gate (`compliance-check`).
---

# publish-queue

The last stage of the pipeline: take a finished, compliance-passed video folder and put it on YouTube
as a **private** upload, then record that it happened. Two deterministic engines
(`scripts/publish_preflight.py`, `scripts/write_publish_record.py`) bracket one piece of agent-work
(the upload via MCP). The scripts make **no network calls** and never touch credentials.

## Stage-0 law — read before doing anything

Autonomy here is **Stage 0**. This is not a discretionary judgment; it is the binding floor:

1. **A human approves EVERY publish.** There is no autonomous publish. You run this only after a human
   has read the Gate-3 `compliance-report.md` and said go. The upload is in-session T3 agent-work.
2. **Every upload goes out `private`.** The OAuth app backing the youtube-uploader MCP is **unaudited**,
   so the Data API is only permitted to create videos at `privacyStatus: private`. The record hard-codes
   `"privacy_status": "private"` to match. There is no code path to public.
3. **Only a human, in YouTube Studio, can make a video public.** The API cannot, and must not try.
4. `metadata.json` itself encodes the policy floor: `defaults.privacy_status == "private"` and
   `defaults.contains_synthetic_media == true`. compliance-check already verified both; publish-queue
   relies on that verified state and never weakens it.

## Where this sits in the pipeline

`render-builder` → `compliance-check` (Gate 3, human reads the report) → **publish-queue**

- **Reads:** `compliance-report.md` (its exit state / mechanical section), `assets/final.mp4`,
  `metadata.json`.
- **Writes:** `publish-record.json` — the durable proof of a completed upload.
- **Transport:** the **youtube-uploader MCP** (tools: `authenticate`, `channels`, `upload_video`,
  `accesstoken`, `refreshtoken`). Credentials live in the MCP. **The scripts never make network calls
  and never see a token.**

## The procedure (in-session, T3, after a human go)

### 1. Preflight — `publish_preflight.py <video_dir>`

```bash
py -3 .claude/skills/publish-queue/scripts/publish_preflight.py channels/<name>/videos/<slug>
echo $?   # 0 = GO, 1 = NOT-READY, 2 = ALREADY-PUBLISHED
```

Exit codes are the contract:

- **0 — GO.** Idempotency clear (no `publish-record.json`), compliance-report.md exists AND its
  `## Mechanical checks` section has no `FAIL — ` line, and `assets/final.mp4` exists. Proceed.
- **1 — NOT-READY.** One condition failed; the message names it (missing report, a mechanical FAIL,
  or missing final.mp4). Fix upstream (re-run compliance-check / render-builder). Do NOT upload.
- **2 — ALREADY-PUBLISHED.** A `publish-record.json` is present; it prints `already published: <video_id>`.
  Stop — this video is done. This is the idempotency guard: a re-run never double-uploads.

Preflight PARSES the report the compliance-check skill already wrote — it does **not** re-run the
mechanical checks. It is read-only and makes no network calls.

### 2. Auth check — prove the MCP is authenticated

Call the youtube-uploader MCP **`channels`** tool. A successful channel list proves the MCP holds a
valid, authenticated session for the right account. If it fails, call `authenticate` (and
`refreshtoken` if needed) and retry. Never handle, print, copy, or persist the token — it stays in the
MCP.

### 3. Upload — `upload_video`, always `private`

Read the upload fields from `metadata.json`'s `long_form` block (real nesting):

- title ← `long_form.title_primary`
- description ← `long_form.description`
- tags ← `long_form.tags`
- privacy ← `defaults.privacy_status` (which is, and must be, `"private"`)

Call `upload_video` with those and `privacyStatus: private`. It returns the new **video_id**. Only the
`title_primary` / primary thumbnail go up — native A/B (title/thumbnail challengers) is a Studio-only
feature the Data API cannot submit; the human sets that up later in Studio.

### 4. Record — `write_publish_record.py`, immediately

The moment `upload_video` returns, write the record so the video_id is captured on disk:

```bash
py -3 .claude/skills/publish-queue/scripts/write_publish_record.py \
    channels/<name>/videos/<slug> --video-id <returned-id> --timestamp <iso8601-now>
```

`--timestamp` is **caller-supplied** (the runner passes the completion time — no ambient clock, so the
record is reproducible). It streams the sha256 of `final.mp4` in chunks (the file can be ~1 GB), embeds
the full parsed `metadata.json` as `metadata_snapshot`, hard-codes `privacy_status: private`, and
**refuses to overwrite** an existing record (exit 2). The record:

```json
{
  "video_id": "<id>",
  "url": "https://www.youtube.com/watch?v=<id>",
  "uploaded_at": "<iso8601, caller-supplied>",
  "privacy_status": "private",
  "file_sha256": "<streamed sha256 of assets/final.mp4>",
  "metadata_snapshot": { "...full metadata.json...": true }
}
```

### 5. The two deliberately-manual Studio steps (a human does these)

These stay manual — on purpose — and publish-queue does **not** do them:

- **Set the thumbnail.** The unaudited OAuth app cannot set a custom thumbnail via the API. The human
  uploads `assets/thumbnail.png` in Studio. (It also sits at the gate the human already attends, so
  there is no automation worth building here.)
- **Flip private → public.** By Stage-0 law only a human, in Studio, can make the video public — after
  the final human review. The API neither can nor should. The human does this when ready.

Both steps sit at a gate the human is already attending, so leaving them manual costs nothing and keeps
the "only a human can make it public" invariant literally true.

## Failure protocol

- **Preflight NOT-READY (exit 1):** fix upstream and re-run; nothing was uploaded.
- **Partial / failed upload (upload_video errored, timed out, or you're unsure it landed):** because
  the record is written **only after** a confirmed success, a partial upload leaves **no
  publish-record.json**. Retrying in-session is therefore **safe** — preflight will still say GO and you
  upload again. (If a stray private draft did land, the human removes it in Studio; the API's private
  scope contains the blast radius.)
- **Record already exists (exit 2 from either script):** the video is already published — stop. The
  record is the single source of truth; never overwrite it.

## Engines

- `scripts/publish_preflight.py <video_dir>` — the idempotency + readiness gate (0/1/2). Read-only,
  network-free.
- `scripts/write_publish_record.py <video_dir> --video-id <id> --timestamp <iso>` — writes the record;
  streamed sha256; refuses overwrite. Network-free.
- `scripts/test_publish_queue.py` — `py -3 -m unittest test_publish_queue` (stdlib only, tmp-dir
  fixtures, no network).
