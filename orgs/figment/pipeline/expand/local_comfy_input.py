"""Offline manifest builder for one reviewed local ComfyUI diagnostic.

The default command validates the immutable local prerequisites and prints a plan.  It
never starts ComfyUI, opens a network connection, or creates an image.  --execute is
kept behind an explicit flag for a separately admitted, local-only run.
"""
from __future__ import annotations

import argparse
import copy
import ctypes
from ctypes import wintypes
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
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

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
FULL_CONDITIONING = "full"
FACE_CROP_CONDITIONING = "face-crop384"
BASELINE_PROMPT_PROFILE = "baseline"
SIMPLE_PORTRAIT_PROMPT_PROFILE = "simple-portrait-v1"
PROMPT_PROFILES = (BASELINE_PROMPT_PROFILE, SIMPLE_PORTRAIT_PROMPT_PROFILE)
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
TH32CS_SNAPPROCESS = 0x00000002
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_TERMINATE = 0x0001
SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0 = 0
WAIT_TIMEOUT = 258
STILL_ACTIVE = 259
ERROR_ACCESS_DENIED = 5
ERROR_INVALID_PARAMETER = 87


@dataclass(frozen=True)
class ProcessIdentity:
    pid: int
    creation_filetime: int
    parent_pid: int | None

    def record(self) -> dict[str, int | None]:
        return {"pid": self.pid, "creation_filetime": self.creation_filetime,
                "parent_pid": self.parent_pid}

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

def _persona_prompt(repo_root: Path, profile: str) -> tuple[str, str, dict[str, str]]:
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
    if profile == BASELINE_PROMPT_PROFILE:
        prompt = (
            f"Shoulders-up portrait photograph of {age_stage}. {hair.strip()}, {eyes.strip()}. "
            "Clothed in the original black opaque strapped top, in the same bedroom setting "
            "as the sole reference image. Natural skin texture with visible pores, photographic realism."
        )
        negative = NEGATIVE
    elif profile == SIMPLE_PORTRAIT_PROMPT_PROFILE:
        prompt = (
            f"Single-person shoulders-up portrait photograph of {age_stage}. {hair.strip()}, {eyes.strip()}. "
            "Front-facing neutral face and neutral gaze. Clothed in an opaque black strapped top. "
            "Plain unadorned bedroom wall. Natural daylight, natural skin texture with visible pores, "
            "photographic realism."
        )
        negative = NEGATIVE + ", collage, framed portraits, pictures, mirrors, reflections, duplicate people"
    else:
        raise LocalComfyError("unsupported prompt profile")
    return prompt, negative, {"repo_path": PERSONA, "sha256": hashlib.sha256(raw).hexdigest(), "age_stage": age_stage,
                               "hair": hair.strip(), "eyes": eyes.strip(),
                               "tester_age_helper_sha256": sha256_file(helper_path)}


def _crop_helper() -> Any:
    path = Path(__file__).with_name("local_conditioning_crop.py")
    spec = importlib.util.spec_from_file_location("figment_local_conditioning_crop", path)
    if spec is None or spec.loader is None:
        raise LocalComfyError("local conditioning crop helper is unavailable")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper

def _workflow(input_name: str, positive: str, negative: str) -> dict[str, dict[str, Any]]:
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": MODELS["checkpoint"]["filename"]}},
        "2": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "3": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": MODELS["clip_vision"]["filename"]}},
        "4": {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": MODELS["ipadapter"]["filename"]}},
        "5": {"class_type": "IPAdapterAdvanced", "inputs": {"model": ["1", 0], "ipadapter": ["4", 0], "image": ["2", 0], "clip_vision": ["3", 0], "weight": 0.65, "weight_type": "linear", "combine_embeds": "average", "start_at": 0.0, "end_at": 1.0, "embeds_scaling": "V only"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["1", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["1", 1]}},
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

def build_manifest(repo_root: Path, conditioning: str = FULL_CONDITIONING,
                   prompt_profile: str = BASELINE_PROMPT_PROFILE) -> dict[str, Any]:
    if conditioning not in (FULL_CONDITIONING, FACE_CROP_CONDITIONING):
        raise LocalComfyError("unsupported conditioning mode")
    if prompt_profile not in PROMPT_PROFILES:
        raise LocalComfyError("unsupported prompt profile")
    verified = validate_static_install(repo_root)
    positive, negative, persona = _persona_prompt(repo_root, prompt_profile)
    input_name = "g01.jpg"
    conditioning_record: dict[str, Any] = {"name": FULL_CONDITIONING, "source_filename": input_name,
                                            "materialized": False}
    if conditioning == FACE_CROP_CONDITIONING:
        helper_path = Path(__file__).with_name("local_conditioning_crop.py")
        helper = _crop_helper()
        input_name = helper.CROP_NAME
        conditioning_record = {
            "name": FACE_CROP_CONDITIONING, "source_filename": "g01.jpg", "materialized": False,
            "helper": {"path": helper_path.name, "sha256": sha256_file(helper_path), "schema": helper.SCHEMA},
            "derivation": {"method": helper.SCHEMA, "box": list(helper.CROP_BOX),
                           "dimensions": list(helper.CROP_SIZE), "resize": False,
                           "output_filename": helper.CROP_NAME},
            "derivative": None,
        }
    workflow = _workflow(input_name, positive, negative)
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
        "conditioning": conditioning_record,
        "persona": persona,
        "models": verified["models"],
        "prompt": {"profile": prompt_profile, "positive": positive, "negative": negative,
                   "sha256": hashlib.sha256((positive + "\n" + negative).encode()).hexdigest()},
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

def _process_parents() -> dict[int, int]:
    """Read parent PIDs through Toolhelp only; never select a process by name."""
    if os.name != "nt":
        raise LocalComfyError("owned process tracking requires Windows")
    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
                    ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
                    ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                    ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
                    ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]
    kernel32 = _kernel32()
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    invalid = ctypes.c_void_p(-1).value
    if snapshot == invalid:
        raise LocalComfyError("cannot snapshot local process metadata")
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        if not kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
            raise LocalComfyError("cannot read local process metadata")
        parents: dict[int, int] = {}
        while True:
            parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
            if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                break
        return parents
    finally:
        kernel32.CloseHandle(snapshot)


def _kernel32() -> Any:
    """Return typed Win32 calls so 64-bit HANDLE values are never truncated."""
    if os.name != "nt":
        raise LocalComfyError("owned process tracking requires Windows")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME),
                                         ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME),
                                         ctypes.POINTER(wintypes.FILETIME)]
    kernel32.GetProcessTimes.restype = wintypes.BOOL
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    return kernel32


def _identity_from_handle(handle: Any, pid: int, parent_pid: int | None) -> ProcessIdentity | None:
    kernel32 = _kernel32()
    exit_code = wintypes.DWORD()
    if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
        raise LocalComfyError("cannot read owned process state")
    if exit_code.value != STILL_ACTIVE:
        return None
    created = wintypes.FILETIME()
    exited = wintypes.FILETIME()
    kernel = wintypes.FILETIME()
    user = wintypes.FILETIME()
    if not kernel32.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited),
                                    ctypes.byref(kernel), ctypes.byref(user)):
        raise LocalComfyError("cannot read owned process creation time")
    stamp = int(created.dwLowDateTime) | (int(created.dwHighDateTime) << 32)
    return ProcessIdentity(pid=pid, creation_filetime=stamp, parent_pid=parent_pid)


def _process_identity(pid: int, parent_pid: int | None = None) -> ProcessIdentity | None:
    if os.name != "nt":
        raise LocalComfyError("owned process tracking requires Windows")
    kernel32 = _kernel32()
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        error = ctypes.get_last_error()
        if error == ERROR_INVALID_PARAMETER:
            return None
        if error == ERROR_ACCESS_DENIED:
            raise LocalComfyError("cannot inspect owned process identity")
        raise LocalComfyError("cannot open owned process identity")
    try:
        return _identity_from_handle(handle, pid, parent_pid)
    finally:
        kernel32.CloseHandle(handle)

