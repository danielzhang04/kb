"""Explicit, bounded, non-promotable local ten-step LoRA fit executor."""
from __future__ import annotations
import argparse, importlib.util, json, os, re, subprocess, sys, threading, time
from pathlib import Path, PurePath
from typing import Any

HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]; PRIVATE_ROOT=ROOT/"_private"; MAIN_PRIVATE_ROOT=ROOT.parents[1]
RUNTIME_PATH=HERE/"local_fit_runtime.py"
PLAN_SCHEMA="figment/local-single-observation-lora-plan@1"; CPU_SCHEMA="figment/local-cpu-preflight-launch@1"; CPU_RESULT_SCHEMA="figment/local-single-observation-cpu-preflight@1"; ADMISSION_SCHEMA="figment/local-single-observation-fit-admission@1"; TOKENIZER_SCHEMA="figment/local-tokenizer-prepared@1"; TOKENIZER_PROBE_SCHEMA="figment/local-tokenizer-load@1"; RUN_SCHEMA="figment/local-single-observation-fit-probe@1"
PLAN_NAME="local-single-observation-plan.json"; PREPARED_NAME="local-tokenizer-prepared.json"; LOAD_NAME="local-tokenizer-load.json"
MAX_JSON_BYTES=256*1024; MAX_INPUT_BYTES=8*1024*1024; MAX_TOKENIZER_FILE_BYTES=4*1024*1024; MAX_TOKENIZER_TOTAL_BYTES=16*1024*1024; MAX_LOG_BYTES=256*1024; MAX_LOG_FILES=24; MAX_FINAL_BYTES=1024*1024*1024; MAX_HEADER_BYTES=1024*1024; MAX_WALL_SECONDS=20*60
SAFE_ID=re.compile(r"[a-z][a-z0-9-]{0,63}\Z"); HEX=re.compile(r"[0-9a-f]{64}\Z")
TOKENIZER_IDS=("openai/clip-vit-large-patch14","laion/CLIP-ViT-bigG-14-laion2B-39B-b160k")
TOKENIZER_DIRS={TOKENIZER_IDS[0]:"openai_clip-vit-large-patch14",TOKENIZER_IDS[1]:"laion_CLIP-ViT-bigG-14-laion2B-39B-b160k"}; TOKENIZER_FILES={"merges.txt","special_tokens_map.json","tokenizer.json","tokenizer_config.json","vocab.json"}
def _runtime():
 s=importlib.util.spec_from_file_location("figment_fit_runtime",RUNTIME_PATH)
 if not s or not s.loader:raise RuntimeError("cannot load shared fit runtime")
 m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);return m
runtime=_runtime();FitProbeError=runtime.FitRuntimeError
_sha=runtime.sha;_is_reparse=runtime.is_reparse;_safe=runtime.safe;_bounded=runtime.bounded;_json=runtime.json_object
def _frozen(v:dict[str,Any],label:str)->None:runtime.frozen(v,label,HEX)
def _load(name:str,p:Path)->Any:
 s=importlib.util.spec_from_file_location(name,p)
 if not s or not s.loader:raise FitProbeError(f"cannot load {name}")
 m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def _hashes()->dict[str,str]:
 return {k:_sha(_bounded(p,MAX_JSON_BYTES,k)) for k,p in {"launcher_sha256":Path(__file__),"runtime_sha256":RUNTIME_PATH,"planner_sha256":HERE/"local_single_observation.py","ownership_sha256":HERE.parent/"expand"/"local_comfy_input.py","cpu_parser_sha256":HERE/"local_single_observation_cpu_preflight.py","tokenizer_preflight_sha256":HERE/"local_tokenizer_preflight.py"}.items()}
def _planner():return _load("figment_fit_planner",HERE/"local_single_observation.py")
def _ownership():return _load("figment_fit_owned_processes",HERE.parent/"expand"/"local_comfy_input.py")
def _plan(p:Path,private:Path)->tuple[dict[str,Any],bytes]:
 p=_safe(p,private,"plan")
 if p.name!=PLAN_NAME or p.parent.parent!=Path(private).absolute():raise FitProbeError("plan location is not fixed")
 v,b=_json(p,MAX_JSON_BYTES,"plan"); _frozen(v,"plan")
 if v.get("schema")!=PLAN_SCHEMA or v.get("execution")!={"cpu_preflight_allowed":True,"gpu_fit_probe_allowed":False,"checkpoint_acceptance_allowed":False,"sample_export_allowed":False} or v.get("fit_probe",{}).get("max_train_steps")!=10 or v.get("fit_probe",{}).get("samples")!=0 or v.get("fit_probe",{}).get("exports")!=0:raise FitProbeError("plan boundary is invalid")
 return v,b
