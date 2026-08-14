#!/usr/bin/env python3
"""Run one frozen Gemini A/B arm without touching production generation state."""
import argparse
import base64
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request


HERE = os.path.dirname(os.path.abspath(__file__))
ORG = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "..", ".."))
OUT_DIR = os.path.join(HERE, "ab-out")
LOG_PATH = os.path.join(HERE, "ab-genlog.md")
ARMS = {
    "gemini-3-pro-image": "pro",
    "gemini-2.5-flash-image": "flash",
}


def load_env(root):
    """Match forge.py's .env parser exactly; called only in live mode."""
    env = {}
    with open(os.path.join(root, ".env"), encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


def sha256_file(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def select_items(spec, requested):
    items = spec.get("items")
    if not isinstance(items, list) or not items:
        raise SystemExit("spec must contain a non-empty items list")
    ids = [item.get("id") for item in items]
    if len(ids) != len(set(ids)) or any(not isinstance(item_id, str) for item_id in ids):
        raise SystemExit("spec item ids must be unique non-empty strings")
    if not requested:
        return items
    wanted = [item_id.strip() for item_id in requested.split(",") if item_id.strip()]
    if not wanted or len(wanted) != len(set(wanted)):
        raise SystemExit("--items must be a comma-separated list of unique item ids")
    unknown = sorted(set(wanted) - set(ids))
    if unknown:
        raise SystemExit("unknown item id(s): " + ", ".join(unknown))
    by_id = {item["id"]: item for item in items}
    return [by_id[item_id] for item_id in wanted]


def output_path(item, arm):
    name = item.get("output_name")
    if not isinstance(name, str) or not name or name != os.path.basename(name):
        raise SystemExit(f"{item.get('id', '<unknown>')}: output_name must be a plain filename")
    return os.path.join(OUT_DIR, f"{name}__{arm}.png")


def validate_item(item):
    if not isinstance(item.get("prompt"), str) or not item["prompt"]:
        raise SystemExit(f"{item.get('id', '<unknown>')}: missing prompt")
    if not isinstance(item.get("aspect_ratio"), str) or not item["aspect_ratio"]:
        raise SystemExit(f"{item['id']}: missing aspect_ratio")
    seeds = item.get("seeds")
    if not isinstance(seeds, list):
        raise SystemExit(f"{item['id']}: seeds must be a list")
    for seed in seeds:
        path = seed.get("path") if isinstance(seed, dict) else None
        expected = seed.get("sha256") if isinstance(seed, dict) else None
        if not isinstance(path, str) or not os.path.isfile(path):
            raise SystemExit(f"{item['id']}: seed is missing")
        if not isinstance(expected, str) or sha256_file(path) != expected:
            raise SystemExit(f"{item['id']}: seed SHA-256 changed")


def parts_for(item):
    parts = []
    for seed in item["seeds"]:
        path = seed["path"]
        # Check the exact bytes supplied to the request, as forge.ip() does.
        with open(path, "rb") as handle:
            data = handle.read()
        if hashlib.sha256(data).hexdigest() != seed["sha256"]:
            raise RuntimeError("seed SHA-256 changed before request assembly")
        parts.append({"inlineData": {"mimeType": "image/png",
                                     "data": base64.b64encode(data).decode()}})
    parts.append({"text": item["prompt"]})
    return parts


def call(model, key, item, image_size):
    """One no-retry call. Error text intentionally never includes the request URL."""
    try:
        parts = parts_for(item)
    except Exception:
        return None, "N/A", "seed assembly failed", False
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": item["aspect_ratio"], "imageSize": image_size},
        },
    }
    url = ("https://generativelanguage.googleapis.com/v1beta/models/" + model
           + ":generateContent?key=" + key)
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=240) as response:
            data = json.load(response)
            status = str(response.status)
    except urllib.error.HTTPError as exc:
        return None, str(exc.code), f"HTTP {exc.code}", True
    except Exception as exc:
        return None, "N/A", f"request failed ({type(exc).__name__})", True
    for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
        inline = part.get("inlineData")
        if inline and inline.get("data"):
            try:
                image = base64.b64decode(inline["data"], validate=True)
            except Exception:
                return None, status, "invalid image part", True
            if image:
                return image, status, None, True
    return None, status, "missing image part", True


def append_log(item_id, arm, elapsed, status, result, running_cost):
    with open(LOG_PATH, "a", encoding="utf-8", newline="\n") as handle:
        handle.write(
            f"- item={item_id} arm={arm} elapsed_s={elapsed:.2f} http={status} "
            f"result={result} nominal_running_usd={running_cost:.3f}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--items")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.model not in ARMS:
        raise SystemExit("unsupported model; choose gemini-3-pro-image or gemini-2.5-flash-image")
    with open(args.spec, encoding="utf-8") as handle:
        spec = json.load(handle)
    if args.model not in spec.get("engines", []):
        raise SystemExit("model is not enabled by this spec")
    selected = select_items(spec, args.items)
    arm = ARMS[args.model]
    rate = spec.get("rate_usd", {}).get(args.model)
    cap = spec.get("hard_cap_usd")
    if not isinstance(rate, (int, float)) or not isinstance(cap, (int, float)):
        raise SystemExit("spec must define numeric per-arm rate_usd and hard_cap_usd")

    for item in selected:
        validate_item(item)
        out = output_path(item, arm)
        if args.dry_run:
            print(f"DRY item={item['id']} prompt_chars={len(item['prompt'])} "
                  f"seeds={len(item['seeds'])} aspect={item['aspect_ratio']} output={out}")
    if args.dry_run:
        return 0

    planned = len(selected) * rate
    if planned > cap:
        raise SystemExit(f"planned nominal cost ${planned:.3f} exceeds hard cap ${cap:.2f}")
    for item in selected:
        if os.path.exists(output_path(item, arm)):
            raise SystemExit(f"refusing to overwrite existing output for {item['id']}")

    os.makedirs(OUT_DIR, exist_ok=True)
    # Forge resolves this from org/.env; the lookup is intentionally after all dry/preflight paths.
    key = load_env(ORG)["GEMINI_API_KEY"]
    running_cost = 0.0
    failed = False
    for item in selected:
        started = time.monotonic()
        image, status, error, called = call(args.model, key, item, spec["image_size"])
        elapsed = time.monotonic() - started
        if called:
            running_cost += rate
        if image is None:
            failed = True
            result = "error:" + error
            append_log(item["id"], arm, elapsed, status, result, running_cost)
            print(f"ERR item={item['id']} http={status} {error}")
            continue
        out = output_path(item, arm)
        try:
            with open(out, "xb") as handle:
                handle.write(image)
        except FileExistsError:
            failed = True
            result = "error:output appeared before write"
            append_log(item["id"], arm, elapsed, status, result, running_cost)
            print(f"ERR item={item['id']} output appeared before write")
            continue
        append_log(item["id"], arm, elapsed, status, out, running_cost)
        print(f"OK item={item['id']} http={status} output={out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