def _discover_owned_processes(wrapper: ProcessIdentity,
                              tracked: dict[int, ProcessIdentity]) -> dict[int, ProcessIdentity]:
    """Extend an exact wrapper descendant set without acting on unrelated PIDs."""
    current_wrapper = _process_identity(wrapper.pid, wrapper.parent_pid)
    if current_wrapper != wrapper:
        raise LocalComfyError("ComfyUI wrapper identity changed or exited")
    parents = _process_parents()
    owned: dict[int, ProcessIdentity] = {wrapper.pid: wrapper}
    for pid, identity in tracked.items():
        try:
            current = _process_identity(pid, identity.parent_pid)
        except LocalComfyError as exc:
            exc.unreadable_pid = pid
            raise
        if current is not None:
            if current != identity:
                raise LocalComfyError("owned process PID was reused")
            owned[pid] = identity
    pending = list(owned)
    while pending:
        parent = pending.pop()
        for pid, parent_pid in parents.items():
            if parent_pid != parent or pid in owned:
                continue
            try:
                identity = _process_identity(pid, parent_pid)
            except LocalComfyError as exc:
                exc.unreadable_pid = pid
                raise
            if identity is None:
                continue
            if identity.creation_filetime < wrapper.creation_filetime:
                # A stale orphan can retain a recycled parent PID in Toolhelp.
                # It is foreign to this exact wrapper and must never be tracked
                # or terminated merely because its numeric parent matches.
                continue
            owned[pid] = identity
            pending.append(pid)
    return owned

def _require_owned_listener(wrapper: ProcessIdentity,
                            tracked: dict[int, ProcessIdentity]) -> dict[int, ProcessIdentity]:
    owned = _discover_owned_processes(wrapper, tracked)
    listener = _listener_pid()
    identity = owned.get(listener) if listener is not None else None
    if identity is None or _process_identity(identity.pid, identity.parent_pid) != identity:
        raise LocalComfyError("local listener is not owned by this ComfyUI process")
    return owned

def _wait_for_owned_listener(wrapper: ProcessIdentity, deadline: float,
                             tracked: dict[int, ProcessIdentity] | None = None,
                             on_discovery: Callable[[dict[int, ProcessIdentity]], None] | None = None
                             ) -> dict[int, ProcessIdentity]:
    """Update the caller-owned record before readiness can fail or the wrapper exits."""
    if tracked is None:
        tracked = {}
    tracked[wrapper.pid] = wrapper
    while time.monotonic() < deadline:
        try:
            discovered = _discover_owned_processes(wrapper, tracked)
            tracked.clear()
            tracked.update(discovered)
            if on_discovery is not None:
                on_discovery(tracked)
            listener = _listener_pid()
            identity = tracked.get(listener) if listener is not None else None
            if identity is not None and _process_identity(identity.pid, identity.parent_pid) == identity:
                return tracked
        except LocalComfyError:
            if _process_identity(wrapper.pid, wrapper.parent_pid) != wrapper:
                raise LocalComfyError("owned ComfyUI process exited before listener readiness")
            raise
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
    env.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "TEMP": str(root / "temp"), "TMP": str(root / "temp"), "HOME": str(root / "home"), "USERPROFILE": str(root / "home"), "LOCALAPPDATA": str(cache), "APPDATA": str(cache), "HF_HOME": str(cache / "hf"), "TRANSFORMERS_CACHE": str(cache / "transformers"), "TORCH_HOME": str(cache / "torch"), "TORCHINDUCTOR_CACHE_DIR": str(cache / "inductor"), "XDG_CACHE_HOME": str(cache / "xdg")})
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
                handle.flush()
                remaining -= len(kept)
    thread = threading.Thread(target=pump, daemon=True)
    thread.start()
    return thread, handle

