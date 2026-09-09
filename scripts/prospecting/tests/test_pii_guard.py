import json
import shutil
import subprocess
from pathlib import Path

import pytest

from scripts.prospecting.pii_guard import (
    GATE_MANIFEST_PATHS,
    PIIClass,
    PIIGuardError,
    VM_SINKS,
    assert_vm_safe,
    find_text_classes,
)

ROOT = Path(__file__).parents[3]
FIXTURES = ROOT / "orgs" / "prospecting" / "fixtures"
FIXTURE = FIXTURES / "pii-cases.json"
REVIEW_FIXTURE = FIXTURES / "review-synthetic.json"
NODEIDS_FIXTURE = FIXTURES / "staging-synthetic-nodeids.json"
REAL_HOOK = ROOT / ".githooks" / "pre-commit"


def _cases() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _case(pii_class: str) -> dict[str, object]:
    return next(item for item in _cases()["cases"] if item["class"] == pii_class)


def _git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=repo, text=True, capture_output=True, check=check
    )


def _temp_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir(parents=True)
    _git(repo, "init")
    _git(repo, "config", "user.name", "pii-test")
    _git(repo, "config", "user.email", "pii-test" + chr(64) + "agents.invalid")
    package = repo / "scripts" / "prospecting"
    package.mkdir(parents=True)
    (repo / "scripts" / "__init__.py").write_text("", encoding="utf-8")
    (package / "__init__.py").write_text("", encoding="utf-8")
    shutil.copy2(Path(__file__).parents[1] / "pii_guard.py", package / "pii_guard.py")
    nodeids = repo / "orgs" / "prospecting" / "fixtures"
    nodeids.mkdir(parents=True)
    shutil.copy2(NODEIDS_FIXTURE, nodeids / NODEIDS_FIXTURE.name)
    (repo / "scripts" / "sync_skills.py").write_text(
        "from pathlib import Path\n"
        "raise SystemExit(1 if Path('sync-fail').exists() else 0)\n",
        encoding="utf-8",
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "baseline")
    hooks = repo / ".githooks"
    hooks.mkdir()
    shutil.copy2(REAL_HOOK, hooks / "pre-commit")
    _git(repo, "config", "core.hooksPath", ".githooks")
    return repo


def _commit_content(repo: Path, relative: str, content: str) -> subprocess.CompletedProcess[str]:
    path = repo / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    _git(repo, "add", relative)
    return _git(repo, "commit", "-m", "candidate", check=False)


def _commit_bytes(repo: Path, relative: str, content: bytes) -> subprocess.CompletedProcess[str]:
    path = repo / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    _git(repo, "add", relative)
    return _git(repo, "commit", "-m", "candidate", check=False)


def test_31_every_pii_class_is_caught_at_every_vm_sink(record_property) -> None:
    cases = _cases()
    names = tuple(cases["known_names"])
    observed: set[str] = set()
    blocked = 0
    for case in cases["cases"]:
        observed.add(case["class"])
        pattern_value = (
            "".join(case["pattern_parts"])
            if "pattern_parts" in case else case["pattern_value"]
        )
        for sink in VM_SINKS:
            with pytest.raises(PIIGuardError) as structural:
                assert_vm_safe({"kind": sink, "fields": {case["field"]: case["value"]}}, sink, names)
            assert structural.value.pii_class.value == case["class"]
            blocked += 1
            with pytest.raises(PIIGuardError) as patterned:
                assert_vm_safe({"kind": sink, "fields": {"opaque_value": pattern_value}}, sink, names)
            assert patterned.value.pii_class.value == case["class"]
            blocked += 1
            assert case["value"] not in str(structural.value)
            assert pattern_value not in str(patterned.value)
    assert observed == {item.value for item in PIIClass}
    record_property("pii_class_sink_combinations", blocked)


def test_32_typed_opaque_payload_is_safe() -> None:
    payload = {"campaign_id": "campaign-1", "count": 20, "result_code": "eligible"}
    for sink in VM_SINKS:
        assert_vm_safe({"kind": sink, "fields": payload}, sink, ("Casey Example",))


