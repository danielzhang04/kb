"""Private Stage D proof with real writer authority and explicit finite roles.

One default retained reader is a private plumbing test, NOT A/B/C quota proof.
"""
import builtins
import io
import dataclasses
import importlib.util
import inspect
import json
import os
from pathlib import Path
import sys

import pytest

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('driver_tensor_fixture_setup',HERE/'tensor_observer_fixture.py')
fixture=importlib.util.module_from_spec(spec);sys.modules[spec.name]=fixture;spec.loader.exec_module(fixture)
restore_module_aliases=fixture.restore_module_aliases


def inventory(result,obs):
    ft=result.ft; roles={}; J=256*1024; I=32*1024*1024
    def add(path,role,*,cap=J,json=True,raw=False,optional=False):
        path=Path(path)
        assert path.is_absolute() and path.is_relative_to(result.figment)
        key=str(path)
        member=obs.ReadMember(path,cap,json,optional,raw,True)
        assert key not in roles, (role,key)
        roles[key]=(role,member)
    add(result.home/'persona.yaml','current persona')
    add(result.home/'training.yaml','current training',optional=True)
    add(result.home/'identity.md','identity spec',json=False)
    add(result.pipeline/'look-spec.md','register spec',json=False)
    add(result.pipeline/'gate.yaml','thresholds',json=False)
    add(ft.PINS_PATH,'pins')
    add(ft.TESTER_START_PATH,'current launcher',json=False)
    persona=ft._read_json(result.home/'persona.yaml')
    reference=result.home/persona['identity']['references'][0]
    add(reference,'registered passport',cap=I,json=False,raw=True)
    add(result.train/'plan.json','source train plan')
    add(result.train/'stage.json','source completed stage',optional=True)
    for name in ['accepted-checkpoint','approval-lineage','grading-manifest','evaluation-inputs','gate']:
        add(result.train/f'grade/tester/{name}.json','tester '+name,optional=name=='evaluation-inputs')
    add(Path(result.accepted['candidate']['path']),'source accepted checkpoint',cap=256*1024*1024,json=False)
    source=ft._read_json(result.train/'plan.json')
    for stage in ['train','tester']:
        run,=source['stages'][stage]['runs']
        add(result.train/run['manifest'],stage+' manifest')
        add(result.train/run['out']/'run.json',stage+' receipt')
    for index,name in enumerate(source['assets']['anchors']):
        add(result.train/name,f'T staged passport{index}',cap=I,json=False)
    for index,row in enumerate(ft._read_json(result.train/'grade/tester/grading-manifest.json')['images']):
        add(Path(row['path']),f'tester image{index}',cap=I,json=False)
    add(result.passport/'plan.json','original passport plan')
    for name in ['approval-lineage','approved-list','rulings','grading-manifest','evaluation-inputs','gate']:
        add(result.passport/f'grade/anchor/{name}.json','anchor '+name)
    add(result.passport/'grade/anchor/chosen-anchor.json','chosen anchor',cap=128*1024,json=False,raw=True)
    original=ft._read_json(result.passport/'plan.json')
    for index,run in enumerate(original['stages']['anchor']['runs']):add(result.passport/run['manifest'],f'anchor manifest{index}',json=False)
    for index,name in enumerate(original['assets']['anchors']):add(result.passport/name,f'original anchor reference{index}',cap=I,json=False)
    selected=result.gen_plan['gen_inputs']['passport']['selection']['image_id']
    for index,row in enumerate(ft._read_json(result.passport/'grade/anchor/grading-manifest.json')['images']):
        add(Path(row['path']),f'anchor image{index}',cap=I,json=False,raw=row['image_id']==selected)
    add(result.evidence/'request.json','scene request',cap=32*1024,json=False,raw=True)
    for row in result.gen_plan['gen_inputs']['scene_files']:
        add(result.evidence/row['path'],f"scene{row['scene_index']} {row['kind']}",cap=32*1024,json=False,raw=True)
        if row['kind']=='draft':
            draft=ft._read_json(result.evidence/row['path'])
            add(result.evidence/draft['photo']['path'],f"scene{row['scene_index']} photo",cap=8*1024*1024,json=False,raw=True)
    add(result.gen/result.gen_plan['assets']['tensor_passport']['staged'],'G staged passport',cap=I,json=False)
    for run in result.gen_plan['stages']['gen']['runs']:
        add(result.gen/run['manifest'],f"gen {run['framing']} manifest")
        add(result.gen/f"train/workflows/tensor_stills_m09_{run['framing']}.json",f"gen {run['framing']} workflow")
    add(result.gen/'train/runs/start-comfy-lorapath.sh.template','staged launcher',json=False)
    package=result.figment/'research/10sorlabs-package/09_krea2_image'
    for name in ['10sorlabs_krea2_image.json','krea2_model_installer.bat']:
        add(package/name,'constant source '+name,json=False,raw=True)
    assert len(roles)<=100
    return roles


class LoggedReads:
    def __init__(self,item):self.item=item;self.calls=[];self.raw_collections=0;self.raw_bytes=0
    def __getattr__(self,name):
        method=getattr(self.item,name)
        def call(*args,**kwargs):
            self.calls.append((name,str(args[0]) if args else None))
            try:
                result=method(*args,**kwargs)
                if name=='read_bytes':self.raw_collections+=1;self.raw_bytes+=len(result)
                return result
            except Exception as exc:
                raise AssertionError(f'retained {name}: {args[0] if args else "final"}: {exc}') from exc
        return call


