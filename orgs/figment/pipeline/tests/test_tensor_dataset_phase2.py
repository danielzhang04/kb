"""Offline module 10/11 parity against the verified editor source, not a golden API copy."""
import copy
import json
import sys
from pathlib import Path
import pytest

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE))
import tensor_parity as tp

LOOK = {"hair": "brown hair", "eyes": "blue eyes", "skin": "forbidden synthetic skin clause"}
BODY = "an average adult build in an opaque loose shirt and trousers"
PINS = json.loads((PIPELINE / "train/tensor-pins.yaml").read_text(encoding="utf-8"))


def fixture():
    workflow = json.loads(tp.DATASET_WORKFLOW.read_text(encoding="utf-8"))
    blocks = tp.dataset_prompt_blocks(LOOK["hair"], LOOK["eyes"], BODY)
    jobs = []
    for branch, node, refine, output in (("face", "174", "800", "791"), ("body", "676", "780", "776")):
        for i, row in enumerate(blocks[branch]["rows"]):
            jobs.append({"seed": i, "output_name": f"{branch}-{i}", "substitutions": [
                {"node_id": "832", "field": "images", "value": [output, 0]},
                {"node_id": node, "field": "prompt", "value": blocks[branch]["identity"] + row},
                {"node_id": refine, "field": "text", "value": blocks[branch]["identity"]}]})
    return workflow, {"models": copy.deepcopy(PINS["pins"]["dataset_tensor"]["models"]), "custom_nodes": copy.deepcopy(PINS["pins"]["dataset_tensor"]["custom_nodes"]), "jobs": jobs}


def test_committed_effective_dataset_export_and_all_30_prompts():
    workflow, manifest = fixture()
    assert len(manifest["jobs"]) == 30
    assert tp.check_dataset(workflow, manifest, LOOK, BODY) == []
    source = json.loads(tp.DATASET_GRAPH.read_text(encoding="utf-8"))
    nodes = {str(n["id"]): n for n in source["nodes"]}
    blocks = tp.dataset_prompt_blocks(LOOK["hair"], LOOK["eyes"], BODY)
    # Independent literal slot substitution and direct prompt-list extraction.
    assert blocks["face"]["identity"] == nodes["761"]["widgets_values"][0].replace("long platinum blone hair", LOOK["hair"]).replace("grey eyes", LOOK["eyes"])
    assert blocks["body"]["identity"] == "A youthful young woman with brown hair, no makeup. she has " + BODY
    for branch, node in (("face", "179"), ("body", "697")):
        assert blocks[branch]["rows"] == nodes[node]["widgets_values"][1].splitlines()
    # Effective edges known independently from the source link table, including bypass 723.
    assert workflow["66"]["inputs"]["model"] == ["89", 0]
    assert workflow["676"]["inputs"]["image1"] == ["678", 0]
    assert workflow["676"]["inputs"]["image2"] == ["698", 0]
    assert workflow["679"]["inputs"]["image"] == ["836", 0]
    assert workflow["678"]["inputs"]["image"] == ["837", 0]
    assert workflow["789"]["inputs"]["conditioning"] == ["800", 0]
    assert workflow["777"]["inputs"]["conditioning"] == ["780", 0]
    assert workflow["646"]["inputs"]["latent_image"] == ["176", 0]
    assert workflow["89"]["inputs"]["model"] == ["r1_2", 0]
    assert workflow["r1_1"]["inputs"]["weight_dtype"] == "fp8_e4m3fn"
    assert {"701", "723", "833"}.isdisjoint(workflow)
    dumped = json.dumps(workflow).lower()
    assert not any(token in dumped for token in ("nsfw", "remove the clothes", "fully naked", "bigsloppy"))


@pytest.mark.parametrize("node,field,value", [
    ("676", "image1", ["698", 0]), ("676", "image2", ["678", 0]),
    ("679", "image", ["837", 0]), ("678", "image", ["836", 0]),
    ("646", "sampler_name", "euler"), ("646", "denoise", .9),
    ("89", "strength_model", 1.0), ("r1_2", "strength_model", .5),
    ("798", "type", "flux2"), ("788", "denoise", .35),
    ("800", "text", "extra skin and repair tail"), ("174", "prompt", "stale widget"),
    ("777", "conditioning", ["766", 0]), ("672", "bongmath", 1),
])
def test_dataset_recipe_mutations_rejected(node, field, value):
    workflow, manifest = fixture()
    workflow[node]["inputs"][field] = value
    assert tp.check_dataset(workflow, manifest, LOOK, BODY)