def test_gate_summary_shape_passes_vm_guard() -> None:
    summary = {
        "interpreter_path_sha256": "a" * 64,
        "git_head": "b" * 40,
        "completed_at": "2026-09-03T14:25:36.123Z",
        "artifact_hashes": {"gate_manifest": "c" * 64},
        "run": {"run_id": "run_0123456789abcdef", "opaque_id": "d" * 16},
        "counts": {"passed": 8, "failed": 0},
    }
    assert_vm_safe({"kind": "stdout", "fields": summary}, "stdout")

    unsafe_summary = {**summary, "run": {"opaque_value": "+" + "44 20 7946 0958"}}
    with pytest.raises(PIIGuardError) as error:
        assert_vm_safe({"kind": "stdout", "fields": unsafe_summary}, "stdout")
    assert error.value.pii_class is PIIClass.PHONE


def test_33_guard_error_never_echoes_payload() -> None:
    secret_value = "Casey Example"
    with pytest.raises(PIIGuardError) as error:
        assert_vm_safe({"kind": "exceptions", "fields": {"name": secret_value}}, "exceptions", (secret_value,))
    assert secret_value not in str(error.value)
    assert "name" in str(error.value)


def test_34_email_detector_decodes_percent_encoding() -> None:
    encoded = _case("email")["pattern_value"]
    assert PIIClass.EMAIL in find_text_classes(encoded)


def test_34a_email_and_phone_detectors_decode_json_unicode_escapes() -> None:
    encoded_email = "casey" + "\\u0040" + "example.test"
    encoded_phone = "+" + "\\u0034\\u0034" + " 20 7946 0958"
    assert PIIClass.EMAIL in find_text_classes(encoded_email)
    assert PIIClass.PHONE in find_text_classes(encoded_phone)


def test_35_phone_detector_catches_synthetic_range() -> None:
    phone = "+1-" + "202" + "-555" + "-0142"
    assert PIIClass.PHONE in find_text_classes(phone)


@pytest.mark.parametrize("opaque_id", (
    "123e4567-e89b-12d3-a456-426614174000",
    "0123456789abcdef",
    "run_ab12cd34ef56ab78",
    "2026-09-03T14:25:36.123Z",
), ids=("uuid", "hex16", "run-id", "timestamp"))
def test_35a_opaque_ids_and_timestamps_are_not_pii(opaque_id: str) -> None:
    assert not find_text_classes(opaque_id)


def test_35b_phone_next_to_opaque_uuid_is_caught() -> None:
    value = "123e4567-e89b-12d3-a456-426614174000 " + _case("phone")["value"]
    assert PIIClass.PHONE in find_text_classes(value)


@pytest.mark.parametrize("phone", (
    "+" + "44 20 7946 0958",
    "+" + "33 1 42 68 53 00",
    "00" + "44 (20) 7946-0958",
), ids=("uk", "fr", "uk-00"))
def test_35c_phone_detector_catches_international_forms(phone: str) -> None:
    assert PIIClass.PHONE in find_text_classes(phone)


def test_36_profile_detector_catches_encoded_content_without_sensitive_key() -> None:
    value = "https%3A%2F%2Fwww.linkedin" + ".com%2Fin%2Fsynthetic-case"
    with pytest.raises(PIIGuardError) as error:
        assert_vm_safe({"kind": "cards", "fields": {"opaque_value": value}}, "cards")
    assert error.value.pii_class is PIIClass.PROFILE_URL


def test_36a_runtime_guard_scans_dictionary_keys() -> None:
    with pytest.raises(PIIGuardError) as error:
        assert_vm_safe({"kind": "cards", "fields": {"casey" + chr(64) + "example.test": "opaque"}}, "cards")
    assert error.value.pii_class is PIIClass.EMAIL


def test_36b_runtime_guard_requires_typed_envelope_and_blocks_nested_note() -> None:
    with pytest.raises(ValueError, match="typed VM sink envelope"):
        assert_vm_safe({"opaque_id": "per_1111111111111111"}, "cards")
    with pytest.raises(PIIGuardError) as error:
        assert_vm_safe({"outer": {"note": "private detail"}}, "cards")
    assert error.value.pii_class is PIIClass.NOTE


