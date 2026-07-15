#!/usr/bin/env python3
"""Per-video audio-analysis runner: cached demucs stems + transcript -> a tagged measurement report.

DETERMINISTIC (G1/G5): runs ffmpeg/librosa tools and structures the numbers; it never "listens/guesses".
Reliable vs directional is STRUCTURAL (G6): the `reliable` block holds load-bearing measures (loudness,
speech gaps, music presence/dips/ducking, breath-by-acoustic-bucket); the `directional` block holds the
noisy ones (onset density, narrative beats, beat-alignment, optional CLAP SFX-tags) — never a dial input.

  py -3 analyze_audio.py <video_id>            # one video -> audio-logs/<id>/report.{json,md}
  py -3 analyze_audio.py <video_id> --clap     # + optional directional CLAP SFX-tag distribution (slow)

Reads: <stems_dir>/<id>/{mix,vocal,residual}.mp3 (from fetch_stems.py) + the transcript (reused vtt from
videos.json, else fetched via yt-dlp captions). Writes under <reports_dir>/<id>/.
"""
import json
import re
import subprocess
import sys
from pathlib import Path
from statistics import median

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
sys.path.insert(0, str(SCRIPT_DIR))
import measures
import io_tools

HOP_S = 0.1
TS = re.compile(r"(\d\d):(\d\d):(\d\d)\.(\d\d\d)\s*-->\s*(\d\d):(\d\d):(\d\d)\.(\d\d\d)")
# live role vocabulary (audio-tokens sfx_pools) -> a CLAP text prompt (directional tagging only)
ROLE_PROMPTS = {
    "whoosh": "a whoosh transition sound", "boom": "a deep boom impact",
    "riser": "a rising tension riser", "boing": "a cartoon boing",
    "record_scratch": "a record scratch", "cash": "a cash register cha-ching",
    "sting": "a dramatic orchestral sting", "womp": "a sad womp womp trombone",
    "pop": "a short pop", "stamp": "a stamp thud", "buzzer": "a wrong-answer buzzer",
    "sparkle": "a magic sparkle chime", "thud": "a dull thud", "tick": "a clock tick",
    "ding": "a bright ding bell", "powerdown": "a power-down descending tone",
}


def _cfg():
    return json.loads((SCRIPT_DIR / "videos.json").read_text(encoding="utf-8"))


def _entry(cfg, vid):
    for v in cfg["videos"]:
        if v["id"] == vid:
            return v
    raise SystemExit(f"{vid} not in videos.json")


def _pctl(xs, p):
    if not xs:
        return None
    s = sorted(xs)
    i = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return round(s[i], 3)


def parse_vtt(path):
    """WEBVTT -> [{start, end, text}] (pure). Rollup-caption duplicate cue-lines are de-duped by start."""
    segs = []
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    for i, line in enumerate(lines):
        m = TS.search(line)
        if not m:
            continue
        a = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000.0
        b = int(m[5]) * 3600 + int(m[6]) * 60 + int(m[7]) + int(m[8]) / 1000.0
        text = " ".join(l.strip() for l in lines[i + 1:i + 4] if l.strip() and not TS.search(l))
        text = re.sub(r"<[^>]+>", "", text)
        if segs and abs(a - segs[-1]["start"]) < 0.05:
            continue
        segs.append({"start": round(a, 3), "end": round(b, 3), "text": text})
    return segs


def get_transcript(entry, stem_dir):
    """Reused vtt (videos.json transcript_path) if present, else fetch captions once via yt-dlp."""
    tp = entry.get("transcript_path")
    if tp and (REPO_ROOT / tp).exists():
        return parse_vtt(REPO_ROOT / tp), tp
    cap = stem_dir / "captions.en.vtt"
    if not cap.exists():
        url = entry.get("url") or f"https://www.youtube.com/watch?v={entry['id']}"
        subprocess.run(["yt-dlp", "--skip-download", "--write-sub", "--write-auto-sub",
                        "--sub-lang", "en", "--sub-format", "vtt", "--convert-subs", "vtt",
                        "-o", str(stem_dir / "captions.%(ext)s"), url], check=False)
    return (parse_vtt(cap) if cap.exists() else []), (str(cap) if cap.exists() else None)


