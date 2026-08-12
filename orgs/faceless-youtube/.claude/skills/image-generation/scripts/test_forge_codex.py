#!/usr/bin/env python3
"""Unit tests for forge_codex.py + the fake codex binary fixture.
Plain asserts, no pytest (house style). Run: py -3 test_forge_codex.py
NO NETWORK, NO API SPEND: every codex invocation in this file is _fake_codex.py."""
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

HERE = Path(__file__).resolve().parent
FAKE = HERE / "_fake_codex.py"
REPO_ROOT = HERE.parents[5]
P4_PROBE3_TURN1_RAW = REPO_ROOT / "scratch-codex-image-engine" / "p4-probe3-turn1-raw.jsonl"

ENVELOPE_FMT = (
    "Read the file at {prompt_path} and pass its exact byte content as the `prompt` argument to "
    "`image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text -- read "
    "and pass through only. Call the tool exactly once, with referenced_image_paths = [{seeds}]. "
    "Do not read any file outside this directory. Report only the saved image path."
)

REAL_VARIABLE_JS = (
    'const reader = await tools.mcp__node_repl__js({code: "var p = await fsA.readFile(\'x.txt\');"});'
    '\nconst prompt = reader.content.find(x => x.type === "text").text;\n'
    'const result = await tools.image_gen__imagegen({prompt, referenced_image_paths: ["C:\\\\a.png"]});'
)


def fake_prefix(mode, image_root, sessions_root):
    return [sys.executable, str(FAKE), "--mode", mode,
            "--image-root", str(image_root), "--sessions-root", str(sessions_root)]


def run_fake(mode, *, envelope, image_root, sessions_root, sandbox="workspace-write", cwd=None,
             resume_thread=None):
    tail = ["exec"]
    if resume_thread:
        # P4 probe 3: `exec resume` restores the session's cwd/sandbox and rejects both flags.
        tail += ["resume", resume_thread, "--json", "--skip-git-repo-check", envelope]
    else:
        tail += ["--json", "--skip-git-repo-check", "--sandbox", sandbox,
                 "--cd", str(cwd or image_root), envelope]
    return subprocess.run(fake_prefix(mode, image_root, sessions_root) + tail,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")


def _events(stdout):
    out = []
    for line in stdout.splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def _scratch():
    tmp = Path(tempfile.mkdtemp(prefix="fkcodex-"))
    (tmp / "generated_images").mkdir()
    (tmp / "sessions").mkdir()
    prompt = tmp / "L29.txt"
    prompt.write_text("Use case: illustration-story\nAvoid: photorealism\n", encoding="utf-8", newline="\n")
    seed = tmp / "seed.png"
    seed.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 2048)
    return tmp, prompt, seed


def _darkest_three_percent_rgb(path):
    """Canonical darkest-3%-BY-LUMA metric, mirroring scratch-codex-image-engine/measure.py:15-20
    (luma = 0.299R + 0.587G + 0.114B; n = max(1, int(len * 0.03)))."""
    from PIL import Image

    pixels = list(Image.open(path).convert("RGB").getdata())
    count = max(1, int(len(pixels) * 0.03))
    darkest = sorted(pixels, key=lambda rgb: 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])[:count]
    return tuple(sum(rgb[channel] for rgb in darkest) / count for channel in range(3))


def _p4_pre_image_call_count(rollout_path):
    """Exact substring-matching algorithm from scratch-codex-image-engine/p4_probe.py."""
    n = 0
    for line in rollout_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if '"custom_tool_call"' not in line:
            continue
        if "image_gen__imagegen" in line:
            return n
        n += 1
    return n


def _real_usage_keys():
    events = _events(P4_PROBE3_TURN1_RAW.read_text(encoding="utf-8", errors="replace"))
    return set(next(event["usage"] for event in reversed(events)
                    if event.get("type") == "turn.completed"))


def test_fake_ok_mode_emits_real_event_shapes_png_and_rollout():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    r = run_fake("ok", envelope=env, image_root=tmp / "generated_images",
                 sessions_root=tmp / "sessions")
    assert r.returncode == 0, r.stderr
    evs = _events(r.stdout)
    kinds = [e["type"] for e in evs]
    assert kinds[0] == "thread.started" and kinds[1] == "turn.started"
    assert kinds[-1] == "turn.completed"
    tid = evs[0]["thread_id"]
    assert tid and tid.startswith("019ff")
    usage = evs[-1]["usage"]
    assert set(usage) == _real_usage_keys()
    assert all(isinstance(value, int) for value in usage.values())
    assert any(e.get("item", {}).get("type") == "agent_message" for e in evs)
    pngs = sorted((tmp / "generated_images" / tid).glob("*.png"))
    assert len(pngs) == 1, pngs
    from PIL import Image
    assert Image.open(pngs[0]).size == (1672, 941)
    ink = _darkest_three_percent_rgb(pngs[0])
    assert ink[0] - ink[2] == 18.0
    rollouts = sorted((tmp / "sessions").glob(f"*/*/*/rollout-*-{tid}.jsonl"))
    assert len(rollouts) == 1, rollouts
    body = rollouts[0].read_text(encoding="utf-8")
    assert "custom_tool_call" in body and "image_gen__imagegen" in body
    rollout_rows = [json.loads(line) for line in body.splitlines()]
    assert any(
        row["payload"].get("type") == "custom_tool_call_output"
        and json.loads(row["payload"]["output"])["prompt"] == prompt.read_text(encoding="utf-8")
        for row in rollout_rows
    )
    assert _p4_pre_image_call_count(rollouts[0]) == 3


def test_fake_rejects_relative_seed_with_the_real_error_string():
    tmp, prompt, _seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds="seeds/figA.png")
    r = run_fake("ok", envelope=env, image_root=tmp / "generated_images",
                 sessions_root=tmp / "sessions")
    assert r.returncode != 0
    assert "AbsolutePathBuf deserialized without a base path" in r.stderr
    assert not list((tmp / "generated_images").rglob("*.png"))


def test_fake_rejects_six_seeds_with_the_real_error_string():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=", ".join([str(seed)] * 6))
    r = run_fake("ok", envelope=env, image_root=tmp / "generated_images",
                 sessions_root=tmp / "sessions")
    assert r.returncode != 0
    assert "referenced_image_paths must contain at most 5 paths" in r.stderr
    assert not list((tmp / "generated_images").rglob("*.png"))