def test_37_precommit_blocks_email(tmp_path: Path, record_property) -> None:
    repo = _temp_repo(tmp_path)
    result = _commit_content(repo, "unsafe.txt", "casey" + chr(64) + "example.test\n")
    assert result.returncode != 0
    assert "unsafe.txt:1:email" in (result.stdout + result.stderr)
    record_property("blocked_pattern_commits", int(result.returncode != 0))


def test_38_precommit_blocks_phone(tmp_path: Path, record_property) -> None:
    repo = _temp_repo(tmp_path)
    result = _commit_content(repo, "unsafe.txt", "+1-" + "202" + "-555" + "-0142\n")
    assert result.returncode != 0
    assert "unsafe.txt:1:phone" in (result.stdout + result.stderr)
    record_property("blocked_pattern_commits", int(result.returncode != 0))


def test_39_precommit_blocks_linkedin_profile(tmp_path: Path, record_property) -> None:
    repo = _temp_repo(tmp_path)
    profile = "https://www.linkedin" + ".com/in/synthetic-case"
    result = _commit_content(repo, "unsafe.txt", profile + "\n")
    assert result.returncode != 0
    assert "unsafe.txt:1:profile_url" in (result.stdout + result.stderr)
    record_property("blocked_pattern_commits", int(result.returncode != 0))


def test_39a_precommit_blocks_email_after_nul_byte(tmp_path: Path) -> None:
    repo = _temp_repo(tmp_path)
    result = _commit_bytes(
        repo, "unsafe.txt", b"opaque\0casey" + bytes([64]) + b"example.test\n"
    )
    assert result.returncode != 0
    assert "unsafe.txt:1:email" in (result.stdout + result.stderr)


@pytest.mark.parametrize("pii_class", ("note", "excerpt", "body"))
def test_39b_precommit_blocks_all_marker_classes(
    tmp_path: Path, pii_class: str
) -> None:
    repo = _temp_repo(tmp_path)
    marker = _case(pii_class)["pattern_value"]
    result = _commit_content(repo, "unsafe.txt", marker + "\n")
    assert result.returncode != 0
    assert f"unsafe.txt:1:{pii_class}" in (result.stdout + result.stderr)


def test_39c_fixture_validation_scans_keys_and_all_phone_matches(tmp_path: Path) -> None:
    repo = _temp_repo(tmp_path)
    key_pii = json.dumps({"casey" + chr(64) + "production.example": "opaque"})
    key_result = _commit_content(repo, "orgs/prospecting/fixtures/synthetic.json", key_pii)
    assert key_result.returncode != 0
    assert "fixture_not_synthetic" in (key_result.stdout + key_result.stderr)

    reserved_phone = _case("phone")["value"]
    mixed_phones = json.dumps({"phones": [reserved_phone, reserved_phone.replace("202", "212", 1)]})
    phone_result = _commit_content(repo, "orgs/prospecting/fixtures/synthetic.json", mixed_phones)
    assert phone_result.returncode != 0
    assert "fixture_not_synthetic" in (phone_result.stdout + phone_result.stderr)


def test_40_precommit_preserves_sync_and_validates_fixture_exemption(tmp_path: Path) -> None:
    repo = _temp_repo(tmp_path)
    valid = json.dumps({
        "email": "casey" + chr(64) + "example.test",
        "phone": _case("phone")["value"],
        "profile_url": "https://linkedin.example.test/in/synthetic-case",
    })
    result = _commit_content(repo, "orgs/prospecting/fixtures/synthetic.json", valid)
    assert result.returncode == 0
    unsafe = json.dumps({"email": "casey" + chr(64) + "production.example"})
    blocked = _commit_content(repo, "orgs/prospecting/fixtures/synthetic.json", unsafe)
    assert blocked.returncode != 0
    assert "fixture_not_synthetic" in (blocked.stdout + blocked.stderr)
    (repo / "sync-fail").write_text("1", encoding="utf-8")
    sync_blocked = _commit_content(repo, "safe.txt", "opaque_code\n")
    assert sync_blocked.returncode != 0
    assert "commit blocked: edit skills/curated" in (sync_blocked.stdout + sync_blocked.stderr)


