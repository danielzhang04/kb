#!/usr/bin/env python3
"""sfx-forge orchestrator. Sources CC0 candidates per role, vets objectively, ranks with CLAP,
and emits an AUDITION artifact that is the human checkpoint (Claude curates, human picks — T4).
Deterministic; secrets stay in .env (T6). `pick` wires finalists into audio-tokens + manifest."""
import argparse, base64, html, json, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import freesound_client as fc
import vet as vetmod
import rank as rankmod

ROOT = Path(__file__).resolve().parents[4]           # repo root
VOCAB = Path(__file__).parent.parent / "vocabulary.json"


def load_env_key():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("FREESOUND_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("FREESOUND_API_KEY not in .env")


def collect(role_cfg, results, feats_by_id):
    lo, hi = role_cfg["dur_s"]
    out = []
    for r in results:
        if not fc.is_allowed(r):                       # T7 re-verify: CC0 or CC-BY, never NC
            continue
        f = feats_by_id.get(r["id"])
        if not f:
            continue
        v = vetmod.vet_features(f, lo, hi)
        if not v["ok"]:
            continue
        out.append({**r, "quality": v["quality"]})
    return out


_AUDITION_CSS = """<style>
:root{--bg:#f4f5f7;--panel:#fffefc;--ink:#1c1e24;--muted:#6b6f77;--line:#e2e3e7;
--accent:#c9781a;--accent-ink:#7a4708;--cc0:#2f8f6b;}
@media (prefers-color-scheme:dark){:root{--bg:#15171c;--panel:#1e2128;--ink:#ecebe8;
--muted:#9a9ea7;--line:#2c2f38;--accent:#f0a63a;--accent-ink:#f0a63a;--cc0:#57c79c;}}
:root[data-theme="light"]{--bg:#f4f5f7;--panel:#fffefc;--ink:#1c1e24;--muted:#6b6f77;--line:#e2e3e7;--accent:#c9781a;--accent-ink:#7a4708;--cc0:#2f8f6b;}
:root[data-theme="dark"]{--bg:#15171c;--panel:#1e2128;--ink:#ecebe8;--muted:#9a9ea7;--line:#2c2f38;--accent:#f0a63a;--accent-ink:#f0a63a;--cc0:#57c79c;}
*{box-sizing:border-box}body{margin:0}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px 64px;color:var(--ink);
font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5}
.lead{font-size:15px;color:var(--muted);max-width:60ch;margin:.4rem 0 2.2rem}
h1{font-size:30px;letter-spacing:-.01em;margin:0}
.role{margin:0 0 2.4rem;border-top:1px solid var(--line);padding-top:1.1rem}
.role-h{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap}
.role-h b{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent-ink)}
.role-h span{font-size:13px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-top:.9rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 14px;
display:flex;flex-direction:column;gap:9px}
.card.top{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.card.chosen{border-color:var(--cc0);background:color-mix(in srgb,var(--cc0) 8%,var(--panel))}
.sec{font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);
margin:2.4rem 0 .4rem;padding-bottom:.4rem;border-bottom:2px solid var(--line)}
.pill{font-size:11px;letter-spacing:.06em;border-radius:99px;padding:2px 9px;font-weight:600;margin-left:auto}
.pill.pick{color:var(--accent-ink);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.pill.ok{color:var(--cc0);background:color-mix(in srgb,var(--cc0) 16%,transparent)}
.nm{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);
border:1px solid var(--accent);border-radius:99px;padding:1px 7px;align-self:flex-start}
.badge.ok{color:var(--cc0);border-color:var(--cc0)}
audio{width:100%;height:34px}
.meta{display:flex;gap:12px;font-size:12px;color:var(--muted);
font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.meta b{color:var(--ink);font-weight:600}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:12px}
.cc0{color:var(--cc0);font-weight:600}
a{color:var(--accent-ink);text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>"""


def _sfx_card(c, chosen=False, top=False):
    clap = "—" if c.get("clap") is None else f"{c['clap']:.2f}"
    cls = "card chosen" if chosen else ("card top" if top else "card")
    badge = "<span class='badge ok'>✓ chosen</span>" if chosen else ("<span class='badge'>CLAP top</span>" if top else "")
    return (f"<div class='{cls}'>{badge}"
            f"<div class='nm' title='{html.escape(c['name'])}'>{html.escape(c['name'])}</div>"
            f"<audio controls preload='none' src='{c['data_uri']}'></audio>"
            f"<div class='meta'><span>clap <b>{clap}</b></span><span>vet <b>{c.get('quality',0):.2f}</b></span>"
            f"<span><b>{c['duration']:.2f}</b>s</span></div>"
            f"<div class='foot'><span class='cc0'>CC0</span>"
            f"<a href='{c['freesound_url']}' target='_blank' rel='noopener'>#{c['id']} ↗</a></div></div>")


def build_audition_html(run, roles_meta=None) -> str:
    """Two sections: CHOSEN (locked, at top, for reference — don't re-pick) and STILL TO CHOOSE
    (with a 'pick N' target per role). A role is 'chosen' iff roles_meta[role]['chosen'] is set."""
    roles_meta = roles_meta or {}
    chosen = [r for r in run if (roles_meta.get(r) or {}).get("chosen")]
    todo = [r for r in run if not (roles_meta.get(r) or {}).get("chosen")]
    parts = ["<title>SFX audition</title>", _AUDITION_CSS, "<div class='wrap'>", "<h1>SFX library audition</h1>",
             "<p class='lead'>The <b>chosen</b> set is locked at the top for reference — no need to re-pick. "
             "Audition only the <b>still to choose</b> section below; each says how many to pick. Reply with "
             "the Freesound id(s) per role.</p>"]

    def role_block(role, cands, is_chosen):
        m = roles_meta.get(role) or {}
        use = html.escape(m.get("scene_use", ""))
        if is_chosen:
            tag = "<span class='pill ok'>locked</span>"
        else:
            n = m.get("pick_n")
            tag = f"<span class='pill pick'>pick {n}</span>" if n else ""
        out = [f"<section class='role'><div class='role-h'><b>{html.escape(role)}</b>"
               f"<span>{use}</span>{tag}</div><div class='grid'>"]
        for i, c in enumerate(cands):
            out.append(_sfx_card(c, chosen=is_chosen, top=(not is_chosen and i == 0)))
        out.append("</div></section>")
        return "".join(out)

    if chosen:
        parts.append("<h2 class='sec'>✓ Chosen — locked (reference only)</h2>")
        parts += [role_block(r, run[r], True) for r in chosen]
    if todo:
        parts.append("<h2 class='sec'>Still to choose</h2>")
        parts += [role_block(r, run[r], False) for r in todo]
    parts.append("</div>")
    return "".join(parts)


def _data_uri(mp3_path):
    return "data:audio/mp3;base64," + base64.b64encode(Path(mp3_path).read_bytes()).decode()


def run_forge(channel, roles, run_id, use_clap):
    key = load_env_key()
    vocab = json.loads(VOCAB.read_text(encoding="utf-8"))
    d = vocab["defaults"]
    ch = ROOT / "channels" / channel
    audition = ch / "visual-kit" / "audio" / "_audition" / run_id
    cache = audition / "cache"; audition.mkdir(parents=True, exist_ok=True)
    want = roles or list(vocab["roles"].keys())
    clap = rankmod.load_clap() if use_clap else None
    print(f"CLAP: {'loaded' if clap else 'OFF (vet-only ranking)'}")
    run = {}
    for role in want:
        cfg = vocab["roles"][role]
        seen, results = set(), []
        for q in cfg["queries"]:
            for r in fc.search(q, key, page_size=d["page_size"]):
                if r["id"] not in seen and cfg["dur_s"][0] <= r["duration"] <= cfg["dur_s"][1]:
                    seen.add(r["id"]); results.append(r)
        results = results[: d["max_download"]]
        feats = {}
        for r in results:
            p = fc.download_preview(r, cache)
            if p is None:            # transient network failure after retries -> skip this candidate
                continue
            feats[r["id"]] = vetmod.probe(p)
        cands = collect(cfg, results, feats)
        if clap and cands:
            paths = [cache / f"{c['id']}.mp3" for c in cands]
            scores = rankmod.clap_scores(clap, paths, cfg["clap_prompts"])
            smap = {c["id"]: s for c, s in zip(cands, scores)}
            ranked = rankmod.rank(cands, scorer=lambda c: smap.get(c["id"]))
        else:
            ranked = rankmod.rank(cands, scorer=lambda c: None)
        top = ranked[: d["top_n"]]
        for c in top:
            c["data_uri"] = _data_uri(cache / f"{c['id']}.mp3")
            c["freesound_url"] = f"https://freesound.org/s/{c['id']}/"
        run[role] = top
        print(f"  {role}: {len(results)} found -> {len(cands)} vetted -> top {len(top)}")
    roles_meta = {role: {"scene_use": vocab["roles"][role].get("scene_use", "")} for role in run}
    (audition / "audition.html").write_text(build_audition_html(run, roles_meta), encoding="utf-8")
    slim = {role: [{k: v for k, v in c.items() if k != "data_uri"} for c in cs] for role, cs in run.items()}
    (audition / "candidates.json").write_text(json.dumps(slim, indent=2), encoding="utf-8")
    print(f"AUDITION -> {audition / 'audition.html'}")


def build_combined_board(channel, run_id="combined", cap=8):
    """Merge every candidate across all prior audition runs (dedupe by id, keep highest-clap instance)
    into ONE board — all roles, descriptions shown. Reusable: run after any set of `run` passes."""
    ch = ROOT / "channels" / channel
    aud_root = ch / "visual-kit" / "audio" / "_audition"
    vocab = json.loads(VOCAB.read_text(encoding="utf-8"))
    merged = {}                                   # role -> {id: candidate}
    for cj in aud_root.glob("*/candidates.json"):
        if cj.parent.name == run_id:
            continue
        for role, cands in json.loads(cj.read_text(encoding="utf-8")).items():
            m = merged.setdefault(role, {})
            for c in cands:
                if c["id"] not in m or (c.get("clap") or -1) > (m[c["id"]].get("clap") or -1):
                    m[c["id"]] = c
    cache = {}
    for mp3 in aud_root.glob("*/cache/*.mp3"):
        cache.setdefault(int(mp3.stem), mp3)
    chosen_path = aud_root / "chosen.json"
    chosen = json.loads(chosen_path.read_text(encoding="utf-8")) if chosen_path.exists() else {}
    out = aud_root / run_id; out.mkdir(parents=True, exist_ok=True)

    def playable(c):
        f = cache.get(c["id"])
        if not f:
            return None
        c = dict(c); c["data_uri"] = _data_uri(f)
        c["freesound_url"] = c.get("freesound_url") or f"https://freesound.org/s/{c['id']}/"
        return c

    run = {}
    for role in vocab["roles"]:
        if vocab["roles"][role].get("dropped"):         # role set aside for now — omit from the board
            continue
        if role in chosen:                              # locked: show only the picked clips
            clips = []
            for sid in chosen[role]:
                c = merged.get(role, {}).get(sid) or {"id": sid, "name": f"#{sid}", "duration": 0.0,
                                                       "license": "CC0", "clap": None, "quality": 0}
                pc = playable(c)
                if pc:
                    clips.append(pc)
            run[role] = clips
        else:                                            # unresolved: top candidates to pick from
            cands = sorted(merged.get(role, {}).values(), key=lambda c: -(c.get("clap") or -1))[:cap]
            run[role] = [pc for pc in (playable(c) for c in cands) if pc]
    roles_meta = {role: {"scene_use": vocab["roles"][role].get("scene_use", ""),
                         "pick_n": vocab["roles"][role].get("pick_n"),
                         "chosen": role in chosen} for role in run}
    (out / "audition.html").write_text(build_audition_html(run, roles_meta), encoding="utf-8")
    slim = {role: [{k: v for k, v in c.items() if k != "data_uri"} for c in cs] for role, cs in run.items()}
    (out / "candidates.json").write_text(json.dumps(slim, indent=2) + "\n", encoding="utf-8")
    print(f"COMBINED -> {out / 'audition.html'}  ({sum(len(v) for v in run.values())} clips, {len(run)} roles)")


def _norm_peak(src, dst, target_db=-1.0):
    """Peak-normalize src to target_db, write 48 kHz stereo mp3. Loudness is levelled HERE so a pick's
    raw loudness never matters (T8); the only mix lever downstream is audio-tokens `sfx_gain_db`."""
    peak = float(vetmod.probe(src)["peak_db"])
    gain = target_db - peak
    subprocess.run(["ffmpeg", "-y", "-i", str(src), "-af", f"volume={gain:.2f}dB",
                    "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", str(dst)],
                   capture_output=True, text=True)


def pick_sfx(channel, picks_path):
    """Wire chosen finalists into the channel: normalize each into visual-kit/audio/sfx/<role>-<n>.mp3,
    REPLACE that role's pool in audio-tokens.json, and record CC0 provenance in audio/manifest.json.
    `picks_path` -> JSON {role: [freesound_id, ...]} (multiple ids = pool variants for anti-repeat)."""
    ch = ROOT / "channels" / channel
    aud_root = ch / "visual-kit" / "audio"
    sfx_dir = aud_root / "sfx"; sfx_dir.mkdir(parents=True, exist_ok=True)
    picks = json.loads(Path(picks_path).read_text(encoding="utf-8"))
    meta, cache = {}, {}
    for cj in (aud_root / "_audition").glob("*/candidates.json"):
        for role, cands in json.loads(cj.read_text(encoding="utf-8")).items():
            for c in cands:
                meta[int(c["id"])] = c
    for mp3 in (aud_root / "_audition").glob("*/cache/*.mp3"):
        cache[int(mp3.stem)] = mp3
    tokens_path = ch / "visual-kit" / "audio-tokens.json"
    tokens = json.loads(tokens_path.read_text(encoding="utf-8"))
    man_path = aud_root / "manifest.json"
    man = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {"sfx": {}}
    man.setdefault("sfx", {})
    pools = tokens.setdefault("sfx_pools", {})
    for role, ids in picks.items():
        variants = []
        for n, sid in enumerate(ids, 1):
            sid = int(sid); src = cache.get(sid)
            if not src:
                print(f"  ! {role} #{sid}: no cached preview — skipped"); continue
            name = f"{role}-{n}"
            _norm_peak(src, sfx_dir / f"{name}.mp3")
            variants.append(name)
            m = meta.get(sid, {})
            man["sfx"][name] = {"file": f"sfx/{name}.mp3", "role": role, "source": f"freesound #{sid}",
                                "license": "CC0", "url": m.get("freesound_url", f"https://freesound.org/s/{sid}/"),
                                "uploader": m.get("username", ""), "orig_name": m.get("name", "")}
            print(f"  {name} <- freesound #{sid}  {m.get('name','')[:40]}")
        if variants:
            pools[role] = variants
    tokens_path.write_text(json.dumps(tokens, indent=2) + "\n", encoding="utf-8")
    man_path.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    print(f"pools now: { {k: v for k, v in pools.items() if not k.startswith('_')} }")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    r = sub.add_parser("run"); r.add_argument("channel"); r.add_argument("--roles", default="")
    r.add_argument("--run-id", default="latest"); r.add_argument("--no-clap", action="store_true")
    p = sub.add_parser("pick"); p.add_argument("channel"); p.add_argument("--picks", required=True)
    b = sub.add_parser("board"); b.add_argument("channel"); b.add_argument("--run-id", default="combined")
    b.add_argument("--cap", type=int, default=8)
    args = ap.parse_args()
    if args.cmd == "run":
        run_forge(args.channel, [x for x in args.roles.split(",") if x], args.run_id, not args.no_clap)
    elif args.cmd == "pick":
        pick_sfx(args.channel, args.picks)
    elif args.cmd == "board":
        build_combined_board(args.channel, args.run_id, args.cap)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
