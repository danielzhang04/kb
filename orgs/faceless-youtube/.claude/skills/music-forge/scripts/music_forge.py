#!/usr/bin/env python3
"""music-forge orchestrator. SOURCE-AGNOSTIC: `board` vets + CLAP-ranks every candidate in
audio/incoming/<bucket>/ and emits an AUDITION artifact (the human checkpoint — G2/G6); `pick`
loudness-normalizes the chosen into audio/beds + wires music_pools. Populate incoming/ via
fetch_incompetech (CC-BY) or manual YT-Audio-Library drops. Reuses sfx-forge vet/rank (G4)."""
import argparse
import base64
import html
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sfx-forge" / "scripts"))
import rank as rankmod          # noqa: E402  (reused, G4)
from vet import probe           # noqa: E402
import music_vet                # noqa: E402

ROOT = Path(__file__).resolve().parents[4]
BUCKETS = Path(__file__).parent.parent / "music-buckets.json"
_AUDIO_EXT = (".mp3", ".wav", ".ogg", ".flac")


def collect_files(bucket_cfg, feats_by_path):
    """PURE: vet each candidate whose probe features are present; attach quality + name + id."""
    lo, hi = bucket_cfg["dur_s"]
    out = []
    for path, base in feats_by_path.items():
        v = music_vet.vet_music(base, lo, hi)
        if v["ok"]:
            out.append({"path": str(path), "name": Path(path).stem, "quality": v["quality"], "id": str(path)})
    return out


_CSS = """<style>
:root{--bg:#f4f5f7;--panel:#fffefc;--ink:#1c1e24;--muted:#6b6f77;--line:#e2e3e7;--accent:#3a6ea5;--accent-ink:#274b73;--ok:#2f8f6b;}
@media (prefers-color-scheme:dark){:root{--bg:#15171c;--panel:#1e2128;--ink:#ecebe8;--muted:#9a9ea7;--line:#2c2f38;--accent:#6fa8dc;--accent-ink:#6fa8dc;--ok:#57c79c;}}
:root[data-theme="light"]{--bg:#f4f5f7;--panel:#fffefc;--ink:#1c1e24;--muted:#6b6f77;--line:#e2e3e7;--accent:#3a6ea5;--accent-ink:#274b73;--ok:#2f8f6b;}
:root[data-theme="dark"]{--bg:#15171c;--panel:#1e2128;--ink:#ecebe8;--muted:#9a9ea7;--line:#2c2f38;--accent:#6fa8dc;--accent-ink:#6fa8dc;--ok:#57c79c;}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px 64px;color:var(--ink);font-family:system-ui,Segoe UI,sans-serif;line-height:1.5}
h1{font-size:30px;margin:0}.lead{font-size:15px;color:var(--muted);max-width:64ch;margin:.4rem 0 2.2rem}
.bucket{margin:0 0 2.4rem;border-top:1px solid var(--line);padding-top:1.1rem}
.bucket-h{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap}
.bucket-h b{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent-ink)}
.bucket-h span{font-size:13px;color:var(--muted)}.pill{font-size:11px;border-radius:99px;padding:2px 9px;font-weight:600;margin-left:auto;color:var(--accent-ink);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:.9rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 14px;display:flex;flex-direction:column;gap:9px}
.card.top{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.nm{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);border:1px solid var(--accent);border-radius:99px;padding:1px 7px;align-self:flex-start}
audio{width:100%;height:34px}
.meta{display:flex;gap:12px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
.meta b{color:var(--ink)}.foot{font-size:12px;color:var(--ok);font-weight:600}
</style>"""


def _data_uri(p):
    return "data:audio/mp3;base64," + base64.b64encode(Path(p).read_bytes()).decode()


def _card(c, top=False):
    clap = "—" if c.get("clap") is None else f"{c['clap']:.2f}"
    badge = "<span class='badge'>CLAP top</span>" if top else ""
    return (f"<div class='card {'top' if top else ''}'>{badge}"
            f"<div class='nm' title='{html.escape(c['name'])}'>{html.escape(c['name'])}</div>"
            f"<audio controls preload='none' src='{c['data_uri']}'></audio>"
            f"<div class='meta'><span>clap <b>{clap}</b></span><span>vet <b>{c.get('quality',0):.2f}</b></span>"
            f"<span><b>{c.get('duration',0):.0f}</b>s</span></div>"
            f"<div class='foot'>CC-BY</div></div>")


