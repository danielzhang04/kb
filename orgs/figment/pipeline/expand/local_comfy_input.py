"""Offline manifest builder for one reviewed local ComfyUI diagnostic.

The default command validates the immutable local prerequisites and prints a plan.  It
never starts ComfyUI, opens a network connection, or creates an image.  --execute is
kept behind an explicit flag for a separately admitted, local-only run.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

SCHEMA = "figment/local-comfy-input@1"
COMFY_ROOT = Path(r"C:\Users\danie\tools\ComfyUI")
COMFY_COMMIT = "95d755cd8107a72258d452b5d3657273d571f07d"
NODE_DIR = COMFY_ROOT / "custom_nodes" / "ComfyUI_IPAdapter_plus"
NODE_COMMIT = "a0f451a5113cf9becb0847b92884cb10cbdec0ef"
PORT = 8190
COMFY_PYTHON = COMFY_ROOT / "venv" / "Scripts" / "python.exe"
WORKSPACE_PRIVATE_ROOT = Path(r"C:\Users\danie\kb\_private")
MAX_STARTUP_LOG_BYTES = 16 * 1024
SEED = 481516234
WIDTH = HEIGHT = 1024
MAX_HTTP_BYTES = 64 * 1024
POLL_SECONDS = 600
CANONICAL = "orgs/figment/personas/creator-001/anchors/g01.jpg"
CANONICAL_SHA256 = "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed"
PERSONA = "orgs/figment/personas/creator-001/persona.yaml"
MAX_PERSONA_BYTES = 128 * 1024
NEGATIVE = "child, minor, nude, lingerie, explicit, extra person, distorted face"
MODELS = {
    "checkpoint": {
        "filename": "RealVisXL_V5.0_fp16.safetensors",
        "path": COMFY_ROOT / "models" / "checkpoints" / "RealVisXL_V5.0_fp16.safetensors",
        "sha256": "6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80",
    },
    "ipadapter": {
        "filename": "ip-adapter-plus-face_sdxl_vit-h.safetensors",
        "path": COMFY_ROOT / "models" / "ipadapter" / "ip-adapter-plus-face_sdxl_vit-h.safetensors",
        "sha256": "677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1",
    },
    "clip_vision": {
        "filename": "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
        "path": COMFY_ROOT / "models" / "clip_vision" / "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
        "sha256": "6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030",
    },
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024
HEX = re.compile(r"^[0-9a-f]{64}$")

class LocalComfyError(RuntimeError):
    pass

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def _is_reparse(path: Path) -> bool:
    try:
        return path.is_symlink() or bool(os.lstat(path).st_file_attributes & 0x400)
    except AttributeError:
        return path.is_symlink()

def safe_existing(path: Path) -> Path:
    """Resolve only after every supplied existing component rejects reparse links."""
    supplied = path.absolute()
    cursor = supplied
    while True:
        if cursor.exists() and _is_reparse(cursor):
            raise LocalComfyError(f"reparse point refused: {cursor}")
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    return supplied.resolve(strict=True)

def checked_file(path: Path, expected: str, *, limit: int | None = None) -> dict[str, Any]:
    if not HEX.fullmatch(expected):
        raise LocalComfyError("invalid expected hash")
    try:
        safe_existing(path)
    except FileNotFoundError as exc:
        raise LocalComfyError(f"missing pinned file: {path.name}") from exc
    if not path.is_file():
        raise LocalComfyError(f"pinned path is not a file: {path.name}")
    size = path.stat().st_size
    if limit is not None and size > limit:
        raise LocalComfyError(f"file exceeds bound: {path.name}")
    actual = sha256_file(path)
    if actual != expected:
        raise LocalComfyError(f"pinned hash mismatch: {path.name}")
    return {"path": str(path), "bytes": size, "sha256": actual}

def git_head(root: Path) -> str:
    result = subprocess.run(["git", "-c", f"safe.directory={root}", "-C", str(root), "rev-parse", "HEAD"], check=False,
                            shell=False, text=True, capture_output=True, timeout=10)
    if result.returncode:
        raise LocalComfyError("cannot read installed code pin")
    return result.stdout.strip()

def git_clean(root: Path) -> bool:
    result = subprocess.run(["git", "-c", f"safe.directory={root}", "-C", str(root), "status", "--porcelain", "--untracked-files=no"], check=False,
                            shell=False, text=True, capture_output=True, timeout=10)
    return result.returncode == 0 and not result.stdout.strip()

def _persona_prompt(repo_root: Path) -> tuple[str, dict[str, str]]:
    """Use Figment's tester-age helper on exact bytes, never a generic age phrase."""
    persona_path = repo_root / PERSONA
    try:
        safe_path = safe_existing(persona_path)
        with safe_path.open("rb") as handle:
            raw = handle.read(MAX_PERSONA_BYTES + 1)
    except FileNotFoundError as exc:
        raise LocalComfyError("missing creator persona") from exc
    if not raw or len(raw) > MAX_PERSONA_BYTES:
        raise LocalComfyError("persona exceeds bound")
    try:
        persona = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LocalComfyError("persona is not valid JSON") from exc
    helper_path = Path(__file__).resolve().parents[1] / "figment_train.py"
    spec = importlib.util.spec_from_file_location("figment_local_comfy_age_helper", helper_path)
    if spec is None or spec.loader is None:
        raise LocalComfyError("tester age helper unavailable")
    helper_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper_module)
    try:
        age_stage = helper_module._tester_age_stage(persona)
    except Exception as exc:
        raise LocalComfyError("persona age wording is not safe for tester prompt") from exc
    look = persona.get("identity", {}).get("look") if isinstance(persona, dict) else None
    hair = look.get("hair") if isinstance(look, dict) else None
    eyes = look.get("eyes") if isinstance(look, dict) else None
    if not isinstance(hair, str) or not hair.strip() or not isinstance(eyes, str) or not eyes.strip():
        raise LocalComfyError("persona hair and eye wording is required")
    prompt = (
        f"Shoulders-up portrait photograph of {age_stage}. {hair.strip()}, {eyes.strip()}. "
        "Clothed in the original black opaque strapped top, in the same bedroom setting "
        "as the sole reference image. Natural skin texture with visible pores, photographic realism."
    )
    return prompt, {"repo_path": PERSONA, "sha256": hashlib.sha256(raw).hexdigest(), "age_stage": age_stage,
                    "hair": hair.strip(), "eyes": eyes.strip(), "tester_age_helper_sha256": sha256_file(helper_path)}