def clap_sfx_distribution(residual_path, events, cap=120):
    """DIRECTIONAL, opt-in: CLAP-tag the loudest N onset slices against the role vocabulary -> a rough
    role distribution ('lots of whoosh-like / pop-like'). Reuses the sfx-forge CLAP stack. Never a dial."""
    try:
        sys.path.insert(0, str(REPO_ROOT / ".claude" / "skills" / "sfx-forge" / "scripts"))
        import rank, librosa, numpy as np, torch
    except Exception as e:
        return {"error": f"clap unavailable: {e}"}
    mp = rank.load_clap()
    if mp is None:
        return {"error": "clap model not loadable"}
    model, proc = mp
    y, sr = librosa.load(str(residual_path), sr=48000, mono=True)
    top = sorted(events, key=lambda e: -e["loud_db"])[:cap]
    roles = list(ROLE_PROMPTS)
    prompts = [ROLE_PROMPTS[r] for r in roles]
    ti = proc(text=prompts, return_tensors="pt", padding=True)
    slices = []
    for e in top:
        s = int(e["at_s"] * sr); w = int(0.5 * sr)
        seg = y[max(0, s - int(0.05 * sr)): s + w]
        if len(seg) < int(0.1 * sr):
            seg = np.pad(seg, (0, int(0.1 * sr) - len(seg)))
        slices.append(seg)
    if not slices:
        return {"n": 0, "roles": {}}
    ai = proc(audio=slices, sampling_rate=48000, return_tensors="pt")
    with torch.no_grad():
        out = model(input_ids=ti["input_ids"], attention_mask=ti["attention_mask"],
                    input_features=ai["input_features"])
        temb = out.text_embeds / out.text_embeds.norm(dim=-1, keepdim=True)
        aemb = out.audio_embeds / out.audio_embeds.norm(dim=-1, keepdim=True)
        best = (aemb @ temb.T).argmax(dim=1).tolist()
    dist = {}
    for bi in best:
        dist[roles[bi]] = dist.get(roles[bi], 0) + 1
    return {"n": len(slices), "roles": dict(sorted(dist.items(), key=lambda kv: -kv[1]))}


def analyze(vid, cfg, do_clap=False):
    entry = _entry(cfg, vid)
    stem_dir = REPO_ROOT / cfg["stems_dir"] / vid
    mix, vocal, residual = stem_dir / "mix.mp3", stem_dir / "vocal.mp3", stem_dir / "residual.mp3"
    for p in (mix, vocal, residual):
        if not p.exists():
            raise SystemExit(f"missing stem {p} — run fetch_stems.py {vid} first")

    # --- reliable: loudness, speech, music ---
    loud = io_tools.ebur128(mix)
    v_rms, hop = io_tools.stem_rms(vocal, hop_s=HOP_S)
    r_rms, _ = io_tools.stem_rms(residual, hop_s=HOP_S)
    regions = measures.speech_regions(v_rms, hop_s=hop)
    gaps = measures.speech_gaps(regions)
    speaking_s = round(sum(e - s for s, e in regions), 2)

    transcript, tsrc = get_transcript(entry, stem_dir)
    words = sum(len(s["text"].split()) for s in transcript)
    wpm = round(words / (speaking_s / 60.0), 1) if speaking_s else None

    presence = measures.music_presence(r_rms)
    dips = measures.music_dips(r_rms, hop_s=hop)
    ducking = measures.ducking_depth(r_rms, regions, hop_s=hop)

    # --- reliable-ish: breath around events, bucketed by acoustics ---
    events, dur = io_tools.onset_events(residual)
    ev_gaps = measures.breath_around_events(events, regions)
    buckets = measures.bucket_by_acoustics(ev_gaps)

    # --- directional: onset density, narrative beats, dip-on-beat alignment ---
    import beat_map
    beats = beat_map.narrative_beats(transcript) if transcript else []
    density = round(measures.onset_density([e["at_s"] for e in events], dur), 2)
    # Emphasis = PUNCHLINES only. The "act" label (>=2s caption gap) misfires on gappy auto-caption
    # tracks (hundreds of false acts), so it is reported but NOT used for dip-alignment.
    emph = [b["at_s"] for b in beats if b["kind"] == "punchline"]
    dip_mids = [round((d[0] + d[1]) / 2, 3) for d in dips]
    dips_on_beat = sum(1 for m in dip_mids if any(abs(m - e) <= 1.5 for e in emph))
    beats_with_dip = sum(1 for e in emph if any(abs(m - e) <= 1.5 for m in dip_mids))

    report = {
        "id": vid, "slug": entry["slug"], "channel": entry["channel"],
        "dur_s": entry.get("dur_s"), "measured_dur_s": round(dur, 1),
        "transcript_source": tsrc, "transcript_segments": len(transcript),
        "confidence_contract": "reliable = load-bearing (sets dials); directional = low-confidence, "
                               "never a dial (SFX+music tangled in the residual; beats are inferred).",
        "reliable": {
            "loudness": loud,
            "speech": {"n_regions": len(regions), "speaking_s": speaking_s, "wpm": wpm, "words": words,
                       "gaps": {"n": len(gaps), "median": _pctl(gaps, 50),
                                "p25": _pctl(gaps, 25), "p75": _pctl(gaps, 75)}},
            "music": {"presence_pct": round(presence * 100, 1),
                      "dips": {"n": len(dips),
                               "median_depth_db": round(median([d[2] for d in dips]), 2) if dips else None,
                               "median_dur_s": round(median([d[1] - d[0] for d in dips]), 2) if dips else None},
                      "ducking_depth_db": round(ducking, 2)},
            "breath_by_acoustic_bucket": buckets,
        },
        "directional": {
            "_note": "SFX and music hits are not separable in the demucs residual; onset-derived numbers "
                     "are a proxy BAND. Beats are transcript-inferred + caption-quality-dependent: the 'act' "
                     "count (>=2s caption gap) is noisy on auto-caption tracks and is NOT used; dip-alignment "
                     "uses PUNCHLINES only. Never a dial.",
            "onset_density_per_min": density, "onsets_n": len(events),
            "beats": {"n": len(beats),
                      "kinds": {k: sum(1 for b in beats if b["kind"] == k) for k in ("act", "punchline", "plain")}},
            "dip_on_punchline": {"dips_total": len(dips), "punchlines": len(emph),
                                 "dips_on_a_punchline": dips_on_beat, "punchlines_with_a_dip": beats_with_dip},
            "clap_sfx_dist": clap_sfx_distribution(residual, events) if do_clap else None,
        },
    }
    return report