def test_missing_reference_extra_model_wrong_hash_and_prompt_tail_rejected():
    for mutation in (lambda w,m: w.pop("789"),
                     lambda w,m: m["models"].append(copy.deepcopy(m["models"][0])),
                     lambda w,m: m["models"][0].update(sha256="0"*64),
                     lambda w,m: m["models"][0].update(pickle_ack="broad exception"),
                     lambda w,m: m["jobs"][0]["substitutions"][1].update(value="skin repair"),
                     lambda w,m: m["jobs"].append(copy.deepcopy(m["jobs"][0]))):
        workflow, manifest = fixture()
        mutation(workflow, manifest)
        assert tp.check_dataset(workflow, manifest, LOOK, BODY)


def test_digest_mutation_is_not_redefined_by_api_export(monkeypatch):
    monkeypatch.setattr(tp, "DATASET_GRAPH_SHA256", "0" * 64)
    with pytest.raises(tp.ParityError, match="digest changed"):
        tp.dataset_workflow()


def _tester_fixture():
    workflow = json.loads(tp.TESTER_WORKFLOW.read_text(encoding="utf-8"))
    jobs = [{"seed": 1595, "output_name": f"step-{step}", "substitutions": [
        {"node_id": "408", "field": "text", "value": "Adult woman seated in an opaque shirt."},
        {"node_id": "411", "field": "lora_name", "value": f"creator-003-{step}.safetensors"}]}
        for step in range(250, 3001, 250)]
    return workflow, {"models": copy.deepcopy(PINS["pins"]["tester"]["models"]), "custom_nodes": copy.deepcopy(PINS["pins"]["tester"]["custom_nodes"]), "jobs": jobs}


def test_tester_all_twelve_source_branches_equal_after_fanout_collapse():
    graph = json.loads(tp.TESTER_GRAPH.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in graph["nodes"]}
    edges = {e[0]: e for e in graph["links"]}
    # Independent recursive source signature. Ignore only checkpoint name, ID and UI.
    def signature(node_id):
        node = nodes[node_id]
        widgets = list(node.get("widgets_values", []))
        if node["type"] == "LoraLoader": widgets[0] = "CHECKPOINT"
        links = [(i["name"], edges[i["link"]][2], signature(edges[i["link"]][1]))
                 for i in node.get("inputs", []) if i.get("link") is not None]
        return node["type"], widgets, links
    decoders = [n["id"] for n in graph["nodes"] if n["type"] == "VAEDecode"]
    assert len(decoders) == 12
    assert all(signature(n) == signature(decoders[0]) for n in decoders)
    w,m = _tester_fixture()
    assert tp.check_tester(w,m) == []
    for field, value in (("seed", 0), ("steps", 8), ("cfg", 2), ("sampler_name", "euler"), ("scheduler", "simple")):
        bad = copy.deepcopy(w); bad["409"]["inputs"][field] = value
        assert tp.check_tester(bad,m)
    for node, field, value in (("403", "width", 1024), ("403", "height", 1440), ("411", "strength_clip", .5), ("381", "conditioning", ["383", 0])):
        bad = copy.deepcopy(w);bad[node]["inputs"][field] = value
        assert tp.check_tester(bad,m)
    m["jobs"][0]["seed"] = 5
    assert tp.check_tester(w,m)