def _terminate_identity(identity: ProcessIdentity) -> dict[str, Any]:
    """Terminate one previously recorded identity, refusing PID reuse."""
    current = _process_identity(identity.pid, identity.parent_pid)
    if current is None:
        return {**identity.record(), "state": "already-exited"}
    if current != identity:
        raise LocalComfyError("refusing to terminate a reused PID")
    kernel32 = _kernel32()
    rights = PROCESS_TERMINATE | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
    handle = kernel32.OpenProcess(rights, False, identity.pid)
    if not handle:
        raise LocalComfyError("cannot open owned process for teardown")
    try:
        if _identity_from_handle(handle, identity.pid, identity.parent_pid) != identity:
            raise LocalComfyError("owned process identity changed before teardown")
        if not kernel32.TerminateProcess(handle, 1):
            raise LocalComfyError("cannot terminate owned process")
        state = kernel32.WaitForSingleObject(handle, 15_000)
        if state != WAIT_OBJECT_0:
            raise LocalComfyError("owned process did not terminate within bound")
    finally:
        kernel32.CloseHandle(handle)
    return _wait_terminated_record(identity)

def _held_wrapper_identity(process: Any, wrapper: ProcessIdentity) -> ProcessIdentity:
    """Use Popen's retained handle to prevent a PID-reuse tree termination."""
    handle = getattr(process, "_handle", None)
    try:
        native_handle = int(handle)
    except (TypeError, ValueError) as exc:
        raise LocalComfyError("launched wrapper handle is unavailable for teardown") from exc
    current = _identity_from_handle(native_handle, wrapper.pid, wrapper.parent_pid)
    if current != wrapper:
        raise LocalComfyError("launched wrapper identity changed before tree teardown")
    return current


def _terminate_held_wrapper(process: Any, wrapper: ProcessIdentity) -> dict[str, Any]:
    """Terminate exactly Popen's still-live wrapper handle, never a PID tree."""
    handle = getattr(process, "_handle", None)
    _held_wrapper_identity(process, wrapper)
    kernel32 = _kernel32()
    if not kernel32.TerminateProcess(handle, 1):
        raise LocalComfyError("cannot terminate held ComfyUI wrapper")
    if kernel32.WaitForSingleObject(handle, 15_000) != WAIT_OBJECT_0:
        raise LocalComfyError("held ComfyUI wrapper did not terminate within bound")
    return _wait_terminated_record(wrapper)


def _held_wrapper_exit_record(process: Any, wrapper: ProcessIdentity) -> dict[str, Any] | None:
    """Return exact-handle exit proof when the redirector has already exited.

    A venv launcher can leave its child server alive while the Popen wrapper exits
    naturally during child-first teardown.  The retained Popen handle identifies
    that original wrapper even if its PID becomes available for reuse; it is the
    only safe way to recognize this particular natural exit.
    """
    handle = getattr(process, "_handle", None)
    if handle is None:
        return None
    kernel32 = _kernel32()
    state = kernel32.WaitForSingleObject(handle, 0)
    if state == WAIT_OBJECT_0:
        return _wait_terminated_record(wrapper)
    if state == WAIT_TIMEOUT:
        return None
    raise LocalComfyError("cannot query held ComfyUI wrapper exit state")


def _wait_terminated_record(identity: ProcessIdentity) -> dict[str, Any]:
    """A waited exact handle proves exit even if a later metadata reopen races cleanup."""
    try:
        current = _process_identity(identity.pid, identity.parent_pid)
    except LocalComfyError:
        return {**identity.record(), "state": "terminated-wait-verified"}
    if current is not None:
        raise LocalComfyError("owned process remained live after teardown")
    return {**identity.record(), "state": "terminated"}


def _verified_absent_record(identity: ProcessIdentity) -> dict[str, Any]:
    if _process_identity(identity.pid, identity.parent_pid) is not None:
        raise LocalComfyError("owned process remained live after teardown")
    return {**identity.record(), "state": "verified-absent"}


