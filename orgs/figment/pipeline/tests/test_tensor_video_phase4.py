"""Real synthetic local media; no model, network or pod execution."""
import hashlib
import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest
from PIL import Image
import test_tensor_edit_integration as edit_tests

registered = edit_tests.registered

SPEC = importlib.util.spec_from_file_location("tensor_video_test", Path(__file__).parents[1] / "tensor_video.py")
video = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(video)


def pair(path):
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def encode(path, *, fps=16, comment=None, width=96, height=128, count=81):
    args = [str(video.frames.FFMPEG_PATH), "-v", "error", "-f", "lavfi", "-i",
            f"color=c=blue:s={width}x{height}:r={fps}", "-frames:v", str(count),
            "-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if comment is not None:
        args += ["-metadata", "comment=" + json.dumps(comment)]
    video.frames._run(args + [str(path)], "synthetic fixture encoding")


@pytest.fixture
def media(tmp_path):
    clip = tmp_path / "drive.mp4"
    encode(clip)
    receipt = video.frames.extract_frames(root=tmp_path, video_path=Path(clip.name), output_dir=Path("extracted"))
    first = tmp_path / receipt["frames"][0]["path"]
    evidence = tmp_path / "extracted/frame-extraction.json"
    return tmp_path, clip, first, evidence


def test_verified_frame0_records_pixels_decoder_and_preserves_inputs(media):
    root, clip, first, evidence = media
    result = video.validate_frame0(clip=pair(clip), image=pair(first), extraction_receipt=pair(evidence), base_dir=root)
    assert result["comparison"] == "exact-decoded-RGB-pixels"
    assert result["not_promotable"] is True
    assert result["decoders"]["ffmpeg"]["version"].startswith("ffmpeg version")
    assert result["frame"]["sha256"] == pair(first)["sha256"]
    assert not list(root.glob(".tensor-frame0-*"))
    assert video.validate_driving_timing(result["clip"])["decoded_frames"] == 81


def test_declared_frame0_receipt_cannot_replace_actual_decoded_pixels(media):
    root, clip, first, evidence = media
    Image.new("RGB", (96,128), "red").save(first)
    receipt = json.loads(evidence.read_text())
    receipt["frames"][0].update(sha256=pair(first)["sha256"], bytes=first.stat().st_size)
    evidence.write_text(json.dumps(receipt))
    with pytest.raises(video.TensorVideoError, match="exact decoded frame0"):
        video.validate_frame0(clip=pair(clip), image=pair(first), extraction_receipt=pair(evidence), base_dir=root)
    assert not list(root.glob(".tensor-frame0-*"))


@pytest.mark.parametrize("fps,count", [(24,81),(16,80)])
def test_driving_clip_requires_conservative_cfr16_and_81frames(tmp_path,fps,count):
    clip = tmp_path / "unsupported.mp4"
    encode(clip,fps=fps,count=count)
    with pytest.raises(video.TensorVideoError):
        video.validate_driving_timing({**pair(clip), "bytes":clip.stat().st_size})


@pytest.mark.parametrize("extra", [{}, {"workflow":{"nodes":[]}}])
def test_native_movie_checks_real_api_prompt_metadata_optional_uiworkflow(tmp_path,extra):
    graph = {"3":{"class_type":"KSampler","inputs":{"seed":123}}}
    path = tmp_path / "native.mp4"
    encode(path, comment={"prompt":json.dumps(graph), **extra})
    result = video.inspect_movie(movie=pair(path),base_dir=tmp_path,submitted_workflow=graph,expected_dimensions=(96,128))
    assert result["embedded_prompt_sha256"] == video.inputs.canonical_sha256(graph)
    assert result["metadata"]["frame_count"] == 81
    assert (result["embedded_workflow_sha256"] is None) == (not extra)


@pytest.mark.parametrize("comment", [None,{"prompt":"{}"},{"prompt":{"not":"string"}}, {"prompt":"{}","workflow":[]}])
def test_native_movie_refuses_missing_or_wrong_graph_metadata(tmp_path,comment):
    path=tmp_path/"native.mp4"
    encode(path,comment=comment)
    with pytest.raises(video.TensorVideoError):
        video.inspect_movie(movie=pair(path),base_dir=tmp_path,submitted_workflow={"expected":{}},expected_dimensions=(96,128))


def test_source_resize_arithmetic_and_extreme_aspect_refusal():
    assert video.output_dimensions(96,128)=={"width":608,"height":832,"frames":81,"fps":16}
    with pytest.raises(video.TensorVideoError,match="aspect"):
        video.output_dimensions(1,8192)


@pytest.fixture
def native_case(registered, media, tmp_path):
    ft = edit_tests.ft
    _, clip, first, evidence = media
    request = registered[4]
    request.update(job_type="start-frame-head-swap", base=pair(first),
        frame_source={"clip":pair(clip), "extraction_receipt":pair(evidence), "frame_index":0})
    edit_tests.write(registered[3],request)
    edit_root, edit_plan = edit_tests.edit_plan(registered,tmp_path)
    edit_tests.passport._fake_stage_outputs(edit_root,edit_plan,"edit")
    edit_run=edit_plan["stages"]["edit"]["runs"][0]
    edit_job=ft._read_json(edit_root/edit_run["manifest"])["jobs"][0]
    shutil.copy2(first,edit_root/edit_run["out"]/(edit_job["output_name"]+".png"))
    grade=ft.build_grade("creator-003","edit",edit_root/"plan.json",skip_judge=True)
    ruling=ft._read_json(Path(grade["rulings_template"]))
    ruling.update(decided_by="fixture",decided_at="2026-10-05T00:00:00Z")
    for row in ruling["rulings"]:
        row.update(edit_tests.passport._axes(),decision="keep",why="fixture only")
    edit_tests.write(edit_root/"filled.json",ruling)
    ft.apply_rulings("creator-003","edit",edit_root/"plan.json",edit_root/"filled.json")
    text="A clothed adult makes a small natural movement."
    request={"schema":video.REQUEST_SCHEMA,"creator":"creator-003","fixture":True,
        "clip":pair(clip),"extraction_receipt":pair(evidence),
        "edit":{"plan":str(edit_root/"plan.json"),"image_id":ruling["rulings"][0]["image_id"]},
        "prompt":{"text":text,"sha256":hashlib.sha256(text.encode()).hexdigest(),
                  "decided_by":"fixture","decided_at":"2026-10-05T00:00:00Z"},
        "intake":{"one_person":True,"simple_motion":True,"adult":True,"clothed":True,
                  "fixture":True,"decided_by":"fixture","decided_at":"2026-10-05T00:00:00Z"}}
    request_path=tmp_path/"video-request.json"
    edit_tests.write(request_path,request)
    root=tmp_path/"video-plan"
    plan=ft.build_plan("creator-003","video",root,personas_root=registered[0],
        video_request=request_path,skip_pin_verify=True,ledger_dir=tmp_path/"ledger")
    run=plan["stages"]["video"]["runs"][0]
    manifest=ft._read_json(root/run["manifest"])
    runner=video._module("tensor_native_test_runner",video.HERE/"pod/runpod_run.py")
    graph=runner.apply_job(manifest["workflow"],manifest["jobs"][0],runner.manifest_seed_fields(manifest))
    source=tmp_path/"synthetic-native.mp4"
    budget=manifest["native_budget"]
    encode(source,width=budget["width"],height=budget["height"],comment={"prompt":json.dumps(graph)})
    out=root/run["out"]
    out.mkdir(parents=True,exist_ok=True)
    class FakeClient:
        def download_contract_output(self,record,path,deadline,watchdog):
            shutil.copy2(source,path)
    class Watchdog:
        def check(self): pass
    rows=runner.contract_history_outputs({"outputs":{"49":{"gifs":[{
        "filename":"native.mp4","subfolder":"","type":"output","format":"video/h264-mp4"}]}}},
        manifest["jobs"][0]["output_contract"])
    files=runner.download_contract_outputs(FakeClient(),rows,out,manifest["jobs"][0]["output_name"],
                                           30,Watchdog(),"fixture-prompt-1")
    receipt={"dry_run":True,"fixture":True,"no_model_execution":True,"termination_verified":True,
        "jobs":[{"output_name":manifest["jobs"][0]["output_name"],"seed":123,
                 "prompt_id":"fixture-prompt-1","effective_workflow_sha256":video.inputs.canonical_sha256(graph),
                 "files":files}]}
    edit_tests.write(out/"run.json",receipt)
    return ft,root,plan,manifest,request_path


def test_real_fixture_native_movie_plan_transport_grade_and_eye_gate(native_case):
    ft,root,plan,manifest,_=native_case
    run=plan["stages"]["video"]["runs"][0]
    dry=ft.subprocess.run([sys.executable,str(ft.POD_RUNNER),"run","--manifest",str(root/run["manifest"]),
                          "--out",str(root/"dry-run"),"--dry-run"],capture_output=True,text=True)
    assert dry.returncode==0,dry.stdout+dry.stderr
    with pytest.raises(ft.FigmentTrainError,match="fixture"):
        ft._install_stage_config("video",plan,root)
    grade=ft.build_grade("creator-003","video",root/"plan.json",skip_judge=True)
    grading=ft._read_json(Path(grade["grading_manifest"]))
    assert len(grading["images"])==11 and all("decoded" in row["image_id"] for row in grading["images"])
    rulings=ft._read_json(Path(grade["rulings_template"]))
    rulings.update(decided_by="fixture",decided_at="2026-10-05T00:00:00Z")
    for row in rulings["rulings"]:
        row.update(edit_tests.passport._axes(),decision="keep",why="fixture only")
    edit_tests.write(root/"filled.json",rulings)
    ft.apply_rulings("creator-003","video",root/"plan.json",root/"filled.json")
    state=ft._stage_state(root/"stage.json","creator-003",root/"plan.json")
    state["completed_stages"]=["video"]
    edit_tests.write(root/"stage.json",state)
    assert ft.command_pipeline("creator-003",plan_path=root/"plan.json")["status"]=="GATE video-playback"
    review,arguments,destination=ft._tensor_video_review_context(plan,root)
    evaluation=ft._read_json(destination/"evaluation-inputs.json")
    subject=evaluation["subject"]
    decision={"schema":review.RULINGS_SCHEMA,"candidate_id":evaluation["candidate_id"],
        "subject_sha256":evaluation["subject_sha256"],"attempt_id":"fixture1","decision":"accept",
        "decided_by":"fixture","decided_at":"2026-10-05T00:00:00Z","reason":"","override":False,
        "samples":[{"image_id":row["label"],"index":row["index"],"frame_sha256":row["sha256"],
                    "why":"synthetic fixture",**{key:value for key,value in edit_tests.passport._axes().items()
                        if key != "gate_override"}} for row in subject["extraction"]["frames"]],
        "complete_sequence":{"coverage":"all-81-ordered-frames","frames_sha256":subject["sequence"]["frames_sha256"],
                             "axes":{axis:"pass" for axis in review.SEQUENCE_AXES}},
        "full_playback":{"coverage":"entire-clip","movie_sha256":subject["assembly"]["movie"]["sha256"],
                         "axes":{axis:"pass" for axis in review.PLAYBACK_AXES}}}
    edit_tests.write(root/"video-rulings.json",decision)
    accepted=review.apply_rulings(**arguments,rulings=Path("video-rulings.json"))
    assert accepted["subject"]["fixture"] is True
    assert accepted["subject"]["runtime_admitted"] is False
    with pytest.raises(review.VideoReviewError,match="fixture"):
        review.validate_accepted_video(root,(destination/review.ACCEPTED_NAME).relative_to(root))
    complete=ft.command_pipeline("creator-003",plan_path=root/"plan.json")
    assert complete["status"]=="complete:video"
    delivered=ft._read_json(Path(complete["deliverable"]))
    assert delivered["schema"]=="figment/tensor-video-deliverable@1" and delivered["not_promotable"]


@pytest.mark.parametrize("target", ["clip", "staged-clip", "both-clip", "request", "edit-ruling", "frame-receipt"])
def test_video_input_authority_mutation_refused(native_case,target):
    ft,root,plan,manifest,request=native_case
    frozen=plan["video_inputs"]
    if target in ("clip","both-clip"):
        Path(frozen["clip"]["path"]).write_bytes(b"changed clip")
    if target in ("staged-clip","both-clip"):
        (root/plan["assets"]["video_inputs"]["clip"]).write_bytes(b"changed clip")
    if target=="request":
        document=ft._read_json(request)
        document["prompt"]["text"]+=" changed"
        document["prompt"]["sha256"]=hashlib.sha256(document["prompt"]["text"].encode()).hexdigest()
        edit_tests.write(request,document)
    if target=="edit-ruling":
        path=Path(frozen["accepted_edit"]["source_plan"]["path"]).parent/"grade/edit/rulings.json"
        path.write_text("{}")
    if target=="frame-receipt":
        Path(frozen["frame0"]["extraction_receipt"]["path"]).write_text("{}")
    with pytest.raises((ft.FigmentTrainError,video.inputs.EditInputError,ValueError)):
        ft._validate_tensor_video_inputs(plan,root)
    with pytest.raises((ft.FigmentTrainError,ValueError)):
        ft.build_grade("creator-003","video",root/"plan.json",skip_judge=True)


@pytest.mark.parametrize("target", ["node", "prompt", "graph", "movie", "decoded", "decoded-and-receipt", "metadata"])
def test_native_receipt_and_decoded_evidence_mutation_refused(native_case,target):
    ft,root,plan,manifest,_=native_case
    run=plan["stages"]["video"]["runs"][0]
    receipt_path=root/run["out"]/"run.json"
    evidence=ft._build_video_evidence(plan,root)
    receipt=ft._read_json(receipt_path)
    if target=="node": receipt["jobs"][0]["files"][0]["node_id"]="3"
    if target=="prompt": receipt["jobs"][0]["files"][0]["prompt_id"]="old-prompt"
    if target=="graph": receipt["jobs"][0]["effective_workflow_sha256"]="a"*64
    if target=="movie": (root/run["out"]/receipt["jobs"][0]["files"][0]["path"]).write_bytes(b"not an mp4")
    if target=="decoded": (root/evidence["assembly"]["frames"][0]["path"]).write_bytes(b"changed frame")
    if target in ("decoded-and-receipt","metadata"):
        value=evidence["assembly"]
        if target=="metadata": value["metadata"]["width"]+=32
        else:
            first=root/value["frames"][0]["path"]
            Image.new("RGB",(manifest["native_budget"]["width"],manifest["native_budget"]["height"]),"red").save(first)
            value["frames"][0].update(sha256=pair(first)["sha256"],bytes=first.stat().st_size)
        edit_tests.write(root/"video/evidence/native/native-evidence.json",value)
    if target in ("node","prompt","graph"): edit_tests.write(receipt_path,receipt)
    with pytest.raises(ft.FigmentTrainError):
        ft._build_video_evidence(plan,root)


def test_native_cfr_proof_does_not_trust_average_rate(tmp_path,monkeypatch):
    graph={"3":{"inputs":{"seed":123},"class_type":"KSampler"}}
    movie=tmp_path/"native.mp4"
    encode(movie,comment={"prompt":json.dumps(graph)})
    original=video.frames._probe_json
    def probe(args,label):
        value=original(args,label)
        if label=="driving clip frame timing":
            value["frames"][40]["best_effort_timestamp_time"]="2.510000"
        return value
    monkeypatch.setattr(video.frames,"_probe_json",probe)
    with pytest.raises(video.TensorVideoError,match="CFR16"):
        video.inspect_movie(movie=pair(movie),base_dir=tmp_path,submitted_workflow=graph,expected_dimensions=(96,128))


@pytest.mark.parametrize("field", ["detail_images","style_lora","style_lora_strength","gen_prompt_style",
    "gen_refine_denoise","gen_detailer_denoise","import_training_config"])
def test_tensor_video_refuses_unrelated_overrides_before_writes(tmp_path,field):
    out=tmp_path/"plan"
    with pytest.raises(edit_tests.ft.FigmentTrainError,match="exclusively"):
        edit_tests.ft.build_plan("creator-003","video",out,video_request=tmp_path/"request.json",**{field:"unused"})
    assert not out.exists()


def test_tensor_video_cannot_fall_through_to_clean_gen_video_adapter(registered,tmp_path):
    out=tmp_path/"must-not-exist"
    with pytest.raises(edit_tests.ft.FigmentTrainError,match="requires --video-request"):
        edit_tests.ft.build_plan("creator-003","video",out,personas_root=registered[0],
            approved_gen_plan=tmp_path/"arbitrary-gen",skip_pin_verify=True)
    assert not out.exists()


@pytest.mark.parametrize("mutation", [None,"role","node","prompt","graph","digest","size","path","media","companion"])
def test_generic_contract_receipt_validation_keeps_node_role_graph_and_byte_binding(tmp_path,monkeypatch,mutation):
    ft=edit_tests.ft
    graph={"1":{"class_type":"KSampler","inputs":{"seed":123}}}
    job={"seed":123,"output_name":"fixture","output_contract":{"schema":"figment/comfy-output-contract@1",
        "outputs":[{"node_id":"49","role":"video","media_type":"video/mp4","count":1,
                    "max_bytes":512*1024*1024,"workflow_png":False}]}}
    manifest={"jobs":[job],"workflow":graph,"seed_fields":["seed"]}
    path=tmp_path/"fixture.mp4"
    path.write_bytes(b"transport-only synthetic bytes; not decoded media proof")
    row={"path":path.name,"bytes":path.stat().st_size,"sha256":pair(path)["sha256"],
         "node_id":"49","role":"video","media_type":"video/mp4","prompt_id":"fixture1",
         "remote":{"filename":"fixture.mp4","subfolder":"","type":"output"}}
    receipt={"termination_verified":True,"jobs":[{"output_name":"fixture","seed":123,"prompt_id":"fixture1",
             "effective_workflow_sha256":video.inputs.canonical_sha256(graph),"files":[row]}]}
    if mutation=="role": row["role"]="other"
    if mutation=="node": row["node_id"]="3"
    if mutation=="prompt": row["prompt_id"]="other"
    if mutation=="graph": receipt["jobs"][0]["effective_workflow_sha256"]="a"*64
    if mutation=="digest": row["sha256"]="a"*64
    if mutation=="size": row["bytes"]+=1
    if mutation=="path": row["path"]="../fixture.mp4"
    if mutation=="media": row["media_type"]="image/png"
    if mutation=="companion": row["companion_of"]="unknown"
    edit_tests.write(tmp_path/"run.json",receipt)
    monkeypatch.setattr(ft,"_verify_ledger",lambda *args:None)
    if mutation is None:
        assert ft.verify_run_record("video",manifest,tmp_path,tmp_path/"ledger")==receipt
    else:
        with pytest.raises((ValueError,ft.FigmentTrainError)):
            ft.verify_run_record("video",manifest,tmp_path,tmp_path/"ledger")