def _cpu(p:Path,plan_sha:str,plan_file_sha:str,main:Path,hashes:dict[str,str])->str:
 p=_safe(p,main,"CPU receipt")
 if p.name!="receipt.json":raise FitProbeError("CPU receipt name is invalid")
 v,b=_json(p,MAX_JSON_BYTES,"CPU receipt");r=v.get("result",{});t=v.get("teardown",{});inputs=v.get("inputs",{})
 if v.get("schema")!=CPU_SCHEMA or v.get("status")!="complete" or v.get("plan_sha256")!=plan_sha or v.get("process",{}).get("exit_code")!=0 or inputs.get("parser_sha256")!=hashes["cpu_parser_sha256"] or inputs.get("planner_sha256")!=hashes["planner_sha256"] or inputs.get("plan_file_sha256")!=plan_file_sha or inputs.get("plan_canonical_sha256")!=plan_sha or r.get("schema")!=CPU_RESULT_SCHEMA or r.get("plan_sha256")!=plan_sha or (r.get("observations"),r.get("unique_source_images"),r.get("repeat_count"))!=(1,1,1) or r.get("cuda_visible_devices")!="-1" or not isinstance(r.get("offline_environment"),list) or "PYTORCH_NVML_BASED_CUDA_CHECK" not in r["offline_environment"] or r.get("cuda_available") is not False or r.get("cuda_device_count")!=0 or r.get("cuda_initialized") is not False or r.get("not_promotable") is not True or r.get("gpu_fit_probe_allowed") is not False or t.get("verified_stopped") is not True:raise FitProbeError("CPU receipt does not prove fixed preflight teardown")
 return _sha(b)
def _rel(r:dict[str,Any])->Path:
 i,s=r.get("tokenizer"),r.get("path")
 if i not in TOKENIZER_DIRS or not isinstance(s,str) or "\\" in s:raise FitProbeError("tokenizer path invalid")
 q=PurePath(s)
 if q.is_absolute() or len(q.parts)!=2 or q.parts[0]!=TOKENIZER_DIRS[i] or q.parts[1] not in TOKENIZER_FILES or any(x in {"",".",".."} for x in q.parts):raise FitProbeError("tokenizer path is not exact id-derived layout")
 return Path(*q.parts)
def _prepared(p:Path,private:Path)->tuple[dict[str,Any],str]:
 p=_safe(p,private,"prepared receipt")
 if p.name!=PREPARED_NAME:raise FitProbeError("prepared receipt name invalid")
 v,b=_json(p,MAX_JSON_BYTES,"prepared receipt");_frozen(v,"prepared receipt");c=v.get("copies")
 if v.get("schema")!=TOKENIZER_SCHEMA or v.get("not_promotable") is not True or v.get("runtime_or_training_approval") is not False or not isinstance(v.get("inventory_sha256"),str) or not HEX.fullmatch(v["inventory_sha256"]) or not isinstance(c,list) or len(c)!=10:raise FitProbeError("prepared tokenizer receipt invalid")
 seen=set();total=0
 for x in c:
  if not isinstance(x,dict):raise FitProbeError("tokenizer record invalid")
  q=_rel(x);k=(x["tokenizer"],q.name)
  if k in seen or not isinstance(x.get("bytes"),int) or not 0<x["bytes"]<=MAX_TOKENIZER_FILE_BYTES or not isinstance(x.get("sha256"),str) or not HEX.fullmatch(x["sha256"]):raise FitProbeError("tokenizer binding invalid")
  seen.add(k);total+=x["bytes"]
 if seen!={(i,f) for i in TOKENIZER_IDS for f in TOKENIZER_FILES} or total>MAX_TOKENIZER_TOTAL_BYTES or v.get("total_bytes")!=total:raise FitProbeError("tokenizer aggregate invalid")
 return v,_sha(b)