def test_fake_asserts_the_real_flag_contract():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    r = subprocess.run(fake_prefix("ok", tmp / "generated_images", tmp / "sessions")
                       + ["exec", "--sandbox", "workspace-write", "--cd", str(tmp), env],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert r.returncode != 0
    assert "--json" in r.stderr


def test_fake_rejects_untrusted_directory_without_skip_git_repo_check():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    r = subprocess.run(fake_prefix("ok", tmp / "generated_images", tmp / "sessions")
                       + ["exec", "--json", "--sandbox", "workspace-write", "--cd", str(tmp), env],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert r.returncode == 1
    assert r.stderr == "Not inside a trusted directory and `--skip-git-repo-check` was not specified.\n"


def test_fake_resume_reemits_the_thread_and_writes_one_new_png():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    fresh = run_fake("ok", envelope=env, image_root=tmp / "generated_images",
                     sessions_root=tmp / "sessions")
    assert fresh.returncode == 0, fresh.stderr
    thread_id = _events(fresh.stdout)[0]["thread_id"]
    image_dir = tmp / "generated_images" / thread_id
    before = set(image_dir.glob("*.png"))

    resumed = run_fake("resume_ok", envelope=env, image_root=tmp / "generated_images",
                       sessions_root=tmp / "sessions", resume_thread=thread_id)
    assert resumed.returncode == 0, resumed.stderr
    resumed_events = _events(resumed.stdout)
    assert resumed_events[0] == {"type": "thread.started", "thread_id": thread_id}
    after = set(image_dir.glob("*.png"))
    assert len(after - before) == 1


def _run(mode, tmp, prompt, seed, **kw):
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    return run_fake(mode, envelope=env, image_root=tmp / "generated_images",
                    sessions_root=tmp / "sessions", **kw)


def _tid(result):
    return _events(result.stdout)[0]["thread_id"]


def test_fake_modes_image_shapes():
    tmp, prompt, seed = _scratch()
    from PIL import Image
    r = _run("ok_portrait", tmp, prompt, seed)
    p = next((tmp / "generated_images" / _tid(r)).glob("*.png"))
    assert Image.open(p).size == (941, 1672)
    r = _run("wrong_ratio", tmp, prompt, seed)
    p = next((tmp / "generated_images" / _tid(r)).glob("*.png"))
    assert Image.open(p).size == (1200, 900)
    r = _run("two_images", tmp, prompt, seed)
    assert len(list((tmp / "generated_images" / _tid(r)).glob("*.png"))) == 2
    r = _run("tiny_png", tmp, prompt, seed)
    p = next((tmp / "generated_images" / _tid(r)).glob("*.png"))
    assert p.stat().st_size <= 1024


def test_fake_no_image_refuse_and_quota_complete_the_turn_with_no_png():
    tmp, prompt, seed = _scratch()
    for mode, marker in (("no_image", "unable to produce"),
                         ("refuse", "can't help"),
                         ("quota", "usage limit")):
        r = _run(mode, tmp, prompt, seed)
        assert r.returncode == 0, (mode, r.stderr)
        evs = _events(r.stdout)
        assert evs[-1]["type"] == "turn.completed"
        assert any(marker in e.get("item", {}).get("text", "") for e in evs), mode
        assert not list((tmp / "generated_images" / _tid(r)).glob("*.png")), mode


def test_fake_transport_failure_modes():
    tmp, prompt, seed = _scratch()
    r = _run("nonzero_exit", tmp, prompt, seed)
    assert r.returncode == 1
    transport_types = [event["type"] for event in _events(r.stdout)]
    assert transport_types == (
        ["thread.started", "turn.started"]
        + ["error"] * 4
        + ["item.completed"]
        + ["error"] * 6
        + ["turn.failed"]
    )
    assert "turn.completed" not in transport_types
    assert r.stderr == (
        "ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: "
        "IO error: invalid peer certificate: UnknownIssuer, url: wss://api.openai.com/v1/responses\n"
    )
    assert not list((tmp / "generated_images").rglob("*.png"))
    r = _run("bad_json", tmp, prompt, seed)
    bad_json_lines = [line for line in r.stdout.splitlines() if line.strip()]
    assert any(
        _line_raises_json_decode_error(line)
        for line in bad_json_lines
    )
    try:
        for line in bad_json_lines:
            json.loads(line)
    except json.JSONDecodeError:
        pass
    else:
        raise AssertionError("a strict all-lines JSON consumer must fail")
    r = _run("no_thread_event", tmp, prompt, seed)
    assert all(json.loads(l)["type"] != "thread.started"
               for l in r.stdout.splitlines() if l.strip())


def _line_raises_json_decode_error(line):
    try:
        json.loads(line)
    except json.JSONDecodeError:
        return True
    return False


def test_fake_stall_mode_does_not_return_within_two_seconds():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    import forge_codex as fc
    proc = subprocess.Popen(fake_prefix("stall", tmp / "generated_images", tmp / "sessions")
                            + ["exec", "--json", "--skip-git-repo-check", "--sandbox",
                               "workspace-write", "--cd", str(tmp), env],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if os.name == "nt":
        fc._attach_windows_job(proc)
    try:
        timed_out = False
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            timed_out = True
        assert timed_out is True
    finally:
        fc.kill_process_tree(proc)


def test_fake_rollout_variants_paraphrase_and_none():
    tmp, prompt, seed = _scratch()
    r = _run("paraphrase", tmp, prompt, seed)
    roll = next((tmp / "sessions").glob(f"*/*/*/rollout-*-{_tid(r)}.jsonl"))
    assert "PARAPHRASED: " in roll.read_text(encoding="utf-8")
    r = _run("no_rollout", tmp, prompt, seed)
    assert not list((tmp / "sessions").glob(f"*/*/*/rollout-*-{_tid(r)}.jsonl"))
    assert len(list((tmp / "generated_images" / _tid(r)).glob("*.png"))) == 1


def test_fake_resume_writes_a_second_png_into_the_same_thread_dir():
    tmp, prompt, seed = _scratch()
    first = _run("resume_ok", tmp, prompt, seed)
    tid = _tid(first)
    assert len(list((tmp / "generated_images" / tid).glob("*.png"))) == 1
    second = _run("resume_ok", tmp, prompt, seed, resume_thread=tid)
    assert _tid(second) == tid
    assert len(list((tmp / "generated_images" / tid).glob("*.png"))) == 2


STYLE_BIBLE = """# Style bible (test fixture)

## LOCKED STYLE descriptor
> clean flat 2.5D vector cartoon, even medium-thick #241a12 outline, flat cel colour.

## STYLE-ONLY descriptor
> flat cel colour, no gradients, no ambient occlusion.

## RIG-HOLD descriptor
> no nose, no ears, four digits per hand, squat proportion.

## CROWD-RIG clause
> anonymous background figures inherit the squat base proportion and dot-eye face.
"""

REGISTRY = {
    "channel": "the-second-take",
    "engine": "gemini-3-pro-image",
    "characters": {
        "base": {"base": "channels/x/visual-kit/refs/base/base.png"},
        "miniscribe-rep": {"base": "channels/x/visual-kit/refs/miniscribe-rep/miniscribe-rep.png"},
        "ibm-suit": {"base": "channels/x/visual-kit/refs/ibm-suit/ibm-suit.png"},
        "terry-johnson": {"base": "channels/x/visual-kit/refs/terry-johnson/terry-johnson.png"},
    },
    "assets": [
        {"name": "expr-delighted", "kind": "expression", "tag": "delighted", "character": "base",
         "file": "channels/x/visual-kit/refs/base/expr-delighted.png"},
        {"name": "expr-crestfallen", "kind": "expression", "tag": "crestfallen", "character": "base",
         "file": "channels/x/visual-kit/refs/base/expr-crestfallen.png"},
        {"name": "action-powerstance", "kind": "action", "tag": "powerstance", "character": "base",
         "file": "channels/x/visual-kit/refs/base/action-powerstance.png"},
        {"name": "hold-both-hands", "kind": "pose", "tag": "both-hands", "character": "base",
         "file": "channels/x/visual-kit/refs/base/hold-both-hands.png"},
        {"name": "handshake", "kind": "interaction", "tag": "handshake", "character": "base",
         "file": "channels/x/visual-kit/refs/base/handshake.png"},
        {"name": "crowd-exemplar", "kind": "crowd-anchor", "tag": "crowd", "character": "base",
         "file": "channels/x/visual-kit/refs/base/crowd-exemplar.png"},
    ],
}


def make_kit(tmp):
    """Build the minimal real kit accepted by ``forge.Kit(dry=True)``.

    The empty temporary ``.env`` is only a root sentinel; nothing reads the repository's real
    environment file.
    """
    root = Path(tmp)
    (root / ".env").write_text("", encoding="utf-8")
    kit = root / "channels" / "x" / "visual-kit"
    (kit / "registry").mkdir(parents=True)
    (kit / "refs" / "base").mkdir(parents=True)
    (kit / "_staging").mkdir(parents=True)
    (kit / "style-bible.md").write_text(STYLE_BIBLE, encoding="utf-8")
    (kit / "registry" / "registry.json").write_text(json.dumps(REGISTRY), encoding="utf-8")
    return str(kit), root


def test_import_surface_contract_matches_forge():
    import ast
    import inspect
    import forge
    import forge_codex  # noqa: F401
    # Plan "Task C1 — module skeleton, import-surface contract, no-key construction" §Interfaces:
    # keep the 14-symbol forge.py dependency surface exact, not merely signature-compatible.
    expected_imports = [
        "Kit", "SeedIntegrityError", "SEED_CAP", "_existing_staging_png",
        "_publish_staging_png", "_release_staging_lock", "_reserve_staging_output",
        "_staging_png", "_stem", "preflight_batch", "resolve_request_seeds",
        "to_png_bytes", "validate_png", "verify_request_seed_digests",
    ]
    tree = ast.parse((HERE / "forge_codex.py").read_text(encoding="utf-8"))
    imported_from_forge = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "forge"
        for alias in node.names
    }
    assert imported_from_forge == set(expected_imports), (
        f"forge_codex import set drifted: {sorted(imported_from_forge)} != "
        f"{sorted(expected_imports)}"
    )
    expected = {
        "Kit": ["kit", "dry"],
        "preflight_batch": ["k", "reqs", "force", "dry"],
        "resolve_request_seeds": ["k", "r", "pending"],
        "verify_request_seed_digests": ["k", "r", "seeds"],
        "validate_png": ["data"],
        "to_png_bytes": ["data"],
        "_staging_png": ["k", "name"],
        "_existing_staging_png": ["path"],
        "_reserve_staging_output": ["k", "name", "force"],
        "_publish_staging_png": ["k", "name", "out", "data", "force"],
        "_release_staging_lock": ["lock", "token"],
        "_stem": ["path"],
    }
    for name, params in expected.items():
        obj = getattr(forge, name, None)
        assert obj is not None, f"forge.{name} disappeared -- forge_codex imports it"
        target = obj.__init__ if inspect.isclass(obj) else obj
        got = [p for p in inspect.signature(target).parameters if p != "self"]
        assert got == params, f"forge.{name} signature drifted: {got} != {params}"
    assert issubclass(forge.SeedIntegrityError, RuntimeError)
    assert forge.SEED_CAP == 4


def test_importing_forge_has_no_side_effects():
    tmp = Path(tempfile.mkdtemp(prefix="importsafe-"))
    before = set(os.listdir(tmp))
    # BOSS RULING (C1 Fix Round 1): os.path.expanduser and USERPROFILE/HOME reads during import
    # are permitted home-dir resolution; only credential-key reads are the blocked class.
    fresh_import = """
import os
import shutil
import socket
import sys
from collections.abc import MutableMapping

SCRIPT_DIR = %r
CREDENTIAL_KEYS = {"OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"}

class CredentialTracingEnviron(MutableMapping):
    def __init__(self, data):
        self.data = {key: value for key, value in data.items() if key not in CREDENTIAL_KEYS}
        self.reads = []

    def _track(self, key):
        if key in CREDENTIAL_KEYS:
            self.reads.append(key)
            raise AssertionError("credential environment key read during import: %%s" %% key)

    def __getitem__(self, key):
        self._track(key)
        return self.data[key]

    def __setitem__(self, key, value):
        self.data[key] = value

    def __delitem__(self, key):
        del self.data[key]

    def __iter__(self):
        return iter(self.data)

    def __len__(self):
        return len(self.data)

    def __contains__(self, key):
        self._track(key)
        return key in self.data

    def get(self, key, default=None):
        self._track(key)
        return self.data.get(key, default)

def forbidden_which(*_args, **_kwargs):
    raise AssertionError("shutil.which called during import")

class ForbiddenSocket(socket.socket):
    def __new__(cls, *_args, **_kwargs):
        raise AssertionError("socket.socket called during import")

os.environ = CredentialTracingEnviron(os.environ)
shutil.which = forbidden_which
socket.socket = ForbiddenSocket
sys.path.insert(0, SCRIPT_DIR)
import forge
import forge_codex
assert os.environ.reads == [], os.environ.reads
""" % str(HERE)
    r = subprocess.run(["py", "-3", "-c", fresh_import], cwd=str(tmp), capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == ""
    assert set(os.listdir(tmp)) == before
    src = (HERE / "forge.py").read_text(encoding="utf-8")
    assert 'if __name__ == "__main__":' in src


def test_kit_builds_with_no_key_and_no_url():
    import forge
    tmp = Path(tempfile.mkdtemp(prefix="nokey-"))
    kit, _root = make_kit(tmp)
    saved = os.environ.pop("GEMINI_API_KEY", None)
    try:
        k = forge.Kit(kit, dry=True)
    finally:
        if saved is not None:
            os.environ["GEMINI_API_KEY"] = saved
    assert k.url is None
    assert k.key == ""
    assert k.ctx is None
    assert k.desc_identity and k.desc_crowdrig
    assert k.reg["characters"]["miniscribe-rep"]


def test_resolve_codex_binary_is_never_called_at_import_and_fails_loud():
    import forge_codex
    saved = forge_codex.CODEX_ARGV_PREFIX
    forge_codex.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    try:
        raised = None
        try:
            forge_codex.resolve_codex_binary()
        except SystemExit as e:
            raised = str(e)
        assert raised is not None and "codex CLI not found on PATH" in raised
    finally:
        forge_codex.CODEX_ARGV_PREFIX = saved
    forge_codex.CODEX_ARGV_PREFIX = [sys.executable]
    try:
        assert os.path.isfile(forge_codex.resolve_codex_binary())
    finally:
        forge_codex.CODEX_ARGV_PREFIX = saved


L46_PAYLOAD = ("One seeded performer, `base`, `expr-crestfallen`, `hold-both-hands`, in a grey work "
               "coat, stage-left, carrying a cardboard box of desk things down the length of the "
               "assembly floor toward the roller door. On the far side of the far bench a subdued "
               "crowd stands and watches him go, arms down, faces flat and tired. Cool grey-teal "
               "palette drained toward grey, flat strip light with every fourth ceiling fitting "
               "dark, foreground depth from a cropped bench end at the lower-right.")

L47_PAYLOAD = ("`terry-johnson`, `expr-crestfallen`, `carry-by-handle`, stage-right, stepping out "
               "through a glass door onto a car park apron with a document case at his side, his "
               "back half turned to the floor behind him. Through the glass the assembly floor runs "
               "away into the depth with its benches bare. Grey-cream-teal palette, flat overcast "
               "light outside against warm strip light inside, foreground depth from a cropped kerb "
               "at the lower-left.")


def test_idiom_table_translates_every_documented_direction():
    import forge_codex as fc
    assert fc.translate_idiom("stage-left,") == "on the left of the frame,"
    assert fc.translate_idiom("Stage Right") == "on the right of the frame"
    assert fc.translate_idiom("stage-centre") == "centred in the frame"
    assert fc.translate_idiom("stage center") == "centred in the frame"
    assert fc.translate_idiom("upstage") == "toward the back of the frame"
    assert fc.translate_idiom("up stage") == "toward the back of the frame"
    assert fc.translate_idiom("downstage") == "toward the front of the frame"
    assert fc.translate_idiom("camera-left") == "on the left of the frame"
    assert fc.translate_idiom("camera right") == "on the right of the frame"
    assert fc.translate_idiom("off-stage") == "outside the frame"
    assert fc.translate_idiom("offstage") == "outside the frame"


def test_idiom_translation_on_real_shot_payloads_keeps_every_fact():
    import forge_codex as fc
    out46 = fc.translate_idiom(L46_PAYLOAD)
    assert "stage-left" not in out46 and "on the left of the frame" in out46
    for noun in ("grey work coat", "cardboard box", "roller door", "subdued", "bench"):
        assert noun in out46, noun
    assert len(out46.split()) >= len(L46_PAYLOAD.split())
    out47 = fc.translate_idiom(L47_PAYLOAD)
    assert "stage-right" not in out47 and "on the right of the frame" in out47
    for noun in ("glass door", "car park apron", "document case", "kerb"):
        assert noun in out47, noun


def test_idiom_translation_never_touches_quoted_literals():
    import forge_codex as fc
    src = "a painted board reading 'STAGE-LEFT' hanging stage-left over him"
    out = fc.translate_idiom(src)
    assert "'STAGE-LEFT'" in out
    assert "hanging on the left of the frame over him" in out
    src2 = 'the sign "UPSTAGE DOCK" seen from upstage'
    out2 = fc.translate_idiom(src2)
    assert '"UPSTAGE DOCK"' in out2 and "from toward the back of the frame" in out2


def test_residual_scan_warns_without_raising():
    import forge_codex as fc
    assert fc.residual_idiom(L47_PAYLOAD) == []
    hits = fc.residual_idiom("he waits in the wings, left of the blocking mark")
    assert hits and any("wings" in h for h in hits)
    assert isinstance(hits, list)


P2B_WORKED_EXAMPLE = """Use case: illustration-story
Asset type: documentary-style animated video still frame
Primary request: miniscribe-rep, delighted expression, power-stance pose, planted centre in the
entrance at the back of the MiniScribe assembly floor, a painted board reading \"MINISCRIBE\"
hanging over him
Input images: Image 1: character reference for miniscribe-rep -- match exact costume,
proportions, and line style
Scene/backdrop: the assembly floor as established -- two long steel benches running back into the
depth, a rack of tote bins at stage-left of frame, a shut roller door beyond
Subject: miniscribe-rep, matching the character reference exactly
Style/medium: clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black outline
(#241a12), flat cel colour fills with gentle soft shading only, rounded friendly shapes, no
realistic detail
Composition/framing: foreground depth from a cropped bench end at lower-right; 16:9 landscape
Lighting/mood: flat strip light, cool grey-teal-cream palette
Color palette: locked 2-3 colour scene palette (cool grey-teal-cream) plus a single red accent
#d7402b reserved only for alarm / prohibition / ownership / the final punch element
Materials/textures: flat cel fills only, no gradients, no ambient occlusion
Text (verbatim): \"MINISCRIBE\" (on the painted board only)
Constraints: preserve miniscribe-rep's exact costume, proportions, and line weight from the
reference image; environment stays a built-but-flat environment -- minimal geometry plus one
foreground depth prop, not a fully rendered set
Avoid: photorealism, on-screen narrator or host face, unrequested text or signage beyond the
quoted board text, logos, gradients, cast shadows, soft ambient shading, invented staging labels
"""

P2B_WORKED_EXPECTED = """Use case: illustration-story
Asset type: documentary-style animated video still frame
Primary request: miniscribe-rep, delighted expression, power-stance pose, planted centre in the
entrance at the back of the MiniScribe assembly floor, a painted board reading \"MINISCRIBE\"
hanging over him
Input images: Image 1: character reference for miniscribe-rep -- match exact costume,
proportions, and line style
Scene/backdrop: the assembly floor as established -- two long steel benches running back into the
depth, a rack of tote bins on the left of the frame, a shut roller door beyond
Subject: miniscribe-rep, matching the character reference exactly
Style/medium: clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black outline
(#241a12), flat cel colour fills with gentle soft shading only, rounded friendly shapes, no
realistic detail
Composition/framing: foreground depth from a cropped bench end at lower-right; 16:9 landscape
Lighting/mood: flat strip light, cool grey-teal-cream palette
Color palette: locked 2-3 colour scene palette (cool grey-teal-cream) plus a single red accent
#d7402b reserved only for alarm / prohibition / ownership / the final punch element
Materials/textures: flat cel fills only, no gradients, no ambient occlusion
Text (verbatim): \"MINISCRIBE\" (on the painted board only)
Constraints: preserve miniscribe-rep's exact costume, proportions, and line weight from the
reference image; environment stays a built-but-flat environment -- minimal geometry plus one
foreground depth prop, not a fully rendered set
Avoid: photorealism, on-screen narrator or host face, unrequested text or signage beyond the
quoted board text, logos, gradients, cast shadows, soft ambient shading, invented staging labels
"""


def test_idiom_translation_p2b_worked_example_translates_full_position_phrase():
    import forge_codex as fc
    assert fc.translate_idiom(P2B_WORKED_EXAMPLE) == P2B_WORKED_EXPECTED


def test_residual_scan_uses_original_offsets_after_prior_translation():
    import forge_codex as fc
    poisoned = "stage-left, left xxxxxxxxxxxxxxxxxxxxxxxxxx wings"
    hits = fc.residual_idiom(poisoned)
    assert hits and any("wings" in hit for hit in hits)


def test_canvas_table_and_framing_line():
    import forge_codex as fc
    assert fc.resolve_canvas("16:9", "1K") == (1376, 768)
    assert fc.resolve_canvas("16:9", "2K") == (2752, 1536)
    assert fc.resolve_canvas("2:3", "1K") == (832, 1248)
    assert fc.resolve_canvas("9:16", "1K") == (768, 1344)
    assert fc.framing_line("16:9", (1376, 768)) == (
        "Composition/framing: Compose for a 1376\u00d7768 pixel frame \u2014 a 16:9 landscape "
        "aspect ratio.")
    assert fc.framing_line("2:3", (832, 1248)).endswith("a 2:3 portrait aspect ratio.")


def test_unknown_canvas_pair_fails_loud_naming_the_pair():
    import forge_codex as fc
    raised = None
    try:
        fc.resolve_canvas("21:9", "1K")
    except SystemExit as e:
        raised = str(e)
    assert raised is not None and "21:9" in raised and "1K" in raised
    # Known ratio with an unknown tier must fail loud the same way (review C3 finding).
    raised = None
    try:
        fc.resolve_canvas("16:9", "3K")
    except SystemExit as e:
        raised = str(e)
    assert raised is not None and "16:9" in raised and "3K" in raised


L29_PAYLOAD = ("`miniscribe-rep`, `expr-delighted`, `action-powerstance`, planted centre in the "
               "entrance at the back of the assembly floor, the painted board 'MINISCRIBE' hanging "
               "over him. The floor as established: two long steel benches running back into the "
               "depth, the rack of tote bins stage-left, the roller door shut beyond. Cool "
               "grey-teal-cream palette, flat strip light, foreground depth from a cropped bench "
               "end at the lower-right.")

L29_GOLDEN = (
    "Use case: illustration-story\n"
    "Asset type: documentary-style animated video still frame\n"
    "Primary request: miniscribe-rep, delighted expression, powerstance pose, planted centre in "
    "the entrance at the back of the assembly floor, the painted board 'MINISCRIBE' hanging over "
    "him. The floor as established: two long steel benches running back into the depth, the rack "
    "of tote bins on the left of the frame, the roller door shut beyond. Cool grey-teal-cream "
    "palette, flat strip light, foreground depth from a cropped bench end at the lower-right.\n"
    "Input images: Image 1: character reference for miniscribe-rep — match exactly. "
    "Image 2: place reference — preserve its set, palette and outline weight.\n"
    "Style/medium: clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black outline "
    "(#241a12), flat cel colour fills with gentle soft shading only, rounded friendly shapes, no "
    "realistic detail\n"
    "Composition/framing: Compose for a 1376×768 pixel frame — a 16:9 landscape aspect "
    "ratio.\n"
    "Color palette: locked 2-3 colour scene palette plus a single red accent #d7402b reserved only "
    "for alarm / prohibition / ownership / the final punch element\n"
    "Materials/textures: flat cel fills only, no gradients, no ambient occlusion\n"
    "Text (verbatim): \"MINISCRIBE\" — render exactly this text and nothing else.\n"
    "Constraints: preserve miniscribe-rep's exact costume, proportions and line weight from the "
    "reference image; environment stays a built-but-flat environment — minimal geometry plus "
    "one foreground depth prop, not a fully rendered set\n"
    "Avoid: photorealism, on-screen narrator or host face, logos, gradients and cast shadows, soft "
    "ambient shading, unrequested text or signage beyond the quoted text and invented staging "
    "labels\n"
)


def _item_L29():
    return {"name": "L29", "mode": "environment", "aspect": "16:9", "payload": L29_PAYLOAD,
            "figures": None,
            "seed_roles": [
                {"path": "C:/k/refs/miniscribe-rep/fig-miniscribe-rep.png", "role": "figure",
                 "character": "miniscribe-rep"},
                {"path": "C:/k/_staging/L28.png", "role": "place", "character": None}]}


def _item_L26():
    return {"name": "L26", "mode": "environment", "aspect": "16:9", "figures": None,
            "payload": ("A flat top-down world map laid out across a concrete floor, oceans in pale "
                        "teal and landmasses in cream, every landmass left completely blank and "
                        "unlettered."),
            "seed_roles": [{"path": "C:/k/refs/env/scene-style-tile.png", "role": "style-anchor",
                            "character": None}]}


def test_composer_reproduces_the_L29_golden_byte_for_byte():
    import forge_codex as fc
    got = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert got == L29_GOLDEN, "\n--- got ---\n" + got + "\n--- want ---\n" + L29_GOLDEN


def test_composer_warns_for_a_residual_from_a_poisoned_registry_item():
    import warnings
    import forge_codex as fc

    poisoned = dict(REGISTRY)
    poisoned["assets"] = list(REGISTRY["assets"]) + [
        {"name": "poisoned-prop", "kind": "prop", "tag": "wings left"}]
    item = dict(_item_L26(), payload="`poisoned-prop` beside the doorway")
    scanned = []
    original = fc.residual_idiom

    def spy(text):
        scanned.append(text)
        return original(text)

    fc.residual_idiom = spy
    try:
        with warnings.catch_warnings(record=True) as reported:
            warnings.simplefilter("always")
            composed = fc.compose_prompt(item, reg=poisoned, canvas=(1376, 768), aspect="16:9")
    finally:
        fc.residual_idiom = original

    assert "Primary request: wings left beside the doorway" in composed
    assert scanned == [composed]
    assert reported and "residual staging idiom" in str(reported[0].message)
    assert "wings left" in str(reported[0].message)


def test_composer_pins_zero_one_and_four_content_seed_boundaries():
    import forge_codex as fc

    for count in (0, 1, 4):
        item = dict(_item_L26(), seed_roles=[
            {"path": f"C:/k/seed-{n}.png", "role": "prop", "character": None}
            for n in range(1, count + 1)
        ])
        composed = fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
        lines = [line for line in composed.splitlines() if line.startswith("Input images: ")]
        if count == 0:
            assert lines == []
        else:
            assert len(lines) == 1
            assert lines[0].count("Image ") == count
            for n in range(1, count + 1):
                assert f"Image {n}: prop reference" in lines[0]


def test_composer_is_deterministic():
    import forge_codex as fc
    a = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    b = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert a == b and a.encode("utf-8") == b.encode("utf-8")


def test_primary_request_is_the_payload_verbatim_after_idiom_and_slug_resolution():
    import forge_codex as fc
    item = _item_L29()
    line = [l for l in fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768),
                                         aspect="16:9").split("\n")
            if l.startswith("Primary request: ")][0]
    body = line[len("Primary request: "):]
    assert body == fc.translate_idiom(fc.resolve_slugs(item["payload"], REGISTRY))
    assert "`" not in body


def test_input_images_line_follows_seed_roles_in_order():
    import forge_codex as fc
    roles = [{"path": "a.png", "role": "figure", "character": "ibm-suit"},
             {"path": "b.png", "role": "prop", "character": None},
             {"path": "c.png", "role": "style-anchor", "character": None},
             {"path": "d.png", "role": "interaction", "character": None}]
    line = fc.input_images_line(roles)
    assert line.startswith("Image 1: character reference for ibm-suit")
    assert "Image 2: prop reference" in line
    assert "Image 3: style reference only" in line
    assert "Image 4: interaction geometry reference" in line
    assert line.index("Image 1") < line.index("Image 2") < line.index("Image 3")


def test_text_field_present_with_quotes_and_absent_without():
    import forge_codex as fc
    with_quotes = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert 'Text (verbatim): "MINISCRIBE"' in with_quotes
    assert "unrequested text or signage beyond the quoted text" in with_quotes
    no_quotes = fc.compose_prompt(_item_L26(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "Text (verbatim):" not in no_quotes
    avoid = [l for l in no_quotes.split("\n") if l.startswith("Avoid: ")][0]
    assert avoid.startswith("Avoid: any words, letters, numerals or signage")


def test_fields_with_no_source_are_omitted_never_emitted_empty():
    import forge_codex as fc
    out = fc.compose_prompt(_item_L26(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "Scene/backdrop:" not in out and "Subject:" not in out and "Lighting/mood:" not in out
    for line in out.split("\n"):
        if line:
            assert not line.rstrip().endswith(":"), line


def test_crowd_clause_only_when_figures_crowd():
    import forge_codex as fc
    item = _item_L29()
    plain = fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "background crowd figures" not in plain
    item["figures"] = {"crowd": True}
    crowded = fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "background crowd figures stay flat silhouetted shapes" in crowded


def test_brevity_budget_and_no_fact_stated_twice():
    import forge_codex as fc
    for item in (_item_L29(), _item_L26()):
        out = fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
        assert len(out) <= fc.COMPOSED_CHAR_BUDGET, (item["name"], len(out))
        assert out.count("#241a12") == 1
        assert out.count("clean flat 2.5D vector cartoon") == 1
        assert out.count("#d7402b") == 1
        assert out.count("Avoid:") == 1
        bodies = [l.split(": ", 1)[1] for l in out.split("\n") if ": " in l]
        for i, a in enumerate(bodies):
            for j, b in enumerate(bodies):
                assert i == j or a not in b, (a, b)


def test_dead_levers_stay_dead_no_head_tail_repetition():
    import forge_codex as fc
    out = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    lines = [l for l in out.split("\n") if l]
    assert lines[-1].startswith("Avoid: ")
    assert lines[0].startswith("Use case: ")
    assert "flat cel" not in lines[0] and "flat cel" not in lines[2]
    labels = [l.split(":", 1)[0] for l in lines]
    assert len(labels) == len(set(labels)), labels


def _png(path, n=4096):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(n))
    return str(path)


def test_prepare_seeds_requires_absolute_paths_and_realpaths_them():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    a = _png(tmp / "a.png")
    out = fc.prepare_seeds({"name": "L29"}, [a])
    assert out == [os.path.realpath(a)] and all(os.path.isabs(p) for p in out)
    raised = None
    try:
        fc.prepare_seeds({"name": "L29"}, ["refs/base/base.png"])
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L29" in raised and "absolute" in raised


def test_prepare_seeds_rejects_five_content_seeds_at_doctrine_cap():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    content = [_png(tmp / f"content-{i}.png") for i in range(5)]
    raised = None
    try:
        fc.prepare_seeds({"name": "L33"}, content)
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L33" in raised and "CODEX_SEED_CAP=4" in raised
    assert "truncat" in raised
    four_content = fc.prepare_seeds({"name": "L33"}, content[:4])
    assert len(four_content) == fc.CODEX_SEED_CAP == 4

    # C15 will supply this fifth, study-only register seed after content preparation.
    register_seed = _png(tmp / "register.png")
    transport_seeds = four_content + [register_seed]
    assert len(transport_seeds) == fc.TRANSPORT_SEED_CEILING == 5
    assert fc.assert_transport_seed_ceiling({"name": "L33"}, transport_seeds) is None

    raised = None
    try:
        fc.assert_transport_seed_ceiling({"name": "L33"}, transport_seeds + [content[4]])
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L33" in raised and "at most 5" in raised


def test_seed_digests_reverify_raises_seed_integrity_error_on_mutation():
    import forge_codex as fc
    from forge import SeedIntegrityError
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    a = _png(tmp / "a.png")
    expected = fc.seed_digests([a])
    fc.reverify_seed_digests("L29", expected)          # unchanged -> silent
    Path(a).write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(4096))
    raised = None
    try:
        fc.reverify_seed_digests("L29", expected)
    except SeedIntegrityError as e:
        raised = str(e)
    assert raised is not None and "L29" in raised


ARC_ENVELOPE = REPO_ROOT / "scratch-codex-image-engine" / "p4-envelope.txt"


def test_build_envelope_matches_the_banked_probe_contract():
    import forge_codex as fc
    got = fc.build_envelope("<PROMPT_PATH>", ["<SEED_1>"])
    assert ARC_ENVELOPE.is_file(), f"missing banked envelope: {ARC_ENVELOPE}"
    assert got == ARC_ENVELOPE.read_text(encoding="utf-8")
    two = fc.build_envelope("C:/p.txt", ["C:/a.png", "C:/b.png"])
    assert "referenced_image_paths = [C:/a.png, C:/b.png]" in two
    assert "exactly once" in two and "Do not read any file outside this directory" in two


def test_write_prompt_file_is_utf8_and_lands_in_the_codex_prompt_archive():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="prompts-"))
    p = fc.write_prompt_file(str(tmp), "L29", "Avoid: photorealism\u2014none\n")
    assert Path(p) == tmp / "_codex" / "prompts" / "L29.txt"
    assert Path(p).read_text(encoding="utf-8") == "Avoid: photorealism\u2014none\n"
    assert Path(p).read_bytes() == "Avoid: photorealism\u2014none\n".encode("utf-8")


def test_run_codex_exec_sends_the_real_flag_tail_and_parses_the_stream():
    import forge_codex as fc
    tmp, prompt, seed = _scratch()
    saved = fc.CODEX_ARGV_PREFIX
    fc.CODEX_ARGV_PREFIX = fake_prefix("ok", tmp / "generated_images", tmp / "sessions")
    try:
        env = fc.build_envelope(str(prompt), [str(seed)])
        r = fc.run_codex_exec(envelope=env, cwd=str(tmp), timeout_s=120)
    finally:
        fc.CODEX_ARGV_PREFIX = saved
    assert r["returncode"] == 0 and r["timed_out"] is False
    assert r["thread_id"] and r["thread_id"].startswith("019ff")
    assert r["usage"]["input_tokens"] == 75742
    assert r["events"] and r["events"][0]["type"] == "thread.started"
    assert r["wall_s"] >= 0


def test_run_codex_exec_resume_uses_the_measured_distinct_argv():
    import forge_codex as fc
    tmp, prompt, seed = _scratch()
    saved = fc.CODEX_ARGV_PREFIX
    fc.CODEX_ARGV_PREFIX = fake_prefix("resume_ok", tmp / "generated_images", tmp / "sessions")
    try:
        env = fc.build_envelope(str(prompt), [str(seed)])
        r = fc.run_codex_exec(envelope=env, cwd=str(tmp), timeout_s=120,
                              resume_thread="019ff123-4567-7890-abcd-0123456789ab")
    finally:
        fc.CODEX_ARGV_PREFIX = saved
    assert r["returncode"] == 0 and r["timed_out"] is False
    assert r["thread_id"] == "019ff123-4567-7890-abcd-0123456789ab"


def test_run_codex_exec_kills_the_whole_process_tree_on_timeout():
    import forge_codex as fc
    tmp, prompt, seed = _scratch()
    hb = tmp / "heartbeat.txt"
    saved = fc.CODEX_ARGV_PREFIX
    fc.CODEX_ARGV_PREFIX = fake_prefix("stall", tmp / "generated_images", tmp / "sessions")
    try:
        try:
            env = fc.build_envelope(str(prompt), [str(seed)])
            r = fc.run_codex_exec(envelope=env, cwd=str(tmp), timeout_s=2)
        finally:
            fc.CODEX_ARGV_PREFIX = saved
        assert r["timed_out"] is True
        assert hb.is_file(), "grandchild never started -- the tree-kill assertion would be vacuous"
        import time as _t
        size_a = hb.stat().st_size
        _t.sleep(1.5)
        assert hb.stat().st_size == size_a, "grandchild survived: the kill was single-PID, not a TREE"
    finally:
        # Failure-path reap: a surviving grandchild must not outlive the test run.
        pid_file = hb.with_suffix(".pid")
        if pid_file.is_file():
            subprocess.run(["taskkill", "/PID", pid_file.read_text(encoding="utf-8").strip(),
                            "/T", "/F"], capture_output=True)


def test_run_codex_exec_reports_stderr_tail_bounded_to_160_chars():
    import forge_codex as fc
    tmp, prompt, seed = _scratch()
    saved = fc.CODEX_ARGV_PREFIX
    fc.CODEX_ARGV_PREFIX = fake_prefix("nonzero_exit", tmp / "generated_images", tmp / "sessions")
    try:
        r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                              timeout_s=120)
    finally:
        fc.CODEX_ARGV_PREFIX = saved
    assert r["returncode"] == 1
    assert "failed to connect" in r["stderr_tail"] and len(r["stderr_tail"]) <= 160


