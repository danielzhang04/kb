#!/usr/bin/env python3
"""FAKE `codex` binary for forge_codex tests. Never contacts a network, never spends anything.

Invoked like the real binary:
  py -3 _fake_codex.py --mode <m> --image-root <dir> --sessions-root <dir> \
      exec --json --skip-git-repo-check --sandbox <s> --cd <dir> "<envelope>"
  py -3 _fake_codex.py ... exec resume --json <thread_id> [prompt]

It encodes the observed codex-cli 0.146.1 contract: p1 hard limits and event
shapes, p2's untrusted-directory rejection, and p3's distinct resume syntax.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

INK = (36, 26, 18)
PAPER = (240, 240, 235)
SIZES = {
    "ok": (1672, 941), "resume_ok": (1672, 941), "paraphrase": (1672, 941),
    "no_rollout": (1672, 941), "two_images": (1672, 941),
    "ok_portrait": (941, 1672), "wrong_ratio": (1200, 900),
}

_SEEDS_RE = re.compile(r"referenced_image_paths = \[(.*?)\]", re.S)
_PROMPT_RE = re.compile(r"Read the file at (.+?) and pass its exact byte content", re.S)


def thread_id_for(seed_text):
    h = hashlib.sha1(seed_text.encode("utf-8")).hexdigest()
    return f"019ff{h[0:3]}-{h[3:7]}-7{h[7:10]}-{h[10:14]}-{h[14:26]}"


def parse_envelope(envelope):
    m = _PROMPT_RE.search(envelope)
    prompt_path = m.group(1).strip() if m else None
    m2 = _SEEDS_RE.search(envelope)
    raw = m2.group(1).strip() if m2 else ""
    seeds = [s.strip() for s in raw.split(",") if s.strip()]
    return prompt_path, seeds


def enforce_contract(seeds):
    """The two server-side rejections measured by P1, with real error strings."""
    if len(seeds) > 5:
        sys.stderr.write("ERROR codex_core::tools::router: error=referenced_image_paths must "
                         "contain at most 5 paths\n")
        return 1
    for seed in seeds:
        if not os.path.isabs(seed):
            sys.stderr.write("ERROR codex_core::tools::router: error=AbsolutePathBuf deserialized "
                             "without a base path at line 1 column 337\n")
            return 1
    return 0


def write_png(path, size):
    from PIL import Image, ImageDraw

    image = Image.new("RGB", size, PAPER)
    draw = ImageDraw.Draw(image)
    width, height = size
    draw.rectangle([0, 0, width - 1, int(height * 0.06)], fill=INK)
    draw.rectangle([0, int(height * 0.94), width - 1, height - 1], fill=INK)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")


def write_rollout(sessions_root, thread_id, prompt_text, pre_calls=3):
    """P2b's shape: response_item lines and literal JS custom-tool-call inputs."""
    now = datetime.datetime.now()
    directory = Path(sessions_root) / f"{now:%Y}" / f"{now:%m}" / f"{now:%d}"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"rollout-{now:%Y-%m-%dT%H-%M-%S}-{thread_id}.jsonl"
    lines = []
    for index in range(pre_calls):
        lines.append({"type": "response_item", "payload": {
            "type": "custom_tool_call", "name": "shell",
            "input": f"const r{index} = await tools.shell({{cmd:'ls'}});",
        }})
    js = (
        "const params = {\n  prompt: %s,\n  referenced_image_paths: []\n};\n"
        "const result = await tools.image_gen__imagegen(params);\n" % json.dumps(prompt_text)
    )
    lines.append({"type": "response_item", "payload": {
        "type": "custom_tool_call", "name": "exec", "input": js,
    }})
    lines.append({"type": "response_item", "payload": {
        "type": "custom_tool_call_output",
        "output": json.dumps({"prompt": prompt_text,
                              "image_url": "data:image/png;base64,AAAA"}),
    }})
    with open(path, "w", encoding="utf-8") as output:
        for row in lines:
            output.write(json.dumps(row) + "\n")
    return path