def _teardown_error_detail(stage: str, identity: ProcessIdentity,
                           exc: LocalComfyError) -> dict[str, Any]:
    """Persist a finite diagnosis without copying runtime text into the journal."""
    message = str(exc)
    codes = {
        "cannot inspect owned process identity": "identity-inspection-unavailable",
        "cannot open owned process identity": "identity-open-failed",
        "cannot read owned process state": "identity-state-unavailable",
        "cannot read owned process creation time": "identity-creation-unavailable",
        "owned process remained live after teardown": "process-still-live",
        "refusing to terminate a reused PID": "pid-reused",
        "cannot open owned process for teardown": "termination-handle-unavailable",
        "owned process identity changed before teardown": "identity-changed",
        "cannot terminate owned process": "termination-rejected",
        "owned process did not terminate within bound": "termination-timeout",
        "launched wrapper handle is unavailable for teardown": "wrapper-handle-unavailable",
        "launched wrapper identity changed before tree teardown": "wrapper-identity-changed",
        "cannot terminate held ComfyUI wrapper": "wrapper-termination-rejected",
        "held ComfyUI wrapper did not terminate within bound": "wrapper-termination-timeout",
        "cannot query held ComfyUI wrapper exit state": "wrapper-exit-state-unavailable",
    }
    return {"stage": stage, "pid": identity.pid,
            "code": codes.get(message, "local-comfy-error")}


def _teardown(wrapper: ProcessIdentity, tracked: dict[int, ProcessIdentity],
              process: Any) -> dict[str, Any]:
    """Stop only recorded wrapper descendants, deepest children first."""
    discovery_error: LocalComfyError | None = None
    try:
        owned = _discover_owned_processes(wrapper, tracked)
    except LocalComfyError as exc:
        discovery_error = exc
        owned = {wrapper.pid: wrapper, **tracked}
    wrapper_absent_before_cleanup = False
    if discovery_error is not None:
        wrapper_absent_before_cleanup = _process_identity(wrapper.pid, wrapper.parent_pid) is None
    parent_snapshot_error = False
    try:
        parents = _process_parents()
    except LocalComfyError:
        parents = {}
        parent_snapshot_error = True
    depth: dict[int, int] = {wrapper.pid: 0}
    pending = [wrapper.pid]
    while pending:
        parent = pending.pop()
        for pid, identity in owned.items():
            if parents.get(pid) == parent:
                depth[pid] = depth[parent] + 1
                pending.append(pid)
    ordered = sorted(owned.values(), key=lambda item: depth.get(item.pid, 0), reverse=True)
    stopped: list[dict[str, Any]] = []
    errors: list[str] = []
    error_details: list[dict[str, Any]] = []
    uncertain = discovery_error is not None or parent_snapshot_error
    unreadable_pid = getattr(discovery_error, "unreadable_pid", None)
    unresolved: list[dict[str, Any]] = []
    if isinstance(unreadable_pid, int) and unreadable_pid > 0:
        unresolved.append({"pid": unreadable_pid, "error_class": type(discovery_error).__name__})
    for identity in ordered:
        if identity.pid == unreadable_pid:
            continue
        try:
            if identity == wrapper:
                naturally_exited = _held_wrapper_exit_record(process, wrapper)
                if naturally_exited is not None:
                    stopped.append(naturally_exited)
                    continue
            if identity == wrapper and uncertain and _process_identity(wrapper.pid, wrapper.parent_pid) is not None:
                stopped.append(_terminate_held_wrapper(process, wrapper))
            else:
                stopped.append(_terminate_identity(identity))
        except LocalComfyError as exc:
            if identity == wrapper:
                # The exact retained handle can become signalled between the
                # initial check and a normal PID-based termination attempt.
                try:
                    naturally_exited = _held_wrapper_exit_record(process, wrapper)
                except LocalComfyError as recovery_exc:
                    errors.append(type(recovery_exc).__name__)
                    error_details.append(_teardown_error_detail(
                        "wrapper-exit-recovery", identity, recovery_exc))
                else:
                    if naturally_exited is not None:
                        stopped.append(naturally_exited)
                        continue
                    errors.append(type(exc).__name__)
                    error_details.append(_teardown_error_detail(
                        "wrapper-termination", identity, exc))
            else:
                errors.append(type(exc).__name__)
                error_details.append(_teardown_error_detail(
                    "descendant-termination", identity, exc))
    verified = not uncertain and not errors and not unresolved
    if (discovery_error is not None and not parent_snapshot_error and wrapper_absent_before_cleanup
            and not errors and not unresolved and all(
            _process_identity(identity.pid, identity.parent_pid) is None for identity in ordered)):
        # The wrapper had already exited and every retained identity is absent;
        # there is no live PID to terminate or a basis to claim an orphan.
        verified = True
    return {"wrapper": wrapper.record(), "owned_processes": stopped,
            "discovery_error": type(discovery_error).__name__ if discovery_error else None,
            "unresolved_processes": unresolved,
            "parent_snapshot_error": parent_snapshot_error, "teardown_errors": errors,
            "teardown_error_details": error_details,
            "verified_stopped": verified}