def _workflow(input_name: str, positive: str) -> dict[str, dict[str, Any]]:
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": MODELS["checkpoint"]["filename"]}},
        "2": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "3": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": MODELS["clip_vision"]["filename"]}},
        "4": {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": MODELS["ipadapter"]["filename"]}},
        "5": {"class_type": "IPAdapterAdvanced", "inputs": {"model": ["1", 0], "ipadapter": ["4", 0], "image": ["2", 0], "clip_vision": ["3", 0], "weight": 0.65, "weight_type": "linear", "combine_embeds": "average", "start_at": 0.0, "end_at": 1.0, "embeds_scaling": "V only"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["1", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["1", 1]}},
        "8": {"class_type": "EmptyLatentImage", "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1}},
        "9": {"class_type": "KSampler", "inputs": {"model": ["5", 0], "seed": SEED, "steps": 24, "cfg": 6.0, "sampler_name": "dpmpp_2m", "scheduler": "karras", "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["8", 0], "denoise": 1.0}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["1", 2]}},
        "11": {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": "figment-local-comfy-input"}},
    }

def validate_static_install(repo_root: Path) -> dict[str, Any]:
    comfy = safe_existing(COMFY_ROOT)
    node = safe_existing(NODE_DIR)
    if (git_head(comfy) != COMFY_COMMIT or git_head(node) != NODE_COMMIT
            or not git_clean(comfy) or not git_clean(node)):
        raise LocalComfyError("installed code pin or clean-state mismatch")
    source = repo_root / CANONICAL
    source_info = checked_file(source, CANONICAL_SHA256, limit=MAX_IMAGE_BYTES)
    pins = {name: checked_file(item["path"], item["sha256"]) for name, item in MODELS.items()}
    text = (node / "IPAdapterPlus.py").read_text(encoding="utf-8")
    for node_name in ("IPAdapterModelLoader", "IPAdapterAdvanced"):
        if f'"{node_name}":' not in text:
            raise LocalComfyError(f"installed custom node mapping missing {node_name}")
    return {"source": source_info, "models": pins}

def build_manifest(repo_root: Path) -> dict[str, Any]:
    verified = validate_static_install(repo_root)
    positive, persona = _persona_prompt(repo_root)
    workflow = _workflow("g01.jpg", positive)
    workflow_bytes = json.dumps(workflow, sort_keys=True, separators=(",", ":")).encode()
    return {
        "schema": SCHEMA,
        "mode": "offline-plan-only",
        "execution_requires_parent_review": True,
        "diagnostic_only": True,
        "not_a_fair_krea_causal_comparison": True,
        "launcher": {"path": Path(__file__).name, "sha256": sha256_file(Path(__file__))},
        "comfyui": {"root": str(COMFY_ROOT), "git_commit": COMFY_COMMIT, "loopback_port": PORT},
        "custom_node": {"directory": "ComfyUI_IPAdapter_plus", "git_commit": NODE_COMMIT, "license": "GPL-3.0"},
        "reference": {"repo_path": CANONICAL, **verified["source"], "sole_pixel_reference": True},
        "persona": persona,
        "models": verified["models"],
        "prompt": {"positive": positive, "negative": NEGATIVE, "sha256": hashlib.sha256((positive + "\n" + NEGATIVE).encode()).hexdigest()},
        "workflow": {"api_prompt": workflow, "sha256": hashlib.sha256(workflow_bytes).hexdigest()},
        "generation": {"seed": SEED, "width": WIDTH, "height": HEIGHT, "images": 1,
                       "sampler": "dpmpp_2m", "scheduler": "karras", "steps": 24,
                       "steps_rationale": "first availability smoke only; not an exhaustive quality setting"},
        "runtime": {"listen": "127.0.0.1", "port": PORT, "deadline_seconds": POLL_SECONDS, "external_http": False,
                    "flags": ["--disable-api-nodes", "--disable-all-custom-nodes", "--whitelist-custom-nodes", "ComfyUI_IPAdapter_plus", "--disable-auto-launch"]},
    }

def _workspace_private_root(_repo_root: Path) -> Path:
    """The write namespace is fixed; --repo-root selects only immutable inputs."""
    root = safe_existing(WORKSPACE_PRIVATE_ROOT)
    if root.name.casefold() != "_private":
        raise LocalComfyError("configured private root is invalid")
    return root

def _fresh_run_root(path: Path, private_root: Path) -> Path:
    path = path.absolute()
    if path.exists():
        raise LocalComfyError("run root must be fresh")
    if path.parent != private_root or not path.name.startswith("figment-local-comfy-"):
        raise LocalComfyError("run root must be an immediate fresh child of the workspace private root")
    safe_existing(private_root)
    return path

def _port_available() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        if probe.connect_ex(("127.0.0.1", PORT)) == 0:
            raise LocalComfyError(f"refusing occupied port {PORT}")

def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")

def _no_redirect(request: Any, *_args: Any, **_kwargs: Any) -> Any:
    raise urllib.error.HTTPError(request.full_url, 302, "redirect refused", request.headers, None)

def _loopback_opener() -> Any:
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        redirect_request = staticmethod(_no_redirect)
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def _local_json(opener: Any, method: str, endpoint: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if not endpoint.startswith("/") or "://" in endpoint or "\\" in endpoint:
        raise LocalComfyError("unsafe local endpoint")
    data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}{endpoint}", data=data,
                                     headers={"Content-Type": "application/json"} if data else {}, method=method)
    with opener.open(request, timeout=5) as response:
        body = response.read(MAX_HTTP_BYTES + 1)
    if len(body) > MAX_HTTP_BYTES:
        raise LocalComfyError("local ComfyUI response exceeds bound")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LocalComfyError("local ComfyUI returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise LocalComfyError("local ComfyUI returned invalid JSON shape")
    return parsed

def _listener_pid() -> int | None:
    result = subprocess.run(["netstat", "-ano", "-p", "tcp"], check=False, shell=False,
                            text=True, capture_output=True, timeout=10)
    if result.returncode:
        return None
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 5 and fields[0].upper() == "TCP" and fields[1] == f"127.0.0.1:{PORT}" and fields[3].upper() == "LISTENING":
            try:
                return int(fields[-1])
            except ValueError:
                return None
    return None

def _require_owned_listener(process: Any) -> None:
    if process.poll() is not None or _listener_pid() != process.pid:
        raise LocalComfyError("local listener is not owned by this ComfyUI process")

def _wait_for_owned_listener(process: Any, deadline: float) -> None:
    while time.monotonic() < deadline:
        try:
            _require_owned_listener(process)
            return
        except LocalComfyError:
            if process.poll() is not None:
                raise LocalComfyError("owned ComfyUI process exited before listener readiness")
        time.sleep(0.25)
    raise LocalComfyError("owned ComfyUI listener did not become ready before deadline")

def _completed_output(history: dict[str, Any], prompt_id: str, output: Path) -> dict[str, Any] | None:
    entry = history.get(prompt_id)
    if not isinstance(entry, dict):
        return None
    status = entry.get("status")
    if isinstance(status, dict) and status.get("status_str") == "error":
        raise LocalComfyError("local ComfyUI reported a generation error")
    outputs = entry.get("outputs")
    if not isinstance(outputs, dict):
        return None
    saved = outputs.get("11")
    images = saved.get("images") if isinstance(saved, dict) else None
    if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict):
        raise LocalComfyError("local ComfyUI did not report exactly one output image")
    image_record = images[0]
    filename = image_record.get("filename")
    if image_record.get("type") != "output" or image_record.get("subfolder") != "":
        raise LocalComfyError("local ComfyUI returned a non-root output image")
    if not isinstance(filename, str) or Path(filename).name != filename or Path(filename).suffix.lower() != ".png":
        raise LocalComfyError("local ComfyUI returned an unsafe output filename")
    image = output / filename
    safe_output = safe_existing(output)
    try:
        safe_image = safe_existing(image)
    except FileNotFoundError:
        return None
    if not safe_image.is_relative_to(safe_output):
        raise LocalComfyError("local output escaped owned directory")
    with safe_image.open("rb") as handle:
        image_bytes = handle.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise LocalComfyError("local output exceeds byte bound")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(image_bytes)) as decoded:
            if decoded.format != "PNG" or decoded.size != (WIDTH, HEIGHT):
                raise LocalComfyError("local output has wrong format or dimensions")
            decoded.load()
    except LocalComfyError:
        raise
    except Exception as exc:
        raise LocalComfyError("local output is not a valid PNG") from exc
    return {"filename": filename, "bytes": len(image_bytes), "sha256": hashlib.sha256(image_bytes).hexdigest(), "dimensions": [WIDTH, HEIGHT]}

def _isolated_environment(root: Path) -> dict[str, str]:
    names = ("SYSTEMROOT", "WINDIR", "COMSPEC", "PATH")
    env = {name: os.environ[name] for name in names if name in os.environ}
    cache = root / "cache"
    cache.mkdir()
    env.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "TEMP": str(root / "temp"), "TMP": str(root / "temp"), "HOME": str(root / "home"), "USERPROFILE": str(root / "home"), "LOCALAPPDATA": str(cache), "APPDATA": str(cache), "HF_HOME": str(cache / "hf"), "TRANSFORMERS_CACHE": str(cache / "transformers"), "TORCH_HOME": str(cache / "torch"), "XDG_CACHE_HOME": str(cache / "xdg")})
    return env

def _bounded_stderr(process: Any, path: Path) -> tuple[Any | None, Any | None]:
    path.touch()
    stream = getattr(process, "stderr", None)
    if stream is None:
        return None, None
    handle = path.open("wb")
    def pump() -> None:
        remaining = MAX_STARTUP_LOG_BYTES
        for chunk in iter(lambda: stream.read(1024), b""):
            if remaining:
                kept = chunk[:remaining]
                handle.write(kept)
                remaining -= len(kept)
        handle.flush()
    thread = threading.Thread(target=pump, daemon=True)
    thread.start()
    return thread, handle

def _teardown(process: Any) -> dict[str, Any]:
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)
    if process.poll() is None:
        raise LocalComfyError("owned ComfyUI process did not terminate")
    return {"pid": process.pid, "verified_stopped": True, "returncode": process.poll()}

