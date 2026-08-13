"""$0 W6 coordinator: freeze, partition, dispatch, and deterministically merge a wave.

It never invokes Forge generation and never starts subprocesses.  The boss/orchestrator
dispatches the emitted command lines and performs all verification, stamps, and promotion.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from typing import Any, Iterable


HERE = Path(__file__).resolve().parent
WORKER = HERE / "wave_worker.py"
DISPATCH_SCHEMA = "image-gen-worker-dispatch@1"
INITIAL_CONCURRENCY = 2
# A third worker is a probe only after two clean parallel K=2 rounds; never use four here.
MAX_PROBE_CONCURRENCY = 3


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: str | Path, value: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise FileExistsError(f"refusing to overwrite immutable wave artifact: {target}")
    target.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_text(path: str | Path, value: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise FileExistsError(f"refusing to overwrite immutable wave artifact: {target}")
    target.write_text(value, encoding="utf-8", newline="\n")


def read_json(path: str | Path) -> Any:
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def _load_forge(forge_path: str | Path) -> Any:
    """Load Forge's review reader without duplicating its review-store semantics."""
    source = Path(forge_path)
    spec = importlib.util.spec_from_file_location("wave_harness_forge", source)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot import Forge review reader: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _input_items(payload: Any) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    if isinstance(payload, list):
        return payload, {}
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("input must be a Forge item list or {'items': [...], 'metadata': {...}}")
    metadata = payload.get("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("metadata must be keyed by output name")
    return payload["items"], metadata


def _staging_dependency(item: dict[str, Any], names: set[str]) -> list[dict[str, Any]]:
    """Infer current-slate generated seeds, but never infer their approval state."""
    found: list[dict[str, Any]] = []
    for seed in item.get("seed", []) or []:
        path = str(seed).replace("\\", "/")
        if "/_staging/" not in path or not path.endswith(".png"):
            continue
        name = Path(path).stem
        if name in names:
            found.append({"name": name, "kind": "scene_parent", "inferred": True})
    return found


def normalized_records(payload: Any, kit_dir: str, video_dir: str, org_dir: str = "") -> list[dict[str, Any]]:
    """Keep raw Forge item bytes separate from explicit scheduling metadata."""
    items, metadata = _input_items(payload)
    names = [item.get("name") for item in items]
    if any(not isinstance(name, str) or not name for name in names) or len(set(names)) != len(names):
        raise ValueError("every input item needs a globally unique Forge name")
    known = set(names)
    records: list[dict[str, Any]] = []
    for ordinal, raw in enumerate(items, 1):
        name = raw["name"]
        meta = metadata.get(name, {})
        if not isinstance(meta, dict):
            raise ValueError(f"metadata for {name} must be an object")
        dependencies = copy.deepcopy(meta.get("dependencies", raw.get("dependencies", [])))
        for dependency in dependencies:
            if not isinstance(dependency, dict):
                raise ValueError(f"dependency for {name} must be an object")
            path = dependency.get("path")
            if path and not Path(path).is_absolute() and org_dir:
                dependency["path"] = str(Path(org_dir) / path)
        dependencies.extend(_staging_dependency(raw, known))
        role_rows = meta.get("references")
        if role_rows is None:
            role_rows = []
            for role in raw.get("seed_roles", []) or []:
                path = role.get("path")
                resolved = Path(path) if path else None
                if resolved and not resolved.is_absolute() and org_dir:
                    resolved = Path(org_dir) / resolved
                row = {"role": role.get("role"), "path": str(resolved) if resolved else path,
                       "sha256": role.get("sha256")}
                if resolved and not row["sha256"] and resolved.is_file():
                    row["sha256"] = sha256_file(resolved)
                role_rows.append(row)
        chain_id = meta.get("chain_id", raw.get("chain_id"))
        if raw.get("stage_role") == "delta" and not chain_id:
            raise ValueError(f"delta {name} lacks a chain_id; W6 forbids guessing a held stage")
        chain_id = chain_id or name
        staging = meta.get("staging_slot", str(Path(kit_dir) / "_staging" / f"{name}.png"))
        promotion = meta.get("promotion_slot", str(Path(video_dir) / "assets" / "scenes" / f"{name}.png"))
        records.append({"raw": copy.deepcopy(raw), "name": name, "ordinal": ordinal,
                        "shot_id": meta.get("shot_id", name if not name.startswith("fig-") else None),
                        "card_id": meta.get("card_id", name if name.startswith("fig-") else None),
                        "chain_id": chain_id, "dependency_depth": int(meta.get("dependency_depth", raw.get("parent_depth", 0))),
                        "dependencies": dependencies, "references": role_rows, "staging_slot": staging,
                        "promotion_slot": promotion, "request_count": int(meta.get("request_count", 1))})
    return records


def validate_frontier(records: list[dict[str, Any]], *, review_store: str | Path | None = None,
                      kit_dir: str | Path | None = None, forge_reader: Any = None,
                      historical_chain_ids: set[str] | None = None) -> None:
    names = {record["name"] for record in records}
    base_chains = {record["chain_id"] for record in records
                   if str(record["raw"].get("stage_role", "")).lower() == "base"}
    valid_chains = base_chains | (historical_chain_ids or set())
    staging, promotion = set(), set()
    for record in records:
        if record["staging_slot"] in staging or record["promotion_slot"] in promotion:
            raise ValueError(f"output slot collision at {record['name']}")
        staging.add(record["staging_slot"])
        promotion.add(record["promotion_slot"])
        if str(record["raw"].get("stage_role", "")).lower() == "delta" and record["chain_id"] not in valid_chains:
            raise ValueError(f"delta {record['name']} chain_id {record['chain_id']!r} has no matching base")
        for dependency in record["dependencies"]:
            dep_name = dependency.get("name")
            if dep_name in names:
                raise ValueError(f"{record['name']} depends on current-wave {dep_name}; verify/stamp it in an earlier wave")
            if not dependency.get("verified") or not dependency.get("stamped"):
                raise ValueError(f"{record['name']} dependency {dep_name!r} is not verified+stamped")
            if dependency.get("kind") == "scene_parent" and not dependency.get("promoted"):
                raise ValueError(f"{record['name']} scene parent {dep_name!r} is not promoted")
            expected_digest = dependency.get("sha256")
            if not expected_digest:
                raise ValueError(f"{record['name']} dependency {dep_name!r} lacks a current digest")
            if review_store is None or kit_dir is None or forge_reader is None:
                raise ValueError(f"{record['name']} dependency {dep_name!r} lacks a Forge review-store reader")
            frame = Path(dependency.get("path", ""))
            if not frame.is_file():
                raise ValueError(f"{record['name']} dependency {dep_name!r} lacks a readable frame")
            if sha256_file(frame) != expected_digest:
                raise ValueError(f"{record['name']} dependency {dep_name!r} digest mismatch")
            staging_dir = Path(review_store).parent
            expected_store = Path(kit_dir) / "_staging" / "review.json"
            if Path(review_store).resolve() != expected_store.resolve():
                raise ValueError("review store must be Forge's kit/_staging/review.json")
            review_record = forge_reader.figure_review_record(str(staging_dir), str(frame), str(kit_dir))
            blocker = forge_reader.record_blocker(review_record, str(frame), str(review_store))
            if blocker:
                raise ValueError(f"{record['name']} dependency {dep_name!r} is not verified+stamped: {blocker}")


def partition_records(records: list[dict[str, Any]], workers: int, *, review_store: str | Path | None = None,
                      kit_dir: str | Path | None = None, forge_reader: Any = None,
                      prior_chain_workers: dict[str, str] | None = None,
                      historical_base_chain_ids: set[str] | None = None) -> list[list[dict[str, Any]]]:
    """Greedy W6 split by whole stage-chain components, request count, then canonical order."""
    if workers < 1:
        raise ValueError("workers must be positive")
    prior_chain_workers = prior_chain_workers or {}
    validate_frontier(records, review_store=review_store, kit_dir=kit_dir, forge_reader=forge_reader,
                      historical_chain_ids=historical_base_chain_ids or set())
    components: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        components.setdefault(record["chain_id"], []).append(record)
    ordered = sorted(components.items(), key=lambda row: (-sum(item["request_count"] for item in row[1]),
                                                           min(item["ordinal"] for item in row[1]), row[0]))
    partitions: list[list[dict[str, Any]]] = [[] for _ in range(workers)]
    loads = [0] * workers
    worker_indexes = {_worker_id(index): index - 1 for index in range(1, workers + 1)}
    for chain_id, component in ordered:
        owner = prior_chain_workers.get(chain_id)
        if owner is None:
            continue
        if owner not in worker_indexes:
            raise ValueError(f"chain_id {chain_id!r} is pinned to unavailable prior worker {owner!r}")
        target = worker_indexes[owner]
        partitions[target].extend(sorted(component, key=lambda item: item["ordinal"]))
        loads[target] += sum(item["request_count"] for item in component)
    for chain_id, component in ordered:
        if chain_id in prior_chain_workers:
            continue
        target = min(range(workers), key=lambda index: (loads[index], index))
        partitions[target].extend(sorted(component, key=lambda item: item["ordinal"]))
        loads[target] += sum(item["request_count"] for item in component)
    assigned = [item["name"] for partition in partitions for item in partition]
    if sorted(assigned) != sorted(item["name"] for item in records):
        raise ValueError("partition did not assign every item exactly once")
    return partitions


def _worker_id(index: int) -> str:
    return f"w{index:02d}"


def _prior_chain_workers(prior_plan_paths: Iterable[str | Path]) -> tuple[dict[str, str], set[str]]:
    owners: dict[str, str] = {}
    base_chain_ids: set[str] = set()
    for path in prior_plan_paths:
        plan = read_json(path)
        workers = plan.get("workers")
        if not isinstance(workers, list):
            raise ValueError(f"prior plan has no workers: {path}")
        for worker in workers:
            worker_id = worker.get("worker_id") if isinstance(worker, dict) else None
            chain_ids = worker.get("chain_ids") if isinstance(worker, dict) else None
            worker_bases = worker.get("base_chain_ids") if isinstance(worker, dict) else None
            if not isinstance(worker_id, str) or not isinstance(chain_ids, list) or not isinstance(worker_bases, list):
                raise ValueError(f"prior plan lacks chain ownership: {path}")
            for chain_id in chain_ids:
                if not isinstance(chain_id, str) or not chain_id:
                    raise ValueError(f"prior plan has an invalid chain_id: {path}")
                previous = owners.setdefault(chain_id, worker_id)
                if previous != worker_id:
                    raise ValueError(f"prior plans disagree on worker ownership for chain_id {chain_id!r}")
            if not set(worker_bases).issubset(chain_ids) or any(not isinstance(chain_id, str) or not chain_id for chain_id in worker_bases):
                raise ValueError(f"prior plan has an invalid base_chain_ids entry: {path}")
            base_chain_ids.update(worker_bases)
    return owners, base_chain_ids


def create_wave(input_path: str | Path, run_id: str, wave_id: str, run_dir: str | Path, *, workers: int,
                clean_parallel_rounds: int, worktree: str, org_dir: str, kit_dir: str, kit_rel: str,
                video_dir: str, review_store: str, forge_path: str, rate_usd: float,
                hard_cap_usd: float, max_provider_attempts: int,
                prior_plan_paths: Iterable[str | Path] = ()) -> dict[str, Any]:
    if workers > MAX_PROBE_CONCURRENCY:
        raise ValueError("K=4+ is refused: W6 permits no more than the measured three-worker probe")
    if workers > INITIAL_CONCURRENCY and not (workers == MAX_PROBE_CONCURRENCY and clean_parallel_rounds >= 2):
        raise ValueError("K=3 is legal only after two clean parallel K=2 rounds")
    if max_provider_attempts < 0 or rate_usd < 0 or hard_cap_usd < 0:
        raise ValueError("wave limits must be non-negative")
    if round(max_provider_attempts * rate_usd, 6) > round(hard_cap_usd, 6):
        raise ValueError("wave attempt cap exceeds hard spend stop")
    payload = read_json(input_path)
    records = normalized_records(payload, kit_dir, video_dir, org_dir)
    prior_chain_workers, historical_base_chain_ids = _prior_chain_workers(prior_plan_paths)
    partitions = partition_records(records, workers, review_store=review_store, kit_dir=kit_dir,
                                   forge_reader=_load_forge(forge_path), prior_chain_workers=prior_chain_workers,
                                   historical_base_chain_ids=historical_base_chain_ids)
    run_root = Path(run_dir)
    run_root.mkdir(parents=True, exist_ok=True)
    prefix = f"{run_id}.{wave_id}"
    review_sha = sha256_file(review_store)
    write_text(run_root / f"{prefix}.review-store.sha256", review_sha + "\n")
    lease_path = run_root / f"{prefix}.attempt-lease.json"
    write_json(lease_path, {"remaining": max_provider_attempts, "claimed": 0, "max_provider_attempts": max_provider_attempts})
    billing_path = run_root / f"{prefix}.billing-halt.json"
    plan_workers, commands = [], []
    for index, partition in enumerate(partitions, 1):
        worker_id = _worker_id(index)
        spec_path = run_root / f"{prefix}.{worker_id}.spec.json"
        write_json(spec_path, [record["raw"] for record in partition])
        assignment_rows = []
        for item_ordinal, record in enumerate(partition, 1):
            assignment_rows.append({"item_ordinal": item_ordinal, "partition_ordinal": index,
                                    "shot_id": record["shot_id"], "card_id": record["card_id"],
                                    "output_name": record["name"], "staging_slot": record["staging_slot"],
                                    "promotion_slot": record["promotion_slot"], "chain_id": record["chain_id"],
                                    "dependency_depth": record["dependency_depth"], "references": record["references"]})
        dispatch_path = run_root / f"{prefix}.{worker_id}.launch.json"
        dispatch = {"schema": DISPATCH_SCHEMA, "run_id": run_id, "wave_id": wave_id, "worker_id": worker_id,
                    "worktree": worktree, "org_dir": org_dir, "kit_rel": kit_rel, "forge_path": forge_path,
                    "wave_ordinal": int(re.sub(r"\D", "", wave_id) or 0),
                    "worker_spec": {"path": str(spec_path), "sha256": sha256_file(spec_path)},
                    "review_store_path": str(Path(review_store)), "review_store_sha256": review_sha,
                    "assignments": assignment_rows, "item_spec_dir": str(run_root),
                    "result_path": str(run_root / f"{prefix}.{worker_id}.results.json"),
                    "genlog_path": str(run_root / f"{prefix}.{worker_id}.genlog.jsonl"),
                    "attempt_lease_path": str(lease_path), "billing_halt_path": str(billing_path),
                    "limits": {"concurrency": workers, "stall_seconds": 240, "stall_reissues": 1,
                               "rate_usd": rate_usd, "hard_cap_usd": hard_cap_usd,
                               "max_provider_attempts": max_provider_attempts},
                    "prohibitions": ["no-improvisation", "no-force", "no-stamp", "no-promote", "no-manifest-edit",
                                     "no-review-store-write", "no-shots-edit"]}
        write_json(dispatch_path, dispatch)
        command = f'{sys.executable} "{WORKER}" --dispatch "{dispatch_path}"'
        commands.append(command)
        plan_workers.append({"worker_id": worker_id, "spec": str(spec_path), "dispatch": str(dispatch_path),
                             "output_names": [record["name"] for record in partition],
                             "chain_ids": sorted({record["chain_id"] for record in partition}),
                             "base_chain_ids": sorted({record["chain_id"] for record in partition
                                                       if str(record["raw"].get("stage_role", "")).lower() == "base"}
                                                      | ({record["chain_id"] for record in partition} & historical_base_chain_ids)),
                             "provider_request_count": sum(record["request_count"] for record in partition)})
    plan = {"schema": "image-gen-wave-plan@1", "run_id": run_id, "wave_id": wave_id,
            "canonical_input": {"path": str(Path(input_path)), "sha256": sha256_file(input_path)},
            "review_store_path": str(Path(review_store)), "review_store_sha256": review_sha,
            "concurrency": workers, "workers": plan_workers,
            "max_provider_attempts": max_provider_attempts, "hard_cap_usd": hard_cap_usd, "commands": commands}
    write_json(run_root / f"{prefix}.plan.json", plan)
    write_json(run_root / f"{prefix}.launch-manifest.json", {"schema": "image-gen-wave-launch@1", "commands": commands})
    return plan


def _segment_key(path: Path) -> tuple[int, str]:
    match = re.search(r"\.w(\d+)\.genlog\.jsonl$", path.name)
    if not match:
        raise ValueError(f"not a worker genlog segment: {path}")
    return int(match.group(1)), path.name


def merge_genlogs(segments: Iterable[str | Path], output: str | Path, run_id: str, wave_id: str) -> bool:
    """Append validated segments in worker-id order once; return True only for a new merge."""
    paths = sorted((Path(path) for path in segments), key=_segment_key)
    lines, seen = [], set()
    for path in paths:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSONL {path}:{line_number}") from exc
            required = {"run_id", "wave_id", "worker_id", "output_name", "attempt_no"}
            expected_worker = f"w{_segment_key(path)[0]:02d}"
            if required - set(record) or record["run_id"] != run_id or record["wave_id"] != wave_id or record["worker_id"] != expected_worker:
                raise ValueError(f"invalid genlog envelope {path}:{line_number}")
            key = (record["output_name"], record["attempt_no"])
            if not key[0] or not isinstance(key[1], int) or key in seen:
                raise ValueError(f"duplicate or invalid genlog key {key}")
            seen.add(key)
            lines.append(json.dumps(record, sort_keys=True, ensure_ascii=False))
    digest = hashlib.sha256(("\n".join(lines) + "\n").encode("utf-8")).hexdigest()
    marker = f"<!-- wave-genlog-merge run={run_id} wave={wave_id} sha256={digest} -->"
    target = Path(output)
    existing = target.read_text(encoding="utf-8") if target.exists() else ""
    if marker in existing:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8", newline="\n") as handle:
        if existing and not existing.endswith("\n"):
            handle.write("\n")
        handle.write(marker + "\n")
        for line in lines:
            handle.write(line + "\n")
    return True


def merge_results(results: Iterable[str | Path], output: str | Path, run_id: str, wave_id: str,
                  *, expected_worker_ids: Iterable[str] | None = None) -> bool:
    """Validate worker returns and materialize the W6 deterministic merged-result artifact."""
    from wave_worker import validate_result

    merged, output_names, worker_ids = [], set(), set()
    for path in sorted((Path(path) for path in results), key=lambda item: item.name):
        result = validate_result(read_json(path))
        if result["run_id"] != run_id or result["wave_id"] != wave_id:
            raise ValueError(f"result envelope mismatch: {path}")
        if result["worker_id"] in worker_ids:
            raise ValueError(f"duplicate worker result: {result['worker_id']}")
        worker_ids.add(result["worker_id"])
        for item in result["items"]:
            if item["output_name"] in output_names:
                raise ValueError(f"duplicate result output: {item['output_name']}")
            output_names.add(item["output_name"])
        merged.append(result)
    if expected_worker_ids is not None:
        expected = set(expected_worker_ids)
        unexpected = sorted(worker_ids - expected)
        missing = sorted(expected - worker_ids)
        if unexpected:
            raise ValueError(f"unexpected worker results: {', '.join(unexpected)}")
        if missing:
            raise ValueError(f"missing dispatched worker results: {', '.join(missing)}")
    payload = {"schema": "image-gen-wave-results@1", "run_id": run_id, "wave_id": wave_id,
               "workers": merged}
    target = Path(output)
    if target.exists():
        if read_json(target) != payload:
            raise FileExistsError(f"refusing to overwrite differing merged results: {target}")
        return False
    write_json(target, payload)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    plan = subparsers.add_parser("plan")
    plan.add_argument("--input", required=True); plan.add_argument("--run-id", required=True); plan.add_argument("--wave-id", required=True)
    plan.add_argument("--run-dir", required=True); plan.add_argument("--workers", type=int, default=INITIAL_CONCURRENCY)
    plan.add_argument("--clean-parallel-rounds", type=int, default=0); plan.add_argument("--worktree", required=True)
    plan.add_argument("--org-dir", required=True); plan.add_argument("--kit-dir", required=True); plan.add_argument("--kit-rel", required=True)
    plan.add_argument("--video-dir", required=True); plan.add_argument("--review-store", required=True); plan.add_argument("--forge-path", required=True)
    plan.add_argument("--rate-usd", type=float, required=True); plan.add_argument("--hard-cap-usd", type=float, required=True)
    plan.add_argument("--max-provider-attempts", type=int, required=True)
    plan.add_argument("--prior-plan", action="append", default=[])
    merge = subparsers.add_parser("merge_genlogs")
    merge.add_argument("--run-dir", required=True); merge.add_argument("--run-id", required=True); merge.add_argument("--wave-id", required=True)
    merge.add_argument("--out")
    result_merge = subparsers.add_parser("merge_results")
    result_merge.add_argument("--run-dir", required=True); result_merge.add_argument("--run-id", required=True); result_merge.add_argument("--wave-id", required=True)
    args = parser.parse_args()
    if args.command == "plan":
        result = create_wave(args.input, args.run_id, args.wave_id, args.run_dir, workers=args.workers,
                             clean_parallel_rounds=args.clean_parallel_rounds, worktree=args.worktree, org_dir=args.org_dir,
                             kit_dir=args.kit_dir, kit_rel=args.kit_rel, video_dir=args.video_dir,
                             review_store=args.review_store, forge_path=args.forge_path, rate_usd=args.rate_usd,
                             hard_cap_usd=args.hard_cap_usd, max_provider_attempts=args.max_provider_attempts,
                             prior_plan_paths=args.prior_plan)
        print("\n".join(result["commands"]))
    elif args.command == "merge_genlogs":
        run_dir = Path(args.run_dir)
        plan = read_json(run_dir / f"{args.run_id}.{args.wave_id}.plan.json")
        if sha256_file(plan["review_store_path"]) != plan["review_store_sha256"]:
            raise SystemExit("HALT-INTEGRITY: review store changed during generation read window")
        segments = sorted(run_dir.glob(f"{args.run_id}.{args.wave_id}.w*.genlog.jsonl"))
        output = args.out or run_dir / f"{args.run_id}.{args.wave_id}.genlog.merged.jsonl"
        merge_genlogs(segments, output, args.run_id, args.wave_id)
    else:
        run_dir = Path(args.run_dir)
        plan = read_json(run_dir / f"{args.run_id}.{args.wave_id}.plan.json")
        if sha256_file(plan["review_store_path"]) != plan["review_store_sha256"]:
            raise SystemExit("HALT-INTEGRITY: review store changed during generation read window")
        paths = sorted(run_dir.glob(f"{args.run_id}.{args.wave_id}.w*.results.json"))
        merge_results(paths, run_dir / f"{args.run_id}.{args.wave_id}.results.merged.json", args.run_id, args.wave_id,
                      expected_worker_ids=[worker["worker_id"] for worker in plan["workers"]])


if __name__ == "__main__":
    main()