def build_board(run, buckets_cfg):
    parts = ["<title>Music audition</title>", _CSS, "<div class='wrap'>", "<h1>Music library audition</h1>",
             "<p class='lead'>One section per mood bucket; each says how many to pick. Audition by ear "
             "(these loop under narration). Reply with the track name(s) per bucket.</p>"]
    for bucket, cands in run.items():
        cfg = buckets_cfg.get(bucket, {})
        tag = f"<span class='pill'>pick {cfg.get('pick_n')}</span>" if cfg.get("pick_n") else ""
        parts.append(f"<section class='bucket'><div class='bucket-h'><b>{html.escape(bucket)}</b>"
                     f"<span>{html.escape(cfg.get('mood_use',''))}</span>{tag}</div><div class='grid'>")
        parts += [_card(c, top=(i == 0)) for i, c in enumerate(cands)]
        parts.append("</div></section>")
    parts.append("</div>")
    return "".join(parts)


def run_board(channel, buckets, use_clap):
    cfg_all = json.loads(BUCKETS.read_text(encoding="utf-8"))
    ch = ROOT / "channels" / channel
    incoming = ch / "visual-kit" / "audio" / "incoming"
    out = ch / "visual-kit" / "audio" / "_audition" / "music"; out.mkdir(parents=True, exist_ok=True)
    want = buckets or list(cfg_all["buckets"].keys())
    clap = rankmod.load_clap() if use_clap else None
    print(f"CLAP: {'loaded' if clap else 'OFF (vet-only ranking)'}")
    run = {}
    for bucket in want:
        cfg = cfg_all["buckets"][bucket]
        files = [p for p in sorted((incoming / bucket).glob("*")) if p.suffix.lower() in _AUDIO_EXT]
        feats = {}
        for p in files:
            try:
                feats[p] = probe(p)
            except Exception as e:
                print(f"    ! probe failed {p.name}: {type(e).__name__}")
        cands = collect_files(cfg, feats)
        for c in cands:
            c["duration"] = feats[Path(c["path"])]["duration"]
        if clap and cands:
            scores = rankmod.clap_scores(clap, [c["path"] for c in cands], cfg["clap_prompts"])
            for c, s in zip(cands, scores):
                c["clap"] = s
            ranked = rankmod.rank(cands, scorer=lambda c: c.get("clap"))
        else:
            ranked = rankmod.rank(cands, scorer=lambda c: None)
        top = ranked[: cfg_all["defaults"]["top_n"]]
        for c in top:
            c["data_uri"] = _data_uri(c["path"])
        run[bucket] = top
        print(f"  {bucket}: {len(files)} in incoming -> {len(cands)} vetted -> top {len(top)}")
    (out / "audition.html").write_text(build_board(run, cfg_all["buckets"]), encoding="utf-8")
    slim = {b: [{k: v for k, v in c.items() if k != "data_uri"} for c in cs] for b, cs in run.items()}
    (out / "candidates.json").write_text(json.dumps(slim, indent=2) + "\n", encoding="utf-8")
    print(f"AUDITION -> {out / 'audition.html'}")


def resolve_picks(picks, incoming_index):
    """PURE: map each picked name (a track NAME as shown on the audition board = a stem, OR a filename) to the
    actual incoming filename, tolerating any audio extension. incoming_index = {bucket: {stem: filename}}.
    Returns (resolved, unresolved): resolved = {bucket: [filename...]} for names that matched a real file;
    unresolved = [(bucket, name)] for names with no match (these must NOT reach music_pools)."""
    resolved, unresolved = {}, []
    for bucket, names in picks.items():
        idx = incoming_index.get(bucket, {})
        got = []
        for name in names:
            fname = idx.get(Path(name).stem)   # tolerate a picked name with OR without extension
            if fname:
                got.append(fname)
            else:
                unresolved.append((bucket, name))
        if got:
            resolved[bucket] = got
    return resolved, unresolved


def assemble_pools(picks, sources):
    """PURE: {bucket:[incoming_filename...]} + per-bucket sources meta -> (music_pools, manifest entries,
    CC-BY credit lines). Bed name = <bucket>-<n>. Every Incompetech track is CC-BY -> a credit line."""
    pools, entries, attribs = {}, {}, []
    for bucket, files in picks.items():
        names, smeta = [], sources.get(bucket, {})
        for n, fname in enumerate(files, 1):
            name = f"{bucket}-{n}"; m = smeta.get(fname, {})
            names.append(name)
            lic = (m.get("license") or "CC-BY").upper()
            entries[name] = {"file": f"beds/{name}.mp3", "bucket": bucket, "source_file": fname,
                             "title": m.get("title", Path(fname).stem), "artist": m.get("artist", ""),
                             "license": lic, "url": m.get("url", "")}
            if lic == "CC-BY":
                attribs.append(f"{name}: '{m.get('title', Path(fname).stem)}' by {m.get('artist','')} — "
                               f"{m.get('url','')} — Licensed under Creative Commons: By Attribution 4.0")
        if names:
            pools[bucket] = names
    return pools, entries, attribs