def _load_receipt(p:Path,private:Path,prepared_sha:str,inventory:str,copies:list[dict[str,Any]])->str:
 p=_safe(p,private,"tokenizer load receipt")
 if p.name!=LOAD_NAME:raise FitProbeError("tokenizer load name invalid")
 v,b=_json(p,MAX_JSON_BYTES,"tokenizer load receipt");_frozen(v,"tokenizer load receipt"); ts=v.get("tokenizers"); cuda=(v.get("torch_imported") is False and v.get("cuda_available") is None and v.get("cuda_device_count") is None) or (v.get("torch_imported") is True and v.get("cuda_available") is False and v.get("cuda_device_count")==0)
 if v.get("schema")!=TOKENIZER_PROBE_SCHEMA or v.get("not_promotable") is not True or v.get("runtime_or_training_approval") is not False or v.get("prepared_receipt_sha256")!=prepared_sha or v.get("inventory_sha256")!=inventory or v.get("copies")!=copies or v.get("cuda_visible_devices")!="-1" or v.get("pytorch_nvml_based_cuda_check")!="1" or v.get("cuda_initialized") is not False or not cuda or not isinstance(ts,list) or len(ts)!=2:raise FitProbeError("tokenizer load receipt invalid")
 ids=set()
 for t in ts:
  if not isinstance(t,dict) or t.get("id") not in TOKENIZER_IDS or t["id"] in ids or t.get("class")!="CLIPTokenizer" or t.get("local_files_only") is not True or not isinstance(t.get("effective_pad_token_id"),int) or not isinstance(t.get("caption_token_count"),int) or t["caption_token_count"]<1 or (t["id"]==TOKENIZER_IDS[1] and t["effective_pad_token_id"]!=0):raise FitProbeError("tokenizer load result invalid")
  ids.add(t["id"])
 if ids!=set(TOKENIZER_IDS):raise FitProbeError("tokenizer load incomplete")
 return _sha(b)
def _current_copies(prepared_path:Path,prepared:dict[str,Any],private:Path)->list[dict[str,Any]]:
 root=_safe(prepared_path.parent,private,"tokenizer root");out=[]
 for r in prepared["copies"]:
  q=_rel(r);b=_bounded(_safe(root/q,root,"tokenizer asset"),MAX_TOKENIZER_FILE_BYTES,"tokenizer asset")
  if len(b)!=r["bytes"] or _sha(b)!=r["sha256"]:raise FitProbeError("tokenizer asset changed")
  out.append(dict(r))
 return out
def _admission(p:Path,private:Path,plan:str,cpu:str,prepared:dict[str,Any],prepared_sha:str,load_sha:str,h:dict[str,str])->dict[str,Any]:
 v,_=_json(_safe(p,private,"admission"),MAX_JSON_BYTES,"admission");_frozen(v,"admission")
 expected={"plan_sha256":plan,"cpu_receipt_sha256":cpu,"tokenizer_inventory_sha256":prepared["inventory_sha256"],"tokenizer_prepared_receipt_sha256":prepared_sha,"tokenizer_probe_sha256":load_sha,"allow_gpu_fit_probe":True,"max_train_steps":10,"max_wall_seconds":MAX_WALL_SECONDS,"gpu_device":0,"max_final_checkpoint_bytes":MAX_FINAL_BYTES,"not_promotable":True,**h}
 if v.get("schema")!=ADMISSION_SCHEMA or not SAFE_ID.fullmatch(str(v.get("admission_id",""))) or any(v.get(k)!=x for k,x in expected.items()):raise FitProbeError("admission does not bind current code and fixed boundary")
 return v