def _fc_with_roots(mode, tmp):
    import forge_codex as fc
    fc.CODEX_ARGV_PREFIX = fake_prefix(mode, tmp / "generated_images", tmp / "sessions")
    fc.IMAGE_ROOT = str(tmp / "generated_images")
    fc.SESSIONS_ROOT = str(tmp / "sessions")
    return fc


def _write_synthetic_rollout(sessions_root, thread_id, rows):
    directory = sessions_root / "2026" / "08" / "12"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"rollout-2026-08-12T12-00-00-{thread_id}.jsonl"
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    return path


def test_fidelity_verified_on_a_literal_pass_through():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    verdict, sha = fc.audit_fidelity(r["thread_id"], str(prompt))
    assert verdict == "verified" and sha and len(sha) == 64


def test_fidelity_mismatch_is_detected_and_carries_the_captured_sha():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("paraphrase", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    verdict, sha = fc.audit_fidelity(r["thread_id"], str(prompt))
    assert verdict == "mismatch" and sha and len(sha) == 64


def test_fidelity_unverifiable_without_a_rollout_log_is_not_a_failure():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("no_rollout", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    verdict, sha = fc.audit_fidelity(r["thread_id"], str(prompt))
    assert verdict == "unverifiable" and sha is None


def test_fidelity_unverifiable_when_the_model_used_the_read_into_variable_mechanism():
    import forge_codex as fc
    assert fc.extract_captured_prompt(json.dumps(
        {"payload": {"type": "custom_tool_call", "input": REAL_VARIABLE_JS}})) is None


def test_audit_reads_only_the_rollout_file_matching_its_own_thread_id():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r1 = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                           timeout_s=120)
    other = tmp / "L44.txt"
    other.write_text("a completely different composed prompt\n", encoding="utf-8", newline="\n")
    r2 = fc.run_codex_exec(envelope=fc.build_envelope(str(other), [str(seed)]), cwd=str(tmp),
                           timeout_s=120)
    assert r1["thread_id"] != r2["thread_id"]
    assert fc.audit_fidelity(r1["thread_id"], str(prompt))[0] == "verified"
    assert fc.audit_fidelity(r2["thread_id"], str(other))[0] == "verified"
    assert fc.audit_fidelity(r1["thread_id"], str(other))[0] == "mismatch"


def test_pre_call_tool_calls_counts_the_ambient_detour():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    assert fc.count_pre_call_tool_calls(r["thread_id"]) == 3
    assert fc.count_pre_call_tool_calls("019ff000-0000-7000-0000-000000000000") is None


def test_pre_call_tool_calls_ignores_image_tool_name_inside_a_prior_call_input():
    tmp, _, _ = _scratch()
    import forge_codex as fc

    thread_id = "input-poison"
    _write_synthetic_rollout(tmp / "sessions", thread_id, [
        {"type": "response_item", "payload": {
            "type": "custom_tool_call", "name": "shell",
            "input": "const shot = {prompt: 'image_gen__imagegen'};",
        }},
        {"type": "response_item", "payload": {
            "type": "custom_tool_call", "name": "exec",
            "input": "const result = await tools.image_gen__imagegen({prompt: 'real'});",
        }},
    ])

    assert fc.count_pre_call_tool_calls(thread_id, str(tmp / "sessions")) == 1


def test_pre_call_tool_calls_ignores_custom_tool_call_text_outside_a_tool_item():
    tmp, _, _ = _scratch()
    import forge_codex as fc

    thread_id = "text-poison"
    _write_synthetic_rollout(tmp / "sessions", thread_id, [
        {"type": "item.completed", "item": {
            "type": "agent_message", "text": "custom_tool_call",
        }},
        {"type": "response_item", "payload": {
            "type": "custom_tool_call", "name": "shell", "input": "Get-ChildItem",
        }},
        {"type": "response_item", "payload": {
            "type": "custom_tool_call", "name": "exec",
            "input": "const result = await tools.image_gen__imagegen({prompt: 'real'});",
        }},
    ])

    assert fc.count_pre_call_tool_calls(thread_id, str(tmp / "sessions")) == 1


def test_fidelity_preserves_crlf_in_the_prompt_archive():
    tmp, prompt, _ = _scratch()
    import forge_codex as fc

    composed = "line one\r\nline two\r\n"
    prompt.write_bytes(composed.encode("utf-8"))
    thread_id = "crlf-fidelity"
    _write_synthetic_rollout(tmp / "sessions", thread_id, [
        {"type": "response_item", "payload": {
            "type": "custom_tool_call", "name": "exec",
            "input": "const result = await tools.image_gen__imagegen({prompt: %s});"
                     % json.dumps(composed),
        }},
    ])

    verdict, sha = fc.audit_fidelity(thread_id, str(prompt), str(tmp / "sessions"))
    assert verdict == "verified" and sha == hashlib.sha256(composed.encode("utf-8")).hexdigest()


def test_harvest_accepts_exactly_one_new_png_and_ignores_pre_existing_files():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    env = fc.build_envelope(str(prompt), [str(seed)])
    first = fc.run_codex_exec(envelope=env, cwd=str(tmp), timeout_s=120)
    tid = first["thread_id"]
    before = fc.snapshot_thread_dir(tid)
    assert len(before) == 1                       # turn 1's frame is already there
    second = fc.run_codex_exec(envelope=env + " ", cwd=str(tmp), timeout_s=120,
                               resume_thread=tid)
    got = fc.harvest_new_pngs(tid, before, polls=3, delay=0.1)
    assert len(got) == 1 and os.path.isfile(got[0]) and got[0].endswith(".png")
    assert os.path.basename(got[0]) not in before
    assert second["returncode"] == 0


def test_harvest_returns_an_empty_list_when_nothing_was_written():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("no_image", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    assert fc.harvest_new_pngs(r["thread_id"], set(), polls=2, delay=0.05) == []


def test_harvest_returns_both_paths_when_two_images_landed():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("two_images", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    got = fc.harvest_new_pngs(r["thread_id"], set(), polls=2, delay=0.05)
    assert len(got) == 2 and got == sorted(got)


def test_harvest_settles_after_the_first_png_for_a_staggered_multi_emit():
    tmp, _, _ = _scratch()
    import forge_codex as fc

    thread_id = "staggered-multi-emit"
    output_dir = tmp / "generated_images" / thread_id
    _png(output_dir / "one.png")

    def staggered_writer():
        time.sleep(0.03)
        _png(output_dir / "two.png")

    writer = threading.Thread(target=staggered_writer)
    writer.start()
    try:
        got = fc.harvest_new_pngs(thread_id, set(), image_root=tmp / "generated_images",
                                  polls=5, delay=0.02)
    finally:
        writer.join()

    assert [os.path.basename(path) for path in got] == ["one.png", "two.png"]


def test_harvest_normalizes_a_relative_image_root_to_absolute_paths():
    tmp, _, _ = _scratch()
    import forge_codex as fc

    thread_id = "relative-root"
    root = tmp / "generated_images"
    _png(root / thread_id / "frame.png")
    relative_root = os.path.relpath(root, os.getcwd())

    got = fc.harvest_new_pngs(thread_id, set(), image_root=relative_root, polls=1, delay=0)

    assert got == [str((root / thread_id / "frame.png").resolve())]
    assert all(os.path.isabs(path) for path in got)


def test_harvest_leaves_the_source_file_in_place():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    got = fc.harvest_new_pngs(r["thread_id"], set(), polls=2, delay=0.05)[0]
    assert os.path.isfile(got)
    assert os.path.commonpath([got, fc.IMAGE_ROOT]) == os.path.normpath(fc.IMAGE_ROOT)


def _png_bytes(size, colour=(36, 26, 18)):
    import io
    from PIL import Image
    im = Image.new("RGB", size, (240, 240, 235))
    im.paste(Image.new("RGB", (size[0], max(1, size[1] // 8)), colour), (0, 0))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_normalization_crops_then_resizes_to_the_exact_canvas():
    import io
    import forge_codex as fc
    from PIL import Image
    data = _png_bytes((1659, 948))
    validations = []
    original_validate_png = fc.validate_png

    def spy_validate_png(bytes_to_validate):
        validations.append(bytes_to_validate)
        return original_validate_png(bytes_to_validate)

    fc.validate_png = spy_validate_png
    try:
        out, native, err = fc.normalize_to_canvas(data, (1376, 768))
    finally:
        fc.validate_png = original_validate_png
    assert native == (1659, 948)
    assert 0 < err <= fc.RATIO_TOLERANCE
    assert Image.open(io.BytesIO(out)).size == (1376, 768)
    assert validations == [data, out]


def test_normalization_is_a_pure_resize_when_the_ratio_already_matches():
    import io
    import forge_codex as fc
    from PIL import Image
    original_crop_to_ratio = fc.crop_to_ratio
    crop_called = False

    def spy_crop_to_ratio(*args, **kwargs):
        nonlocal crop_called
        crop_called = True
        return original_crop_to_ratio(*args, **kwargs)

    fc.crop_to_ratio = spy_crop_to_ratio
    try:
        out, native, err = fc.normalize_to_canvas(_png_bytes((1720, 960)), (1376, 768))
    finally:
        fc.crop_to_ratio = original_crop_to_ratio
    assert native == (1720, 960)
    assert err == 0
    assert not crop_called
    assert Image.open(io.BytesIO(out)).size == (1376, 768)


def test_normalization_crops_to_an_exact_ratio():
    import io
    import forge_codex as fc
    from PIL import Image
    # 1659x948 is WIDER-than-target?  target 16:9 = 1.7917, native = 1.7500 -> too TALL, crop height
    cropped = fc.crop_to_ratio(Image.open(io.BytesIO(_png_bytes((1659, 948)))), 1376 / 768)
    assert abs(cropped.size[0] / cropped.size[1] - 1376 / 768) == 0


def test_crop_to_ratio_eliminates_the_52_by_29_rounding_residual():
    import io
    import forge_codex as fc
    from PIL import Image

    target_ratio = 1376 / 768
    source = Image.open(io.BytesIO(_png_bytes((52, 29))))
    cropped = fc.crop_to_ratio(source, target_ratio)
    residual = abs(cropped.size[0] / cropped.size[1] - target_ratio)
    unfixed_residual = abs(52 / 29 - target_ratio)

    assert residual <= max(1 / cropped.size[0], 1 / cropped.size[1])
    assert residual < unfixed_residual


def test_crop_to_ratio_stays_within_the_one_pixel_quantization_bound():
    import forge_codex as fc
    from PIL import Image

    target_ratio = 1376 / 768
    for width in range(20, 81):
        for height in range(20, 81):
            cropped = fc.crop_to_ratio(Image.new("RGB", (width, height)), target_ratio)
            residual = abs(cropped.size[0] / cropped.size[1] - target_ratio)
            assert residual <= max(1 / cropped.size[0], 1 / cropped.size[1]), (
                f"{width}x{height} cropped to {cropped.size} leaves residual {residual}"
            )


def test_normalization_raises_ratio_error_beyond_tolerance():
    import forge_codex as fc
    raised = None
    try:
        fc.normalize_to_canvas(_png_bytes((1200, 900)), (1376, 768))
    except fc.RatioError as e:
        raised = str(e)
    assert raised is not None and "1200" in raised and "900" in raised


def test_normalization_rejects_invalid_bytes_before_touching_pillow():
    import forge_codex as fc
    raised = None
    try:
        fc.normalize_to_canvas(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200, (1376, 768))
    except RuntimeError as e:
        raised = str(e)
    assert raised is not None and "too small" in raised


def test_classify_turn_maps_every_documented_class():
    import forge_codex as fc
    ok = {"timed_out": False, "returncode": 0, "thread_id": "t", "events": []}
    assert fc.classify_turn(ok, ["a.png"]) is None
    assert fc.classify_turn(ok, []) == "no_image"
    assert fc.classify_turn(ok, ["a.png", "b.png"]) == "multi_emit"
    assert fc.classify_turn(dict(ok, timed_out=True), []) == "stall"
    assert fc.classify_turn(dict(ok, returncode=1), []) == "exec_failed"
    assert fc.classify_turn(dict(ok, thread_id=None), []) == "exec_failed"
    refuse = dict(ok, events=[{"type": "item.completed",
                               "item": {"type": "agent_message",
                                        "text": "I can't help with that."}}])
    assert fc.classify_turn(refuse, []) == "refusal"
    quota = dict(ok, events=[{"type": "item.completed",
                              "item": {"type": "agent_message",
                                       "text": "You've hit your usage limit."}}])
    assert fc.classify_turn(quota, []) == "quota"


def test_classify_turn_quoted_usage_limit_is_no_image():
    import forge_codex as fc
    ok = {"timed_out": False, "returncode": 0, "thread_id": "t"}
    for text in (
        "The prompt says 'usage limit' as a literal, but the tool returned no image.",
        'The reference says "You\'ve hit your usage limit."',
    ):
        result = dict(ok, events=[{"type": "item.completed", "item": {"type": "agent_message",
                      "text": text}}])
        assert fc.classify_turn(result, []) == "no_image"


def test_classify_turn_quoted_refusal_is_no_image():
    import forge_codex as fc
    ok = {"timed_out": False, "returncode": 0, "thread_id": "t"}
    for text in (
        "The brief says 'I can't help' is a phrase to avoid.",
        'The brief says "I cannot help" is a phrase to avoid.',
    ):
        result = dict(ok, events=[{"type": "item.completed", "item": {"type": "agent_message",
                      "text": text}}])
        assert fc.classify_turn(result, []) == "no_image"


def test_classify_turn_try_again_later_is_no_image():
    import forge_codex as fc
    ok = {"timed_out": False, "returncode": 0, "thread_id": "t"}
    result = dict(ok, events=[{"type": "item.completed",
                               "item": {"type": "agent_message", "text": "Try again later."}}])
    assert fc.classify_turn(result, []) == "no_image"


def test_generate_happy_path_returns_canvas_bytes_and_full_metadata():
    import io
    from PIL import Image
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    data, meta = fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768),
                             name="L29")
    assert Image.open(io.BytesIO(data)).size == (1376, 768)
    assert meta["native"] == [1672, 941]
    assert meta["canvas"] == [1376, 768]
    assert meta["reissues"] == 0 and meta["failure_class"] is None
    assert meta["fidelity_audit"] == "verified"
    assert meta["pre_call_tool_calls"] == 3
    assert meta["source_png"].endswith(".png") and len(meta["source_sha256"]) == 64
    assert meta["usage"]["input_tokens"] == 75742
    assert meta["turn_index"] == 1 and meta["session_mode"] == "isolated"


def test_generate_reissues_once_on_no_image_then_gives_up():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("no_image", tmp)
    raised = None
    try:
        fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29",
                    poll_delay=0.05)
    except fc.CodexRunError as e:
        raised = e
    assert raised is not None and raised.failure_class == "no_image"
    assert raised.reissues == 1, "exactly ONE transport re-issue, ever"


def test_generate_does_not_reissue_refusal_quota_or_multi_emit():
    tmp, prompt, seed = _scratch()
    for mode, cls in (("refuse", "refusal"), ("quota", "quota"), ("two_images", "multi_emit")):
        fc = _fc_with_roots(mode, tmp)
        raised = None
        try:
            fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768),
                        name="L29", poll_delay=0.05)
        except fc.CodexRunError as e:
            raised = e
        assert raised is not None and raised.failure_class == cls, mode
        assert raised.reissues == 0, mode


def test_generate_publishes_a_mismatch_frame_but_marks_it():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("paraphrase", tmp)
    data, meta = fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768),
                             name="L29")
    assert data and meta["fidelity_audit"] == "mismatch"
    assert meta["failure_class"] is None, "a mismatch is marked, never discarded"