def test_every_dataset_widget_and_effective_edge_against_source_independently():
    """Do not use the exporter or its widget/edge helpers as the oracle."""
    graph = json.loads(tp.DATASET_GRAPH.read_text(encoding="utf-8"))
    source = {str(n["id"]): n for n in graph["nodes"]}
    links = {edge[0]: edge for edge in graph["links"]}
    actual = json.loads(tp.DATASET_WORKFLOW.read_text(encoding="utf-8"))
    ui_types = {"Note", "PreviewImage", "GetNode", "SetNode", "PrimitiveStringMultiline", "CR Prompt List"}
    ids = {key for key,n in source.items() if n["type"] not in ui_types and n.get("mode") != 4} - {"701", "833"}
    assert set(actual) == ids | {"r1_1", "r1_2", "r1_3", "r1_4"}
    def resolve(link):
        edge = links[link]; n = source[str(edge[1])]
        if n["type"] == "GetNode":
            setter = next(x for x in source.values() if x["type"] == "SetNode" and x["widgets_values"] == n["widgets_values"])
            return resolve(setter["inputs"][0]["link"])
        if n.get("mode") == 4:
            return resolve(n["inputs"][0]["link"])
        if n["type"] == "PrimitiveStringMultiline": return f"__PROMPT_{n['id']}__"
        if n["type"] == "CR Prompt List": return f"__ROW_{n['id']}__"
        if n["id"] == 701: return [["r1_2",0],["r1_3",0],["r1_4",0]][edge[2]]
        return [str(edge[1]),edge[2]]
    for key in ids:
        node = source[key]; exported = actual[key]
        assert exported["class_type"] == node["type"]
        values = iter(node.get("widgets_values", []))
        expected = {}
        for field in node.get("inputs", []):
            if "widget" in field:
                expected[field["name"]] = next(values)
                if field["name"] in ("seed", "noise_seed"):
                    assert next(values) in ("fixed", "randomize", "increment", "decrement")
            if field.get("link") is not None:
                expected[field["name"]] = resolve(field["link"])
        assert list(values) == []
        if node["type"] == "LoadImage":
            expected.pop("upload")
            expected["image"] = "__FACE_IMAGE__" if key == "836" else "__BODY_IMAGE__"
        assert json.dumps(exported["inputs"],sort_keys=True) == json.dumps(expected,sort_keys=True), key
    r1 = json.loads(tp.R1_GRAPH.read_text(encoding="utf-8"))
    nodes = {n["id"]:n for n in r1["nodes"]}
    for key in (1,2,3,4):
        n=nodes[key]; out=actual[f"r1_{key}"]
        names=[i["name"] for i in n["inputs"] if "widget" in i]
        assert out["class_type"] == n["type"]
        for field,value in zip(names,n["widgets_values"]):
            assert type(out["inputs"][field]) is type(value) and out["inputs"][field] == value
    assert actual["r1_2"]["inputs"]["model"] == ["r1_1",0]


@pytest.mark.parametrize("mutation", [
    lambda w,m: m["jobs"].pop(),
    lambda w,m: m["jobs"][0]["substitutions"][1].update(value=m["jobs"][1]["substitutions"][1]["value"]),
    lambda w,m: m["jobs"][0]["substitutions"][0].update(value="unapproved scene"),
    lambda w,m: m["models"][0].update(sha256="0"*64),
    lambda w,m: m["custom_nodes"].append({"git_url":"https://example.invalid/unlisted", "git_ref":"0"*40}),
])
def test_tester_ladder_prompt_model_and_node_mutations(mutation):
    w,m = _tester_fixture()
    mutation(w,m)
    assert tp.check_tester(w,m, "Adult woman seated in an opaque shirt.")


def test_tester_api_base_branch_directly_against_all_source_widgets_and_edges():
    graph = json.loads(tp.TESTER_GRAPH.read_text(encoding="utf-8"))
    nodes={str(n["id"]):n for n in graph["nodes"]}
    links={e[0]:e for e in graph["links"]}
    api=json.loads(tp.TESTER_WORKFLOW.read_text(encoding="utf-8"))
    assert set(api)=={"382","383","395","381","403","409","411","408","407","900"}
    for key,node in api.items():
        if key=="900":
            assert node=={"class_type":"SaveImage","inputs":{"images":["407",0],"filename_prefix":"tester"}}
            continue
        original=nodes[key]; assert node["class_type"]==original["type"]
        values=iter(original.get("widgets_values",[])); expected={}
        for field in original.get("inputs",[]):
            if "widget" in field:
                expected[field["name"]]=next(values)
                if field["name"]=="seed": assert next(values)=="fixed"
            if field.get("link") is not None:
                e=links[field["link"]]; expected[field["name"]]=[str(e[1]),e[2]]
        assert list(values)==[]
        if key=="408": expected["text"]="__TESTER_PROMPT__"
        if key=="411": expected["lora_name"]="__CHECKPOINT__"
        assert json.dumps(node["inputs"],sort_keys=True)==json.dumps(expected,sort_keys=True)
