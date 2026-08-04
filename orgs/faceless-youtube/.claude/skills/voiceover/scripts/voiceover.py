#!/usr/bin/env python3
"""
voiceover.py — the deterministic engine behind the `voiceover` skill.

Turns a scripted videos/<slug>/ folder into narration audio:
  script.md            -> assets/vo.mp3        (long-form)
  shorts/short-NN.md   -> assets/shorts/short-NN.mp3  (each `publish` short)
plus assets/voiceover.manifest.json (the contract render-builder reads) and a
readable assets/*.txt of exactly what was spoken (QA + resumability).

Design choices (see SKILL.md for the why):
  * Raw HTTP over Python stdlib urllib — zero pip dependency, so it never breaks
    in a scheduled or subagent run where the env isn't pre-provisioned.
  * The provider (ElevenLabs) lives entirely in this file, behind the file-based
    skill boundary, so swapping TTS vendors is a one-file change.
  * Long scripts are chunked at paragraph boundaries and stitched, with
    previous_text/next_text passed for cross-chunk prosody continuity.

CLI:
  python voiceover.py VIDEO_DIR [options]

Options:
  --dry-run            Parse + strip markers + write cleaned .txt + manifest, but
                       make NO API call (spends zero TTS quota). duration is estimated
                       from word count in this mode.
  --only PIECES        Comma list: "long-form", "shorts", or specific "short-01".
                       Default: long-form + every publish-tagged short.
  --all-shorts         Voice every short regardless of publish/bench status.
  --limit-chars N      Cap TOTAL characters actually sent to the API (truncates at a
                       word boundary). For cheap real smoke-tests on the free tier.
  --max-chunk-chars N  Split text into <=N-char chunks for the API (default 2000).
  --pause-seconds F    Seconds for each [PAUSE] break tag (default 0.6).
  --env PATH           Path to the .env holding ELEVENLABS_API_KEY (default: auto-find
                       by walking up from VIDEO_DIR to the repo root).
"""