def _revalidate_current(plan_path:Path,plan:dict[str,Any],private:Path)->None:
 p=_planner()
 try:
  root=_safe(plan_path,private,"plan").parent;src=p._safe_existing(p.PERSONAS_ROOT/p.SOURCE_RELATIVE,p.PERSONAS_ROOT);persona=p._safe_existing(p.PERSONAS_ROOT/p.CREATOR/"persona.yaml",p.PERSONAS_ROOT);img,w,h=p._read_jpeg(src);caption,ps=p._persona_caption(persona);p._fixed_regular(p.VENV_PYTHON,"python");p._fixed_regular(p.SDXL_SCRIPT,"trainer");p._fixed_regular(p.MODEL_PATH,"model");p._sd_scripts_head();model_sha,model_bytes=p._file_sha256(p.MODEL_PATH,maximum=p.MODEL_BYTES)
 except p.LocalObservationError as e:raise FitProbeError("current inputs cannot be revalidated") from e
 if plan.get("source")!={"logical_path":"anchors/g01.jpg","sha256":_sha(img),"bytes":len(img),"width":w,"height":h,"format":"JPEG"} or plan.get("caption")!=caption or plan.get("persona_sha256")!=ps or model_sha!=p.MODEL_SHA256 or model_bytes!=p.MODEL_BYTES:raise FitProbeError("source/persona/model changed")
 st=plan.get("staging",{});files=st.get("files",{})
 if st.get("dataset")!=f"dataset/1_{p.TRIGGER}" or set(files)!={"g01.jpg","g01.txt","fit-probe.toml"}:raise FitProbeError("staging invalid")
 expected={"g01.jpg":img,"g01.txt":(caption+"\n").encode(),"fit-probe.toml":p._bounded_bytes(p.TEMPLATE_PATH,16*1024,"template")}
 for n,b in expected.items():
  q=root/(Path(st["dataset"])/n if n!="fit-probe.toml" else n);raw=_bounded(_safe(q,root,"staged input"),MAX_INPUT_BYTES,"staged input")
  if raw!=b or files[n].get("sha256")!=_sha(raw) or files[n].get("bytes")!=len(raw):raise FitProbeError("staged input changed")
def validate(plan_path:Path,cpu_receipt_path:Path,admission_path:Path,tokenizer_prepared_path:Path,tokenizer_load_path:Path,*,private_root:Path|None=None,main_private_root:Path|None=None)->dict[str,Any]:
 private=Path(private_root or PRIVATE_ROOT).absolute();main=Path(main_private_root or MAIN_PRIVATE_ROOT).absolute()
 if private!=PRIVATE_ROOT.absolute() or main!=MAIN_PRIVATE_ROOT.absolute():raise FitProbeError("public validation uses only fixed private roots")
 plan,raw=_plan(plan_path,private);hashes=_hashes();cpu=_cpu(cpu_receipt_path,plan["frozen_sha256"],_sha(raw),main,hashes);prepared,prepared_sha=_prepared(tokenizer_prepared_path,private);load_sha=_load_receipt(tokenizer_load_path,private,prepared_sha,prepared["inventory_sha256"],prepared["copies"]);admission=_admission(admission_path,private,plan["frozen_sha256"],cpu,prepared,prepared_sha,load_sha,hashes);_revalidate_current(plan_path,plan,private);copies=_current_copies(tokenizer_prepared_path,prepared,private)
 return {"plan":plan,"admission":admission,"tokenizer_copies":copies,**hashes,"input_paths":{"plan":str(Path(plan_path).absolute()),"cpu":str(Path(cpu_receipt_path).absolute()),"admission":str(Path(admission_path).absolute()),"prepared":str(Path(tokenizer_prepared_path).absolute()),"load":str(Path(tokenizer_load_path).absolute()),"private":str(private),"main":str(main)}}
def _ten_policy(name:str="figmentlocalg01probe.safetensors"):
 return runtime.RunPolicy("figment-local-lora-fit-","figment-local-lora-fit-dispatches",max(1,MAX_WALL_SECONDS),MAX_LOG_BYTES,MAX_LOG_FILES,MAX_FINAL_BYTES,MAX_FINAL_BYTES,(runtime.ArtifactPolicy(name,10),))
_exclusive=runtime.exclusive;_copy=runtime.copy_checked;_entries=runtime.entries;_pump=runtime.pump
def _logs(root:Path)->dict[str,Any]:return runtime._log_summary(root,_ten_policy())
def _runtime_logs_within(root:Path)->bool:return runtime.runtime_logs_within(root,_ten_policy())
def _runtime_output_within(root:Path)->bool:return runtime.runtime_output_within(root,_ten_policy())
def _checkpoint(output:Path,name:str)->dict[str,Any]:
 record=runtime.checkpoints(output,_ten_policy(name))[0];record.pop("ss_steps",None);return record
