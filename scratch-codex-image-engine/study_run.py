#!/usr/bin/env python3
"""The codex-engine register study ladder (spec §7.3). BUILT AND TESTED at P4; RUN at P5 only,
behind Daniel's gate, under a HARD 40-generation budget. $0 (subscription).

Rungs:
  L0  baseline composer, 4 shots x 2 reps                              = 8 gens
  L1  style tile as an ink/register seed, 2 variants x 4 shots x 2 reps <= 16 gens
  L2  format length (labeled schema vs minimal prose), 4 shots x 2 reps = 8 gens
  L3  canvas choice: re-normalize the SAME renders to 1K vs 2K          = 0 gens
No lever gets a third variant: a third wording is where an unbounded chase starts.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import study_metrics as sm  # noqa: E402

GEN_BUDGET = 40
REPS = 2
EARLY_STOP_DELTA = 3.0
CORPUS = sm.CORPUS

LEVER_VARIANTS = {
    "L0": ("base",),
    "L1": ("tile-on", "tile-on-short-label"),
    "L2": ("format2-labeled", "format3-minimal"),
    "L3": (),                       # zero-gen: re-normalizes existing renders
}


class BudgetExceeded(RuntimeError):
    pass


class Budget:
    def __init__(self, total=GEN_BUDGET):
        self.total = int(total)
        self.used = 0

    @property
    def remaining(self):
        return self.total - self.used

    def spend(self, n=1):
        if self.used + n > self.total:
            raise BudgetExceeded(f"generation budget exhausted: {self.used}+{n} > {self.total} "
                                 f"(plan-approved study budget is {GEN_BUDGET})")
        self.used += n


def ladder(levers=("L0", "L1", "L2", "L3")):
    cells = []
    for lever in levers:
        variants = LEVER_VARIANTS[lever]
        if not variants:
            continue
        # L2 compares two formats but spends only 8 gens: one rep per format per shot.
        reps = 1 if lever == "L2" else REPS
        for shot in CORPUS:
            for variant in variants:
                for rep in range(1, reps + 1):
                    cells.append({"lever": lever, "shot": shot, "variant": variant,
                                  "rep": rep, "gens": 1})
    return cells


def _key(cell):
    return f"{cell['lever']}|{cell['shot']}|{cell['variant']}|{cell['rep']}"


def load_results(path):
    if not os.path.isfile(path):
        return []
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def append_result(path, row):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")


def run_study(*, cells, generate_fn, measure_fn, results_path, budget, baseline_m1=None):
    """Walk the ladder, banking each cell to `results_path` the moment it lands (a crash mid-run
    never loses spent generations). Stops a lever whose |dM1| worsens by more than 3 against the
    best so far -- never rescues it with a third wording."""
    done = {(_key(r)) for r in load_results(results_path)}
    best_d_m1 = min([r["d_m1"] for r in load_results(results_path) if "d_m1" in r] or [None]) \
        if any("d_m1" in r for r in load_results(results_path)) else None
    stopped, used, skipped = [], 0, 0
    for cell in cells:
        if cell["lever"] in stopped:
            continue
        if _key(cell) in done:
            skipped += 1
            continue
        budget.spend(cell["gens"])
        png = generate_fn(cell)
        metrics = measure_fn(png)
        row = dict(cell, png=png, **metrics)
        if baseline_m1 is not None and cell["shot"] in baseline_m1:
            row["d_m1"] = abs(metrics["m1"] - baseline_m1[cell["shot"]])
        append_result(results_path, row)
        used += cell["gens"]
        if "d_m1" in row:
            if best_d_m1 is not None and row["d_m1"] > best_d_m1 + EARLY_STOP_DELTA:
                stopped.append(cell["lever"])
                print(f"  == lever {cell['lever']} STOPPED: |dM1| {row['d_m1']:.1f} is more than "
                      f"{EARLY_STOP_DELTA} worse than the best so far ({best_d_m1:.1f}) ==",
                      flush=True)
                continue
            best_d_m1 = row["d_m1"] if best_d_m1 is None else min(best_d_m1, row["d_m1"])
    return {"gens_used": used, "skipped": skipped, "stopped_levers": stopped,
            "budget_remaining": budget.remaining, "results_path": results_path}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan-only", action="store_true",
                    help="print the ladder and its gen cost; spend nothing")
    ap.add_argument("--levers", default="L0,L1,L2,L3")
    a = ap.parse_args(argv)
    cells = ladder(tuple(x.strip() for x in a.levers.split(",") if x.strip()))
    print(json.dumps({"cells": len(cells), "gens": sum(c["gens"] for c in cells),
                      "budget": GEN_BUDGET}, indent=2))
    if not a.plan_only:
        print("Running the study is a P5 step behind a human gate. Re-run with --plan-only, or "
              "drive run_study() from the P5 runbook with forge_codex as generate_fn.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
