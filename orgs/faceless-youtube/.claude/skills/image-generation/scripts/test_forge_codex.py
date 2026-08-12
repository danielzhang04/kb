#!/usr/bin/env python3
"""Unit tests for forge_codex.py + the fake codex binary fixture.
Plain asserts, no pytest (house style). Run: py -3 test_forge_codex.py
NO NETWORK, NO API SPEND: every codex invocation in this file is _fake_codex.py."""
import json
import os
import subprocess
import sys
import tempfile
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
    prompt.write_text("Use case: illustration-story\nAvoid: photorealism\n", encoding="utf-8")
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
    proc = subprocess.Popen(fake_prefix("stall", tmp / "generated_images", tmp / "sessions")
                            + ["exec", "--json", "--skip-git-repo-check", "--sandbox",
                               "workspace-write", "--cd", str(tmp), env],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        timed_out = False
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            timed_out = True
        assert timed_out is True
    finally:
        proc.kill()
        proc.wait(timeout=10)


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
    import inspect
    import forge
    import forge_codex  # noqa: F401
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
    r = subprocess.run([sys.executable, "-c",
                        "import sys; sys.path.insert(0, r'%s'); import forge, forge_codex" % HERE],
                       cwd=str(tmp), capture_output=True, text=True)
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


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
