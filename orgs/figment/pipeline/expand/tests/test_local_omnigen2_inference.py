import builtins
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[5]))

from orgs.figment.pipeline.expand import local_omnigen2_inference as plan  # noqa: E402


def _by_type(g, class_type):
    return [n for n in g.values() if n["class_type"] == class_type]


def test_graph_rejects_non_fixed_seed():
    for bad in (0, 481516235, True, 90210.0, "90210"):
        with pytest.raises(ValueError):
            plan.graph(bad)


def test_graph_fixed_values_and_seed():
    g = plan.graph(481516234)
    assert g["21"]["inputs"] == {"noise_seed": 481516234}
    assert plan.graph(90210)["21"]["inputs"]["noise_seed"] == 90210
    assert g["11"]["inputs"] == {"width": 768, "height": 768, "batch_size": 1}
    gi = g["27"]["inputs"]
    assert (gi["cfg_conds"], gi["cfg_cond2_negative"], gi["style"]) == (5.0, 2.5, "regular")
    assert g["23"]["inputs"] == {"model": ["12", 0], "scheduler": "simple", "steps": 20, "denoise": 1.0}
    assert g["20"]["inputs"] == {"sampler_name": "euler"}
    assert g["17"]["inputs"] == {"image": ["16", 0], "upscale_method": "area", "megapixels": 1.0}
    assert g["16"]["inputs"] == {"image": "g01.jpg"}
    assert g["12"]["inputs"] == {"unet_name": "omnigen2_fp16.safetensors", "weight_dtype": "default"}
    assert g["10"]["inputs"] == {"clip_name": "qwen_2.5_vl_fp16.safetensors", "type": "omnigen2", "device": "default"}
    assert g["13"]["inputs"] == {"vae_name": "ae.safetensors"}
    assert g["9"]["inputs"] == {"images": ["8", 0], "filename_prefix": "figment-local-omnigen2"}
    assert g["6"]["inputs"]["text"].startswith("Using the woman in image 1 as the identity reference,")
    assert g["6"]["inputs"]["text"].endswith("do not copy the source pose, crop, background, lighting, or clothing.")
    assert g["7"]["inputs"]["text"] == (
        "child, minor, nude, lingerie, explicit, extra person, duplicate person, deformed, blurry, "
        "bad anatomy, distorted face, extra limb, fused fingers, text, watermark, censor bar"
    )


def test_one_reference_wiring_matches_official_path():
    g = plan.graph(90210)
    assert len(_by_type(g, "LoadImage")) == 1
    assert len(_by_type(g, "VAEEncode")) == 1
    assert len(_by_type(g, "ReferenceLatent")) == 2
    for absent in ("GetImageSize", "MarkdownNote", "Note"):
        assert not _by_type(g, absent)
    assert g["14"]["inputs"] == {"pixels": ["17", 0], "vae": ["13", 0]}
    # reference-positive: positive text + reference latent
    assert g["15"]["inputs"] == {"conditioning": ["6", 0], "latent": ["14", 0]}
    # reference-negative: negative text + reference latent
    assert g["29"]["inputs"] == {"conditioning": ["7", 0], "latent": ["14", 0]}
    guider = g["27"]["inputs"]
    assert guider["model"] == ["12", 0]
    assert guider["cond1"] == ["15", 0]
    assert guider["cond2"] == ["29", 0]
    # unconditioned negative: plain negative text encode, no ReferenceLatent in between
    assert guider["negative"] == ["7", 0]
    assert g["7"]["class_type"] == "CLIPTextEncode"
    assert g["28"]["inputs"] == {
        "noise": ["21", 0], "guider": ["27", 0], "sampler": ["20", 0], "sigmas": ["23", 0], "latent_image": ["11", 0],
    }
    assert g["8"]["inputs"] == {"samples": ["28", 0], "vae": ["13", 0]}
    # every link points at an existing node
    for node in g.values():
        for v in node["inputs"].values():
            if isinstance(v, list):
                assert v[0] in g and v[1] == 0


def test_manifest_builds_offline_without_opening_files(monkeypatch):
    def deny(*a, **k):
        raise AssertionError("planner must not read files")

    monkeypatch.setattr(builtins, "open", deny)
    m = plan.build_manifest()
    assert m["schema"] == "figment/local-omnigen2-inference-plan@1"
    assert m["seeds"] == [481516234, 90210]
    assert [r["seed"] for r in m["runs"]] == [481516234, 90210]
    for r in m["runs"]:
        assert r["graph"] == plan.graph(r["seed"])
        assert r["graph_sha256"] == plan.sha256_of(plan.graph(r["seed"]))
    assert m["runs"][0]["graph_sha256"] != m["runs"][1]["graph_sha256"]
    assert m["manifest_sha256"] == plan.manifest_hash(m)
    assert m["status"] == {
        "research_only": True,
        "promotable": False,
        "commercial_use_cleared": False,
        "execution": "unimplemented; planner data only",
        "quality_acceptance_implied": False,
    }