def _loudnorm(src, dst, target_lufs=-20.0):
    """One-pass EBU R128 loudnorm to a consistent integrated LUFS so every bed sits at the same perceived
    level (music is LOUDNESS-matched; the realizer's base_db does the ducking)."""
    subprocess.run(["ffmpeg", "-y", "-i", str(src),
                    "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
                    "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", str(dst)],
                   capture_output=True, text=True)


def pick_music(channel, picks_path):
    ch = ROOT / "channels" / channel
    aud = ch / "visual-kit" / "audio"
    beds = aud / "beds"; beds.mkdir(parents=True, exist_ok=True)
    incoming = aud / "incoming"
    picks = json.loads(Path(picks_path).read_text(encoding="utf-8"))
    # Resolve each picked name (a board track NAME = a stem, OR a filename) to the real incoming file,
    # tolerating any audio extension. Unresolved picks are warned + EXCLUDED (music_pools must never
    # reference a bed that was not created — final-review Finding 1).
    incoming_index = {}
    for bucket in picks:
        idx, d = {}, incoming / bucket
        if d.exists():
            for p in d.iterdir():
                if p.suffix.lower() in _AUDIO_EXT:
                    idx[p.stem] = p.name
        incoming_index[bucket] = idx
    resolved, unresolved = resolve_picks(picks, incoming_index)
    for bucket, name in unresolved:
        print(f"  ! {bucket}: '{name}' has no matching file in incoming/{bucket} — skipped")
    sources = {}
    for bucket in resolved:
        sp = incoming / bucket / "sources.json"
        sources[bucket] = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else {}
    tokens_path = ch / "visual-kit" / "audio-tokens.json"
    tokens = json.loads(tokens_path.read_text(encoding="utf-8"))
    # Loudnorm target: audio-tokens music_norm_lufs is the realizer's source of truth; fall back to the
    # sourcing default in music-buckets.json (final-review Finding 3 — one source, no silent divergence).
    norm_lufs = tokens.get("music_norm_lufs",
                           json.loads(BUCKETS.read_text(encoding="utf-8"))["defaults"].get("norm_lufs", -20.0))
    pools, entries, attribs = assemble_pools(resolved, sources)
    for name, e in entries.items():
        src = incoming / e["bucket"] / e["source_file"]
        if not src.exists():
            print(f"  ! {name}: {src.name} not in incoming/{e['bucket']} — skipped"); continue
        _loudnorm(src, beds / f"{name}.mp3", norm_lufs)
        print(f"  {name} <- {e['source_file']}")
    mp = tokens.setdefault("music_pools", {})
    for bucket, names in pools.items():
        mp[bucket] = names
    tokens_path.write_text(json.dumps(tokens, indent=2) + "\n", encoding="utf-8")
    man_path = aud / "manifest.json"
    man = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {}
    man.setdefault("music", {}).update(entries)
    man_path.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    if attribs:
        att = aud / "attribution.txt"
        try:                                            # existing SFX attribution may be cp1252 (em dashes) —
            prior = att.read_text(encoding="utf-8") if att.exists() else ""
        except UnicodeDecodeError:                      # read it tolerantly, then normalize the whole file to utf-8
            prior = att.read_text(encoding="cp1252")
        att.write_text(prior.rstrip() + "\n\n# Music (CC-BY) — paste into the video description\n"
                       + "\n".join(attribs) + "\n", encoding="utf-8")
    print(f"music_pools now: { {k: v for k, v in mp.items() if not k.startswith('_')} }")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    b = sub.add_parser("board"); b.add_argument("channel"); b.add_argument("--buckets", default="")
    b.add_argument("--no-clap", action="store_true")
    p = sub.add_parser("pick"); p.add_argument("channel"); p.add_argument("--picks", required=True)
    args = ap.parse_args()
    if args.cmd == "board":
        run_board(args.channel, [x for x in args.buckets.split(",") if x], not args.no_clap)
    elif args.cmd == "pick":
        pick_music(args.channel, args.picks)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