def execute(repo_root: Path, run_root: Path) -> dict[str, Any]:
    """Explicit local-only execution; intentionally never called by the default CLI."""
    manifest = build_manifest(repo_root)
    _port_available()
    root = _fresh_run_root(run_root, _workspace_private_root(repo_root))
    root.mkdir()
    for name in ("input", "output", "temp", "user", "home"):
        (root / name).mkdir()
    copied = root / "input" / "g01.jpg"
    shutil.copyfile(repo_root / CANONICAL, copied)
    if sha256_file(copied) != CANONICAL_SHA256:
        raise LocalComfyError("copied source hash mismatch")
    manifest_bytes = json.dumps(manifest, indent=2, sort_keys=True).encode() + b"\n"
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    (root / "manifest.json").write_bytes(manifest_bytes)
    journal = {"schema": SCHEMA, "status": "prepared", "manifest_sha256": manifest_sha,
               "pins": {"reference": manifest["reference"]["sha256"], "persona": manifest["persona"]["sha256"],
                        "models": {name: pin["sha256"] for name, pin in manifest["models"].items()},
                        "comfyui": COMFY_COMMIT, "custom_node": NODE_COMMIT, "workflow": manifest["workflow"]["sha256"]}}
    _write_json(root / "journal.json", journal)
    if not COMFY_PYTHON.is_file():
        raise LocalComfyError("installed ComfyUI virtualenv python is unavailable")
    command = [str(COMFY_PYTHON), "main.py", "--listen", "127.0.0.1", "--port", str(PORT), "--input-directory", str(root / "input"), "--output-directory", str(root / "output"), "--temp-directory", str(root / "temp"), "--user-directory", str(root / "user"), "--disable-api-nodes", "--disable-all-custom-nodes", "--whitelist-custom-nodes", "ComfyUI_IPAdapter_plus", "--disable-auto-launch"]
    process = None
    stderr_thread = stderr_handle = None
    completed: dict[str, Any] | None = None
    prompt_id: str | None = None
    failure: Exception | None = None
    teardown: dict[str, Any] = {"pid": None, "verified_stopped": False}
    try:
        process = subprocess.Popen(command, cwd=COMFY_ROOT, shell=False, env=_isolated_environment(root), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        stderr_thread, stderr_handle = _bounded_stderr(process, root / "startup.stderr.log")
        journal.update({"status": "started", "child_pid": process.pid})
        _write_json(root / "journal.json", journal)
        deadline = time.monotonic() + POLL_SECONDS
        _wait_for_owned_listener(process, deadline)
        opener = _loopback_opener()
        marker = root / "dispatch-attempt.json"
        marker.write_text(json.dumps({"schema": SCHEMA, "manifest_sha256": manifest_sha, "attempt": 1}) + "\n", encoding="utf-8")
        _require_owned_listener(process)
        queued = _local_json(opener, "POST", "/prompt", {"prompt": manifest["workflow"]["api_prompt"], "client_id": uuid.uuid4().hex})
        candidate = queued.get("prompt_id")
        if not isinstance(candidate, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", candidate):
            raise LocalComfyError("local prompt response missing safe id")
        prompt_id = candidate
        journal.update({"status": "queued", "prompt_id": prompt_id})
        _write_json(root / "journal.json", journal)
        while time.monotonic() < deadline:
            _require_owned_listener(process)
            completed = _completed_output(_local_json(opener, "GET", f"/history/{prompt_id}"), prompt_id, root / "output")
            if completed is not None:
                break
            time.sleep(0.5)
        if completed is None:
            raise LocalComfyError("local ComfyUI did not complete before deadline")
    except Exception as exc:
        failure = exc
        raise
    finally:
        if process is not None:
            try:
                teardown = _teardown(process)
            except Exception as teardown_error:
                teardown = {"pid": process.pid, "verified_stopped": False, "error_class": type(teardown_error).__name__}
                if failure is None:
                    failure = teardown_error
        if stderr_thread is not None:
            stderr_thread.join(timeout=2)
        if stderr_handle is not None:
            stderr_handle.close()
        if failure is not None:
            journal.update({"status": "failed", "error_class": type(failure).__name__, "prompt_id": prompt_id, "teardown": teardown})
            _write_json(root / "journal.json", journal)
    if failure is not None:
        raise failure
    receipt = {"schema": SCHEMA, "status": "completed", "manifest_sha256": manifest_sha,
               "prompt_id": prompt_id, "output": completed, "teardown": teardown}
    _write_json(root / "receipt.json", receipt)
    _write_json(root / "journal.json", receipt)
    return {"run_root": str(root), **receipt}

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--execute", action="store_true", help="requires separate parent review; starts only owned local ComfyUI")
    parser.add_argument("--run-root", type=Path)
    args = parser.parse_args(argv)
    if args.execute:
        if args.run_root is None:
            parser.error("--execute requires --run-root")
        print(json.dumps(execute(args.repo_root.resolve(), args.run_root), sort_keys=True))
    else:
        print(json.dumps(build_manifest(args.repo_root.resolve()), indent=2, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