def domain_traps(patch,result,obs):
    pipeline=str(result.pipeline).casefold()
    def project_caller():
        frame=inspect.currentframe().f_back
        while frame:
            filename=frame.f_code.co_filename
            if filename.casefold().startswith(pipeline):return filename
            frame=frame.f_back
        return None
    def guarded(original):
        def call(*args,**kwargs):
            source=project_caller()
            if source is not None and source!=obs.__file__:
                raise AssertionError(f'unobserved data IO from {source}')
            return original(*args,**kwargs)
        return call
    for name in ['open','read_bytes','read_text','resolve','absolute','stat','lstat','iterdir','is_file','exists','cwd']:
        patch.setattr(Path,name,guarded(getattr(Path,name)))
    for name in ['stat','lstat','scandir','open','getcwd']:
        patch.setattr(os,name,guarded(getattr(os,name)))
    patch.setattr(builtins,'open',guarded(builtins.open))
    patch.setattr(io,'open',guarded(io.open))
    original=importlib.util.spec_from_file_location
    def no_project_load(name,location,*args,**kwargs):
        if str(location).casefold().startswith(pipeline):raise AssertionError('new project module loaded during domain')
        return original(name,location,*args,**kwargs)
    patch.setattr(importlib.util,'spec_from_file_location',no_project_load)


def test_private_tensor_validator_real_authority_retained_io(tmp_path_factory,restore_module_aliases,monkeypatch):
    result=fixture.build_tensor_fixture(tmp_path_factory.mktemp('td'))
    obs=fixture.load('_figment_private_tensor_reads',result.pipeline/'observed_reads.py')
    roles=inventory(result,obs)
    item=obs.ObservedReads(roots=(result.figment,),members=tuple(row[1] for row in roles.values()))
    reads=LoggedReads(item)
    monkeypatch.chdir(result.root.parent)
    with fixture.producer._OfflineGuard() as guard,monkeypatch.context() as patch:
        domain_traps(patch,result,obs)
        current=result.ft._validate_tensor_stills_inputs(result.gen_plan,result.gen,reads=reads)
        assert current==result.gen_plan['gen_inputs']
        reads.recheck()
    assert guard.attempts==[]
    touched={path for _,path in reads.calls if path in roles}
    assert touched==set(roles),sorted(set(roles)-touched)
    assert item._operations<=obs.ReadLimits().max_operations
    report={'fixture':True,'full_adapter_proof':False,'guard_attempts':guard.attempts,
        'roles':{str(Path(path).relative_to(result.figment)):role for path,(role,_) in roles.items()},
        'calls':[(method,str(Path(path).relative_to(result.figment)) if path else None) for method,path in reads.calls],
        'limits':dataclasses.asdict(obs.ReadLimits()),
        'counters':{name:getattr(item,name) for name in ['_operations','_unique_bytes','_stream_bytes','_case_scans','_case_probes','_case_stream_name_bytes','_case_unique_entries','_case_unique_name_bytes']}}
    report['counters'].update(case_directories=len(item._case_snapshots),raw_collections=reads.raw_collections,raw_collected_bytes=reads.raw_bytes)
    destination=os.environ.get('FIGMENT_DRIVER_EVIDENCE')



    # Fresh readers ensure canonical byte commitments fail, not merely old stamps.
    mutation_roles=['registered passport','source accepted checkpoint','T staged passport0',
        'G staged passport','anchor approved-list','scene0 photo','gen full manifest',
        'staged launcher','constant source 10sorlabs_krea2_image.json',
        'constant source krea2_model_installer.bat']
    for role in mutation_roles:
        path=Path(next(path for path,(name,_) in roles.items() if name==role))
        original=path.read_bytes()
        if role=='anchor approved-list':
            changed=json.loads(original);changed['images']=[]
            path.write_text(json.dumps(changed),encoding='utf-8')
        else:path.write_bytes(original+b' ')
        try:
            fresh=obs.ObservedReads(roots=(result.figment,),members=tuple(row[1] for row in roles.values()))
            with fixture.producer._OfflineGuard() as attempt,monkeypatch.context() as patch:
                domain_traps(patch,result,obs)
                try:result.ft._validate_tensor_stills_inputs(result.gen_plan,result.gen,reads=fresh)
                except (ValueError,RuntimeError):pass
                else:pytest.fail('mutation unexpectedly accepted: '+role)
            assert attempt.attempts==[]
        finally:path.write_bytes(original)

    # Existing shared input guards must remain identical for native and observed.
    for mode in ['creator','ceiling','pod_class']:
        path=result.home/'persona.yaml' if mode=='creator' else result.ft.PINS_PATH
        original=path.read_bytes();document=json.loads(original)
        if mode=='creator':document['id']='creator-004'
        elif mode=='ceiling':document['pod_classes'][result.gen_plan['training']['pod_class']]['price_usd_per_hour']=999
        else:document['pod_classes'].pop(result.gen_plan['training']['pod_class'])
        path.write_text(json.dumps(document),encoding='utf-8')
        try:
            messages=[]
            for observed in [False,True]:
                fresh=obs.ObservedReads(roots=(result.figment,),members=tuple(row[1] for row in roles.values())) if observed else None
                with pytest.raises(result.ft.FigmentTrainError) as caught:
                    result.ft._load_inputs(fixture.CREATOR,result.home.parent,reads=fresh)
                messages.append(str(caught.value))
            assert messages[0]==messages[1]
            assert {'creator':'does not match','ceiling':'exceeds persona ceiling','pod_class':'unknown training pod class'}[mode] in messages[0]
        finally:path.write_bytes(original)

    report['negative_cases']=mutation_roles+['creator','ceiling','pod_class']
    if destination:Path(destination).write_text(json.dumps(report,indent=2)+'\n',encoding='ascii')