def test_review_fixture_is_exactly_allowlisted_and_validated(tmp_path: Path) -> None:
    repo = _temp_repo(tmp_path)
    relative = "orgs/prospecting/fixtures/review-synthetic.json"
    valid = REVIEW_FIXTURE.read_text(encoding="utf-8")
    allowed = _commit_content(repo, relative, valid)
    assert allowed.returncode == 0

    unsafe = json.loads(valid)
    unsafe["review_app"]["contact_email"] = unsafe["review_app"]["contact_email"].replace(
        ".test", ".example"
    )
    blocked = _commit_content(repo, relative, json.dumps(unsafe))
    assert blocked.returncode != 0
    assert "fixture_not_synthetic" in (blocked.stdout + blocked.stderr)


@pytest.mark.parametrize(
    ("relative", "fixture"),
    (
        ("orgs/prospecting/fixtures/legacy-synthetic.json", FIXTURES / "legacy-synthetic.json"),
        ("orgs/prospecting/fixtures/t1-synthetic-10.json", FIXTURES / "t1-synthetic-10.json"),
        (
            "orgs/prospecting/fixtures/vendor/snov/email-search-complete.json",
            FIXTURES / "vendor" / "snov" / "email-search-complete.json",
        ),
    ),
    ids=("legacy", "t1", "snov"),
)
def test_additional_fixture_allowlist_is_exact_and_fail_closed(
    tmp_path: Path, relative: str, fixture: Path
) -> None:
    repo = _temp_repo(tmp_path)
    valid = fixture.read_text(encoding="utf-8")
    allowed = _commit_content(repo, relative, valid)
    assert allowed.returncode == 0

    unsafe = valid.replace(".test", ".example", 1)
    assert unsafe != valid
    blocked = _commit_content(repo, relative, unsafe)
    assert blocked.returncode != 0
    assert "fixture_not_synthetic" in (blocked.stdout + blocked.stderr)


@pytest.mark.parametrize("depth", ("top", "nested"), ids=("top-email", "nested-phone"))
def test_allowlisted_fixture_rejects_duplicate_object_keys_at_every_depth(
    tmp_path: Path, depth: str
) -> None:
    repo = _temp_repo(tmp_path)
    if depth == "top":
        safe = json.loads(REVIEW_FIXTURE.read_text(encoding="utf-8"))["review_app"][
            "contact_email"
        ]
        unsafe = safe.replace(".test", ".example")
        content = (
            '{"email":' + json.dumps(unsafe) + ',"email":' + json.dumps(safe) + "}"
        )
    else:
        safe = _case("phone")["value"]
        unsafe = safe.replace("202", "212", 1)
        content = (
            '{"outer":{"phone":'
            + json.dumps(unsafe)
            + ',"phone":'
            + json.dumps(safe)
            + "}}"
        )

    blocked = _commit_content(
        repo, "orgs/prospecting/fixtures/synthetic.json", content
    )
    assert blocked.returncode != 0
    assert "fixture_not_synthetic" in (blocked.stdout + blocked.stderr)


def test_nodeid_fixture_rejects_duplicate_top_level_fields(tmp_path: Path) -> None:
    repo = _temp_repo(tmp_path)
    nodeids = json.loads(NODEIDS_FIXTURE.read_text(encoding="utf-8"))["nodeids"]
    content = (
        '{"version":1,"nodeids":[],"nodeids":' + json.dumps(nodeids) + "}"
    )
    blocked = _commit_content(
        repo,
        "orgs/prospecting/fixtures/staging-synthetic-nodeids.json",
        content,
    )
    assert blocked.returncode != 0
    assert "staging-synthetic-nodeids.json:1:fixture_not_synthetic" in (
        blocked.stdout + blocked.stderr
    )