def test_generate_raises_ratio_without_a_transport_reissue():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("wrong_ratio", tmp)
    raised = None
    try:
        fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29")
    except fc.CodexRunError as e:
        raised = e
    assert raised is not None and raised.failure_class == "ratio" and raised.reissues == 0


def test_generate_raises_on_invalid_bytes_with_no_reissue():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("tiny_png", tmp)
    raised = None
    try:
        fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29")
    except fc.CodexRunError as e:
        raised = e
    assert raised is not None and raised.failure_class == "invalid_bytes" and raised.reissues == 0


def test_generate_transport_reissue_reuses_envelope_but_not_thread():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("no_image", tmp)
    original_run_codex_exec = fc.run_codex_exec
    calls = []

    def spy_run_codex_exec(**kwargs):
        result = original_run_codex_exec(**kwargs)
        calls.append((kwargs["envelope"], kwargs["resume_thread"]))
        return result

    fc.run_codex_exec = spy_run_codex_exec
    try:
        try:
            fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29",
                        poll_delay=0.05)
        except fc.CodexRunError:
            pass
    finally:
        fc.run_codex_exec = original_run_codex_exec
    assert len(calls) == 2
    assert calls[0][0] == calls[1][0]
    assert calls[0][1] is None and calls[1][1] is None

    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    original_run_codex_exec = fc.run_codex_exec
    calls = []

    def spy_stalled_after_image(**kwargs):
        calls.append(kwargs)
        return dict(original_run_codex_exec(**kwargs), timed_out=True)

    fc.run_codex_exec = spy_stalled_after_image
    raised = None
    try:
        try:
            fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29",
                        poll_delay=0.05)
        except fc.CodexRunError as e:
            raised = e
    finally:
        fc.run_codex_exec = original_run_codex_exec
    assert raised is not None and raised.failure_class == "stall" and raised.reissues == 0
    assert len(calls) == 1, "an emitted image forbids the transport re-issue"


