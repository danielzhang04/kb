#!/usr/bin/env python3
"""P4 probe harness -- one bounded, $0 codex exec call with full evidence capture.

codex is SUBSCRIPTION-billed: no key is read, no .env is touched, no metered API is called.
Usage:
  py -3 p4_probe.py --label probe1-tempdir --cwd-mode tempdir \
      --prompt-file <abs .txt> --seed <abs .png> [--sandbox workspace-write] [--timeout 240]
"""
import argparse, json, os, shutil, signal, subprocess, sys, tempfile, time
from pathlib import Path

ARC = Path(__file__).resolve().parent
IMAGE_ROOT = Path(os.path.expanduser("~/.codex/generated_images"))
SESSIONS_ROOT = Path(os.path.expanduser("~/.codex/sessions"))

ENVELOPE = (
    "Read the file at {prompt_path} and pass its exact byte content as the `prompt` argument to "
    "`image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text -- read "
    "and pass through only. Call the tool exactly once, with referenced_image_paths = [{seeds}]. "
    "Do not read any file outside this directory. Report only the saved image path."
)


def build_envelope(prompt_path, seeds):
    return ENVELOPE.format(prompt_path=prompt_path,
                           seeds=", ".join(str(s) for s in seeds))


def kill_tree(proc):
    """Kill the child AND every descendant -- a single-PID kill left 4 live codex.exe in P2b."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        pass


def _thread_dir_listing(thread_id):
    d = IMAGE_ROOT / (thread_id or "")
    return set(os.listdir(d)) if thread_id and d.is_dir() else set()


def _rollout_path(thread_id):
    if not thread_id or not SESSIONS_ROOT.is_dir():
        return None
    hits = sorted(SESSIONS_ROOT.glob(f"*/*/*/rollout-*-{thread_id}.jsonl"))
    return hits[-1] if hits else None


def count_pre_call_tool_calls(thread_id):
    """custom_tool_call items appearing BEFORE the image_gen__imagegen call -- the detour meter."""
    path = _rollout_path(thread_id)
    if not path:
        return None
    n = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if '"custom_tool_call"' not in line:
            continue
        if "image_gen__imagegen" in line:
            return n
        n += 1
    return n


def scrub_long_strings(obj, max_len=120, keep=40):
    """Recursively truncate every string value longer than `max_len` chars to its first
    `keep` chars plus a "...<TRUNCATED len=N>" marker (N = original length) -- no exceptions.

    Full codex rollout logs (~/.codex/sessions/**/rollout-*.jsonl) are raw session
    transcripts, not curated evidence: they can embed arbitrarily long string payloads --
    base64/hex-encoded image bytes, full file contents read via shell exec, anything a
    prompt or tool happened to read or produce -- in shapes this repo's credential ceiling
    cannot safely classify at scale (a keyword/entropy scan can miss a secret-shaped blob
    it doesn't recognize; a human reviewer flagged exactly that on this probe's first banked
    copy). Full rollout logs are therefore never committed to this repo. Rather than trust a
    classifier to catch every shape a credential or other sensitive blob could take, this
    scrubber removes the *category* of risk: no string longer than max_len chars survives
    un-truncated anywhere in the structure, so no single-line secret, key, or bulk-data blob
    can ever reach the tracked repo, regardless of what it is or whether it was recognized.
    """
    if isinstance(obj, str):
        if len(obj) > max_len:
            return f"{obj[:keep]}…<TRUNCATED len={len(obj)}>"
        return obj
    if isinstance(obj, dict):
        return {scrub_long_strings(k, max_len, keep): scrub_long_strings(v, max_len, keep) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub_long_strings(v, max_len, keep) for v in obj]
    return obj


def run_probe(*, label, prompt_path, seeds, cwd, sandbox, timeout_s):
    # shutil.which resolves PATHEXT (codex.CMD on Windows) -- Popen with shell=False does not.
    codex_bin = shutil.which("codex") or "codex"
    # --skip-git-repo-check: codex 0.146.1 refuses to run outside a trusted git repo (observed on
    # the tempdir arm -- "Not inside a trusted directory"); added to BOTH arms so the flag itself
    # is not a confound -- only cwd differs between arms, per the probe's intent.
    argv = [codex_bin, "exec", "--json", "--sandbox", sandbox, "--cd", str(cwd),
            "--skip-git-repo-check", build_envelope(prompt_path, seeds)]
    raw = ARC / f"{label}-raw.jsonl"
    err = ARC / f"{label}-stderr.txt"
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" \
        else {"start_new_session": True}
    t0 = time.time()
    with open(raw, "w", encoding="utf-8") as fo, open(err, "w", encoding="utf-8") as fe:
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=fo, stderr=fe,
                                cwd=str(cwd), **kwargs)
        timed_out = False
        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_tree(proc)
    wall = round(time.time() - t0, 1)
    thread_id, usage = None, {}
    for line in raw.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "thread.started":
            thread_id = ev.get("thread_id")
        elif ev.get("type") == "turn.completed":
            usage = ev.get("usage", {})
    out = {"label": label, "thread_id": thread_id, "usage": usage,
           "pre_call_tool_calls": count_pre_call_tool_calls(thread_id),
           "wall_s": wall, "returncode": proc.returncode, "timed_out": timed_out,
           "images": sorted(_thread_dir_listing(thread_id))}
    print(json.dumps(out, indent=2), flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--seed", action="append", default=[])
    ap.add_argument("--cwd-mode", choices=("tempdir", "worktree"), default="tempdir")
    ap.add_argument("--sandbox", default="workspace-write")
    ap.add_argument("--timeout", type=int, default=240)
    a = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="p4probe-") if a.cwd_mode == "tempdir" else str(ARC)
    try:
        run_probe(label=a.label, prompt_path=os.path.abspath(a.prompt_file),
                  seeds=[os.path.abspath(s) for s in a.seed], cwd=tmp,
                  sandbox=a.sandbox, timeout_s=a.timeout)
    finally:
        if a.cwd_mode == "tempdir":
            shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