def test_allowlisted_fixture_rejects_hex_local_part_at_non_test_domain(
    tmp_path: Path,
) -> None:
    repo = _temp_repo(tmp_path)
    relative = "orgs/prospecting/fixtures/t1-synthetic-10.json"
    unsafe = json.dumps({"email": "0123456789abcdef" + chr(64) + "production.example"})
    blocked = _commit_content(repo, relative, unsafe)
    assert blocked.returncode != 0
    assert "fixture_not_synthetic" in (blocked.stdout + blocked.stderr)


def _approved_nodeid() -> str:
    value = json.loads(NODEIDS_FIXTURE.read_text(encoding="utf-8"))
    return next(
        nodeid for nodeid in value["nodeids"] if "synthetic-message-body" in nodeid
    )


def _ssh_destination(
    *, user: str = "kb", host: str = "100.89.73.118", prefix: str = "", suffix: str = ""
) -> str:
    return prefix + user + chr(64) + host + suffix


def test_nodeid_fixture_exactly_covers_current_gate_manifest_sentinels() -> None:
    approved = set(json.loads(NODEIDS_FIXTURE.read_text(encoding="utf-8"))["nodeids"])
    observed = {
        nodeid
        for relative in GATE_MANIFEST_PATHS
        for nodeid in json.loads((ROOT / relative).read_text(encoding="utf-8"))["tests"]
        if find_text_classes(nodeid)
    }
    assert observed == approved


def test_gate_manifest_allows_only_an_exact_approved_tests_nodeid(tmp_path: Path) -> None:
    repo = _temp_repo(tmp_path)
    relative = "scripts/prospecting/gate_manifest_p3.json"
    nodeid = _approved_nodeid()
    allowed = _commit_content(repo, relative, json.dumps({"tests": [nodeid]}))
    assert allowed.returncode == 0

    altered = nodeid.replace("synthetic-message-body", "different-message-body")
    blocked = _commit_content(repo, relative, json.dumps({"tests": [altered]}))
    assert blocked.returncode != 0
    assert f"{relative}:1:body" in (blocked.stdout + blocked.stderr)


def test_approved_nodeid_elsewhere_and_other_manifest_text_are_scanned(
    tmp_path: Path,
) -> None:
    nodeid = _approved_nodeid()
    unapproved_repo = _temp_repo(tmp_path / "unapproved")
    unapproved = _commit_content(
        unapproved_repo, "other_manifest.json", json.dumps({"tests": [nodeid]})
    )
    assert unapproved.returncode != 0
    assert "other_manifest.json:1:body" in (unapproved.stdout + unapproved.stderr)

    manifest_repo = _temp_repo(tmp_path / "other-field")
    relative = "scripts/prospecting/gate_manifest_p5.json"
    unsafe = _commit_content(
        manifest_repo,
        relative,
        json.dumps({"tests": [nodeid], "owner": "casey" + chr(64) + "production.example"}),
    )
    assert unsafe.returncode != 0
    assert f"{relative}:1:email" in (unsafe.stdout + unsafe.stderr)


def test_unstaged_or_invalid_nodeid_fixture_cannot_authorize_manifest(
    tmp_path: Path,
) -> None:
    repo = _temp_repo(tmp_path / "dirty")
    fixture_path = repo / "orgs" / "prospecting" / "fixtures" / NODEIDS_FIXTURE.name
    fixture_value = json.loads(fixture_path.read_text(encoding="utf-8"))
    altered = _approved_nodeid().replace("synthetic-message-body", "dirty-message-body")
    fixture_value["nodeids"].append(altered)
    fixture_path.write_text(json.dumps(fixture_value), encoding="utf-8")
    relative = "scripts/prospecting/gate_manifest_p6.json"
    dirty = _commit_content(repo, relative, json.dumps({"tests": [altered]}))
    assert dirty.returncode != 0
    assert f"{relative}:1:body" in (dirty.stdout + dirty.stderr)

    invalid_repo = _temp_repo(tmp_path / "invalid")
    invalid_fixture = (
        invalid_repo / "orgs" / "prospecting" / "fixtures" / NODEIDS_FIXTURE.name
    )
    invalid_value = json.loads(invalid_fixture.read_text(encoding="utf-8"))
    invalid_value["nodeids"].append(
        "scripts/prospecting/tests/test_guard.py::test_email[casey"
        + chr(64)
        + "production.example]"
    )
    invalid_fixture.write_text(json.dumps(invalid_value), encoding="utf-8")
    manifest_path = invalid_repo / relative
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({"tests": [_approved_nodeid()]}), encoding="utf-8")
    _git(invalid_repo, "add", invalid_fixture.relative_to(invalid_repo).as_posix(), relative)
    invalid = _git(invalid_repo, "commit", "-m", "candidate", check=False)
    assert invalid.returncode != 0
    assert "staging-synthetic-nodeids.json:1:fixture_not_synthetic" in (
        invalid.stdout + invalid.stderr
    )