def _meta_stub():
    return {"thread_id": "019ffabc-1111-7222-3333-444455556666", "turn_index": 1,
            "session_mode": "isolated", "wall_s": 107.4,
            "usage": {"input_tokens": 75742, "cached_input_tokens": 48384,
                      "output_tokens": 1593, "reasoning_output_tokens": 742},
            "native": [1672, 941], "canvas": [1376, 768], "ratio_error": 0.0039, "reissues": 0,
            "source_png": "C:/Users/x/.codex/generated_images/019ffabc/exec-5a2c2c62.png",
            "source_sha256": "a" * 64, "fidelity_audit": "verified", "fidelity_sha256": "b" * 64,
            "pre_call_tool_calls": 3, "failure_class": None}


def test_engine_log_row_carries_every_documented_key():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="log-"))
    composed = fc.write_prompt_file(str(tmp), "L29", L29_GOLDEN)
    row = fc.build_log_row(name="L29", meta=_meta_stub(), composed_path=composed,
                           composed_text=L29_GOLDEN, seed_shas={"C:/k/a.png": "c" * 64},
                           residual=[], kit_root=str(tmp))
    for key in fc.LOG_KEYS:
        assert key in row, key
    assert set(row) == set(fc.LOG_KEYS)
    assert row["engine"] == "codex-imagegen" and row["name"] == "L29"
    assert row["tokens_in"] == 75742 and row["tokens_cached"] == 48384
    assert row["tokens_out"] == 1593 and row["reasoning_out"] == 742
    assert row["composed_chars"] == len(L29_GOLDEN)
    assert row["composed_prompt_sha256"] == \
        __import__("hashlib").sha256(L29_GOLDEN.encode("utf-8")).hexdigest()
    assert row["composed_prompt"].endswith("_codex/prompts/L29.txt")
    assert row["seed_sha256"] == {"C:/k/a.png": "c" * 64}
    assert row["residual_idiom"] == [] and row["failure_class"] is None
    assert row["ts"].endswith("Z")