def emit(event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def _parse_exec_tail(tail):
    if not tail or tail[0] != "exec":
        sys.stderr.write("fake codex: expected `exec` subcommand\n")
        return None, None, 2
    rest = tail[1:]
    if rest and rest[0] == "resume":
        rest = rest[1:]
        if "--sandbox" in rest or "--cd" in rest:
            sys.stderr.write("error: unexpected argument '--sandbox' found\n\n"
                             "Usage: codex exec resume --json <SESSION_ID> [PROMPT]\n")
            return None, None, 2
        if "--json" not in rest:
            sys.stderr.write("fake codex: --json is required by the runner contract\n")
            return None, None, 2
        positionals = [item for item in rest if item not in ("--json", "--skip-git-repo-check")]
        if not positionals:
            sys.stderr.write("error: a session ID is required for resume\n")
            return None, None, 2
        resume_id = positionals[0]
        prompt = positionals[1] if len(positionals) > 1 else ""
        return resume_id, prompt, 0
    if "--json" not in rest:
        sys.stderr.write("fake codex: --json is required by the runner contract\n")
        return None, None, 2
    if "--sandbox" not in rest or "--cd" not in rest:
        sys.stderr.write("fake codex: --sandbox and --cd are required by the runner contract\n")
        return None, None, 2
    if "--skip-git-repo-check" not in rest:
        sys.stderr.write("Not inside a trusted directory and `--skip-git-repo-check` was not specified.\n")
        return None, None, 1
    return None, rest[-1], 0


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--image-root", required=True)
    parser.add_argument("--sessions-root", required=True)
    args, tail = parser.parse_known_args()
    parsed = _parse_exec_tail(tail)
    resume_id, envelope, parse_rc = parsed
    if parse_rc:
        return parse_rc
    prompt_path, seeds = parse_envelope(envelope)
    rc = enforce_contract(seeds)
    if rc:
        return rc
    prompt_text = Path(prompt_path).read_text(encoding="utf-8") if prompt_path else ""
    mode = args.mode

    if mode == "stall":
        # This grandchild makes the timeout test prove TREE termination, not only PID termination.
        import subprocess as _sp
        heartbeat = Path(args.image_root).parent / "heartbeat.txt"
        _sp.Popen([sys.executable, "-c",
                   "import sys,time\n"
                   "while True:\n"
                   "    open(sys.argv[1], 'a').write('x')\n"
                   "    time.sleep(0.2)\n", str(heartbeat)],
                  stdin=_sp.DEVNULL, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
        time.sleep(600)
        return 0
    if mode == "bad_json":
        sys.stdout.write("not json at all\n{oops\n")
        sys.stdout.flush()
        return 0

    thread_id = resume_id or thread_id_for(f"{mode}|{envelope}")
    if mode != "no_thread_event":
        emit({"type": "thread.started", "thread_id": thread_id})
    emit({"type": "turn.started"})

    image_dir = Path(args.image_root) / thread_id
    n_existing = len(list(image_dir.glob("*.png"))) if image_dir.is_dir() else 0
    stamp = hashlib.sha1(f"{thread_id}|{n_existing}".encode()).hexdigest()[:8]

    if mode in ("ok", "ok_portrait", "wrong_ratio", "resume_ok", "paraphrase", "no_rollout"):
        path = image_dir / f"exec-{stamp}.png"
        write_png(path, SIZES.get(mode, (1672, 941)))
        emit({"type": "item.completed", "item": {
            "id": "item_9", "type": "agent_message", "text": f"Saved output:\n\n`{path}`",
        }})
    elif mode == "two_images":
        write_png(image_dir / f"exec-{stamp}a.png", SIZES["two_images"])
        write_png(image_dir / f"exec-{stamp}b.png", SIZES["two_images"])
        emit({"type": "item.completed", "item": {
            "id": "item_9", "type": "agent_message", "text": "Saved two outputs.",
        }})
    elif mode == "tiny_png":
        image_dir.mkdir(parents=True, exist_ok=True)
        (image_dir / f"exec-{stamp}.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200)
        emit({"type": "item.completed", "item": {
            "id": "item_9", "type": "agent_message", "text": "Saved output.",
        }})
    elif mode == "no_image":
        emit({"type": "item.completed", "item": {
            "id": "item_9", "type": "agent_message",
            "text": "I was unable to produce an image this turn.",
        }})
    elif mode == "refuse":
        emit({"type": "item.completed", "item": {
            "id": "item_9", "type": "agent_message",
            "text": "I can't help with generating that image.",
        }})
    elif mode == "quota":
        emit({"type": "item.completed", "item": {
            "id": "item_9", "type": "agent_message",
            "text": "You've hit your usage limit. Try again later.",
        }})
    elif mode == "nonzero_exit":
        for message in (
            "Reconnecting... 2/5 (stream disconnected before completion: invalid peer certificate: UnknownIssuer)",
            "Reconnecting... 3/5 (stream disconnected before completion: invalid peer certificate: UnknownIssuer)",
            "Reconnecting... 4/5 (stream disconnected before completion: invalid peer certificate: UnknownIssuer)",
            "Reconnecting... 5/5 (stream disconnected before completion: invalid peer certificate: UnknownIssuer)",
        ):
            emit({"type": "error", "message": message})
        emit({"type": "item.completed", "item": {
            "id": "item_0", "type": "error",
            "message": "Falling back from WebSockets to HTTPS transport. stream disconnected before completion: invalid peer certificate: UnknownIssuer",
        }})
        for message in (
            "Reconnecting... 1/5 (stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses))",
            "Reconnecting... 2/5 (stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses))",
            "Reconnecting... 3/5 (stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses))",
            "Reconnecting... 4/5 (stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses))",
            "Reconnecting... 5/5 (stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses))",
            "stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)",
        ):
            emit({"type": "error", "message": message})
        emit({"type": "turn.failed", "error": {
            "message": "stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)",
        }})
        sys.stderr.write("ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: "
                         "IO error: invalid peer certificate: UnknownIssuer, url: wss://api.openai.com/v1/responses\n")
        return 1
    else:
        sys.stderr.write(f"fake codex: unknown --mode {mode}\n")
        return 2

    if mode != "no_rollout":
        rollout_text = "PARAPHRASED: " + prompt_text if mode == "paraphrase" else prompt_text
        write_rollout(args.sessions_root, thread_id, rollout_text)

    emit({"type": "turn.completed", "usage": {
        "input_tokens": 75742, "cached_input_tokens": 48384, "cache_write_input_tokens": 0,
        "output_tokens": 1593, "reasoning_output_tokens": 742,
    }})
    return 0


if __name__ == "__main__":
    sys.exit(main())
