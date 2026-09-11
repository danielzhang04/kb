"""Synthetic local checks; these do not contact a VM or use credentials."""
import ast
import base64
import builtins
import functools
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shlex
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts.prospecting import dev_vm


def service_status(**changes):
    value = {key: "" for key in dev_vm.STATUS_KEYS}
    value.update({
        "LoadState": "loaded", "ActiveState": "active", "SubState": "exited",
        "Result": "success", "ExecMainStatus": "0",
        "ControlGroup": "/system.slice/kb-prospecting-test.service",
    })
    value.update(changes)
    return value


def lease_status(**changes):
    value = {"LoadState": "loaded", "ActiveState": "active", "SubState": "waiting", "Result": "success"}
    value.update(changes)
    return value


def collection_reply(files=None, evidence=None, status=None):
    return {"status": status or service_status(), "files": files or [], "evidence": evidence or {}}


def manifest():
    data = b"print('synthetic')\n"
    return {"version": 1, "inputs": [{"path": "scripts/prospecting/example.py", "size": len(data),
             "sha256": hashlib.sha256(data).hexdigest()}],
            "allowed_outputs": ["scripts/prospecting/example.py"],
            "output_base": {"scripts/prospecting/example.py": {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}},
            "limits": {"max_file_bytes": 2097152, "max_total_bytes": 16777216}}


BASE = b"print('synthetic')\n"
EXAMPLE = "scripts/prospecting/example.py"
NEW = "scripts/prospecting/new.py"
NOT_FOUND = {"LoadState": "not-found", "ActiveState": "inactive", "SubState": "dead", "Result": "success"}


def two_output_manifest():
    value = manifest()
    value["allowed_outputs"] = [EXAMPLE, NEW]
    value["output_base"][NEW] = None
    return value


def record(path, data):
    return {"path": path, "data": base64.b64encode(data).decode(), "sha256": hashlib.sha256(data).hexdigest()}


def lease_program(job):
    """Build the exact lease program the supervisor arms, without running a start."""
    module = ast.parse(dev_vm.REMOTE_SOURCE)
    definition = next(node for node in module.body
                      if isinstance(node, ast.FunctionDef) and node.name == "lease_script")
    namespace = {"unit": "kb-prospecting-" + job, "job": job,
                 "root": PurePosixPath("/var/tmp/kb-prospecting-" + job)}
    exec(compile(ast.Module(body=[definition], type_ignores=[]), "lease_script", "exec"), namespace)
    return namespace["lease_script"]()