def to_md(r):
    R, D = r["reliable"], r["directional"]
    L = [f"# Audio report — {r['slug']} ({r['channel']}) · {r['id']}",
         f"_{r['measured_dur_s']}s measured · transcript: {r['transcript_segments']} segs_",
         "", "## RELIABLE (load-bearing — sets dials)",
         f"- **Loudness:** {R['loudness']['lufs']} LUFS · LRA {R['loudness']['lra']} · TP {R['loudness']['true_peak']} dBFS",
         f"- **Speech:** {R['speech']['wpm']} wpm · {R['speech']['n_regions']} regions · "
         f"gap median {R['speech']['gaps']['median']}s (p25 {R['speech']['gaps']['p25']} / p75 {R['speech']['gaps']['p75']})",
         f"- **Music:** presence {R['music']['presence_pct']}% · dips {R['music']['dips']['n']} "
         f"(median depth {R['music']['dips']['median_depth_db']} dB) · ducking {R['music']['ducking_depth_db']} dB",
         "- **Breath by acoustic bucket** (does the event get its own VO silence?):"]
    for b, v in R["breath_by_acoustic_bucket"].items():
        L.append(f"    - {b}: n={v['n']} · {v['pause_rate']:.0%} land in a silence "
                 f"(median {v['median_pause_when_paused']}s when they do)")
    dp = D["dip_on_punchline"]
    L += ["", "## DIRECTIONAL (low-confidence — never a dial)",
          f"- **Onset density:** {D['onset_density_per_min']}/min ({D['onsets_n']} onsets) — SFX+music mixed",
          f"- **Narrative beats:** {D['beats']['n']} ({D['beats']['kinds']}) — 'act' is caption-noisy, unused",
          f"- **Dip↔punchline:** {dp['dips_on_a_punchline']}/{dp['dips_total']} dips on a punchline · "
          f"{dp['punchlines_with_a_dip']}/{dp['punchlines']} punchlines have a dip"]
    if D.get("clap_sfx_dist"):
        L.append(f"- **CLAP SFX-tag (directional):** {D['clap_sfx_dist']}")
    return "\n".join(L) + "\n"


def _band(xs):
    """median + [min,max] over a numeric list (Nones dropped). None if empty."""
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {"median": round(median(xs), 2), "min": round(min(xs), 2), "max": round(max(xs), 2), "n": len(xs)}