def test_engine_log_is_append_only_jsonl():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="log-"))
    path = fc.engine_log_path(str(tmp))
    fc.append_log_row(path, {"name": "L26"})
    fc.append_log_row(path, {"name": "L29"})
    rows = [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    assert [r["name"] for r in rows] == ["L26", "L29"]
    assert Path(path) == tmp / "_codex" / "engine-log.jsonl"


def test_rel_to_kit_ignores_windows_drive_letter_case():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="kit-"))
    inside = str(tmp / "_codex" / "prompts" / "L29.txt")
    swapped = inside[0].swapcase() + inside[1:]
    assert fc._rel_to_kit(swapped, str(tmp)) == "_codex/prompts/L29.txt"
    assert fc._rel_to_kit("D:/elsewhere/x.txt", str(tmp)) == "D:/elsewhere/x.txt"


def test_run_totals_names_every_non_verified_row():
    import forge_codex as fc
    rows = [dict(_meta_stub(), name="L26", tokens_in=1, tokens_cached=0, tokens_out=0,
                 reasoning_out=0, fidelity_audit="verified", pre_call_tool_calls=2),
            dict(_meta_stub(), name="L29", tokens_in=3, tokens_cached=0, tokens_out=0,
                 reasoning_out=0, fidelity_audit="mismatch", pre_call_tool_calls=4)]
    text = fc.run_totals_text(rows)
    assert "2 frame" in text
    assert "L29" in text and "mismatch" in text
    assert "L26" not in text
    assert "mean pre_call_tool_calls 3.0" in text