import argparse
import base64
import json
import os
import re
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def build_ssl_context():
    """A TLS context that works across interpreters.

    Some Windows Pythons (e.g. msys2) ship without a CA bundle, so plain
    urlopen fails with CERTIFICATE_VERIFY_FAILED. Prefer certifi's bundle when
    installed; otherwise the system default (honours SSL_CERT_FILE and, on the
    native python.org build, the Windows cert store)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


_SSL_CTX = build_ssl_context()

API_BASE = "https://api.elevenlabs.io/v1/text-to-speech"
WPM = 150  # project runtime constant (matches scriptwriter / visual-prompt-writer)

# Project defaults for a channel that omits a knob in its dna voice block.
DEFAULT_VOICE = {
    "voice_id": None,  # no safe default — a missing voice_id is a hard error
    "model_id": "eleven_multilingual_v2",
    "stability": 0.45,
    "similarity_boost": 0.8,
    "style": 0.15,
    "use_speaker_boost": True,
    "speed": 1.0,
    "output_format": "mp3_44100_128",
}
_FLOAT_KEYS = {"stability", "similarity_boost", "style", "speed"}


# --------------------------------------------------------------------------- #
# Environment / config
# --------------------------------------------------------------------------- #
def find_repo_root(start: Path) -> Path:
    """Walk up from start until we find a .env (the repo root marker)."""
    for d in [start, *start.parents]:
        if (d / ".env").exists():
            return d
    return start


def find_route(start: Path):
    """Walk up from `start` looking for `.kb/spend-grant.json` (mirrors `find_repo_root`'s `.env`
    walk, but independently — an attempt worktree may carry the grant file with no `.env` at all).
    Its presence gates worker-mediated ROUTE MODE: spend goes through the daemon's paid-action
    route instead of a direct ElevenLabs call, and ELEVENLABS_API_KEY is never read. Its directory
    is the ROUTE ROOT that `expectedArtifactPath` is expressed relative to. Returns
    (grant_dict, route_root) or (None, None) when absent — the direct-provider path is unchanged."""
    for d in [start, *start.parents]:
        p = d / ".kb" / "spend-grant.json"
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8")), d
    return None, None


def load_env(env_path: Path) -> dict:
    env = {}
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def parse_voice_config(dna_text: str) -> dict:
    """
    Resolve the channel's voice config, with project defaults for anything omitted.

    Primary source: a fenced code block in dna.md containing `voice_id:` lines
    (the machine-read 'Voiceover config' block). Fallback: the prose
    '**Voice ID (locked):** XXXX' line, so older channels still work.
    """
    cfg = dict(DEFAULT_VOICE)

    block = None
    for m in re.finditer(r"```[a-zA-Z]*\n(.*?)```", dna_text, re.DOTALL):
        if "voice_id:" in m.group(1):
            block = m.group(1)
            break
    if block:
        for line in block.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            k, _, v = line.partition(":")
            k, v = k.strip(), v.split("#")[0].strip()
            if k not in cfg or not v:
                continue
            if k in _FLOAT_KEYS:
                cfg[k] = float(v)
            elif k == "use_speaker_boost":
                cfg[k] = v.lower() in ("true", "1", "yes")
            else:
                cfg[k] = v
    else:
        m = re.search(r"Voice ID[^:]*:\*\*\s*([A-Za-z0-9]+)", dna_text)
        if m:
            cfg["voice_id"] = m.group(1)

    return cfg


# --------------------------------------------------------------------------- #
# Marker stripping — turn script markup into clean spoken text
# --------------------------------------------------------------------------- #
EXPRESSIVE_MARKER_TRANSLATIONS = {
    "[emote: curious]": "[curious]",
    "[emote: knowingly]": "[knowingly]",
    "[emote: sternly]": "[sternly]",
    "[emote: sighs]": "[sighs]",
    "[emote: exhales]": "[exhales]",
    "[aside: dry]": "[deadpan]",
}
_EXPRESSIVE_CANDIDATE_RE = re.compile(r"\[(?:emote|aside)\b[^\]]*\]", re.IGNORECASE)
_EXPRESSIVE_ADJACENCY_RE = re.compile(
    r"\[(?:emote|aside)\b[^\]]*\]\s*\[(?:emote|aside)\b", re.IGNORECASE
)
_TRAILING_RHYTHM_CUES_RE = re.compile(
    r"(?:\[(?:PAUSE(?::LONG)?|BEAT)\]\s*)+$", re.IGNORECASE
)
_V3_MOOD_OR_CHAPTER_RE = re.compile(
    r"^\s*(?:\[[^\]]+\]\s*)?(?:step\s+\d+\s*[:.]|\[(?:curious|knowingly|sternly|sighs|exhales|deadpan)\])",
    re.IGNORECASE,
)
_MIN_V3_CHUNK_CHARS = 250


def _without_nonspoken_cues(text: str) -> str:
    """Remove visual-only cues before checking spoken expressive markers."""
    text = re.sub(r"\[B-ROLL[^\]]*\]", "", text)
    text = re.sub(r"\{[^}]*\}", "", text)
    return "\n".join(
        "" if line.strip().startswith(("#", ">", "---")) else line
        for line in text.splitlines()
    )


def validate_expressive_markers(raw: str) -> list[str]:
    """Reject unsupported or badly placed delivery markers before any TTS request."""
    text = _without_nonspoken_cues(raw)
    if re.search(r"\[(?:emote|aside)\b[^\]\n]*(?:\n|$)", text, re.IGNORECASE):
        raise ValueError("Unsupported or malformed expressive marker (missing closing bracket).")
    if _EXPRESSIVE_ADJACENCY_RE.search(text):
        raise ValueError("Expressive delivery markers may not be adjacent.")
    markers = []
    for match in _EXPRESSIVE_CANDIDATE_RE.finditer(text):
        marker = match.group(0)
        if marker not in EXPRESSIVE_MARKER_TRANSLATIONS:
            allowed = ", ".join(EXPRESSIVE_MARKER_TRANSLATIONS)
            raise ValueError(f"Unsupported or malformed expressive marker {marker!r}; allowed: {allowed}")
        before = text[:match.start()].rstrip()
        spoken_before = _TRAILING_RHYTHM_CUES_RE.sub("", before).rstrip()
        after_raw = text[match.end():]
        after = after_raw.lstrip()
        if spoken_before and spoken_before[-1] not in ".!?":
            raise ValueError(f"Expressive marker {marker!r} must appear before a sentence.")
        if not re.match(r"(?:[\"\u201c\u2018(]*[A-Za-z0-9])", after):
            raise ValueError(f"Expressive marker {marker!r} must be followed by a sentence.")
        if after_raw and not after_raw[0].isspace():
            raise ValueError(f"Expressive marker {marker!r} must be separated from its sentence.")
        markers.append(marker)
    return markers


def expressive_cleanup_summary(raw: str) -> str:
    """Return a compact dry-run report after validation has made markers safe."""
    markers = validate_expressive_markers(raw)
    if not markers:
        return "no expressive markers"
    translations = ", ".join(f"{marker}->{EXPRESSIVE_MARKER_TRANSLATIONS[marker]}" for marker in markers)
    return f"v3 {translations}; v2 strips {len(markers)} expressive marker(s)"


def _region(text: str, start_pat: str) -> str | None:
    """Return the text under the heading matching start_pat, up to the next `## ` heading."""
    m = re.search(start_pat, text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return None
    # Start after the END of the heading's line, so trailing heading words
    # (e.g. the "+ cues" in "## VO + cues") aren't voiced.
    line_end = text.find("\n", m.start())
    rest = text[line_end + 1:] if line_end != -1 else ""
    nxt = re.search(r"^##\s", rest, re.MULTILINE)
    return rest[: nxt.start()] if nxt else rest


def clean_markers(raw: str, pause_seconds: float, is_v3: bool = False) -> str:
    """
    Strip production markup so only the spoken words remain:
      - [B-ROLL: ...] cue blocks (may span multiple lines) -> removed
      - TIERED pauses -> a break tag (v2) or a pause audio-tag (v3). Kept DELIBERATELY SHORT
        (tuned 2026-07-06, user-directed): human/library voices already breathe at punctuation,
        so an injected pause STACKS on top of a natural one and reads too long. Our pauses
        punctuate; they don't stall. Tiers:
          [BEAT]  -> natural (no tag on v3; the voice's own micro-pause carries the rhythm)
          [PAUSE] (topic shift) -> a SHORT pause
          [PAUSE:LONG] (reveal) -> a normal pause (was a "long pause" — dialled down)
        Most cadence should come from punctuation (…, —, commas) which passes through untouched.
      - Exact expressive markers are translated to v3 audio tags or stripped on v2, so they never
        become spoken words.
      - ### beat headers, > blockquote notes, --- rules -> removed
      - markdown emphasis / inline code / stray heading marks -> unwrapped
    Paragraph breaks (blank lines) are preserved so we can chunk on them.
    """
    # Validate before cleanup can hide a bad marker. All selected pieces are parsed
    # before synthesis starts, so a malformed later piece cannot spend earlier quota.
    validate_expressive_markers(raw)
    t = raw
    # B-ROLL cue blocks: '[B-ROLL' ... first ']'. [^\]] also spans newlines.
    t = re.sub(r"\[B-ROLL[^\]]*\]", "", t)

    def _pause(seconds: float, v3_tag: str) -> str:
        # v3 has no <break> support; use its pause audio-tag instead.
        return f" [{v3_tag}] " if is_v3 else f' <break time="{seconds}s" /> '

    # Order: match [PAUSE:LONG] before [PAUSE] (though the literal ']' already disambiguates).
    # SHORT by design — see the tier note in the docstring. [BEAT] emits nothing on v3.
    t = re.sub(r"\[PAUSE:LONG\]", _pause(0.7, "pause"), t, flags=re.IGNORECASE)
    t = re.sub(r"\[PAUSE\]", _pause(min(pause_seconds, 0.45), "short pause"), t, flags=re.IGNORECASE)
    t = re.sub(r"\[BEAT\]", (" " if is_v3 else ' <break time="0.2s" /> '), t, flags=re.IGNORECASE)

    # Validated expressive tags translate to Eleven v3 audio tags; v2 strips them.
    def _tag(m):
        return EXPRESSIVE_MARKER_TRANSLATIONS[m.group(0)] if is_v3 else ""
    t = _EXPRESSIVE_CANDIDATE_RE.sub(_tag, t)

    out = []
    for line in t.splitlines():
        s = line.strip()
        if not s:
            out.append("")
            continue
        if s.startswith(("#", ">", "---")):
            continue  # beat headers, note blockquotes, horizontal rules
        s = re.sub(r"\*\*(.*?)\*\*", r"\1", s)  # bold
        s = re.sub(r"(?<!\*)\*(?!\*)(.*?)\*", r"\1", s)  # italic
        s = re.sub(r"`([^`]*)`", r"\1", s)  # inline code
        out.append(s)
    # collapse runs of blank lines, join into paragraphs
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _long_form_region(script_text: str) -> str:
    """Return only the long-form region that can become spoken audio."""
    region = _region(script_text, r"^##\s+LONG-?FORM VOICEOVER")
    if region is None:
        # Fallback: drop the leading metadata block (up to first '---'), voice the rest —
        # but stop at any trailing appendix heading (## Sources, production notes) the same
        # way _region does, so bibliography bullets ('- [S1] ...') are never read aloud.
        parts = script_text.split("\n---\n", 1)
        region = parts[1] if len(parts) == 2 else script_text
        nxt = re.search(r"^##\s", region, re.MULTILINE)
        if nxt:
            region = region[: nxt.start()]
    return region


def extract_long_form(script_text: str, pause_seconds: float, is_v3: bool = False) -> str:
    return clean_markers(_long_form_region(script_text), pause_seconds, is_v3)


def _short_region(short_text: str) -> str:
    """Return only the short region that can become spoken audio."""
    region = _region(short_text, r"^##\s+VO")
    if region is None:
        region = short_text
    return region


def extract_short(short_text: str, pause_seconds: float, is_v3: bool = False) -> str:
    return clean_markers(_short_region(short_text), pause_seconds, is_v3)


def short_status(short_text: str) -> str:
    m = re.search(r"\*\*Status:\*\*\s*(\w+)", short_text, re.IGNORECASE)
    return m.group(1).lower() if m else "unknown"


# --------------------------------------------------------------------------- #
# Chunking + duration
# --------------------------------------------------------------------------- #
def chunk_text(text: str, max_chars: int, is_v3: bool = False) -> list[str]:
    """Split on paragraph/sentence boundaries, favouring v3 mood/chapter seams."""
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        if len(p) > max_chars:  # a single huge paragraph: fall back to sentence splits
            for sent in re.split(r"(?<=[.!?])\s+", p):
                if len(cur) + len(sent) + 1 > max_chars and cur:
                    chunks.append(cur.strip())
                    cur = ""
                cur = f"{cur} {sent}".strip()
            continue
        if len(cur) + len(p) + 2 > max_chars and cur:
            if is_v3:
                # v3 cannot carry context across requests. Reset before a real
                # chapter or delivery turn when both chunks remain substantial.
                cur_paras = cur.split("\n\n")
                preferred = [
                    i for i in range(1, len(cur_paras))
                    if _V3_MOOD_OR_CHAPTER_RE.match(cur_paras[i])
                    and len("\n\n".join(cur_paras[:i])) >= _MIN_V3_CHUNK_CHARS
                    and len("\n\n".join(cur_paras[i:])) >= _MIN_V3_CHUNK_CHARS
                ]
                if preferred:
                    seam = preferred[-1]
                    chunks.append("\n\n".join(cur_paras[:seam]).strip())
                    cur = "\n\n".join(cur_paras[seam:]).strip()
                    if len(cur) + len(p) + 2 <= max_chars:
                        cur = f"{cur}\n\n{p}".strip()
                        continue
            chunks.append(cur.strip())
            cur = ""
        cur = f"{cur}\n\n{p}".strip()
    if cur.strip():
        chunks.append(cur.strip())
    return chunks or [""]


def report_chunk_plan(label: str, chunks: list[str]) -> None:
    """Emit zero-spend seam locations for the human ear review."""
    sizes = ", ".join(str(len(chunk)) for chunk in chunks)
    print(f"    {label}: {len(chunks)} planned request chunk(s) ({sizes} chars)")
    for i, chunk in enumerate(chunks[:-1], start=1):
        next_start = chunks[i].replace("\n", " ")[:72]
        print(f"      seam {i}: after {len(chunk)} chars; next starts {next_start!r}; ear-review required")


def bitrate_kbps(output_format: str) -> int:
    m = re.search(r"mp3_\d+_(\d+)", output_format)
    return int(m.group(1)) if m else 128


def est_duration_from_bytes(n_bytes: int, output_format: str) -> float:
    """CBR mp3 estimate: bytes*8 / bitrate. Good enough for render-builder re-time."""
    return round(n_bytes * 8 / (bitrate_kbps(output_format) * 1000), 2)


def est_duration_from_words(text: str) -> float:
    words = len(re.findall(r"\b\w+\b", text))
    return round(words / WPM * 60, 2)


def measure_chunk_duration_s(audio_bytes: bytes) -> float | None:
    """Real decoded contribution (seconds) of one mp3 chunk to the stitched vo file.

    The final mp3 is a naive byte-concat of per-chunk mp3 frame streams, so a chunk's
    true contribution to the decoded timeline is its frame count x samples-per-frame.
    Everything else is wrong for this job (proven on the poyais VO, 5 chunks):
      * alignment ends[-1] misses the encoder's frame padding — summed 464.24s vs the
        file's real 464.46s of frames, with seam drift stepping up to +0.72s;
      * ffprobe's container duration is a bitrate ESTIMATE on these headerless (no
        Xing tag) streams — 464.57s for that same file, ~0.12s over;
      * a standalone full decode trims the ~26ms decoder lead-in once per FILE, so
        per-chunk decodes undercount every chunk after the first. Appended mid-stream
        a chunk always decodes to exactly frames x spf samples (verified: decoding
        vo.mp3 self-concatenated, the second copy contributed its full frame count).
    Frame (packet) counting via ffprobe is exact and additive under byte-concat.

    Returns None if ffprobe is missing or fails — the caller falls back to alignment.
    """
    if not audio_bytes:
        return None
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".mp3")
        try:
            os.write(fd, audio_bytes)
        finally:
            os.close(fd)
        p = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-count_packets",
             "-show_entries", "stream=sample_rate,nb_read_packets", "-of", "json", tmp],
            capture_output=True, timeout=120)
        if p.returncode != 0:
            return None
        st = (json.loads(p.stdout.decode("utf-8", "replace")).get("streams") or [{}])[0]
        sr = int(st.get("sample_rate") or 0)
        packets = int(st.get("nb_read_packets") or 0)
        if sr <= 0 or packets <= 0:
            return None
        spf = 1152 if sr >= 32000 else 576  # MPEG-1 vs MPEG-2/2.5 Layer III samples/frame
        return packets * spf / sr
    except Exception:
        return None
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass


# --------------------------------------------------------------------------- #
# ElevenLabs call
# --------------------------------------------------------------------------- #
def tts_request(text, cfg, api_key, prev_text, next_text, timeout=180):
    # The /with-timestamps variant returns JSON {audio_base64, alignment:{characters,
    # character_start_times_seconds, character_end_times_seconds}} instead of raw mp3,
    # so render-builder can sync each visual shot to the exact narration line. Everything
    # else (voice settings, prosody stitching) is identical.
    url = f"{API_BASE}/{cfg['voice_id']}/with-timestamps?output_format={cfg['output_format']}"
    body = {
        "text": text,
        "model_id": cfg["model_id"],
        "voice_settings": {
            "stability": cfg["stability"],
            "similarity_boost": cfg["similarity_boost"],
            "style": cfg["style"],
            "use_speaker_boost": cfg["use_speaker_boost"],
            "speed": cfg["speed"],
        },
    }
    # previous_text/next_text give cross-chunk prosody continuity, but eleven_v3 does not
    # support them (API 400 unsupported_model). Only send them on models that accept them.
    if "v3" not in cfg["model_id"].lower():
        if prev_text:
            body["previous_text"] = prev_text[-400:]
        if next_text:
            body["next_text"] = next_text[:400]
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "xi-api-key": api_key,
            "accept": "application/json",
            "content-type": "application/json",
        },
        method="POST",
    )
    delay = 2
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(delay)
                delay *= 2
                continue
            if e.code == 401:
                raise SystemExit("ElevenLabs 401 Unauthorized — check ELEVENLABS_API_KEY in .env.")
            raise SystemExit(f"ElevenLabs HTTP {e.code}: {detail}")
        except urllib.error.URLError as e:
            if "CERTIFICATE_VERIFY" in str(e):
                raise SystemExit(
                    "TLS certificate verification failed - this interpreter has no CA bundle.\n"
                    "  Fix (any one): run with the native Python (`py -3 <script>`), "
                    "`pip install certifi`, or set SSL_CERT_FILE to a CA bundle path."
                )
            if attempt < 3:
                time.sleep(delay)
                delay *= 2
                continue
            raise SystemExit(f"Network error calling ElevenLabs: {e}")
    raise SystemExit("ElevenLabs request failed after retries.")


ROUTE_OPERATION = "fyt.elevenlabs.locked-tts"


def _route_urlopen(req, timeout):
    # routeUrl is the local daemon (typically http://); only pay for a TLS context when the URL
    # actually needs one.
    if req.full_url.lower().startswith("https"):
        return urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX)
    return urllib.request.urlopen(req, timeout=timeout)


def tts_request_via_route(route, route_root, text, out_path, timeout=180):
    """Route-mode equivalent of `tts_request()`: POST one call through the daemon's paid-action
    route (Unit D) instead of calling ElevenLabs directly, so the worker never sees
    ELEVENLABS_API_KEY. Per the thin-slice work order this is ONE call, no in-script retry — a
    non-succeeded status is surfaced as a hard error (the call is already spent; a caller that
    wants another attempt re-runs the piece, which draws the grant's NEXT capped ordinal).

    NOTE (flagged, not solved here): the direct path's `/with-timestamps` response carries
    character-level alignment that `stitch_chunks`/`words_from_alignment` turn into per-word
    timings render-builder syncs shots to. The route contract's AUDIO response has no alignment
    equivalent — the daemon returns only the committed mp3. Route-mode pieces therefore carry
    an EMPTY word_timings list; any shot-level VO sync for a route-mode piece has no timing data
    to sync to. This is a real gap, not a bug in this script — flagged for Unit D/the thin-slice
    scope, not silently patched over here."""
    rel_out = os.path.relpath(out_path, route_root).replace(os.sep, "/")
    body = {"operation": ROUTE_OPERATION, "text": text, "expectedArtifactPath": rel_out}
    req = urllib.request.Request(
        route["routeUrl"],
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {route['token']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _route_urlopen(req, timeout) as r:
            resp = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise SystemExit(f"route HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"Network error calling route: {e}")
    status = resp.get("status")
    if status != "succeeded":
        raise SystemExit(
            f"route call did not succeed (status={status!r}, reason={resp.get('reason')!r}) - "
            "this call is already spent; re-run to draw the grant's next capped call if budget remains."
        )
    if not out_path.exists():
        raise SystemExit(f"route reported succeeded but {out_path} was not committed")
    return out_path.read_bytes()


def words_from_alignment(chars, starts, ends):
    """Collapse ElevenLabs character-level alignment into [word, start_s] pairs
    (a word's start = its first character's start). Whitespace + break-tag markup
    separate words; render-builder matches a shot's vo_ref against this stream."""
    words, cur, cur_start = [], "", None
    for ch, st in zip(chars, starts):
        if ch.isspace():
            if cur:
                words.append([cur, cur_start]); cur, cur_start = "", None
        else:
            if not cur:
                cur_start = st
            cur += ch
    if cur:
        words.append([cur, cur_start])
    return words


def stitch_chunks(chunk_results, duration_probe=measure_chunk_duration_s):
    """Concatenate per-chunk audio and place each chunk's words on the stitched timeline.

    chunk_results yields (audio_bytes, alignment_dict_or_None) per chunk. Words land at
    offset + their in-chunk alignment start; the offset then advances by the chunk's
    MEASURED decoded duration (see measure_chunk_duration_s) — NOT the alignment's last
    character end, which misses mp3 frame padding and made timings drift at chunk seams.
    If the probe fails, warn and fall back to ends[-1] so synthesis never hard-fails on
    a probe error (it just drifts like the pre-fix behaviour).

    Returns (audio_bytes, word_timings, total_offset_s). Pure of network — unit-testable.
    """
    audio, words, offset = b"", [], 0.0
    for chunk_audio, al in chunk_results:
        audio += chunk_audio
        al = al or {}
        starts = al.get("character_start_times_seconds") or []
        ends = al.get("character_end_times_seconds") or []
        for w, st in words_from_alignment(al.get("characters") or [], starts, ends):
            words.append([w, round(offset + st, 3)])
        measured = duration_probe(chunk_audio)
        if measured is not None:
            offset += measured
        else:
            if chunk_audio:
                print("  ! chunk duration probe failed (ffprobe?) - falling back to "
                      "alignment end; stitched timings may drift at chunk seams")
            offset += (ends[-1] if ends else 0.0)
    return audio, words, offset


def synthesize(text, cfg, api_key, out_path, args, budget, is_v3=False, route=None, route_root=None):
    """Synthesize one piece; return (audio_written, char_count, est_duration_s,
    chunk_count, word_timings). word_timings is [[word, start_s], ...] on the global
    (stitched) timeline — the ground truth render-builder syncs shots to.
    budget is a mutable [remaining_chars] list for --limit-chars; None = unlimited.

    Route mode (`route` set): ONE daemon-mediated call, no chunking, no in-script retry (thin-slice
    work order) — see `tts_request_via_route` for why word_timings comes back empty in this mode."""
    if budget is not None:
        if budget[0] <= 0:
            return False, 0, 0.0, 0, []
        if len(text) > budget[0]:  # truncate at a word boundary to fit the smoke-test budget
            cut = text[: budget[0]]
            text = cut.rsplit(" ", 1)[0] if " " in cut else cut
        budget[0] -= len(text)

    char_count = len(text)
    if args.dry_run:
        return False, char_count, est_duration_from_words(text), 0, []

    if route:
        audio = tts_request_via_route(route, route_root, text, out_path)
        dur = est_duration_from_bytes(len(audio), cfg["output_format"])
        return True, char_count, dur, 1, []

    chunks = chunk_text(text, args.max_chunk_chars, is_v3=is_v3)

    def chunk_results():
        for i, ch in enumerate(chunks):
            prev = chunks[i - 1] if i > 0 else ""
            nxt = chunks[i + 1] if i + 1 < len(chunks) else ""
            resp = json.loads(tts_request(ch, cfg, api_key, prev, nxt).decode("utf-8", "replace"))
            yield base64.b64decode(resp["audio_base64"]), resp.get("alignment")

    # chunk's real decoded length -> next chunk's offset (measured, not alignment-summed)
    audio, words, offset = stitch_chunks(chunk_results())
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(audio)
    # Exact duration from the stitched offset (measured decode, alignment on probe
    # failure); fall back to the mp3-size estimate if both came up empty.
    dur = round(offset, 2) if offset > 0 else est_duration_from_bytes(len(audio), cfg["output_format"])
    return True, char_count, dur, len(chunks), words


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Generate narration audio for a scripted video folder.")
    ap.add_argument("video_dir")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--all-shorts", action="store_true")
    ap.add_argument("--limit-chars", type=int, default=0)
    ap.add_argument("--max-chunk-chars", type=int, default=2000)
    ap.add_argument("--pause-seconds", type=float, default=0.6)
    ap.add_argument("--env", default="")
    args = ap.parse_args()

    video_dir = Path(args.video_dir).resolve()
    if not video_dir.exists():
        raise SystemExit(f"video_dir not found: {video_dir}")

    repo_root = find_repo_root(video_dir)
    env_path = Path(args.env).resolve() if args.env else repo_root / ".env"
    # Worker-mediated spend routing (Phase 3 Unit E): a `.kb/spend-grant.json` anywhere from
    # video_dir upward means this is a daemon-managed attempt worktree — route ALL spend through
    # the daemon's paid-action route instead of a direct ElevenLabs call, and never read
    # ELEVENLABS_API_KEY. Absent the grant file, behavior is exactly the pre-existing direct path.
    route, route_root = find_route(video_dir)
    if route:
        api_key = ""
    else:
        api_key = load_env(env_path).get("ELEVENLABS_API_KEY", "")
        if not args.dry_run and not api_key:
            raise SystemExit(f"ELEVENLABS_API_KEY not found in {env_path}. Use --dry-run to test parsing offline.")

    # Channel dna.md lives two levels up: channels/<name>/videos/<slug>/ -> channels/<name>/dna.md
    dna_path = video_dir.parent.parent / "dna.md"
    if not dna_path.exists():
        raise SystemExit(f"dna.md not found at {dna_path}")
    cfg = parse_voice_config(dna_path.read_text(encoding="utf-8"))
    if not cfg["voice_id"]:
        raise SystemExit(f"No voice_id in {dna_path} (need a Voiceover-config block or a '**Voice ID (locked):**' line).")

    only = {p.strip() for p in args.only.split(",") if p.strip()}
    assets = video_dir / "assets"
    budget = [args.limit_chars] if args.limit_chars > 0 else None
    is_v3 = "v3" in cfg["model_id"].lower()  # v3 routes pauses to audio-tags, not <break>

    # Build the work list: (piece_name, source_rel, clean_text, out_rel, status)
    work = []
    dry_plans = {}
    want_long = not only or "long-form" in only
    if want_long and (video_dir / "script.md").exists():
        raw = (video_dir / "script.md").read_text(encoding="utf-8")
        raw_voice = _long_form_region(raw)
        txt = clean_markers(raw_voice, args.pause_seconds, is_v3)
        if args.dry_run:
            dry_plans["long-form"] = (
                clean_markers(raw_voice, args.pause_seconds, True),
                clean_markers(raw_voice, args.pause_seconds, False),
                expressive_cleanup_summary(raw_voice),
            )
        work.append(("long-form", "script.md", txt, "assets/vo.mp3", "-"))

    shorts_dir = video_dir / "shorts"
    if shorts_dir.exists():
        for sp in sorted(shorts_dir.glob("short-*.md")):
            name = sp.stem  # short-01
            status = short_status(sp.read_text(encoding="utf-8"))
            selected = name in only or "shorts" in only or (not only)
            if not selected:
                continue
            if not args.all_shorts and status != "publish":
                print(f"  skip {name} (status={status}; use --all-shorts to force)")
                continue
            raw = sp.read_text(encoding="utf-8")
            raw_voice = _short_region(raw)
            txt = clean_markers(raw_voice, args.pause_seconds, is_v3)
            if args.dry_run:
                dry_plans[name] = (
                    clean_markers(raw_voice, args.pause_seconds, True),
                    clean_markers(raw_voice, args.pause_seconds, False),
                    expressive_cleanup_summary(raw_voice),
                )
            work.append((name, f"shorts/{name}.md", txt, f"assets/shorts/{name}.mp3", status))

    if not work:
        raise SystemExit("No pieces to voice (check --only / short statuses).")

    if args.dry_run:
        print("DRY-RUN: no ElevenLabs request will be made.")
        settings = {k: cfg[k] for k in ("model_id", "voice_id", "stability", "similarity_boost", "style", "use_speaker_boost", "speed", "output_format")}
        print("  effective configured settings: " + json.dumps(settings, sort_keys=True))
        print("  v2 fallback retains those configured delivery settings; only expressive markup is stripped.")
        for name, _, _, _, _ in work:
            v3_text, v2_text, cleanup = dry_plans[name]
            print(f"  {name} cleanup: {cleanup}")
            report_chunk_plan("v3", chunk_text(v3_text, args.max_chunk_chars, is_v3=True))
            report_chunk_plan("v2", chunk_text(v2_text, args.max_chunk_chars, is_v3=False))

    pieces_out = []
    for name, source, text, out_rel, status in work:
        # Always drop the readable transcript — cheap, and it's the QA artifact.
        txt_path = (video_dir / out_rel).with_suffix(".txt")
        txt_path.parent.mkdir(parents=True, exist_ok=True)
        txt_path.write_text(text, encoding="utf-8")

        written, chars, dur, chunks, word_timings = synthesize(
            text, cfg, api_key, video_dir / out_rel, args, budget, is_v3=is_v3,
            route=route, route_root=route_root,
        )
        state = "synthesized" if written else ("dry-run" if args.dry_run else "skipped-budget")
        if args.dry_run:
            print(f"  {name}: {chars} chars, ~{dur:.1f}s, planned chunks reported above, "
                  f"0 timed words -> {state}")
        else:
            print(f"  {name}: {chars} chars, ~{dur:.1f}s, {chunks} chunk(s), "
                  f"{len(word_timings)} timed words -> {state}")
        pieces_out.append({
            "piece": name,
            "source": source,
            "audio": out_rel if written else None,
            "transcript": str(txt_path.relative_to(video_dir)).replace("\\", "/"),
            "short_status": status,
            "char_count": chars,
            "est_duration_s": dur,
            "duration_basis": (
                "mp3-byte-estimate-routed" if written and route else
                "elevenlabs-alignment" if written else
                "word-count-estimate"
            ),
            "chunk_count": chunks,
            "word_timings": word_timings,
            "state": state,
        })

    long_piece = next((p for p in pieces_out if p["piece"] == "long-form"), None)
    manifest = {
        "generated_by": "voiceover",
        "video_dir": video_dir.name,
        "channel_dna": str(dna_path.relative_to(repo_root)).replace("\\", "/"),
        "voice_id": cfg["voice_id"],
        "model_id": cfg["model_id"],
        "output_format": cfg["output_format"],
        "voice_settings": {k: cfg[k] for k in ("stability", "similarity_boost", "style", "use_speaker_boost", "speed")},
        "wpm_constant": WPM,
        "long_form_est_runtime_s": long_piece["est_duration_s"] if long_piece else None,
        "total_char_count": sum(p["char_count"] for p in pieces_out),
        "dry_run": args.dry_run,
        "pieces": pieces_out,
    }
    manifest_path = assets / "voiceover.manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"manifest -> {manifest_path.relative_to(repo_root)}")


if __name__ == "__main__":
    main()
