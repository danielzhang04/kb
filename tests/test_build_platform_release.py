import hashlib
import json
import tarfile
from pathlib import Path

from scripts.build_platform_release import build_release


def test_release_is_versioned_and_excludes_data(tmp_path: Path):
    source = tmp_path / "source"
    for rel in ("dashboard/dist/app.js", "dashboard/server/index.ts", "dashboard/package.json", "dashboard/package-lock.json", "dashboard/node_modules/pkg/index.js", "scripts/cards.py", "schemas/compatibility.json", "dashboard/config/repositories.json", "deploy/activate_release.py", "deploy/bootstrap_vm.py", "deploy/export_tier0.py", "deploy/validate_vm_runtime.py", "deploy/systemd/kb-dashboard.service"):
        path = source / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rel, encoding="utf-8")
    (source / "deploy/__pycache__").mkdir()
    (source / "deploy/__pycache__/activate_release.cpython-313.pyc").write_bytes(b"local bytecode")
    (source / "queue").mkdir()
    (source / "queue/card.md").write_text("secret data", encoding="utf-8")
    output = tmp_path / f"kb-platform-{'a' * 40}.tar.gz"
    attestation = tmp_path / f"kb-platform-{'a' * 40}.attestation.json"
    build_release(source, "a" * 40, output, attestation)
    with tarfile.open(output, "r:gz") as archive:
        names = set(archive.getnames())
        assert "VERSION" in names
        assert "dashboard/server/index.ts" in names
        assert "deploy/activate_release.py" in names
        assert "deploy/bootstrap_vm.py" in names
        assert "deploy/export_tier0.py" in names
        assert "deploy/validate_vm_runtime.py" in names
        assert "deploy/systemd/kb-dashboard.service" in names
        assert not any("__pycache__" in name or name.endswith(".pyc") for name in names)
        assert not any(name.startswith("queue/") for name in names)
        assert archive.extractfile("VERSION").read().decode() == "a" * 40 + "\n"
        assert "MANIFEST.sha256" in names
    assert json.loads(attestation.read_text(encoding="utf-8")) == {
        "archive": output.name,
        "schema": "kb.release-attestation/v1",
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "sourceCommit": "a" * 40,
        "workflow": "kb-platform-release",
    }
    assert attestation.read_bytes().endswith(b"\n")