def test_manifest_pins_match_feasibility_doc():
    m = plan.build_manifest()
    assert m["source"]["comfy_commit"] == "95d755cd8107a72258d452b5d3657273d571f07d"
    assert m["template"]["sha256"] == "3a63f64bf3b58ad8fa761e4606d7d5ca1e6efd42fc1df57afe9e3e6d075ca593"
    assert m["template"]["bytes"] == 26553
    assert m["reference"]["sha256"] == "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed"
    assert m["reference"]["filename"] == "g01.jpg"
    mm = m["models"]
    assert (mm["diffusion"]["bytes"], mm["diffusion"]["sha256"]) == (
        7934384176, "60dbde45107762d164bac463e1cf365e074b377fa843dc90cb2985fb211cd4de")
    assert (mm["clip"]["bytes"], mm["clip"]["sha256"]) == (
        7509337224, "ba05dd266ad6a6aa90f7b2936e4e775d801fb233540585b43933647f8bc4fbc3")
    assert (mm["vae"]["bytes"], mm["vae"]["sha256"]) == (
        335304388, "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38")
    assert sum(v["bytes"] for v in mm.values()) == m["model_payload_bytes"] == 15779025788
    assert all(v["revision"] == "4876f2222e35e269029e8d72aaff5b2aaaf73e1b" for v in mm.values())


def test_validate_accepts_json_roundtrip():
    m = json.loads(json.dumps(plan.build_manifest()))
    plan.validate_manifest(m)
    assert m == plan.build_manifest()


def _set(m, path, value):
    target = m
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value


TAMPERS = {
    "seed": (("runs", 1, "graph", "21", "inputs", "noise_seed"), 90211),
    "seed_list": (("seeds", 1), 90211),
    "width": (("runs", 0, "graph", "11", "inputs", "width"), 1024),
    "height": (("runs", 0, "graph", "11", "inputs", "height"), 1408),
    "batch": (("runs", 0, "graph", "11", "inputs", "batch_size"), 2),
    "text_cfg": (("runs", 0, "graph", "27", "inputs", "cfg_conds"), 7.0),
    "image_cfg": (("runs", 1, "graph", "27", "inputs", "cfg_cond2_negative"), 3.0),
    "guider_style": (("runs", 0, "graph", "27", "inputs", "style"), "nested"),
    "negative_gets_reference": (("runs", 0, "graph", "27", "inputs", "negative"), ["29", 0]),
    "reference_file": (("runs", 0, "graph", "16", "inputs", "image"), "g02.jpg"),
    "reference_hash": (("reference", "sha256"), "0" * 64),
    "model_file": (("runs", 0, "graph", "12", "inputs", "unet_name"), "omnigen2_fp8.safetensors"),
    "model_hash": (("models", "diffusion", "sha256"), "0" * 64),
    "steps": (("runs", 0, "graph", "23", "inputs", "steps"), 30),
    "prompt": (("runs", 0, "graph", "6", "inputs", "text"), "a woman"),
    "status": (("status", "promotable"), True),
    "template_hash": (("template", "sha256"), "0" * 64),
    # numeric-coercion tampers: Python would call these equal, canonical JSON must not
    "cfg_int_coercion": (("runs", 0, "graph", "27", "inputs", "cfg_conds"), 5),
    "batch_bool_coercion": (("runs", 0, "graph", "11", "inputs", "batch_size"), True),
    "denoise_int_coercion": (("fixed", "denoise"), 1),
}


@pytest.mark.parametrize("name", sorted(TAMPERS))
def test_validate_rejects_tampering_even_when_refrozen(name):
    path, value = TAMPERS[name]
    m = copy.deepcopy(plan.build_manifest())
    _set(m, path, value)
    with pytest.raises(plan.ManifestMismatch):
        plan.validate_manifest(m)
    # attacker re-signs the graph and the whole manifest: still rejected
    for r in m["runs"]:
        r["graph_sha256"] = plan.sha256_of(r["graph"])
    m["manifest_sha256"] = plan.manifest_hash(m)
    with pytest.raises(plan.ManifestMismatch):
        plan.validate_manifest(m)


def test_validate_rejects_subset_and_wrong_schema():
    m = plan.build_manifest()
    subset = {k: v for k, v in m.items() if k != "runs"}
    subset["manifest_sha256"] = plan.manifest_hash(subset)
    with pytest.raises(plan.ManifestMismatch):
        plan.validate_manifest(subset)
    with pytest.raises(plan.ManifestMismatch):
        plan.validate_manifest({**m, "schema": "figment/local-omnigen2-inference-plan@2"})
    with pytest.raises(plan.ManifestMismatch):
        plan.validate_manifest([m])