class FakeVM:
    """Filesystem and systemd boundary for executing the transmitted supervisor program."""

    def __init__(self, job, *, root=True, owner=None):
        self.unit = "kb-prospecting-" + job
        self.root = "/var/tmp/kb-prospecting-" + job
        self.dirs, self.files, self.mounts = set(), {}, set()
        if root:
            self.dirs.update({self.root, self.root + "/output"})
            self.files[self.root + "/owner"] = job if owner is None else owner
            self.mounts.add(self.root + "/output")
        self.units, self.sticky, self.on_stop, self.calls = {}, set(), {}, []
        # Optional exact (returncode, stdout) override for a `systemctl show` query.
        self.show_results = {}
        self.error = None
        vm = self

        class FakePath:
            def __init__(self, value):
                self.value = value

            def __str__(self):
                return self.value

            def __truediv__(self, name):
                return FakePath(self.value + "/" + name)

            def exists(self):
                return self.value in vm.dirs or self.value in vm.files

            def is_symlink(self):
                return False

            def is_dir(self):
                return self.value in vm.dirs

            def stat(self):
                return SimpleNamespace(st_uid=0)

            def read_text(self):
                if self.value not in vm.files:
                    raise FileNotFoundError(self.value)
                return vm.files[self.value]

        self.path_type = FakePath

    def run(self, args, check=True, **kwargs):
        self.calls.append(list(args))
        stdout = ""
        if args[:2] == ["systemctl", "show"]:
            if args[2] in self.show_results:
                returncode, stdout = self.show_results[args[2]]
                return SimpleNamespace(returncode=returncode, stdout=stdout)
            state = self.units.get(args[2], NOT_FOUND)
            stdout = "".join(f"{name}={state.get(name, '')}\n" for name in args[3].split("=", 1)[1].split(","))
        elif args[:2] in (["systemctl", "stop"], ["systemctl", "reset-failed"]):
            for name in args[2:]:
                if args[1] == "stop":
                    self.on_stop.pop(name, lambda: None)()
                failed = name in self.units and self.units[name]["ActiveState"] == "failed"
                if name in self.units and name not in self.sticky and failed == (args[1] == "reset-failed"):
                    del self.units[name]
        elif args[0] == "/usr/bin/umount":
            self.mounts.discard(args[1])
        else:
            raise AssertionError(args)
        return SimpleNamespace(returncode=0, stdout=stdout)

    def rmtree(self, path):
        self.calls.append(["rmtree", str(path)])
        prefix = str(path)
        if any(mount == prefix or mount.startswith(prefix + "/") for mount in self.mounts):
            raise OSError("mounted")
        self.dirs = {item for item in self.dirs if item != prefix and not item.startswith(prefix + "/")}
        self.files = {key: value for key, value in self.files.items() if not key.startswith(prefix + "/")}

    def destructive(self):
        return [call for call in self.calls if call[0] in ("rmtree", "/usr/bin/umount")
                or call[:2] in (["systemctl", "stop"], ["systemctl", "reset-failed"])]

    def run_lease(self, program):
        """Execute the armed lease program against this same fake OS boundary."""
        fakes = {
            "os": SimpleNamespace(path=SimpleNamespace(ismount=lambda path: str(path) in self.mounts)),
            "pathlib": SimpleNamespace(Path=self.path_type, PurePosixPath=PurePosixPath),
            "shutil": SimpleNamespace(rmtree=self.rmtree),
            "subprocess": SimpleNamespace(run=self.run, PIPE=subprocess.PIPE, DEVNULL=subprocess.DEVNULL),
        }
        namespace = dict(vars(builtins))
        namespace["__import__"] = lambda name, *rest, **kw: (
            fakes[name] if name in fakes else builtins.__import__(name, *rest, **kw))
        try:
            exec(program, {"__builtins__": namespace})
        except SystemExit as stop:
            return stop.code
        return 0

    def ssh(self, args, *, input, **kwargs):
        """Execute the exact program sent over SSH against fake OS modules."""
        program = shlex.split(args[-1])[-1]
        stdout = io.StringIO()

        def leave(code=0):
            raise SystemExit(code)

        fakes = {
            "os": SimpleNamespace(path=SimpleNamespace(ismount=lambda path: str(path) in self.mounts)),
            "pathlib": SimpleNamespace(Path=self.path_type, PurePosixPath=PurePosixPath),
            "pwd": SimpleNamespace(),
            "shutil": SimpleNamespace(rmtree=self.rmtree),
            "subprocess": SimpleNamespace(run=self.run, PIPE=subprocess.PIPE, DEVNULL=subprocess.DEVNULL),
            "sys": SimpleNamespace(stdin=io.StringIO(input.decode()), exit=leave),
        }
        namespace = dict(vars(builtins))
        namespace["__import__"] = lambda name, *rest, **kw: (
            fakes[name] if name in fakes else builtins.__import__(name, *rest, **kw))
        namespace["print"] = functools.partial(print, file=stdout)
        try:
            exec(program, {"__builtins__": namespace})
            code = 0
        except SystemExit as stop:
            code = stop.code
        except Exception as error:
            self.error, code = error, 1
        return SimpleNamespace(returncode=code, stdout=stdout.getvalue().encode())


class DevVMTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.receipt = self.root / "receipt.json"

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self, **kwargs):
        return dev_vm.prepare(self.receipt, {"scripts/prospecting/example.py": b"print('synthetic')\n"},
                              instruction="Improve the synthetic source.", manifest=manifest(), **kwargs)

    def test_receipt_precedes_remote_and_owns_exact_paths(self):
        with patch.object(dev_vm, "remote", side_effect=AssertionError("must remain local")):
            value = self.prepare()
        self.assertEqual(dev_vm.load_receipt(self.receipt), value)
        self.assertEqual(value["remote_root"], "/var/tmp/kb-prospecting-" + value["id"])
        with self.assertRaises(ValueError):
            self.prepare()

    def test_tampered_ownership_rejected(self):
        value = self.prepare()
        value["remote_root"] = "/var/lib/kb/ops"
        self.receipt.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            dev_vm.load_receipt(self.receipt)

    def test_immutable_contract_and_exact_receipt_schema_are_checked(self):
        value = self.prepare()
        for key, changed in (("model", "different"), ("deadline_seconds", 11)):
            with self.subTest(key=key):
                tampered = dict(value)
                tampered[key] = changed
                self.receipt.write_text(json.dumps(tampered))
                with self.assertRaises(ValueError):
                    dev_vm.load_receipt(self.receipt)
        extra = dict(value, extra=True)
        self.receipt.write_text(json.dumps(extra))
        with self.assertRaises(ValueError):
            dev_vm.load_receipt(self.receipt)

    def test_paths_reject_traversal_and_ambiguous_windows_names(self):
        for value in ("../a", "/etc/passwd", "a/../b", "a//b", "a\\b", "C:a", "a\n", "", 1):
            with self.subTest(value=value), self.assertRaises(ValueError):
                dev_vm.relative_path(value)

    def test_hash_mismatch_fails_before_receipt(self):
        with self.assertRaises(ValueError):
            dev_vm.prepare(self.receipt, {"scripts/prospecting/example.py": b"changed"},
                           instruction="Synthetic", manifest=manifest())
        self.assertFalse(self.receipt.exists())

    def test_resource_limits(self):
        for kwargs in ({"deadline_seconds": 0}, {"collection_seconds": 999999}, {"model": "x; unsafe"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.prepare(**kwargs)

    def test_collection_verified_and_idempotent(self):
        self.prepare()
        data = b"print('updated synthetic')\n"
        reply = collection_reply([{
            "path": "scripts/prospecting/example.py", "data": base64.b64encode(data).decode(),
            "sha256": hashlib.sha256(data).hexdigest()}])
        with patch.object(dev_vm, "remote", return_value=reply):
            result = dev_vm.collect(self.receipt, self.root / "output")
            self.assertEqual(result, dev_vm.collect(self.receipt, self.root / "output"))
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "collected")

    def test_collection_rejects_unlisted_before_write(self):
        self.prepare()
        reply = collection_reply([{"path": "unlisted.py", "data": "", "sha256": hashlib.sha256(b"").hexdigest()}])
        with patch.object(dev_vm, "remote", return_value=reply), self.assertRaises(ValueError):
            dev_vm.collect(self.receipt, self.root / "output")
        self.assertFalse((self.root / "output" / "unlisted.py").exists())
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "prepared")

    def test_collection_requires_exact_success_status_before_write(self):
        self.prepare()
        reply = {"status": {}, "files": [], "evidence": {}}
        with patch.object(dev_vm, "remote", return_value=reply), self.assertRaises(ValueError):
            dev_vm.collect(self.receipt)
        self.assertFalse((self.root / "output").exists())
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "prepared")

    def test_collection_rejects_arbitrary_destination_before_remote(self):
        self.prepare()
        destination = self.root / "authoritative-source"
        with patch.object(dev_vm, "remote") as remote, self.assertRaises(ValueError):
            dev_vm.collect(self.receipt, destination)
        remote.assert_not_called()
        self.assertFalse(destination.exists())

    def test_codex_json_envelope(self):
        self.prepare(mode="codex")
        data = json.dumps({"files": [{"path": "scripts/prospecting/example.py", "content": "print('edited synthetic')\n"}]}).encode()
        reply = collection_reply([{"path": "result.json", "data": base64.b64encode(data).decode(), "sha256": hashlib.sha256(data).hexdigest()}])
        with patch.object(dev_vm, "remote", return_value=reply):
            dev_vm.collect(self.receipt, self.root / "output")
        self.assertEqual((self.root / "output/scripts/prospecting/example.py").read_text(), "print('edited synthetic')\n")

    def test_corrupt_transport_hash_does_not_mark_collected(self):
        self.prepare()
        reply = collection_reply([{"path": "scripts/prospecting/example.py", "data": "eA==", "sha256": "0" * 64}])
        with patch.object(dev_vm, "remote", return_value=reply), self.assertRaises(ValueError):
            dev_vm.collect(self.receipt, self.root / "output")
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "prepared")

    def test_existing_local_output_is_never_overwritten(self):
        self.prepare()
        target = self.root / "output/scripts/prospecting/example.py"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"local work")
        reply = collection_reply([{"path": "scripts/prospecting/example.py", "data": "eA==", "sha256": hashlib.sha256(b"x").hexdigest()}])
        with patch.object(dev_vm, "remote", return_value=reply), self.assertRaises(ValueError):
            dev_vm.collect(self.receipt, self.root / "output")
        self.assertEqual(target.read_bytes(), b"local work")

    def test_evidence_is_persisted_hashed_and_not_returned_raw(self):
        self.prepare()
        data = b'{"type":"synthetic.started"}\n'
        reply = collection_reply(evidence={"events.jsonl": {
            "data": base64.b64encode(data).decode(), "sha256": hashlib.sha256(data).hexdigest()}})
        with patch.object(dev_vm, "remote", return_value=reply):
            result = dev_vm.collect(self.receipt, self.root / "output")
        receipt = dev_vm.load_receipt(self.receipt)
        self.assertEqual(receipt["evidence_hashes"]["events.jsonl"], hashlib.sha256(data).hexdigest())
        self.assertEqual(self.receipt.with_name("receipt.json.events.jsonl").read_bytes(), data)
        self.assertNotIn("synthetic.started", json.dumps(result))

    def test_reparse_parent_rejected_before_any_collection_write_or_remote_call(self):
        self.prepare()
        redirect = self.root / "redirect"
        redirect.mkdir()
        original_lstat = Path.lstat
        def reparse_metadata(path, *args, **kwargs):
            value = original_lstat(path, *args, **kwargs)
            if path == redirect:
                return SimpleNamespace(st_mode=value.st_mode, st_file_attributes=0x400)
            return value
        with patch.object(Path, "lstat", reparse_metadata), patch.object(dev_vm, "remote") as remote:
            with self.assertRaises(ValueError):
                dev_vm.collect(self.receipt, redirect / "new-directory")
        remote.assert_not_called()
        self.assertFalse((redirect / "new-directory").exists())

    def test_failed_job_collects_evidence_without_accepting_a_patch(self):
        self.prepare(mode="codex")
        reply = collection_reply(status=service_status(
            ActiveState="failed", SubState="failed", Result="timeout", ExecMainStatus="15"
        ))
        with patch.object(dev_vm, "remote", return_value=reply) as remote:
            result = dev_vm.collect(self.receipt, self.root / "output", failure_only=True)
        self.assertEqual(remote.call_args.args[1], "collect-failure")
        self.assertEqual(result["state"], "failed-collected")
        self.assertEqual(dev_vm.load_receipt(self.receipt)["output_hashes"], {})
        self.assertFalse((self.root / "output").exists())

    def test_success_cannot_be_recorded_as_failed_collection(self):
        self.prepare()
        with patch.object(dev_vm, "remote", return_value=collection_reply()), self.assertRaises(ValueError):
            dev_vm.collect(self.receipt, self.root / "output", failure_only=True)
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "prepared")

    def test_start_runs_preamble_and_records_only_valid_response(self):
        value = self.prepare()
        status = service_status(ControlGroup=f"/system.slice/{value['unit']}.service")
        reply = {"started": True, "existing": False, "status": status, "lease": lease_status()}
        with patch.object(dev_vm, "trusted_local_preamble") as preamble, patch.object(
            dev_vm.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(reply).encode()
            )
        ):
            result = dev_vm.start(self.receipt)
        preamble.assert_called_once_with()
        self.assertEqual(result, reply)
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "started")

    def test_completed_service_without_cgroup_is_valid_existing_service(self):
        value = self.prepare()
        status = service_status(ControlGroup="")
        reply = {"started": True, "existing": True, "status": status, "lease": lease_status()}
        with patch.object(dev_vm, "remote", return_value=reply):
            self.assertEqual(dev_vm.start(self.receipt), reply)
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "started")

        running = service_status(SubState="running", ControlGroup="")
        with self.assertRaisesRegex(ValueError, "invalid existing service"):
            dev_vm._existing_service(running, value["unit"])

    def test_failed_preamble_blocks_ssh_start_but_recovery_actions_skip_it(self):
        value = self.prepare()
        with patch.object(dev_vm, "trusted_local_preamble", side_effect=RuntimeError("stopped")), patch.object(
            dev_vm.subprocess, "run"
        ) as ssh, self.assertRaises(RuntimeError):
            dev_vm.remote(value, "start")
        ssh.assert_not_called()

        status_reply = {"status": service_status(), "lease": lease_status()}
        with patch.object(dev_vm, "trusted_local_preamble", side_effect=AssertionError("not for recovery")), patch.object(
            dev_vm.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(status_reply).encode()
            )
        ):
            self.assertEqual(dev_vm.remote(value, "status"), status_reply)

    def test_partial_start_has_typed_recovery_state_and_terminal_states_do_not_regress(self):
        self.prepare()
        error = dev_vm.RemoteActionError("partial_start", {"status": service_status(
            ActiveState="failed", SubState="failed", Result="exit-code", ExecMainStatus="1"
        )})
        with patch.object(dev_vm, "remote", side_effect=error), self.assertRaises(dev_vm.RemoteActionError):
            dev_vm.start(self.receipt)
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "start-failed")

        with patch.object(dev_vm, "remote", return_value={"cleaned": True}):
            dev_vm.cleanup(self.receipt)
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "cleaned")
        with patch.object(dev_vm, "remote") as remote, self.assertRaises(ValueError):
            dev_vm.start(self.receipt)
        remote.assert_not_called()

    def test_status_does_not_regress_collected_states_when_lease_expires(self):
        for state in ("collected", "failed-collected"):
            with self.subTest(state=state):
                status = (service_status(ControlGroup="") if state == "collected" else
                          service_status(ActiveState="failed", SubState="failed",
                                         Result="exit-code", ExecMainStatus="1", ControlGroup=""))
                response = {"status": status, "lease": lease_status(
                    ActiveState="inactive", SubState="dead", Result="success"
                )}
                value = self.prepare()
                value["state"] = state
                value["remote_status"] = status
                if state == "collected":
                    value["collection_directory"] = "output"
                    value["output_hashes"] = {}
                else:
                    empty_hash = hashlib.sha256(b"").hexdigest()
                    value["evidence_hashes"] = {"events.jsonl": empty_hash,
                                                "stderr.txt": empty_hash}
                dev_vm._atomic_json(self.receipt, value)
                with patch.object(dev_vm, "remote", return_value=response):
                    self.assertEqual(dev_vm.inspect_status(self.receipt), response)
                self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], state)
                self.receipt.unlink()

    def prepare_two_outputs(self):
        return dev_vm.prepare(self.receipt, {EXAMPLE: BASE}, instruction="Improve the synthetic source.",
                              manifest=two_output_manifest())

    def test_collection_rejects_local_output_omitted_from_current_response(self):
        cases = (
            ("empty response, stale change", [], {EXAMPLE: b"stale change\n"}),
            ("empty response, stale unchanged", [], {EXAMPLE: BASE}),
            ("subset response, stale change", [record(NEW, b"new\n")], {EXAMPLE: b"stale change\n"}),
            ("subset response, stale new file", [record(EXAMPLE, BASE)], {NEW: b"stale new\n"}),
            ("mismatched bytes", [record(EXAMPLE, b"current\n")], {EXAMPLE: b"stale change\n"}),
        )
        for index, (name, files, local) in enumerate(cases):
            with self.subTest(name):
                self.receipt = self.root / f"case{index}" / "receipt.json"
                self.prepare_two_outputs()
                output = self.receipt.parent / "output"
                for path, data in local.items():
                    (output / path).parent.mkdir(parents=True, exist_ok=True)
                    (output / path).write_bytes(data)
                with patch.object(dev_vm, "remote", return_value=collection_reply(files)), self.assertRaises(ValueError):
                    dev_vm.collect(self.receipt)
                for path, data in local.items():
                    self.assertEqual((output / path).read_bytes(), data)
                receipt = dev_vm.load_receipt(self.receipt)
                self.assertEqual((receipt["state"], receipt["output_hashes"]), ("prepared", {}))

    def test_collection_accepts_exact_tree_with_unchanged_file_and_identical_retry(self):
        self.prepare_two_outputs()
        output = self.root / "output"
        (output / EXAMPLE).parent.mkdir(parents=True)
        (output / EXAMPLE).write_bytes(BASE)
        reply = collection_reply([record(EXAMPLE, BASE), record(NEW, b"new\n")])
        with patch.object(dev_vm, "remote", return_value=reply):
            first = dev_vm.collect(self.receipt)
            second = dev_vm.collect(self.receipt)
        expected = {EXAMPLE: hashlib.sha256(BASE).hexdigest(), NEW: hashlib.sha256(b"new\n").hexdigest()}
        self.assertEqual(first, second)
        self.assertEqual(first["files"], expected)
        self.assertEqual([item["path"] for item in first["validation"]], [NEW])
        self.assertEqual(dev_vm.load_receipt(self.receipt)["output_hashes"], expected)

    def cleanup_vm(self, **kwargs):
        value = self.prepare()
        value.update(state="start-failed", remote_status=service_status(ControlGroup=""))
        dev_vm._atomic_json(self.receipt, value)
        return FakeVM(value["id"], **kwargs)

    def run_cleanup(self, vm):
        with patch.object(dev_vm.subprocess, "run", vm.ssh):
            return dev_vm.cleanup(self.receipt)

    def assert_cleanup_refused(self, vm, code):
        with self.assertRaises(dev_vm.RemoteActionError) as raised:
            self.run_cleanup(vm)
        self.assertEqual(raised.exception.code, code)
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "start-failed")

    def assert_cleanup_refused_state(self, vm, code, state):
        with self.assertRaises(dev_vm.RemoteActionError) as raised:
            self.run_cleanup(vm)
        self.assertEqual(raised.exception.code, code)
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], state)

    def started_cleanup_vm(self, **kwargs):
        value = self.prepare()
        value.update(state="started", remote_status=service_status(ControlGroup=""))
        dev_vm._atomic_json(self.receipt, value)
        return FakeVM(value["id"], **kwargs)

    def test_started_cleanup_with_root_present_refuses_without_destructive_calls(self):
        cases = (
            ("successful worker", service_status(ControlGroup="")),
            ("failed worker", service_status(ActiveState="failed", SubState="failed",
                                             Result="exit-code", ExecMainStatus="1", ControlGroup="")),
        )
        for index, (name, worker) in enumerate(cases):
            with self.subTest(name):
                self.receipt = self.root / f"started-present-{index}" / "receipt.json"
                vm = self.started_cleanup_vm()
                vm.units[vm.unit + ".service"] = worker
                self.assert_cleanup_refused_state(vm, "cleanup_unverified", "started")
                self.assertEqual(vm.destructive(), [])
                self.assertIn(vm.root, vm.dirs)
                self.assertIn(vm.root + "/output", vm.mounts)
                self.assertIn(vm.unit + ".service", vm.units)

    def test_started_cleanup_with_absent_root_but_remaining_unit_refuses(self):
        vm = self.started_cleanup_vm(root=False)
        vm.units[vm.unit + ".service"] = service_status(ControlGroup="")
        self.assert_cleanup_refused_state(vm, "cleanup_unverified", "started")
        self.assertEqual(vm.destructive(), [])
        self.assertIn(vm.unit + ".service", vm.units)

    def test_started_cleanup_succeeds_only_when_root_and_all_three_units_absent(self):
        vm = self.started_cleanup_vm(root=False)
        self.assertEqual(self.run_cleanup(vm), {"cleaned": True, "already_absent": True})
        self.assertEqual(vm.destructive(), [])
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "cleaned")

    def test_ordinary_collected_cleanup_path_is_unchanged(self):
        value = self.prepare()
        value.update(state="collected", collection_directory="output", output_hashes={},
                     remote_status=service_status(ControlGroup=""))
        dev_vm._atomic_json(self.receipt, value)
        vm = FakeVM(value["id"])
        vm.units.update({vm.unit + ".service": service_status(ControlGroup=""),
                         vm.unit + "-lease.timer": lease_status()})
        self.assertEqual(self.run_cleanup(vm), {"cleaned": True})
        self.assertEqual((vm.dirs, vm.files, vm.mounts, vm.units), (set(), {}, set(), {}))
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "cleaned")

    def test_absent_root_cleanup_succeeds_only_after_verifying_every_unit_absent(self):
        vm = self.cleanup_vm(root=False)
        self.assertEqual(self.run_cleanup(vm), {"cleaned": True, "already_absent": True})
        self.assertEqual([call[2] for call in vm.calls], [
            vm.unit + ".service", vm.unit + "-lease.timer", vm.unit + "-lease.service"])
        self.assertEqual(vm.destructive(), [])
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "cleaned")

    def test_absent_root_with_existing_unit_refuses_without_destructive_fallback(self):
        remaining = (
            (".service", service_status(ActiveState="failed", SubState="failed", Result="exit-code",
                                        ExecMainStatus="1", ControlGroup="")),
            ("-lease.timer", lease_status(SubState="elapsed")),
            ("-lease.service", {"LoadState": "loaded", "ActiveState": "activating", "SubState": "start",
                                "Result": "success"}),
        )
        for index, (suffix, state) in enumerate(remaining):
            with self.subTest(suffix):
                self.receipt = self.root / f"case{index}" / "receipt.json"
                vm = self.cleanup_vm(root=False)
                vm.units[vm.unit + suffix] = state
                self.assert_cleanup_refused(vm, "cleanup_unverified")
                self.assertEqual(vm.destructive(), [])
                self.assertEqual(vm.units, {vm.unit + suffix: state})

    def test_present_root_without_matching_owner_is_never_touched(self):
        for index, owner in enumerate(("0" * 32, None)):
            with self.subTest(owner=owner):
                self.receipt = self.root / f"case{index}" / "receipt.json"
                vm = self.cleanup_vm(owner=owner)
                if owner is None:
                    del vm.files[vm.root + "/owner"]
                vm.units[vm.unit + ".service"] = service_status(ControlGroup="")
                self.assert_cleanup_refused(vm, "vm_action_failed")
                self.assertIsInstance(vm.error, (ValueError, FileNotFoundError))
                self.assertEqual(vm.destructive(), [])
                self.assertIn(vm.root, vm.dirs)

    def test_owned_cleanup_tears_down_and_verifies_every_resource(self):
        vm = self.cleanup_vm()
        vm.units.update({vm.unit + ".service": service_status(ControlGroup=""),
                         vm.unit + "-lease.timer": lease_status()})
        self.assertEqual(self.run_cleanup(vm), {"cleaned": True})
        self.assertEqual((vm.dirs, vm.files, vm.mounts, vm.units), (set(), {}, set(), {}))
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "cleaned")

    def test_incomplete_teardown_keeps_receipt_recoverable(self):
        vm = self.cleanup_vm()
        vm.units[vm.unit + ".service"] = service_status(
            ActiveState="failed", SubState="failed", Result="exit-code", ExecMainStatus="1", ControlGroup="")
        vm.sticky.add(vm.unit + ".service")
        self.assert_cleanup_refused(vm, "cleanup_incomplete")

    def test_lease_run_in_progress_is_left_to_finish_before_verified_retry(self):
        vm = self.cleanup_vm()
        worker, timer, lease = (vm.unit + suffix for suffix in (".service", "-lease.timer", "-lease.service"))
        vm.units.update({worker: service_status(ControlGroup=""), timer: lease_status()})

        def lease_fires():
            vm.units[timer] = lease_status(SubState="elapsed")
            vm.units[lease] = {"LoadState": "loaded", "ActiveState": "active", "SubState": "running",
                               "Result": "success"}

        vm.on_stop[worker] = lease_fires
        self.assert_cleanup_refused(vm, "cleanup_incomplete")
        self.assertFalse(any(lease in call for call in vm.destructive()))
        self.assertFalse(any(call[0] in ("rmtree", "/usr/bin/umount") for call in vm.calls))
        self.assertIn(lease, vm.units)
        self.assertIn(vm.root, vm.dirs)

        vm.mounts.clear()
        vm.rmtree(vm.root)
        del vm.units[lease]
        self.assertEqual(self.run_cleanup(vm), {"cleaned": True, "already_absent": True})
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "cleaned")

    def test_remote_source_validates_contract_service_and_lease_before_reuse(self):
        self.assertIn("decoded=validate_request()", dev_vm.REMOTE_SOURCE)
        self.assertLess(dev_vm.REMOTE_SOURCE.index("decoded=validate_request()"),
                        dev_vm.REMOTE_SOURCE.index("root.mkdir(mode=0o711)"))
        self.assertIn("if not valid_existing(s,l)", dev_vm.REMOTE_SOURCE)
        self.assertIn("if action=='collect' and not success(s)", dev_vm.REMOTE_SOURCE)
        self.assertIn("'error':'partial_start'", dev_vm.REMOTE_SOURCE)

    def test_codex_profile_matches_measured_tool_disabled_configuration(self):
        self.assertIn('permissions.job.filesystem={":root"="read","/output"="write"}', dev_vm.REMOTE_SOURCE)
        self.assertIn("features.shell_tool=false", dev_vm.REMOTE_SOURCE)
        self.assertIn("mcp_servers={}", dev_vm.REMOTE_SOURCE)

    def test_runtime_scratch_cap_is_separate_from_output_caps(self):
        self.assertIn("--property=LimitFSIZE=134217728", dev_vm.REMOTE_SOURCE)
        self.assertIn("MAX_FILE=1048576; MAX_TOTAL=8388608", dev_vm.REMOTE_SOURCE)
        self.assertIn("size=16M,nr_inodes=1024", dev_vm.REMOTE_SOURCE)

    def test_remote_source_compiles(self):
        compile(dev_vm.REMOTE_SOURCE, "remote_runner", "exec")

    def lease_case(self, **kwargs):
        vm = self.cleanup_vm(**kwargs)
        return vm, lease_program(vm.unit[len("kb-prospecting-"):])

    def failed_worker(self):
        return service_status(ActiveState="failed", SubState="failed", Result="timeout",
                              ExecMainStatus="15", ControlGroup="")

    def test_lease_program_guards_are_not_assertions_and_target_only_the_owned_root(self):
        vm, program = self.lease_case()
        compile(program, "lease_program", "exec")
        # An optimized interpreter must not be able to remove the destructive guards.
        self.assertNotIn("assert ", program)
        self.assertEqual(program.count("/var/tmp/"), 1)
        self.assertIn(repr(vm.root), program)
        self.assertLess(program.index("systemctl','show'"), program.index("shutil.rmtree(p)"))
        self.assertLess(program.index("cgroup.events"), program.index("shutil.rmtree(p)"))
        self.assertLess(program.index("'owner'"), program.index("shutil.rmtree(p)"))
        self.assertLess(program.index("shutil.rmtree(p)"), program.index("reset-failed"))

    def test_natural_lease_clears_owned_root_and_failed_worker_for_later_cleanup(self):
        vm, program = self.lease_case()
        worker, timer = vm.unit + ".service", vm.unit + "-lease.timer"
        vm.units.update({worker: self.failed_worker(), timer: lease_status(SubState="elapsed")})
        self.assertEqual(vm.run_lease(program), 0)
        self.assertEqual((vm.dirs, vm.files, vm.mounts), (set(), {}, set()))
        self.assertIn(["systemctl", "stop", worker], vm.calls)
        self.assertIn(["systemctl", "reset-failed", worker], vm.calls)
        self.assertEqual(vm.units, {timer: lease_status(SubState="elapsed")})
        # RemainAfterElapse=no unloads the elapsed transient timer and its lease service.
        del vm.units[timer]
        self.assertEqual(self.run_cleanup(vm), {"cleaned": True, "already_absent": True})
        self.assertEqual(dev_vm.load_receipt(self.receipt)["state"], "cleaned")

    def test_lease_retains_the_root_whenever_the_worker_state_is_unproven(self):
        cases = (
            ("query failed", (1, ""), None),
            ("empty output", (0, ""), None),
            ("truncated properties", (0, "ActiveState=inactive\nSubState=dead\n"), None),
            ("unknown state", (0, "LoadState=loaded\nActiveState=zombie\nSubState=?\nControlGroup=\n"), None),
            ("still running", None, service_status(SubState="running")),
            ("activating", None, service_status(ActiveState="activating", SubState="start")),
            ("reloading", None, service_status(ActiveState="reloading", SubState="running")),
        )
        for index, (name, override, state) in enumerate(cases):
            with self.subTest(name):
                self.receipt = self.root / f"case{index}" / "receipt.json"
                vm, program = self.lease_case()
                worker = vm.unit + ".service"
                vm.units[worker] = state or self.failed_worker()
                vm.sticky.add(worker)
                if override is not None:
                    vm.show_results[worker] = override
                self.assertEqual(vm.run_lease(program), 1)
                self.assertEqual(vm.destructive(), [["systemctl", "stop", worker]])
                self.assertIn(vm.root, vm.dirs)
                self.assertIn(vm.root + "/output", vm.mounts)
                self.assertEqual(vm.files[vm.root + "/owner"], vm.unit[len("kb-prospecting-"):])
                self.assertIn(worker, vm.units)

    def test_lease_deletes_only_when_the_owned_control_group_is_provably_empty(self):
        cases = (("foreign group", "/system.slice/other.service", "populated 0\n", 1),
                 ("populated group", None, "populated 1\n", 1),
                 ("quiet group", None, "populated 0\n", 0))
        for index, (name, group, events, expected) in enumerate(cases):
            with self.subTest(name):
                self.receipt = self.root / f"case{index}" / "receipt.json"
                vm, program = self.lease_case()
                worker = vm.unit + ".service"
                owned = "/system.slice/" + worker
                vm.units[worker] = service_status(ActiveState="failed", SubState="failed",
                                                  Result="timeout", ExecMainStatus="15",
                                                  ControlGroup=group or owned)
                vm.files["/sys/fs/cgroup" + owned + "/cgroup.events"] = events
                self.assertEqual(vm.run_lease(program), expected)
                self.assertEqual(vm.root in vm.dirs, expected == 1)
                if expected:
                    self.assertEqual(vm.destructive(), [["systemctl", "stop", worker]])
                    self.assertIn(vm.root + "/output", vm.mounts)
                    self.assertIn(worker, vm.units)
                else:
                    self.assertIn(["rmtree", vm.root], vm.calls)
                    self.assertNotIn(worker, vm.units)

    def test_lease_never_deletes_a_root_whose_owner_marker_does_not_match(self):
        for index, owner in enumerate(("0" * 32, None)):
            with self.subTest(owner=owner):
                self.receipt = self.root / f"case{index}" / "receipt.json"
                vm, program = self.lease_case(owner=owner)
                worker = vm.unit + ".service"
                if owner is None:
                    del vm.files[vm.root + "/owner"]
                vm.units[worker] = service_status(ActiveState="failed", SubState="failed",
                                                  Result="exit-code", ExecMainStatus="1", ControlGroup="")
                self.assertEqual(vm.run_lease(program), 1)
                self.assertEqual(vm.destructive(), [["systemctl", "stop", worker]])
                self.assertIn(vm.root, vm.dirs)
                self.assertIn(vm.root + "/output", vm.mounts)
                self.assertIn(worker, vm.units)

    def test_lease_after_the_root_is_gone_still_clears_only_the_owned_unit(self):
        vm, program = self.lease_case(root=False)
        worker = vm.unit + ".service"
        vm.units[worker] = self.failed_worker()
        self.assertEqual(vm.run_lease(program), 0)
        self.assertEqual(vm.units, {})
        self.assertFalse([call for call in vm.calls if call[0] in ("rmtree", "/usr/bin/umount")])
        self.assertEqual(self.run_cleanup(vm), {"cleaned": True, "already_absent": True})

    def test_lease_timer_is_armed_to_unload_itself_after_it_elapses(self):
        source = dev_vm.REMOTE_SOURCE
        self.assertIn("'--timer-property=RemainAfterElapse=no'", source)
        self.assertIn("cleanup=lease_script()", source)
        self.assertLess(source.index("'--timer-property=RemainAfterElapse=no'"),
                        source.index("'/usr/bin/python3','-c',cleanup"))
        self.assertLess(source.index("--unit='+unit+'-lease'"),
                        source.index("args=['systemd-run','--quiet','--unit='+unit"))


if __name__ == "__main__":
    unittest.main()