def synthesize(cfg):
    """Aggregate every report.json -> cross-video bands (reliable/directional kept separate; Kurzgesagt
    excluded from TARGET bands as the restrained floor; ducking dropped where VO is near-continuous so the
    gap sample is too thin to trust). Deterministic. Writes synthesis.md + synthesis.json — the SYNTHESIS
    GATE artifact. It structures the numbers; the human maps them to final dials."""
    rdir = REPO_ROOT / cfg["reports_dir"]
    reps = [json.loads((rdir / v["id"] / "report.json").read_text(encoding="utf-8"))
            for v in cfg["videos"] if (rdir / v["id"] / "report.json").exists()]
    rows, tgt = [], []                                  # tgt = target set (excl. the kurzgesagt floor)
    for r in reps:
        R, D = r["reliable"], r["directional"]
        gap_frac = round(1 - R["speech"]["speaking_s"] / max(1e-6, r["measured_dur_s"]), 3)
        sl = R["breath_by_acoustic_bucket"].get("sustained_loud", {})
        sp = R["breath_by_acoustic_bucket"].get("short_percussive", {})
        dp = D["dip_on_punchline"]
        row = {"slug": r["slug"], "channel": r["channel"], "floor": r["channel"] == "kurzgesagt",
               "lufs": R["loudness"]["lufs"], "lra": R["loudness"]["lra"], "tp": R["loudness"]["true_peak"],
               "wpm": R["speech"]["wpm"], "gap_med": R["speech"]["gaps"]["median"],
               "presence": R["music"]["presence_pct"], "dip_depth": R["music"]["dips"]["median_depth_db"],
               "ducking": R["music"]["ducking_depth_db"], "gap_frac": gap_frac,
               "duck_trust": gap_frac >= 0.12,
               "sl_rate": sl.get("pause_rate"), "sl_pause": sl.get("median_pause_when_paused"),
               "sp_rate": sp.get("pause_rate"), "sp_pause": sp.get("median_pause_when_paused"),
               "onset_min": D["onset_density_per_min"],
               "dip_punch_pct": round(100 * dp["punchlines_with_a_dip"] / max(1, dp["punchlines"]), 1)}
        rows.append(row)
        if not row["floor"]:
            tgt.append(row)
    def col(rs, k):
        return [r[k] for r in rs]
    bands = {
        "loudness_lufs": _band(col(tgt, "lufs")), "lra": _band(col(tgt, "lra")),
        "true_peak": _band(col(tgt, "tp")), "wpm": _band(col(tgt, "wpm")),
        "speech_gap_med_s": _band(col(tgt, "gap_med")), "music_presence_pct": _band(col(tgt, "presence")),
        "dip_depth_db": _band(col(tgt, "dip_depth")),
        "ducking_db_trusted": _band([r["ducking"] for r in tgt if r["duck_trust"]]),
        "breath_sustained_pause_s": _band(col(tgt, "sl_pause")),
        "breath_sustained_rate": _band(col(tgt, "sl_rate")),
        "breath_percussive_pause_s": _band(col(tgt, "sp_pause")),
        "onset_density_min_DIRECTIONAL": _band(col(tgt, "onset_min")),
        "dip_on_punchline_pct_DIRECTIONAL": _band(col(tgt, "dip_punch_pct")),
    }
    out = {"n_videos": len(reps), "target_set_excludes_floor": "kurzgesagt", "rows": rows, "bands": bands}
    (rdir / "synthesis.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    (rdir / "synthesis.md").write_text(_synth_md(rows, bands), encoding="utf-8")
    print(_synth_md(rows, bands))
    print(f"[written] {rdir/'synthesis.md'}")


def _synth_md(rows, bands):
    L = ["# Measured audio grammar — 8 reference videos (SYNTHESIS GATE)", "",
         "Reliable = load-bearing (sets dials). Directional = low-confidence, never a dial.",
         "Target bands EXCLUDE Kurzgesagt (the restrained wall-to-wall-bed floor). Ducking is dropped for",
         "near-continuous-VO videos (gap_frac < 0.12) where the gap sample is too thin to trust.", "",
         "## Per-video", "",
         "| video | ch | LUFS | LRA | TP | wpm | gap | music% | dip dB | duck dB (trust) | sustain pause | dip·punch% |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        fl = "·floor" if r["floor"] else ""
        L.append(f"| {r['slug']} | {r['channel']}{fl} | {r['lufs']} | {r['lra']} | {r['tp']} | {r['wpm']} | "
                 f"{r['gap_med']} | {r['presence']} | {r['dip_depth']} | {r['ducking']} "
                 f"({'Y' if r['duck_trust'] else 'n/gap='+str(r['gap_frac'])}) | "
                 f"{r['sl_rate']}@{r['sl_pause']}s | {r['dip_punch_pct']} |")
    L += ["", "## Cross-video bands (target set, floor excluded)", ""]
    for k, b in bands.items():
        if b:
            L.append(f"- **{k}**: median **{b['median']}** (range {b['min']}–{b['max']}, n={b['n']})")
    return "\n".join(L) + "\n"


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8")   # md carries unicode; the Windows console is cp1252
    except Exception:
        pass
    cfg = _cfg()
    if "--synthesize" in argv:
        synthesize(cfg)
        return
    do_clap = "--clap" in argv
    ids = [a for a in argv if not a.startswith("--")]
    if not ids:
        raise SystemExit(__doc__)
    vid = ids[0]
    r = analyze(vid, cfg, do_clap=do_clap)
    out_dir = REPO_ROOT / cfg["reports_dir"] / vid
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
    (out_dir / "report.md").write_text(to_md(r), encoding="utf-8")
    print(to_md(r))
    print(f"[written] {out_dir/'report.json'}")


if __name__ == "__main__":
    main(sys.argv[1:])
