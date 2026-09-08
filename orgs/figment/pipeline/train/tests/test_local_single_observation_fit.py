"""CPU-only regression tests for fit executor containment and artifact gates."""
from __future__ import annotations
import importlib.util,json,subprocess,sys
from pathlib import Path
import pytest
HERE=Path(__file__).resolve().parents[1]
def load():
 s=importlib.util.spec_from_file_location("fit_test",HERE/"local_single_observation_fit.py");assert s and s.loader;m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);return m
fit=load()
def execution_evidence(tmp_path):
 import hashlib
 private=tmp_path/"private";private.mkdir(parents=True);planroot=private/"plan";source=planroot/"dataset"/"1_figmentlocalg01probe";source.mkdir(parents=True);prepared=private/"prepared";prepared.mkdir()
 files={}
 for name,raw in (("g01.jpg",b"jpg"),("g01.txt",b"caption"),("fit-probe.toml",b"toml")):
  path=source/name if name!="fit-probe.toml" else planroot/name;path.write_bytes(raw);files[name]={"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}
 copies=[]
 for ident,directory in fit.TOKENIZER_DIRS.items():
  (prepared/directory).mkdir()
  for name in fit.TOKENIZER_FILES:
   raw=(ident+name).encode();(prepared/directory/name).write_bytes(raw);copies.append({"tokenizer":ident,"path":directory+"/"+name,"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()})
 return {"plan":{"frozen_sha256":"a"*64,"staging":{"dataset":"dataset/1_figmentlocalg01probe","files":files}},"admission":{"admission_id":"probe-one","gpu_device":0},"launcher_sha256":"b"*64,"tokenizer_copies":copies,"input_paths":{"plan":str(planroot/fit.PLAN_NAME),"prepared":str(prepared/fit.PREPARED_NAME),"private":str(private)}}
class Empty:
 def read(self,_):return b""
 def close(self):pass
class Identity:pid=44
class Planner:
 VENV_PYTHON=Path("python");SD_SCRIPTS_ROOT=Path.cwd();MODEL_PATH=Path("model");TRIGGER="figmentlocalg01probe"
def tensor(path,steps="10"):
 h={"__metadata__":{"ss_steps":steps},"lora":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}};b=json.dumps(h).encode();path.write_bytes(len(b).to_bytes(8,"little")+b+b"\0\0\0\0")
def test_safetensors_requires_real_tensor_and_steps(tmp_path):
 o=tmp_path/"out";o.mkdir();p=o/"figmentlocalg01probe.safetensors";tensor(p);assert len(fit._checkpoint(o,p.name)["sha256"])==64
 p.unlink();tensor(p,"9")
 with pytest.raises(fit.FitProbeError,match="ss_steps"):fit._checkpoint(o,p.name)
def test_safetensors_rejects_shape_byte_mismatch_and_gaps(tmp_path):
 o=tmp_path/"out";o.mkdir();p=o/"figmentlocalg01probe.safetensors"
 h={"__metadata__":{"ss_steps":"10"},"x":{"dtype":"F32","shape":[2],"data_offsets":[0,1]}};b=json.dumps(h).encode();p.write_bytes(len(b).to_bytes(8,"little")+b+b"x")
 with pytest.raises(fit.FitProbeError,match="byte size"):fit._checkpoint(o,p.name)
 h["x"]["shape"]=[1];h["x"]["data_offsets"]=[1,5];b=json.dumps(h).encode();p.write_bytes(len(b).to_bytes(8,"little")+b+b"xxxxx")
 with pytest.raises(fit.FitProbeError,match="contiguous"):fit._checkpoint(o,p.name)
@pytest.mark.skipif(not (fit.PRIVATE_ROOT/"local-lora-single-observation-20260908-v1"/fit.PLAN_NAME).is_file(),reason="local completed receipts are not checkout fixtures")
def test_actual_completed_cpu_and_tokenizer_receipts_bind_current_helpers():
 plan=fit.PRIVATE_ROOT/"local-lora-single-observation-20260908-v1"/fit.PLAN_NAME
 value,raw=fit._plan(plan,fit.PRIVATE_ROOT);hashes=fit._hashes()
 assert hashes["cpu_parser_sha256"]=="24317914b2a05790bcf887ab4941f67d623d2c18e73218f019d4f962a173336e"
 cpu=fit.MAIN_PRIVATE_ROOT/"figment-local-cpu-preflight-20260908-v3"/"receipt.json"
 assert fit._cpu(cpu,value["frozen_sha256"],fit._sha(raw),fit.MAIN_PRIVATE_ROOT,hashes)=="8a9831fd42b173af2cd7bfb2fbe9239a56b4a4618eb46d147cff3bbf02da8bb0"
 prepared_path=fit.PRIVATE_ROOT/"local-lora-tokenizers-20260908-v1"/fit.PREPARED_NAME;prepared,prepared_sha=fit._prepared(prepared_path,fit.PRIVATE_ROOT)
 assert prepared_sha=="c0c2208edafd7c57dbc2df5361176125c2465e1bf41ee691e9ba8ac593179518"
 assert fit._load_receipt(prepared_path.with_name(fit.LOAD_NAME),fit.PRIVATE_ROOT,prepared_sha,prepared["inventory_sha256"],prepared["copies"])=="16b3ea1e97ec6e6918c26f135f5409bc785c0f6d70625417e37bd8c86ce513e4"
def test_arbitrary_and_extra_output_refuse(tmp_path):
 o=tmp_path/"out";o.mkdir();(o/"figmentlocalg01probe.safetensors").write_bytes(b"arbitrary")
 with pytest.raises(fit.FitProbeError):fit._checkpoint(o,"figmentlocalg01probe.safetensors")
 (o/"sample.png").write_bytes(b"x")
 with pytest.raises(fit.FitProbeError,match="entry bound"):fit._checkpoint(o,"figmentlocalg01probe.safetensors")
def test_log_tree_checks_real_bytes_and_bound(tmp_path,monkeypatch):
 d=tmp_path/"logs";d.mkdir();(d/"stdout.log").write_bytes(b"out");(d/"stderr.log").write_bytes(b"err");assert fit._logs(d)["total_bytes"]==6
 (d/"event").write_bytes(b"x"*20);monkeypatch.setattr(fit,"MAX_LOG_BYTES",10)
 with pytest.raises(fit.FitProbeError,match="bound"):fit._logs(d)
def test_tokenizer_layout_and_escapes():
 r={"tokenizer":fit.TOKENIZER_IDS[0],"path":"openai_clip-vit-large-patch14/tokenizer.json"};assert fit._rel(r).name=="tokenizer.json"
 for x in ("../x","C:/x/tokenizer.json","openai_clip-vit-large-patch14/../tokenizer.json","bad/tokenizer.json","openai_clip-vit-large-patch14\\tokenizer.json"):
  with pytest.raises(fit.FitProbeError):fit._rel({"tokenizer":fit.TOKENIZER_IDS[0],"path":x})
def test_final_stage_check_refuses_extra_repeat_or_changed_tokenizer(tmp_path):
 import hashlib
 stage=tmp_path/"stage";data=stage/"dataset"/"1_figmentlocalg01probe";tokens=tmp_path/"tokens";data.mkdir(parents=True);tokens.mkdir()
 files={}
 for name,raw in (("g01.jpg",b"j"),("g01.txt",b"t"),("fit-probe.toml",b"c")):
  path=(data/name) if name!="fit-probe.toml" else stage/name;path.write_bytes(raw);files[name]={"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}
 copies=[]
 for ident,directory in fit.TOKENIZER_DIRS.items():
  (tokens/directory).mkdir()
  for name in fit.TOKENIZER_FILES:
   raw=(ident+name).encode();(tokens/directory/name).write_bytes(raw);copies.append({"tokenizer":ident,"path":directory+"/"+name,"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()})
 plan={"staging":{"files":files}};fit._stage_current(stage,data,tokens,plan,copies)
 (stage/"dataset"/"99_extra").mkdir()
 with pytest.raises(fit.FitProbeError,match="entry bound"):fit._stage_current(stage,data,tokens,plan,copies)
 (stage/"dataset"/"99_extra").rmdir();(tokens/fit.TOKENIZER_DIRS[fit.TOKENIZER_IDS[0]]/"vocab.json").write_bytes(b"changed")
 with pytest.raises(fit.FitProbeError,match="tokenizer asset changed"):fit._stage_current(stage,data,tokens,plan,copies)
def test_marker_replay_and_fresh_output(tmp_path):
 p=tmp_path/"private";p.mkdir();(p/"figment-local-lora-fit-one").mkdir()
 with pytest.raises(fit.FitProbeError):fit._fresh(p,"figment-local-lora-fit-one")
 marker=p/"marker";fit._exclusive(marker,b"one")
 with pytest.raises(fit.FitProbeError):fit._exclusive(marker,b"two")
def test_pump_reader_error_and_truncation(tmp_path):
 class Bad:
  def read(self,_):raise OSError()
  def close(self):pass
 s={"truncated":False};fit._pump(Bad(),tmp_path/"a",3,s);assert s["reader_error"]=="OSError"
 class Loud:
  first=True
  def read(self,_):
   if self.first:self.first=False;return b"abcdef"
   return b""
  def close(self):pass
 s={"truncated":False};fit._pump(Loud(),tmp_path/"b",3,s);assert s["truncated"] and (tmp_path/"b").read_bytes()==b"abc"
def test_fake_owned_nonzero_writes_failure_receipt(tmp_path,monkeypatch):
 private=tmp_path/"private";private.mkdir();pr=private/"plan";data=pr/"dataset"/"1_figmentlocalg01probe";data.mkdir(parents=True)
 (data/"g01.jpg").write_bytes(b"jpg");(data/"g01.txt").write_bytes(b"caption");(pr/"fit-probe.toml").write_bytes(b"toml")
 def h(p):
  import hashlib
  return hashlib.sha256(p.read_bytes()).hexdigest()
 fs={"g01.jpg":{"sha256":h(data/"g01.jpg")},"g01.txt":{"sha256":h(data/"g01.txt")},"fit-probe.toml":{"sha256":h(pr/"fit-probe.toml")}}
 e={"plan":{"frozen_sha256":"a"*64,"staging":{"dataset":"dataset/1_figmentlocalg01probe","files":fs}},"admission":{"admission_id":"probe-one","gpu_device":0},"launcher_sha256":"b"*64,"tokenizer_copies":[],"input_paths":{"plan":str(pr/fit.PLAN_NAME),"prepared":str(private/"prepared"/fit.PREPARED_NAME),"private":str(private)}}
 class S:
  def read(self,_):return b""
  def close(self):pass
 class P:
  pid=44;stdout=S();stderr=S()
  def poll(self):return 7
  def wait(self,timeout):return 7
 class I:
  pid=44
 class O:
  def _process_identity(self,pid):return I()
  def _discover_owned_processes(self,w,t):return t
  def _teardown(self,w,t,p):return {"verified_stopped":True,"owned_processes":[]}
 class Planner:
  VENV_PYTHON=Path("python");SD_SCRIPTS_ROOT=tmp_path;MODEL_PATH=Path("model");TRIGGER="figmentlocalg01probe"
 seen=[]
 monkeypatch.setattr(fit,"_fresh_evidence",lambda _:e);monkeypatch.setattr(fit,"_stage_current",lambda *a:None);monkeypatch.setattr(fit,"_planner",lambda:Planner);monkeypatch.setattr(fit,"_ownership",lambda:O());monkeypatch.setattr(fit.subprocess,"Popen",lambda command,*a,**k:(seen.append(command) or P()))
 with pytest.raises(fit.FitProbeError,match="nonzero"):fit.execute(e,out="figment-local-lora-fit-nonzero")
 r=json.loads((private/"figment-local-lora-fit-nonzero"/"failure.json").read_text());assert r["failure"]=="nonzero" and r["teardown"]["verified_stopped"]
 assert Path(seen[0][seen[0].index("--train_data_dir")+1]).name=="dataset"
 assert seen[0][1:3]==["-X","utf8"]
def test_utf8_interpreter_flag_preserves_japanese_pipe_output(tmp_path):
 result=subprocess.run([sys.executable,"-X","utf8","-B","-c","print('学習開始')"],env=fit._env(tmp_path,0),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,timeout=10)
 assert result.returncode==0 and result.stdout.decode("utf-8").strip()=="学習開始"
def test_execute_replay_different_out_refuses_before_second_popen(tmp_path,monkeypatch):
 e=execution_evidence(tmp_path);calls=[]
 class P:
  pid=44;stdout=Empty();stderr=Empty()
  def poll(self):return 7
  def wait(self,timeout):return 7
 class O:
  def _process_identity(self,p):return Identity()
  def _teardown(self,*a):return {"verified_stopped":True}
 monkeypatch.setattr(fit,"_fresh_evidence",lambda _:e);monkeypatch.setattr(fit,"_planner",lambda:Planner);monkeypatch.setattr(fit,"_ownership",lambda:O());monkeypatch.setattr(fit.subprocess,"Popen",lambda *a,**k:(calls.append(1) or P()))
 with pytest.raises(fit.FitProbeError):fit.execute(e,out="figment-local-lora-fit-a")
 with pytest.raises(fit.FitProbeError,match="exclusively"):fit.execute(e,out="figment-local-lora-fit-b")
 assert len(calls)==1
def test_execute_final_stage_change_refuses_before_popen(tmp_path,monkeypatch):
 e=execution_evidence(tmp_path);calls=[];fresh=[e,e]
 def refreshed(_):
  value=fresh.pop(0)
  if not fresh:
   path=Path(value["input_paths"]["private"])/"figment-local-lora-fit-change"/"tokenizers"/fit.TOKENIZER_DIRS[fit.TOKENIZER_IDS[0]]/"vocab.json";path.write_bytes(b"changed")
  return value
 monkeypatch.setattr(fit,"_fresh_evidence",refreshed);monkeypatch.setattr(fit.subprocess,"Popen",lambda *a,**k:calls.append(1))
 with pytest.raises(fit.FitProbeError,match="tokenizer asset changed"):fit.execute(e,out="figment-local-lora-fit-change")
 assert not calls
def test_execute_timeout_and_preidentity_cleanup_are_fail_closed(tmp_path,monkeypatch):
 e=execution_evidence(tmp_path)
 class P:
  pid=44;stdout=Empty();stderr=Empty();terminated=False
  def poll(self):return None
  def wait(self,timeout):return 0
  def terminate(self):self.terminated=True
 class O:
  def _process_identity(self,p):return Identity()
  def _teardown(self,*a):return {"verified_stopped":True}
 monkeypatch.setattr(fit,"_fresh_evidence",lambda _:e);monkeypatch.setattr(fit,"_planner",lambda:Planner);monkeypatch.setattr(fit,"_ownership",lambda:O());monkeypatch.setattr(fit,"MAX_WALL_SECONDS",0);monkeypatch.setattr(fit.subprocess,"Popen",lambda *a,**k:P())
 with pytest.raises(fit.FitProbeError,match="deadline"):fit.execute(e,out="figment-local-lora-fit-timeout")
 e=execution_evidence(tmp_path/"two");process=P()
 class NoIdentity:
  def _process_identity(self,p):return None
 monkeypatch.setattr(fit,"_fresh_evidence",lambda _:e);monkeypatch.setattr(fit,"_ownership",lambda:NoIdentity());monkeypatch.setattr(fit.subprocess,"Popen",lambda *a,**k:process)
 with pytest.raises(fit.FitProbeError):fit.execute(e,out="figment-local-lora-fit-preidentity")
 r=json.loads((Path(e["input_paths"]["private"])/"figment-local-lora-fit-preidentity"/"failure.json").read_text());assert process.terminated and r["teardown"]["verified_stopped"] is False and r["teardown"]["unresolved_descendants"]
def test_execute_natural_exit_discovery_race_and_late_log_truncation(tmp_path,monkeypatch):
 e=execution_evidence(tmp_path)
 class Natural:
  pid=44;stdout=Empty();stderr=Empty();calls=0
  def poll(self):self.calls+=1;return None if self.calls==1 else 0
  def wait(self,timeout):return 0
 class RaceOwner:
  def _process_identity(self,p):return Identity()
  def _discover_owned_processes(self,*a):raise RuntimeError("exited")
  def _teardown(self,*a):return {"verified_stopped":True,"natural":True}
 def launch(command,*a,**k):
  out=Path(command[command.index("--output_dir")+1]);tensor(out/"figmentlocalg01probe.safetensors");return Natural()
 monkeypatch.setattr(fit,"_fresh_evidence",lambda _:e);monkeypatch.setattr(fit,"_planner",lambda:Planner);monkeypatch.setattr(fit,"_ownership",lambda:RaceOwner());monkeypatch.setattr(fit.subprocess,"Popen",launch)
 assert fit.execute(e,out="figment-local-lora-fit-race")["status"]=="complete"
 e=execution_evidence(tmp_path/"late")
 class JoinThread:
  def __init__(self,target,args,daemon):self.target=target;self.args=args
  def start(self):pass
  def join(self,timeout):self.target(*self.args)
  def is_alive(self):return False
 class Loud:
  first=True
  def read(self,_):
   if self.first:self.first=False;return b"x"*(fit.MAX_LOG_BYTES//2+1)
   return b""
  def close(self):pass
 class Fast:
  pid=44;stdout=Loud();stderr=Empty()
  def poll(self):return 0
  def wait(self,timeout):return 0
 class Owner:
  def _process_identity(self,p):return Identity()
  def _teardown(self,*a):return {"verified_stopped":True}
 monkeypatch.setattr(fit.threading,"Thread",JoinThread);monkeypatch.setattr(fit,"_fresh_evidence",lambda _:e);monkeypatch.setattr(fit,"_ownership",lambda:Owner());monkeypatch.setattr(fit.subprocess,"Popen",lambda *a,**k:Fast())
 with pytest.raises(fit.FitProbeError,match="log-bound"):fit.execute(e,out="figment-local-lora-fit-late")
 e=execution_evidence(tmp_path/"broken")
 class Broken:
  def read(self,_):raise OSError("reader")
  def close(self):pass
 class BrokenFast:
  pid=44;stdout=Broken();stderr=Empty()
  def poll(self):return 0
  def wait(self,timeout):return 0
 monkeypatch.setattr(fit,"_fresh_evidence",lambda _:e);monkeypatch.setattr(fit.subprocess,"Popen",lambda *a,**k:BrokenFast())
 with pytest.raises(fit.FitProbeError,match="log-reader-failed"):fit.execute(e,out="figment-local-lora-fit-reader")