def _kit_for_run(mode):
    """A dry Kit whose staging is an ARC-style directory outside the kit (kit read-only)."""
    import forge
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="runitem-"))
    kit, root = make_kit(tmp)
    k = forge.Kit(kit, dry=True)
    staging = tmp / "arc-staging"
    staging.mkdir()
    k.staging = str(staging)
    (tmp / "generated_images").mkdir()
    (tmp / "sessions").mkdir()
    fc.CODEX_ARGV_PREFIX = fake_prefix(mode, tmp / "generated_images", tmp / "sessions")
    fc.IMAGE_ROOT = str(tmp / "generated_images")
    fc.SESSIONS_ROOT = str(tmp / "sessions")
    seed = _png(tmp / "seed.png")
    return fc, k, tmp, staging, seed


def _assert_run_item_rejects_traversal(*, dry_run):
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    item = dict(_item_L29(), name="../../../escaped-c12")
    escaped = (staging / "_codex" / "prompts" / f"{item['name']}.txt").resolve()
    assert os.path.commonpath((str(escaped), str(staging.resolve()))) != str(staging.resolve())
    raised = None
    try:
        fc.run_item(k, item, [seed], fc.RunOptions(dry_run=dry_run))
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "filename stem" in raised
    assert not escaped.exists(), escaped
    assert list(staging.iterdir()) == []
    assert not (staging / "_codex" / "engine-log.jsonl").exists()


def test_run_item_dry_run_rejects_traversal_before_any_write():
    _assert_run_item_rejects_traversal(dry_run=True)


def test_run_item_live_rejects_traversal_before_any_write():
    _assert_run_item_rejects_traversal(dry_run=False)


def test_run_item_concurrent_loser_cannot_overwrite_winners_prompt():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    winner = dict(_item_L29(), payload=_item_L29()["payload"] + "\nWINNER REQUEST")
    loser = dict(_item_L29(), payload=_item_L29()["payload"] + "\nLOSER REQUEST")
    winner_text = fc.compose_prompt(winner, reg=k.reg, canvas=(1376, 768), aspect="16:9")
    ready = threading.Event()
    proceed = threading.Event()
    result = {}
    original_generate = fc.generate

    def blocked_generate(**kwargs):
        ready.set()
        assert proceed.wait(5), "loser never reached the reservation seam"
        result["tool_prompt"] = Path(kwargs["prompt_path"]).read_text(encoding="utf-8")
        return _png_bytes((1376, 768)), _meta_stub()

    def run_winner():
        try:
            result["winner"] = fc.run_item(k, winner, [seed], fc.RunOptions())
        except BaseException as e:
            result["exception"] = e

    fc.generate = blocked_generate
    thread = threading.Thread(target=run_winner)
    try:
        thread.start()
        assert ready.wait(5), "winner never reached generation"
        result["loser"] = fc.run_item(k, loser, [seed], fc.RunOptions())
        proceed.set()
        thread.join(5)
    finally:
        proceed.set()
        thread.join(5)
        fc.generate = original_generate
    assert not thread.is_alive()
    assert "exception" not in result, result.get("exception")
    winner_status, winner_row = result["winner"]
    loser_status, loser_row = result["loser"]
    assert winner_status == "OK"
    assert loser_status == "SKIP skip (reserved by concurrent generator)" and loser_row is None
    archive = staging / "_codex" / "prompts" / "L29.txt"
    assert archive.read_text(encoding="utf-8") == winner_text
    assert result["tool_prompt"] == winner_text
    assert winner_row["composed_prompt_sha256"] == hashlib.sha256(archive.read_bytes()).hexdigest()
    rows = [json.loads(line) for line in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1 and rows[0] == winner_row


def test_run_item_dry_run_does_not_clobber_an_existing_prompt_archive():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    archive = Path(fc.write_prompt_file(k.staging, "L29", "LIVE WINNER\n"))
    original = archive.read_bytes()
    item = dict(_item_L29(), payload=_item_L29()["payload"] + "\nDRY LOSER")
    status, row = fc.run_item(k, item, [seed], fc.RunOptions(dry_run=True))
    assert status == "DRY" and row is None
    assert archive.read_bytes() == original
    assert not (staging / "_codex" / "engine-log.jsonl").exists()


def test_run_item_seed_digest_failure_never_reserves_or_archives_and_is_retryable():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    original_seed_digests = fc.seed_digests

    def explode(_seeds):
        raise OSError("digest read exploded")

    fc.seed_digests = explode
    raised = None
    try:
        try:
            fc.run_item(k, _item_L29(), [seed], fc.RunOptions(keep_composed=False))
        except OSError as e:
            raised = str(e)
    finally:
        fc.seed_digests = original_seed_digests
    assert raised == "digest read exploded"
    out = forge._staging_png(k, "L29")
    assert not os.path.exists(out) and not os.path.exists(out + ".lock")
    assert not (staging / "_codex" / "prompts" / "L29.txt").exists()
    assert not (staging / "_codex" / "engine-log.jsonl").exists()
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status == "OK" and row is not None


def test_run_item_log_append_failure_rolls_back_output_before_retry():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    original_append_log_row = fc.append_log_row
    original_generate = fc.generate

    def explode(_path, _row):
        raise OSError("log disk full")

    def generated(**_kwargs):
        return _png_bytes((1376, 768)), _meta_stub()

    fc.generate = generated
    raised = None
    try:
        fc.append_log_row = explode
        try:
            try:
                fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
            except OSError as e:
                raised = str(e)
        finally:
            fc.append_log_row = original_append_log_row
        assert raised == "log disk full"
        out = forge._staging_png(k, "L29")
        assert not os.path.exists(out) and not os.path.exists(out + ".lock")
        assert not (staging / "_codex" / "engine-log.jsonl").exists()
        status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
        assert status == "OK" and row is not None
        rows = [json.loads(line) for line in
                (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
        assert len(rows) == 1 and rows[0] == row
    finally:
        fc.generate = original_generate


def test_run_item_close_after_durable_log_is_success_and_retry_skips():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    log = staging / "_codex" / "engine-log.jsonl"
    original_open = open
    original_generate = fc.generate

    class ClosePoison:
        def __init__(self, real):
            self.real = real

        def __getattr__(self, name):
            return getattr(self.real, name)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

        def close(self):
            self.real.close()
            raise OSError("close after durable log write")

    def poisoned_open(path, mode="r", *args, **kwargs):
        real = original_open(path, mode, *args, **kwargs)
        if os.fspath(path) == str(log) and mode == "a":
            return ClosePoison(real)
        return real

    def generated(**_kwargs):
        return _png_bytes((1376, 768)), _meta_stub()

    fc.open = poisoned_open
    fc.generate = generated
    try:
        status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    finally:
        fc.open = original_open
        fc.generate = original_generate
    assert status == "OK" and row is not None
    assert (staging / "L29.png").is_file()
    rows = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert rows == [row]
    status, retry_row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status.startswith("SKIP") and retry_row is None
    assert [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()] == [row]


def test_run_item_pre_fsync_log_failure_restores_exact_prior_bytes_then_retries():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    log = staging / "_codex" / "engine-log.jsonl"
    log.parent.mkdir(parents=True)
    before = b'{"preexisting": true}\n'
    log.write_bytes(before)
    original_open = open
    original_generate = fc.generate

    class WritePoison:
        def __init__(self, real):
            self.real = real

        def __getattr__(self, name):
            return getattr(self.real, name)

        def write(self, text):
            self.real.write(text[:len(text) // 2])
            raise OSError("log write poison")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return self.real.__exit__(*args)

    def poisoned_open(path, mode="r", *args, **kwargs):
        real = original_open(path, mode, *args, **kwargs)
        if os.fspath(path) == str(log) and mode == "a":
            return WritePoison(real)
        return real

    def generated(**_kwargs):
        return _png_bytes((1376, 768)), _meta_stub()

    fc.open = poisoned_open
    fc.generate = generated
    raised = None
    try:
        try:
            fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
        except OSError as e:
            raised = str(e)
    finally:
        fc.open = original_open
        fc.generate = original_generate
    assert raised == "log write poison"
    out = forge._staging_png(k, "L29")
    assert not os.path.exists(out) and not os.path.exists(out + ".lock")
    assert log.read_bytes() == before
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status == "OK" and row is not None
    assert [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()] == [
        {"preexisting": True}, row]


def test_run_item_live_archive_replaces_a_planted_symlink_without_touching_victim():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    archive = staging / "_codex" / "prompts" / "L29.txt"
    archive.parent.mkdir(parents=True)
    victim = tmp / "outside-symlink-victim.txt"
    before = b"outside symlink victim\n"
    victim.write_bytes(before)
    try:
        os.symlink(victim, archive)
    except OSError as e:
        # This Windows runner does not hold SeCreateSymbolicLinkPrivilege. The hard-link regression
        # below proves the same os.replace directory-entry behavior on this platform.
        if getattr(e, "winerror", None) == 1314:
            return
        raise
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status == "OK" and row is not None
    assert victim.read_bytes() == before
    assert archive.is_file() and not archive.is_symlink()
    assert archive.read_text(encoding="utf-8") == fc.compose_prompt(
        _item_L29(), reg=k.reg, canvas=(1376, 768), aspect="16:9")


def test_run_item_live_archive_replaces_a_planted_hardlink_without_touching_victim():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    archive = staging / "_codex" / "prompts" / "L29.txt"
    archive.parent.mkdir(parents=True)
    victim = tmp / "outside-hardlink-victim.txt"
    before = b"outside hardlink victim\n"
    victim.write_bytes(before)
    os.link(victim, archive)
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status == "OK" and row is not None
    assert victim.read_bytes() == before
    assert archive.is_file() and not archive.is_symlink() and not os.path.samefile(archive, victim)
    assert archive.read_text(encoding="utf-8") == fc.compose_prompt(
        _item_L29(), reg=k.reg, canvas=(1376, 768), aspect="16:9")


def test_run_item_rejects_a_planted_log_symlink_without_writing_the_victim():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    log = staging / "_codex" / "engine-log.jsonl"
    log.parent.mkdir(parents=True)
    victim = tmp / "outside-log-victim.jsonl"
    before = b"outside log victim\n"
    victim.write_bytes(before)
    original_lstat = fc.os.lstat
    try:
        os.symlink(victim, log)
    except OSError as e:
        if getattr(e, "winerror", None) != 1314:
            raise
        # Model the unprivileged-platform symlink metadata while retaining a real outside-write
        # target: current code appends to this hard-linked victim; fixed code rejects before open.
        os.link(victim, log)

        def symlink_lstat(path):
            if os.fspath(path) == str(log):
                actual = original_lstat(path)
                return os.stat_result((stat.S_IFLNK,) + tuple(actual)[1:])
            return original_lstat(path)

        fc.os.lstat = symlink_lstat
    raised = None
    try:
        fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    except fc.CodexContractError as e:
        raised = str(e)
    finally:
        fc.os.lstat = original_lstat
    assert raised is not None and "symlink" in raised
    assert victim.read_bytes() == before
    out = forge._staging_png(k, "L29")
    assert not os.path.exists(out) and not os.path.exists(out + ".lock")


def test_run_item_false_publish_reports_concurrent_survivor_and_logs_once():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    survivor = _png_bytes((1376, 768), colour=(11, 22, 33))
    original_publish = fc._publish_staging_png

    def concurrent_publish(_k, _name, out, _data, _force):
        Path(out).write_bytes(survivor)
        return False

    fc._publish_staging_png = concurrent_publish
    try:
        status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    finally:
        fc._publish_staging_png = original_publish
    assert status == "SKIP publish (concurrent survivor)" and row is not None
    assert (staging / "L29.png").read_bytes() == survivor
    rows = [json.loads(line) for line in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1 and rows[0] == row


def test_run_item_validates_generated_bytes_before_publish():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    data = _png_bytes((1376, 768))
    original_generate = fc.generate
    original_validate = fc.validate_png
    original_publish = fc._publish_staging_png
    order = []

    def generated(**_kwargs):
        return data, _meta_stub()

    def validating(candidate):
        order.append(("validate", candidate))
        return original_validate(candidate)

    def publishing(*args):
        order.append(("publish", args[3]))
        return original_publish(*args)

    fc.generate = generated
    fc.validate_png = validating
    fc._publish_staging_png = publishing
    try:
        status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    finally:
        fc.generate = original_generate
        fc.validate_png = original_validate
        fc._publish_staging_png = original_publish
    assert status == "OK" and row is not None
    assert order == [("validate", data), ("publish", data)]


def test_run_item_publishes_through_forge_primitives_and_logs_one_row():
    import io
    from PIL import Image
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    item = _item_L29()
    status, row = fc.run_item(k, item, [seed], fc.RunOptions())
    assert status == "OK", status
    out = forge._staging_png(k, "L29")
    assert os.path.isfile(out)
    assert Image.open(io.BytesIO(open(out, "rb").read())).size == (1376, 768)
    assert not os.path.exists(out + ".lock")
    assert (staging / "_codex" / "prompts" / "L29.txt").is_file()
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1 and rows[0]["name"] == "L29" and rows[0]["fidelity_audit"] == "verified"
    assert row["seed_sha256"] and list(row["seed_sha256"].values())[0]


def test_run_item_skips_an_existing_survivor_without_a_subprocess():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    (staging / "L29.png").write_bytes(_png_bytes((1376, 768)))
    fc.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status.startswith("SKIP")
    assert row is None
    assert forge._existing_staging_png(forge._staging_png(k, "L29")) is True


def test_run_item_force_overwrites_the_survivor():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    (staging / "L29.png").write_bytes(_png_bytes((900, 900)))
    status, _row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions(force=True))
    assert status == "OK"
    import io
    from PIL import Image
    assert Image.open(io.BytesIO((staging / "L29.png").read_bytes())).size == (1376, 768)


def test_run_item_respects_a_concurrent_lock():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    lock = forge._staging_png(k, "L29") + ".lock"
    Path(lock).write_text(json.dumps({"pid": os.getpid(), "token": "x",
                                      "created_at": __import__("time").time()}), encoding="utf-8")
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert "concurrent" in status and row is None
    assert not (staging / "L29.png").exists()


def test_a_failed_gen_leaves_no_file_and_no_stale_lock():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("no_image")
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions(keep_composed=False))
    assert status.startswith("ERR no_image"), status
    assert not (staging / "L29.png").exists()
    assert not os.path.exists(forge._staging_png(k, "L29") + ".lock")
    assert not (staging / "_codex" / "prompts" / "L29.txt").exists()
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    assert rows[0]["failure_class"] == "no_image" and rows[0]["reissues"] == 1


def test_dry_run_prints_the_prompt_and_spawns_no_subprocess():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    fc.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions(dry_run=True))
    assert status == "DRY" and row is None
    assert (staging / "_codex" / "prompts" / "L29.txt").is_file()
    assert not (staging / "L29.png").exists()
    assert not any(Path(tmp / "generated_images").rglob("*.png"))


def _spec_file(tmp, items):
    p = Path(tmp) / "spec.json"
    p.write_text(json.dumps(items), encoding="utf-8")
    return str(p)


def _runnable_item(name, payload_seed):
    it = _item_L29()
    it["name"] = name
    it["mode"] = "identity"
    it["seed"] = [payload_seed]
    it.pop("seed_roles")
    return it


def _cli_env(mode):
    fc, k, tmp, staging, seed = _kit_for_run(mode)
    return fc, k, tmp, staging, seed


def test_cli_shots_filter_consumes_only_the_named_items():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    rc = fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                  "--shots", "A1"])
    assert rc == 0
    assert (staging / "A1.png").is_file() and not (staging / "A2.png").exists()
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["name"] for r in rows] == ["A1"]


