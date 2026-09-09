"""Synthetic local checks; these do not contact a VM or use credentials."""
import base64
import hashlib
import json
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