@pytest.mark.parametrize(
    "change",
    (
        ("test_pii_guard.py::test_39b", "test_unknown.py::test_unknown"),
        ("synthetic-message-body", "altered-message-body"),
    ),
    ids=("unknown-function", "altered-marker"),
)
def test_nodeid_fixture_rejects_unknown_or_altered_sentinels(
    tmp_path: Path, change: tuple[str, str]
) -> None:
    repo = _temp_repo(tmp_path)
    fixture_path = repo / "orgs" / "prospecting" / "fixtures" / NODEIDS_FIXTURE.name
    value = json.loads(fixture_path.read_text(encoding="utf-8"))
    nodeid = _approved_nodeid().replace(*change)
    assert nodeid != _approved_nodeid()
    value["nodeids"].append(nodeid)
    blocked = _commit_content(
        repo,
        fixture_path.relative_to(repo).as_posix(),
        json.dumps(value),
    )
    assert blocked.returncode != 0
    assert "staging-synthetic-nodeids.json:1:fixture_not_synthetic" in (
        blocked.stdout + blocked.stderr
    )


def test_staging_masks_only_bounded_dev_vm_cgnat_ssh_destinations(
    tmp_path: Path,
) -> None:
    repo = _temp_repo(tmp_path)
    relative = "scripts/prospecting/dev_vm.py"
    allowed = _commit_content(repo, relative, f'HOST = "{_ssh_destination()}"\n')
    assert allowed.returncode == 0


@pytest.mark.parametrize(
    ("relative", "parts"),
    (
        ("scripts/prospecting/other.py", {}),
        ("scripts/prospecting/dev_vm.py", {"user": "user"}),
        ("scripts/prospecting/dev_vm.py", {"host": "192.0.2.1"}),
        ("scripts/prospecting/dev_vm.py", {"prefix": "prefix"}),
        ("scripts/prospecting/dev_vm.py", {"suffix": ".example"}),
        (
            "scripts/prospecting/dev_vm.py",
            {"suffix": chr(64) + "production.example"},
        ),
        ("scripts/prospecting/dev_vm.py", {"suffix": "%40production.example"}),
    ),
    ids=(
        "other-path",
        "other-user",
        "other-network",
        "prefix",
        "suffix",
        "appended-domain",
        "encoded-domain",
    ),
)
def test_staging_ssh_destination_near_misses_remain_blocked(
    tmp_path: Path, relative: str, parts: dict[str, str]
) -> None:
    repo = _temp_repo(tmp_path)
    destination = _ssh_destination(**parts)
    blocked = _commit_content(repo, relative, f'DESTINATION = "{destination}"\n')
    assert blocked.returncode != 0
    assert f"{relative}:1:email" in (blocked.stdout + blocked.stderr)


def test_vm_guard_still_blocks_valid_staging_ssh_destination() -> None:
    with pytest.raises(PIIGuardError) as error:
        assert_vm_safe(
            {
                "kind": "process_arguments",
                "fields": {"destination": _ssh_destination()},
            },
            "process_arguments",
        )
    assert error.value.pii_class is PIIClass.EMAIL