def test_cli_unknown_shot_id_raises_naming_it():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed)])
    raised = None
    try:
        fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                 "--shots", "A1,NOPE"])
    except SystemExit as e:
        raised = str(e)
    assert raised is not None and "NOPE" in raised


def test_cli_without_shots_consumes_the_whole_spec():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)]) == 0
    assert (staging / "A1.png").is_file() and (staging / "A2.png").is_file()


def test_cli_dry_run_spawns_zero_subprocesses_and_writes_no_png():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    fc.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    rc = fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging), "--dry-run"])
    assert rc == 0
    assert not list(staging.glob("*.png"))
    assert not list(Path(tmp / "generated_images").rglob("*.png"))
    assert (staging / "_codex" / "prompts" / "A1.txt").is_file()
    assert (staging / "_codex" / "prompts" / "A2.txt").is_file()
    assert not (staging / "_codex" / "engine-log.jsonl").exists()


def test_cli_split_run_isolation_over_one_spec():
    """§2.2: codex runs its subset; a Gemini-side publication of the other name is untouched and
    the codex log holds exactly one row."""
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                    "--shots", "A1"]) == 0
    (staging / "A2.png").write_bytes(_png_bytes((1376, 768)))     # the "Gemini half"
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["name"] for r in rows] == ["A1"]
    assert (staging / "A1.png").is_file() and (staging / "A2.png").is_file()
    assert not list(staging.glob("*.lock"))


def test_cli_reports_failures_with_a_nonzero_exit():
    fc, k, tmp, staging, seed = _cli_env("no_image")
    spec = _spec_file(tmp, [_runnable_item("A1", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)]) == 1


def test_cli_never_loads_a_key():
    """A tracing environ proves main() performs ZERO credential-key reads — absence of the key
    succeeding is not evidence (an os.environ.get would still succeed with it absent)."""
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed)])
    forbidden = {"GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CODEX_API_KEY"}
    reads = []

    class TracingEnviron(dict):
        def __getitem__(self, key):
            if key in forbidden:
                reads.append(("getitem", key))
            return super().__getitem__(key)

        def get(self, key, default=None):
            if key in forbidden:
                reads.append(("get", key))
            return super().get(key, default)

        def __contains__(self, key):
            if key in forbidden:
                reads.append(("contains", key))
            return super().__contains__(key)

    saved = os.environ
    os.environ = TracingEnviron({k_: v_ for k_, v_ in saved.items()
                                 if k_ not in forbidden})
    try:
        rc = fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)])
    finally:
        os.environ = saved
    assert rc == 0
    assert reads == [], f"main() read credential keys: {reads}"


def test_session_reuses_one_thread_and_harvests_turn_two():
    fc, k, tmp, staging, seed = _kit_for_run("resume_ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    rc = fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                  "--session-mode", "session"])
    assert rc == 0
    assert (staging / "A1.png").is_file() and (staging / "A2.png").is_file()
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["name"] for r in rows] == ["A1", "A2"]
    assert rows[0]["thread_id"] == rows[1]["thread_id"], "turn 2 must reuse the thread"
    assert [r["turn_index"] for r in rows] == [1, 2]
    assert all(r["session_mode"] == "session" for r in rows)


def test_session_span_starts_a_fresh_thread_after_n_turns():
    fc, k, tmp, staging, seed = _kit_for_run("resume_ok")
    spec = _spec_file(tmp, [_runnable_item(f"A{i}", seed) for i in range(3)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                    "--session-mode", "session", "--session-span", "2"]) == 0
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[0]["thread_id"] == rows[1]["thread_id"]
    assert rows[2]["thread_id"] != rows[1]["thread_id"]
    assert [r["turn_index"] for r in rows] == [1, 2, 1]


def test_session_object_records_and_resets():
    import forge_codex as fc
    s = fc.Session(span=2)
    assert s.thread_id is None and s.turns == 0 and s.exhausted() is False
    s.record("t1")
    assert s.thread_id == "t1" and s.turns == 1 and s.exhausted() is False
    s.record("t1")
    assert s.turns == 2 and s.exhausted() is True
    s.reset()
    assert s.thread_id is None and s.turns == 0 and s.fallbacks == 1


def test_isolated_mode_uses_a_fresh_thread_per_frame():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)]) == 0
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[0]["thread_id"] != rows[1]["thread_id"]
    assert all(r["session_mode"] == "isolated" and r["turn_index"] == 1 for r in rows)


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
