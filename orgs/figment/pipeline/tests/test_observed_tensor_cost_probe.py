"""Measurement only: proposed fixed tensor quotas, existing real router/authority.

A quota refusal is recorded evidence, not a reason to expand bounds or cache proof.
Discovery is omitted: domain-only costs are a lower bound, not full CLI support.
"""
import dataclasses
import importlib.util
import json
import os
from pathlib import Path
import sys

import pytest

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('tensor_cost_driver_helpers',HERE/'test_observed_tensor_driver_reads.py')
helpers=importlib.util.module_from_spec(spec);sys.modules[spec.name]=helpers;spec.loader.exec_module(helpers)
fixture=helpers.fixture
restore_module_aliases=helpers.restore_module_aliases
MIB=1024*1024
POLICY={'A':(32,4*MIB,32*MIB,256*1024,384),
        'B':(80,64*MIB,128*MIB,256*1024,256),
        'C':(144,956*MIB,1888*MIB,256*MIB,384)}


def phase(role):
    if role in {'selected gen plan','source train plan','source completed stage','current persona','current training','thresholds'} or role.startswith('tester ') and not role.startswith('tester image') and role not in {'tester manifest','tester receipt'}:
        return 'A'
    if (role in {'train manifest','tester manifest','original passport plan','pins','current launcher','chosen anchor'}
            or role.startswith('anchor ') and role not in {'anchor image0'} and not role.startswith(('anchor image','anchor manifest'))
            or role.startswith('constant source ')
            or role.startswith('gen ') and role.endswith('manifest')
            or role=='scene request' or role.startswith('scene') and role.endswith(('draft','approval'))):
        return 'B'
    return 'C'


def limits(obs,label):
    files,unique,stream,cap,operations=POLICY[label]
    return obs.ReadLimits(max_files=files,max_unique_bytes=unique,max_stream_bytes=stream,max_file_bytes=cap,max_operations=operations)


class Recorder:
    def __init__(self,router,obs):
        self.router=router;self.obs=obs;self.stage='discovery';self.calls=[]
        self.raw={label:{'collections':0,'bytes':0} for label in POLICY}
    def __getattr__(self,name):
        method=getattr(self.router,name)
        def call(*args,**kwargs):
            path=args[0] if args else None
            owner=self.router._files.get(self.obs._key(path)) if path is not None else None
            label=next((label for label,item in zip(POLICY,self.router._readers) if item is owner),None)
            self.calls.append({'stage':self.stage,'method':name,'path':str(path) if path is not None else None,'owner':label})
            value=method(*args,**kwargs)
            if name=='read_bytes':self.raw[label]['collections']+=1;self.raw[label]['bytes']+=len(value)
            return value
        return call


def snapshot(router,record):
    fields=['_operations','_unique_bytes','_stream_bytes','_case_scans','_case_probes',
            '_case_unique_entries','_case_unique_name_bytes','_case_stream_name_bytes']
    return {label:{**{key:getattr(item,key) for key in fields},'case_directories':len(item._case_snapshots),
                   'raw_collections':record.raw[label]['collections'],'raw_collected_bytes':record.raw[label]['bytes'],
                   'limits':dataclasses.asdict(item._limits)} for label,item in zip(POLICY,router._readers)}


@pytest.mark.parametrize('scene_specs,variant', [
    (((0,'full'),(3,'close-up')),'two-scenes'),
    (((0,'full'),),'one-full'),
    (((3,'close-up'),),'one-close-up')], ids=['two-scenes','one-full','one-close-up'])