def _fresh(private:Path,out:str)->Path:
 if not SAFE_ID.fullmatch(out) or not out.startswith("figment-local-lora-fit-"):raise FitProbeError("run output must be safe")
 if not private.is_dir() or _is_reparse(private) or (private/out).exists():raise FitProbeError("fit run output must be fresh")
 return private/out
_env=runtime.environment
def _fresh_evidence(e:dict[str,Any])->dict[str,Any]:
 p=e.get("input_paths",{})
 if not isinstance(p,dict) or not all(isinstance(p.get(k),str) for k in ("plan","cpu","admission","prepared","load","private","main")):raise FitProbeError("execute requires validated source paths")
 return validate(Path(p["plan"]),Path(p["cpu"]),Path(p["admission"]),Path(p["prepared"]),Path(p["load"]),private_root=Path(p["private"]),main_private_root=Path(p["main"]))
def _stage_current(stage:Path,data:Path,tokens:Path,plan:dict[str,Any],copies:list[dict[str,Any]])->None:
 """Rehash the run-owned copies after the final slow admission revalidation."""
 expected={data/"g01.jpg":plan["staging"]["files"]["g01.jpg"],data/"g01.txt":plan["staging"]["files"]["g01.txt"],stage/"fit-probe.toml":plan["staging"]["files"]["fit-probe.toml"]}
 try:
  if {x.name for x in _entries(data,2,"run dataset")}!={"g01.jpg","g01.txt"} or {x.name for x in _entries(stage,2,"run stage")}!={"dataset","fit-probe.toml"} or {x.name for x in _entries(stage/"dataset",1,"run repeat root")}!={"1_figmentlocalg01probe"}:raise FitProbeError("run stage inventory is not exact")
 except OSError as e:raise FitProbeError("run stage inventory unavailable") from e
 for path,record in expected.items():
  raw=_bounded(_safe(path,stage,"run staged input"),MAX_INPUT_BYTES,"run staged input")
  if len(raw)!=record["bytes"] or _sha(raw)!=record["sha256"]:raise FitProbeError("run staged input changed before launch")
 if len(copies)!=10:raise FitProbeError("run tokenizer inventory is incomplete")
 if {x.name for x in _entries(tokens,2,"run tokenizer root")}!=set(TOKENIZER_DIRS.values()):raise FitProbeError("run tokenizer directories are not exact")
 for record in copies:
  relative=_rel(record);raw=_bounded(_safe(tokens/relative,tokens,"run tokenizer asset"),MAX_TOKENIZER_FILE_BYTES,"run tokenizer asset")
  if len(raw)!=record["bytes"] or _sha(raw)!=record["sha256"]:raise FitProbeError("run tokenizer asset changed before launch")
 for directory in TOKENIZER_DIRS.values():
  if {x.name for x in _entries(tokens/directory,5,"run tokenizer files")}!=TOKENIZER_FILES:raise FitProbeError("run tokenizer file inventory is not exact")
