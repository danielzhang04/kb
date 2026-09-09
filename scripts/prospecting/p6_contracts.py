from __future__ import annotations

import hashlib
import inspect
import json
import re
import sqlite3
import subprocess
from pathlib import Path
from typing import Callable


PHASES = ("P1", "P2", "P3", "P4", "P5")
EXPECTED_TABLES = {
    "company", "person", "source_observation", "employment", "merge_review",
    "fit_score_version", "fit_score", "eligibility_decision", "contact_point",
    "provider_attempt", "credit_reservation", "finder_run", "finder_cursor",
    "source_snapshot", "campaign", "evidence", "revision", "reply_template", "approval",
    "enrollment", "delivery", "inbound", "reply_revision", "exec_request", "suppression",
    "relationship", "audit",
}
EXPECTED_TRIGGERS = {"audit_append_only", "audit_delete_append_only"}
EXPECTED_PII_GUARD_LINE = "py -3 -m scripts.prospecting.pii_guard --staged || exit 1"

# SHA-256 fingerprints of the exact foreign-key, CHECK, and UNIQUE declarations
# returned by a freshly migrated P6 store.  The triplets are (foreign_key, check,
# unique), in P1 table order; the source declaration text is normalized only for
# whitespace before hashing.
EXPECTED_CONSTRAINT_FINGERPRINTS = {
    'schema_version': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '13ea51d353f39588631d9bd9a343ef8149fd0c0d63fe92536c1d10b3900d1a4a', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'schema_migrations': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'sender_profile': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '64c09bd977fb501b65eac0724232eb4207f4b559c24f7ea62b8522ed0da695b6', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'company': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '1ff1e501dd6352caef51c1b4c3851bfa8805de9f3504d52d099179b4325489f4', '4e3e692352557bb2a664a9100acc641fd26c6f222b62daaf728f6166fa85cedd'),
    'person': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '38ded9cbf4868bb460809782f3a68a2c3d90acf7c7d4cf8b1ba7338ab853c0d7', '4e3e692352557bb2a664a9100acc641fd26c6f222b62daaf728f6166fa85cedd'),
    'campaign': ('0811977b47bc3079342e9f8cdfcbae9da18ca62a6a87a49ad66995985c1165ea', '154050ddce41e22ffc547e715690cbdb92d070a63c7ce93464204086e9c6b6ab', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'source_snapshot': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', 'afa177a12dda073d5c248924d28f76b6ba385e9a113f325440c3e02b00ec41cc', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'source_observation': ('5144d364fcb29d0c8367ef212bd4afc30aaf303664e57d78f4e12645df95de58', '7b50f66bcdf9f77b9f017890efc78f732b868ea4dcf0296fe3658c90fe89591b', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'employment': ('fd31caff618872143ddcf8db20e4f6b1d9f4a2f6524491e491bafa6f26e6e01e', 'fb7d4857062f2068de163b9785dbb39f6e5403afba02c34971589038adc0949f', 'a643a1396279feb2e0191bfdddf3b7e0d3561399ad7c92314d1ee3f1a1973698'),
    'merge_review': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '7ecd749bc19f795b13cb5a3612d53a81d9e07ad35b30ebd0a78f534103226ff7', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'fit_score_version': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '4e86e263d3f28d7416225c714dfbe06cea608eadbf9489ca19b545622755506d', 'c38202c7fe3e762470efc0a3141dabf87332975e26d6c6dd3a80c43f17706bdd'),
    'fit_score': ('fe50d7a8ba46a10d699dae2a5e8cb0afb4a13b8ed2286e78ab9f66c6f5cda1f7', 'bad8c935400d04803f84c3c206c06668739dbbdbd15760e868a6ff2d53906029', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'predicate_override': ('3649f555d0baa8f9164b6653d83f7631e384eef06e616f70f5645b0d9d441dd4', 'e6ad7fbcd925d52a3bc0d201e60d56c5d26eba390daf49860db97ca2999ea24f', '64e86d986b1f5bd40291a68945feea973d969f4470f3d29322b2e1aa6997c87c'),
    'eligibility_decision': ('eadff05c1317a58cb4d469cf1b190c9a576bc3ecf947c299e6fef5347341a176', '7167e3fddbf55cf668c8a327eb5a4d66414b2a8135ba3baf9f9b3fbe596649ef', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'fit_veto': ('659a7e2f2f6f17cdb12b61ffcc1ccae9b8d425a8eee2779a6f1a8f9cfa9739a0', '74666f6ab1c9e14a7c3bfded84f8fdfbca8a712093aa6c747c50ca65312a3908', '0019077a1d78de83ff26dcd98557ae4b2ff2c5f70c6358863287a9dac05be226'),
    'contact_point': ('19bbf6f5e6001835ce7f57f7d49dd6d010569fa40c988de896cb32e7e6d51439', 'f1e9a579607387e929a575ac4f052526eecac7cd2105c2a5ea0984c36aed0a4b', 'c073f533d846b2a706fd7e8c56dceb6f4ebce29fca727cfc588502bce9a1538f'),
    'evidence': ('cce39a4e559db850afe94957af392a3417fb370474ad0c9511ab5dc47818184d', '985c5651a8673599e3bb41752c4659f4c62f4b3d80a707e501646940b970be36', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'revision': ('659a7e2f2f6f17cdb12b61ffcc1ccae9b8d425a8eee2779a6f1a8f9cfa9739a0', 'bf3e45c3fd335d7b26cb4ec0e4ec28a7b06f1d7e0d6ca99e47f33a9e6824b306', '83666f6254ccd420846939e1a4ae103515231dc8fd9fa5ae682d05bcfd00a6e8'),
    'reply_template': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', 'a43dbbbb52a6511f2f5ae1250f8466935d6f7ac30e4edd04b66572a13213a163', 'a2e5589980a36d91c555fc3a1c671bade6723aec226dc476938500ec6c1f0b4a'),
    'approval': ('a73f46986ab61fdf9fe9febce1f172537a8be81a75d48723ab6ff5833444f756', 'd2eb9f1f0a8e55b253101389889ff2d1aa8130e01f1541d7d7d6d7123591d4f2', '10d047f3d40ebd79474cf621f7a4c70cec8e7d7d5a78203c71876857d39af5a4'),
    'exec_request': ('6c4eef9c3a60a687532a336e3f47dafb9a94e4369f7f8d47948d584f18b3cc2f', '4f3b26ecba8a345099e6b35c261d9c35a921ad714dd3775bad9beee9b2ea7a9a', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'provider_attempt': ('cce39a4e559db850afe94957af392a3417fb370474ad0c9511ab5dc47818184d', 'c2d33677f7d9bfcc8abf0a2ea647f39d128fdcb3564727b3061843dab08cac6a', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'credit_reservation': ('6919caf460dedcc06eaa0d32ffb3701dc4d4fc663c309d6c3c62f154ec595000', 'b259ba51c17538ff7a939e183dff6a3c7532a583e79f15ef7773d6f4ba515e06', '24b365e6f0db03ba80a76f7b4cad78a39585db6cce252b7acc62f8ab129d1ceb'),
    'finder_run': ('3649f555d0baa8f9164b6653d83f7631e384eef06e616f70f5645b0d9d441dd4', '62695b602e649662993ad1968ae2ee0781a0a7eca3bb0fb246f0d6a0ec998e0a', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'finder_cursor': ('7555725713b459e610164e2898e9af1bb6492811bcbcd9b98eea39d5b6daac2c', '2fa8f5e0f1ba5f530fc10b442272438ca3c7750d92f196ce6b8da4f47b202333', '0f9f9c3f5c73362de99bc7daccbb1c22b21ec5d90c0de5e140cfd1eff22e03f8'),
    'enrollment': ('659a7e2f2f6f17cdb12b61ffcc1ccae9b8d425a8eee2779a6f1a8f9cfa9739a0', '2f605c884960c63933ab10aa237deb61c19a0820878d7d1e01cee2c6732aae71', '31f2894e4a39c3bf32c596a0414541739e76674600d52e2ed26657cb9cef7366'),
    'delivery': ('67875e60222bbfe55d061e6ae90585ce76bf5be848340ab99d450e20f5e2af25', 'f580fe4af15da4cc27d3972eb29af07383dc1ce74f79c922b66e97bceee1d169', '0d7c41bfa9ef5aa8e56bac92296e0db1f3fba3c5c004d150783e147458152e62'),
    'inbound': ('066ce6934c603bb942fe06818d7533142752fb04c074027133602533c028015a', '09d10d29414053537f150cad00e06057889e476e87b122f04342c77d5b197a31', '43e6ce6fb92a11ff0b5095b68366bcf08faba1f1661d20d13fe4e11eeedaaa4d'),
    'reply_revision': ('33010f6b109edf5794d7402eea9deb869e5bb843756da65ad7f1f83bae75d878', 'bb9c6a9426441e469779722d84531ecb4c8d6f5e1c76f7e35653ae221c6a2c29', '83666f6254ccd420846939e1a4ae103515231dc8fd9fa5ae682d05bcfd00a6e8'),
    'suppression': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '126ca342e2785f26237da809481c32f7d6b6cd4352b65d4a25e9c29ae7cc29b4', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'relationship': ('cce39a4e559db850afe94957af392a3417fb370474ad0c9511ab5dc47818184d', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
    'audit': ('2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d', '2e38e77b22c314a449e91fafed92a43826ac6aa403ae6a8acb6cf58239fbaf5d'),
}
EXPECTED_TRIGGER_SQL = {
    "audit_append_only": "create trigger audit_append_only before update on audit begin select raise(abort, 'audit_is_append_only'); end",
    "audit_delete_append_only": "create trigger audit_delete_append_only before delete on audit begin select raise(abort, 'audit_is_append_only'); end",
}


def verify_prerequisites(
    root: Path, runner: Callable = subprocess.run, pending_ok: bool = False,
) -> dict[str, object]:
    hashes: dict[str, str] = {}
    pending: list[str] = []
    for phase in PHASES:
        argv = [
            "py", "-3", "-m", "scripts.prospecting.gate",
            "--phase", phase, "--verify-recorded",
        ]
        result = runner(argv, cwd=root, text=True, capture_output=True, check=False)
        try:
            value = json.loads(result.stdout)
        except (TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"invalid_recorded_gate:{phase}") from exc
        if "phase" in value and value["phase"] != phase:
            raise RuntimeError(f"invalid_recorded_gate:{phase}")
        legacy_matched = value.get("recorded") == "matched" and value.get("passed") is True
        current_matched = value.get("matched") is True and value.get("status") == "passed"
        if value.get("recorded") == "absent":
            if pending_ok and phase != "P1":
                pending.append(phase)
                continue
            raise RuntimeError(f"recorded_gate_absent:{phase}")
        if result.returncode != 0 or not (legacy_matched or current_matched):
            raise RuntimeError(f"recorded_gate_failed:{phase}")
        hashes[phase] = hashlib.sha256(result.stdout.encode()).hexdigest()
    return {"phases": list(PHASES), "record_sha256": hashes, "pending": pending}


def validate_schema(connection: sqlite3.Connection) -> tuple[str, ...]:
    objects = connection.execute(
        "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')"
    ).fetchall()
    tables = {name for kind, name, sql in objects if kind == "table" and not name.startswith("sqlite_")}
    trigger_sql = {name: sql or "" for kind, name, sql in objects if kind == "trigger"}
    errors = [f"table:{name}" for name in sorted(EXPECTED_TABLES - tables)]
    for table, expected in EXPECTED_CONSTRAINT_FINGERPRINTS.items():
        if table not in tables:
            errors.append(f"table:{table}")
            continue
        actual = _constraint_fingerprints(connection, table)
        for category, got, required in zip(("foreign_key", "check", "unique"), actual, expected):
            if got != required:
                errors.append(f"{category}:{table}")
    for name, expected_sql in EXPECTED_TRIGGER_SQL.items():
        actual_sql = trigger_sql.get(name)
        if actual_sql is None:
            errors.append(f"trigger:{name}")
        elif _normalize_sql(actual_sql) != expected_sql:
            errors.append(f"trigger:{name}:body")
    if connection.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
        errors.append("pragma:journal_mode")
    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        errors.append("pragma:foreign_keys")
    return tuple(errors)


def _normalize_sql(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).lower()


def _check_declarations(sql: str) -> tuple[str, ...]:
    declarations: list[str] = []
    position = 0
    lowered = sql.lower()
    while (match := re.search(r"\bcheck\s*\(", lowered[position:])) is not None:
        start = position + match.start()
        open_paren = position + match.end() - 1
        depth = 0
        for end in range(open_paren, len(sql)):
            if sql[end] == "(":
                depth += 1
            elif sql[end] == ")":
                depth -= 1
                if depth == 0:
                    declarations.append(_normalize_sql(sql[start:end + 1]))
                    position = end + 1
                    break
    return tuple(declarations)


def _constraint_fingerprints(connection: sqlite3.Connection, table: str) -> tuple[str, str, str]:
    foreign_keys = tuple(sorted(
        tuple(row[3:8]) for row in connection.execute(f'PRAGMA foreign_key_list("{table}")')
    ))
    table_sql = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()[0]
    unique_indexes = []
    for row in connection.execute(f'PRAGMA index_list("{table}")'):
        if row[2] and row[3] != "pk":
            name = row[1]
            columns = tuple(item[2] for item in connection.execute(f'PRAGMA index_info("{name}")'))
            index_sql = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name=?", (name,)
            ).fetchone()[0] or ""
            unique_indexes.append((row[3], columns, _normalize_sql(index_sql)))
    declarations = (foreign_keys, _check_declarations(table_sql), tuple(sorted(unique_indexes)))
    return tuple(hashlib.sha256(repr(value).encode()).hexdigest() for value in declarations)  # type: ignore[return-value]


def validate_pre_commit_hook(root: Path) -> tuple[str, ...]:
    lines = (root / ".githooks/pre-commit").read_text(encoding="utf-8").splitlines()
    retained = lines[3:18]
    errors = []
    if len(retained) != 15 or not any("skill" in line.lower() for line in retained):
        errors.append("hook:retention")
    if lines.count(EXPECTED_PII_GUARD_LINE) != 1:
        errors.append("hook:pii_guard")
    return tuple(errors)


def validate_runtime_contracts() -> tuple[str, ...]:
    from scripts.prospecting.campaigner.cli import CampaignerService
    from scripts.prospecting.campaigner.release import release_due
    from scripts.prospecting.campaigner.wiring import attach_campaigner, attach_gmail
    from scripts.prospecting.executor import validate_exec_request
    from scripts.prospecting.executor_campaigner import (
        OPERATION_HANDLERS,
        execute_gmail_draft,
        execute_linearized_draft,
    )
    from scripts.prospecting.manager.bridge import DesktopBridge, SshStager

    checks = {
        "release_due": (release_due, ("context", "delivery_id")),
        "scan": (CampaignerService.scan, ("self",)),
        "sweep": (CampaignerService.sweep, ("self",)),
        "status": (CampaignerService.status, ("self",)),
        "executor_validator": (validate_exec_request, ("request", "campaign_tier", "connection", "now")),
        "bridge": (
            DesktopBridge,
            (
                "job_dir", "launch", "stage", "cleanup", "terminate_tree",
                "remote_terminate_tree", "allowed_hosts", "local_app_data",
                "store_path", "repo_root",
            ),
        ),
        "bridge_invoke": (DesktopBridge.invoke, ("self", "agent_cli", "job", "mode", "host", "timeout")),
        "stager_stage": (SshStager.stage, ("self", "path", "host", "timeout")),
        "stager_cleanup": (SshStager.cleanup, ("self", "host", "remote", "timeout")),
        "attach_gmail": (attach_gmail, ("executor", "backend")),
        "attach_campaigner": (attach_campaigner, ("executor", "backend", "persist_inbound", "inject", "now")),
        "linearized_draft": (execute_linearized_draft, ("context", "delivery_id")),
        "gmail_draft": (execute_gmail_draft, ("connection", "gmail", "revision_id", "contact_id", "mailbox_id")),
    }
    errors = []
    for name, (callable_, expected) in checks.items():
        names = tuple(inspect.signature(callable_).parameters)
        if names != expected:
            errors.append(f"{name}:signature:{','.join(names)}")
    if tuple(OPERATION_HANDLERS) != ("gmail_draft",):
        errors.append("gmail_draft:handler")
    elif OPERATION_HANDLERS["gmail_draft"] is not execute_gmail_draft:
        errors.append("gmail_draft:handler_target")
    return tuple(errors)