def test_complete_fixed_tensor_cost_probe(tmp_path_factory,restore_module_aliases,monkeypatch,scene_specs,variant):
    result=fixture.build_tensor_fixture(tmp_path_factory.mktemp('tc'),scene_specs=scene_specs)
    obs=fixture.load('_figment_cost_observed_reads',result.pipeline/'observed_reads.py')
    gen=fixture.load('_figment_cost_gen_source',result.pipeline/'gen_source_read.py')
    roles=helpers.inventory(result,obs)
    gate=str(result.train/'grade/tester/gate.json')
    role,member=roles[gate];roles[gate]=(role,dataclasses.replace(member,allow_json=False))
    roles[str(result.gen/'plan.json')]=('selected gen plan',obs.ReadMember(result.gen/'plan.json',256*1024,True,False,False,True))
    staged=result.gen/'train/runs/accepted-checkpoint'/result.report['checkpoint_artifact']
    roles[str(staged)]=('G staged accepted checkpoint',obs.ReadMember(staged,256*MIB,False,False,False,True))
    router=gen._Router(obs);record=Recorder(router,obs)
    roots=(result.figment,result.gen,result.train)
    admission=[]
    # Actual addresses come only from the explicit writer-role setup, never a glob.
    for label in POLICY:
        members=tuple(member for role,member in roles.values() if phase(role)==label)
        router.admit(roots,members,(),limits(obs,label))
        admission.append({'phase':label,'counters':snapshot(router,record)})
    before=snapshot(router,record)
    status='success';reason=None;where=None;finished=False
    monkeypatch.chdir(result.root.parent)
    with fixture.producer._OfflineGuard() as guard,monkeypatch.context() as patch:
        helpers.domain_traps(patch,result,obs)
        record.stage='domain';record.begin_domain()
        try:
            where='load selected plan'
            plan,root=result.ft._load_plan(fixture.CREATOR,result.gen/'plan.json',reads=record)
            assert obs._key(root)==obs._key(result.gen)
            where='common planned authority'
            result.ft._revalidate_planned_gen_authority(plan,reads=record)
            digest=plan.get('training',{}).get('chosen_checkpoint_sha256');assert isinstance(digest,str)
            where='common staged checkpoint'
            result.ft._validate_staged_checkpoint_upload(plan,root,'gen',digest,reads=record)
            where='private tensor validator'
            assert result.ft._validate_tensor_stills_inputs(plan,root,reads=record)==plan['gen_inputs']
            where='final gen manifest hashes'
            for run in plan['stages']['gen']['runs']:assert record.sha256(root/run['manifest'])==run['sha256']
            where='final C/B/A rechecks'
            record.recheck();finished=True
        except (obs.ObservedReadError,gen._Refusal,result.ft.FigmentTrainError) as exc:
            cause=exc
            while cause.__cause__ is not None:cause=cause.__cause__
            if not isinstance(cause,(obs.ObservedReadError,gen._Refusal)):raise
            status='retained refusal';reason=str(cause)
    assert guard.attempts==[]
    final=snapshot(router,record)
    report={'fixture':True,'scene_count':len(scene_specs),'scene_indices':[index for index,_ in scene_specs],'framings':[framing for _,framing in scene_specs],'full_adapter_proof':False,'production_discovery_implemented':False,
        'discovery_is_test_prepared_approximation':False,'discovery_work_omitted':True,'measurement_is_lower_bound':True,
        'policy':'proposed tensor A32/B80/C144, existing operation/content/metadata bounds',
        'outcome':status,'reason':reason,'stopped_at':where,'final_rechecks_completed':finished,
        'guard_attempts':guard.attempts,'pre_domain':before,'final':final,'admission':admission,
        'roles':{str(Path(path).relative_to(result.figment)):{'role':role,'phase':phase(role),'raw':member.allow_bytes,'json':member.allow_json,'cap':member.max_bytes}
                 for path,(role,member) in roles.items()},
        'calls':[{**row,'path':str(Path(row['path']).relative_to(result.figment)) if row['path'] else None} for row in record.calls]}
    destination=os.environ.get('FIGMENT_COST_EVIDENCE')
    if destination:Path(destination.format(variant=variant)).write_text(json.dumps(report,indent=2)+'\n',encoding='ascii')
    # A measured quota refusal is an accepted probe outcome, never support.
    assert status=='success' or reason=='public operation budget exceeded',(status,reason,where,final)
    if status!='success':assert not finished and router._poisoned
