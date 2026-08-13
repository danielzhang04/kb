from __future__ import annotations
import argparse
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path

RELEASE_ROOTS = (
    "dashboard/dist", "dashboard/server", "dashboard/node_modules",
    "dashboard/package.json", "dashboard/package-lock.json",
    "dashboard/config/repositories.json", "scripts", "schemas",
)


def release_files(source: Path) -> list[Path]:
    files: list[Path] = []
    for rel in RELEASE_ROOTS:
        path = source / rel
        if not path.exists():
            raise FileNotFoundError(rel)
        files.extend(sorted(item for item in ([path] if path.is_file() else path.rglob("*")) if item.is_file()))
    return sorted(files, key=lambda item: item.relative_to(source).as_posix())


def build_release(source: Path, version: str, output: Path, attestation: Path) -> None:
    if len(version) != 40 or any(char not in "0123456789abcdef" for char in version):
        raise ValueError("version must be a full lowercase git commit")
    expected_name = f"kb-platform-{version}.tar.gz"
    if output.name != expected_name:
        raise ValueError(f"release archive must be named {expected_name}")
    files = release_files(source)
    manifest = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(source).as_posix()}\n" for path in files)
    with output.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name, data in (("VERSION", version + "\n"), ("MANIFEST.sha256", manifest)):
            info = tarfile.TarInfo(name); info.size = len(data.encode()); info.mtime = 0; info.mode = 0o444
            archive.addfile(info, io.BytesIO(data.encode()))
        for path in files:
            data = path.read_bytes()
            info = tarfile.TarInfo(path.relative_to(source).as_posix()); info.size = len(data); info.mtime = 0; info.mode = 0o555 if path.stat().st_mode & 0o111 else 0o444
            archive.addfile(info, io.BytesIO(data))
    statement = {
        "archive": output.name,
        "schema": "kb.release-attestation/v1",
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "sourceCommit": version,
        "workflow": "kb-platform-release",
    }
    attestation.write_text(json.dumps(statement, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8", newline="")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--attestation", type=Path, required=True)
    args = parser.parse_args(); build_release(args.source, args.version, args.output, args.attestation); return 0


if __name__ == "__main__":
    raise SystemExit(main())