def execute(evidence:dict[str,Any],*,out:str)->dict[str,Any]:
 evidence=_fresh_evidence(evidence);private=Path(evidence["input_paths"]["private"]);plan=evidence["plan"];ad=evidence["admission"];root=_fresh(private,out)
 locks=private/"figment-local-lora-fit-dispatches"
 if locks.exists():_safe(locks,private,"dispatch markers")
 else:locks.mkdir();_safe(locks,private,"dispatch markers")
 _exclusive(locks/(ad["admission_id"]+".json"),json.dumps({"admission_id":ad["admission_id"],"plan_sha256":plan["frozen_sha256"]},sort_keys=True).encode())
 root.mkdir();stage=root/"stage";data=stage/"dataset"/"1_figmentlocalg01probe";output=root/"output";logs=root/"logs";tokens=root/"tokenizers";data.mkdir(parents=True);output.mkdir();logs.mkdir();tokens.mkdir()
 pr=Path(evidence["input_paths"]["plan"]).parent;fs=plan["staging"]["files"]
 _copy(pr/plan["staging"]["dataset"]/"g01.jpg",data/"g01.jpg",fs["g01.jpg"]["sha256"],MAX_INPUT_BYTES,"g01");_copy(pr/plan["staging"]["dataset"]/"g01.txt",data/"g01.txt",fs["g01.txt"]["sha256"],MAX_INPUT_BYTES,"caption");_copy(pr/"fit-probe.toml",stage/"fit-probe.toml",fs["fit-probe.toml"]["sha256"],MAX_INPUT_BYTES,"template")
 tokenroot=Path(evidence["input_paths"]["prepared"]).parent
 for r in evidence["tokenizer_copies"]:
  q=_rel(r);(tokens/q).parent.mkdir(exist_ok=True);_copy(_safe(tokenroot/q,tokenroot,"tokenizer asset"),tokens/q,r["sha256"],MAX_TOKENIZER_FILE_BYTES,"tokenizer asset")
 evidence=_fresh_evidence(evidence) # repeat all hashes, inputs, receipts and admission immediately before Popen
 _stage_current(stage,data,tokens,evidence["plan"],evidence["tokenizer_copies"])
 mark={"schema":RUN_SCHEMA,"not_promotable":True,"status":"dispatched","plan_sha256":plan["frozen_sha256"],"admission_id":ad["admission_id"],"launcher_sha256":evidence["launcher_sha256"]};_exclusive(root/"dispatch.json",(json.dumps(mark,sort_keys=True)+"\n").encode())
 planner=_planner();owner=_ownership();cmd=[str(planner.VENV_PYTHON),"-X","utf8","-B","-m","sdxl_train_network","--config_file",str(stage/"fit-probe.toml"),"--pretrained_model_name_or_path",str(planner.MODEL_PATH),"--train_data_dir",str(stage/"dataset"),"--output_dir",str(output),"--output_name",planner.TRIGGER,"--logging_dir",str(logs),"--tokenizer_cache_dir",str(tokens)]
 _exclusive(root/"journal.json",(json.dumps({**mark,"status":"started","command_sha256":_sha(json.dumps(cmd,separators=(",",":")).encode())},sort_keys=True)+"\n").encode());started=time.monotonic()
 result=runtime.run_owned(cmd,cwd=planner.SD_SCRIPTS_ROOT,environment_map=_env(root,ad["gpu_device"]),root=root,logs=logs,output=output,policy=_ten_policy(planner.TRIGGER+".safetensors"),ownership=owner,popen=subprocess.Popen,thread_factory=threading.Thread,deadline_seconds=MAX_WALL_SECONDS)
 failure=result.failure;exit_code=result.exit_code;td=result.teardown;summary=result.log_summary
 artifact=None
 if failure is None:
  try:artifact=_checkpoint(output,planner.TRIGGER+".safetensors")
  except FitProbeError:failure="output-invalid"
 record={**mark,"status":"complete" if failure is None else "failed","exit_code":exit_code,"duration_seconds":round(time.monotonic()-started,3),"log_truncated":result.log_truncated,"log_summary":summary,"teardown":td,"failure":failure,"final_checkpoint":artifact};_exclusive(root/("receipt.json" if failure is None else "failure.json"),(json.dumps(record,sort_keys=True)+"\n").encode())
 if failure:raise FitProbeError("fit probe failed: "+failure)
 return record
def main(argv:list[str]|None=None)->int:
 a=argparse.ArgumentParser();a.add_argument("--plan",type=Path,required=True);a.add_argument("--cpu-receipt",type=Path,required=True);a.add_argument("--admission",type=Path,required=True);a.add_argument("--tokenizer-prepared",type=Path,required=True);a.add_argument("--tokenizer-load",type=Path,required=True);a.add_argument("--execute",action="store_true");a.add_argument("--out");x=a.parse_args(argv)
 try:e=validate(x.plan,x.cpu_receipt,x.admission,x.tokenizer_prepared,x.tokenizer_load)
 except FitProbeError as z:print("local fit probe refused: "+str(z),file=sys.stderr);return 2
 if not x.execute:print(json.dumps({"status":"validated-not-executed","not_promotable":True,"plan_sha256":e["plan"]["frozen_sha256"]},sort_keys=True));return 0
 if not isinstance(x.out,str):print("local fit probe refused: --execute requires --out",file=sys.stderr);return 2
 try:print(json.dumps(execute(e,out=x.out),sort_keys=True));return 0
 except FitProbeError as z:print("local fit probe refused: "+str(z),file=sys.stderr);return 2
if __name__=="__main__":raise SystemExit(main())