def _record_owned_processes(journal: dict[str, Any], wrapper: ProcessIdentity,
                            owned: dict[int, ProcessIdentity]) -> None:
    journal["wrapper"] = wrapper.record()
    journal["owned_processes"] = [owned[pid].record() for pid in sorted(owned)]


def _database_url(root: Path) -> str:
    """Keep ComfyUI's SQLite database out of its shared installation user directory."""
    database = root / "user" / "comfyui.db"
    return "sqlite:///" + database.as_posix()


def execute(repo_root: Path, run_root: Path, conditioning: str = FULL_CONDITIONING,
            prompt_profile: str = BASELINE_PROMPT_PROFILE) -> dict[str, Any]:
    """Explicit local-only execution; intentionally never called by the default CLI."""
    manifest = build_manifest(repo_root, conditioning, prompt_profile)
    _port_available()
    root = _fresh_run_root(run_root, _workspace_private_root(repo_root))
    crop_record: dict[str, Any] | None = None
    if conditioning == FACE_CROP_CONDITIONING:
        helper = _crop_helper()
        helper_path = Path(__file__).with_name("local_conditioning_crop.py")
        helper_hash = manifest["conditioning"]["helper"]["sha256"]
        if sha256_file(helper_path) != helper_hash:
            raise LocalComfyError("local conditioning crop helper changed before materialization")
        crop_record = helper.materialize_crop(repo_root / CANONICAL, CANONICAL_SHA256, helper.SOURCE_SIZE,
                                              _workspace_private_root(repo_root), root, output_kind="local-comfy-run")
        if sha256_file(helper_path) != helper_hash:
            raise LocalComfyError("local conditioning crop helper changed after materialization")
    else:
        root.mkdir()
    for name in ("input", "output", "temp", "user", "home"):
        (root / name).mkdir()
    if conditioning == FACE_CROP_CONDITIONING:
        if crop_record is None:
            raise LocalComfyError("crop materialization record is missing")
        crop_name = manifest["conditioning"]["derivation"]["output_filename"]
        if not isinstance(crop_name, str) or Path(crop_name).name != crop_name or crop_name != helper.CROP_NAME:
            raise LocalComfyError("verified crop filename is invalid")
        materialized = root / crop_name
        copied = root / "input" / crop_name
        if not materialized.is_file() or copied.exists() or _is_reparse(materialized):
            raise LocalComfyError("materialized crop path is unsafe")
        os.replace(materialized, copied)
        if _is_reparse(copied) or sha256_file(copied) != crop_record["output"]["sha256"]:
            raise LocalComfyError("materialized crop hash mismatch")
        manifest["conditioning"]["materialized"] = True
        manifest["conditioning"]["derivative"] = {"filename": helper.CROP_NAME,
                                                       "sha256": crop_record["output"]["sha256"],
                                                       "bytes": crop_record["output"]["bytes"],
                                                       "dimensions": crop_record["output"]["dimensions"]}
        manifest["conditioning"]["source"] = crop_record["source"]
        provenance = copy.deepcopy(crop_record)
        provenance["output"]["path"] = str(copied)
        manifest["conditioning"]["crop_provenance"] = provenance
    else:
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
    database_url = _database_url(root)
    command = [str(COMFY_PYTHON), "main.py", "--listen", "127.0.0.1", "--port", str(PORT), "--input-directory", str(root / "input"), "--output-directory", str(root / "output"), "--temp-directory", str(root / "temp"), "--user-directory", str(root / "user"), "--database-url", database_url, "--disable-api-nodes", "--disable-all-custom-nodes", "--whitelist-custom-nodes", "ComfyUI_IPAdapter_plus", "--disable-auto-launch"]
    process = None
    wrapper: ProcessIdentity | None = None
    owned: dict[int, ProcessIdentity] = {}
    stderr_thread = stderr_handle = None
    completed: dict[str, Any] | None = None
    prompt_id: str | None = None
    failure: Exception | None = None
    teardown: dict[str, Any] = {"wrapper": None, "owned_processes": [], "verified_stopped": False}
    try:
        process = subprocess.Popen(command, cwd=COMFY_ROOT, shell=False, env=_isolated_environment(root), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        stderr_thread, stderr_handle = _bounded_stderr(process, root / "startup.stderr.log")
        wrapper = _process_identity(process.pid)
        if wrapper is None:
            raise LocalComfyError("cannot read launched ComfyUI wrapper identity")
        journal.update({"status": "started", "database_url": database_url})
        _record_owned_processes(journal, wrapper, {wrapper.pid: wrapper})
        _write_json(root / "journal.json", journal)
        deadline = time.monotonic() + POLL_SECONDS
        def record_discovery(known: dict[int, ProcessIdentity]) -> None:
            _record_owned_processes(journal, wrapper, known)
            _write_json(root / "journal.json", journal)
        owned = _wait_for_owned_listener(wrapper, deadline, owned, record_discovery)
        opener = _loopback_opener()
        marker = root / "dispatch-attempt.json"
        marker.write_text(json.dumps({"schema": SCHEMA, "manifest_sha256": manifest_sha, "attempt": 1}) + "\n", encoding="utf-8")
        owned = _require_owned_listener(wrapper, owned)
        _record_owned_processes(journal, wrapper, owned)
        _write_json(root / "journal.json", journal)
        queued = _local_json(opener, "POST", "/prompt", {"prompt": manifest["workflow"]["api_prompt"], "client_id": uuid.uuid4().hex})
        candidate = queued.get("prompt_id")
        if not isinstance(candidate, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", candidate):
            raise LocalComfyError("local prompt response missing safe id")
        prompt_id = candidate
        journal.update({"status": "queued", "prompt_id": prompt_id})
        _write_json(root / "journal.json", journal)
        while time.monotonic() < deadline:
            owned = _require_owned_listener(wrapper, owned)
            _record_owned_processes(journal, wrapper, owned)
            _write_json(root / "journal.json", journal)
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
        if wrapper is not None:
            try:
                teardown = _teardown(wrapper, owned, process)
                if not teardown["verified_stopped"] and failure is None:
                    failure = LocalComfyError("owned ComfyUI teardown was not fully verified")
            except Exception as teardown_error:
                teardown = {"wrapper": wrapper.record(), "owned_processes": [], "verified_stopped": False,
                            "error_class": type(teardown_error).__name__}
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
    parser.add_argument("--conditioning", choices=(FULL_CONDITIONING, FACE_CROP_CONDITIONING), default=FULL_CONDITIONING)
    parser.add_argument("--prompt-profile", choices=PROMPT_PROFILES, default=BASELINE_PROMPT_PROFILE)
    args = parser.parse_args(argv)
    if args.execute:
        if args.run_root is None:
            parser.error("--execute requires --run-root")
        print(json.dumps(execute(args.repo_root.resolve(), args.run_root, args.conditioning, args.prompt_profile), sort_keys=True))
    else:
        print(json.dumps(build_manifest(args.repo_root.resolve(), args.conditioning, args.prompt_profile), indent=2, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

