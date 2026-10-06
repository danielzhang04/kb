"""Stage P retained scene/source plumbing; synthetic callbacks are unit seams."""
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
import sys

import pytest
from PIL import Image

HERE=Path(__file__).parents[1]


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    spec.loader.exec_module(module)
    return module


obs=load('stills_observed_reads_test',HERE/'observed_reads.py')


def sha(raw): return hashlib.sha256(raw).hexdigest()
def forbidden(*args,**kwargs): raise AssertionError('unexpected native domain I/O')


@pytest.fixture
def copied(tmp_path,monkeypatch):
    figment=tmp_path/'figment'; pipeline=figment/'pipeline';pipeline.mkdir(parents=True)
    names=['tensor_stills.py','tensor_stills_parity.py','tensor_parity.py','prompt_intake.py']
    for name in names:
        (pipeline/name).write_bytes((HERE/name).read_bytes())
    package=figment/'research/10sorlabs-package/09_krea2_image';package.mkdir(parents=True)
    for name in ['10sorlabs_krea2_image.json','krea2_model_installer.bat']:
        (package/name).write_bytes((HERE.parent/'research/10sorlabs-package/09_krea2_image'/name).read_bytes())
    aliases=['_figment_stills_intake','_figment_stills_parity','_figment_stills_source_parity','stagep_stills']
    for name in aliases: monkeypatch.delitem(sys.modules,name,raising=False)
    # Only these two original, exact pinned-code operands may resolve at bootstrap.
    allowed={str(pipeline/'tensor_parity.py'),str(pipeline/'tensor_stills_parity.py')}
    original=Path.resolve;seen=[]
    def qualified(path,*args,**kwargs):
        frame=inspect.currentframe().f_back
        if frame.f_code.co_filename in {str(pipeline/n) for n in names}:
            assert str(path) in allowed and frame.f_code.co_name=='<module>'
            seen.append(str(path))
        return original(path,*args,**kwargs)
    with monkeypatch.context() as guard:
        guard.setattr(Path,'resolve',qualified)
        stills=load('stagep_stills',pipeline/'tensor_stills.py')
    assert sorted(seen)==sorted(allowed)
    assert stills.parity.HERE==pipeline and stills.parity._source.HERE==pipeline
    assert sha((package/'10sorlabs_krea2_image.json').read_bytes())==stills.parity.STILLS_GRAPH_SHA256
    assert sha((package/'krea2_model_installer.bat').read_bytes())==stills.parity.STILLS_INSTALLER_SHA256
    yield stills,figment,package
    # monkeypatch only restores pre-existing aliases; remove modules we loaded.
    for name in aliases: sys.modules.pop(name,None)


def retained(root,paths,*,raw=True):
    return obs.ObservedReads(roots=(root,),members=tuple(obs.ReadMember(p,8*1024*1024,False,False,raw,True) for p in paths))


def traps(monkeypatch,stills):
    sources={m.__file__ for m in [stills,stills.prompt_intake,stills.parity,stills.parity._source]}
    for name in ('open','read_bytes','read_text','resolve','absolute','stat','lstat','iterdir','is_file','cwd'):
        original=getattr(Path,name)
        def wrapped(*args,_original=original,**kwargs):
            if inspect.currentframe().f_back.f_code.co_filename in sources: forbidden()
            return _original(*args,**kwargs)
        monkeypatch.setattr(Path,name,wrapped)


def scenes(stills,root):
    intake=stills.prompt_intake
    image=root/'Scene.png';Image.new('RGB',(16,24),'navy').save(image)
    source=root/'plan.json';source.write_bytes(b'{}')
    record={'path':str(source),'sha256':sha(b'{}')}
    authority={'schema':'figment/registered-passport-authority@1','creator':'creator-999','fixture':True,
        'image':dict(record,image_id='fixture'),'source_plan':record,'chosen_anchor':record,
        'approval_lineage':record,'rulings':record,'registered_reference':'fixture'}
    authority['authority_sha256']=sha(intake._canonical(authority))
    calls=[]
    def callback(*args): calls.append(1);return copy.deepcopy(authority)
    adapter=intake.CanonicalPassportAdapter(callback,lambda *args:dict.fromkeys(intake.DESCRIPTORS,'adult'))
    selection={'source_plan':str(source),'image_id':'fixture'}
    passport=intake.canonical_passport_binding(creator='creator-999',selection=selection,passport_adapter=adapter)
    request={'schema':'figment/tensor-stills-request@1','creator':'creator-999','fixture':True,'passport':selection,'scenes':[]}
    paths=[image,source]
    for index,framing in [(0,'full'),(3,'close-up'),(7,'full')]:
        response=dict.fromkeys(intake.SECTIONS,'');response.update(shot_subject='one adult person',age_appearance=dict.fromkeys(intake.DESCRIPTORS,''),clothing='Opaque jacket.')
        draft=intake.extract_fixture_draft(root,photo_path=image.name,creator='creator-999',passport=passport,aspects=['clothing'],framing=framing,runner=intake.FixtureRunner(json.dumps(response)),passport_adapter=adapter)
        approval=intake.approve_fixture_prompt(root,draft,decided_by='fixture:test',decided_at='2026-10-06T00:00:00Z',acknowledged_notes=draft['review_notes'],passport_adapter=adapter)
        row={'scene_index':index}
        for kind,value in [('draft',draft),('approval',approval)]:
            path=root/f'{kind}{index}.json';path.write_text(json.dumps(value),encoding='utf-8');paths.append(path)
            row[kind]={'path':path.name,'sha256':sha(path.read_bytes())}
        request['scenes'].append(row)
    path=root/'request.json';path.write_text(json.dumps(request),encoding='utf-8');paths.append(path)
    return path,adapter,paths,calls


def test_observed_request_mixed_groups_constant_sources_and_native_parity(copied,monkeypatch):
    stills,root,package=copied
    request,adapter,paths,calls=scenes(stills,root)
    native=stills.read_request(request,'creator-999',passport_adapter=adapter)
    expected=stills.compile_scene_groups(native['scenes'],identity_lora='creator-999_000000750.safetensors',output_prefix='fixture')
    paths += [package/'10sorlabs_krea2_image.json',package/'krea2_model_installer.bat']
    item=retained(root,paths);start=len(calls)
    monkeypatch.chdir(root.parent)
    with monkeypatch.context() as guard:
        traps(guard,stills)
        actual=stills.read_request(request,'creator-999',passport_adapter=adapter,reads=item)
        assert actual==native and len(calls)-start==7
        groups=stills.compile_scene_groups(actual['scenes'],identity_lora='creator-999_000000750.safetensors',output_prefix='fixture',reads=item)
        assert groups==expected
        assert all('uploads' not in group for group in groups)
        assert 'Scene.png' not in json.dumps(groups) and str(root) not in json.dumps(groups)
        assert [g['framing'] for g in groups]==['full','close-up']
        assert [j['scene_index'] for j in groups[0]['jobs']]==[0,7]
        for group in groups:
            manifest={**group,**stills.parity.stills_pin_group(group['framing'])}
            assert stills.parity.check_stills(group['workflow'],manifest,framing=group['framing'],identity_lora='creator-999_000000750.safetensors',approved_prompts=group['approved_prompts'],reads=item)==[]
        item.recheck()


@pytest.mark.parametrize('name',['10sorlabs_krea2_image.json','krea2_model_installer.bat'])
def test_actual_source_constant_tamper_refused(copied,name):
    stills,root,package=copied
    path=package/name;path.write_bytes(path.read_bytes()+b' ')
    item=retained(root,[package/'10sorlabs_krea2_image.json',package/'krea2_model_installer.bat'])
    with pytest.raises(stills.parity.ParityError,match='digest changed'):
        stills.parity.stills_workflow('full',reads=item)


@pytest.mark.parametrize('mode',['no_raw','wrong_case','unlisted'])
def test_source_policy_cannot_fall_back_to_native(copied,monkeypatch,mode):
    stills,root,package=copied
    paths=[package/'10sorlabs_krea2_image.json',package/'krea2_model_installer.bat']
    if mode=='wrong_case': paths[0]=paths[0].with_name('10SORLABS_krea2_image.json')
    if mode=='unlisted': paths=paths[1:]
    item=retained(root,paths,raw=mode!='no_raw')
    with monkeypatch.context() as guard:
        traps(guard,stills)
        with pytest.raises(obs.ObservedReadError): stills.parity.stills_workflow('full',reads=item)


@pytest.mark.parametrize('name',['request.json','draft0.json','approval0.json','Scene.png'])
def test_changed_request_evidence_cannot_revalidate(copied,name):
    stills,root,package=copied
    request,adapter,paths,_=scenes(stills,root)
    item=retained(root,paths)
    stills.read_request(request,'creator-999',passport_adapter=adapter,reads=item)
    target=root/name;target.write_bytes(target.read_bytes()+b' ')
    with pytest.raises((ValueError,OSError)):
        stills.read_request(request,'creator-999',passport_adapter=adapter,reads=item)


def test_request_duplicate_keys_and_relative_paths_refuse(copied):
    stills,root,package=copied
    request=root/'request.json';request.write_bytes(b'{"schema":1,"schema":2}')
    with pytest.raises(stills.StillsError,match='strict JSON'):
        stills.read_request(request,'creator-999',passport_adapter=None,reads=retained(root,[request]))
    with pytest.raises(stills.StillsError,match='absolute'):
        stills.read_request(Path('request.json'),'creator-999',passport_adapter=None,reads=object())


def test_actual_checkout_package_junction_is_not_admissible():
    package=HERE.parent/'research/10sorlabs-package'
    if not package.exists() or not getattr(package.lstat(),'st_file_attributes',0)&0x400:
        pytest.skip('checkout has no package junction')
    with pytest.raises(obs.ObservedReadError):
        retained(HERE.parent,[package/'09_krea2_image/10sorlabs_krea2_image.json'])


@pytest.mark.parametrize('mode',['no_raw','no_strict','unlisted'])
def test_request_policy_cannot_silently_weaken_intake(copied,mode):
    stills,root,package=copied
    request,adapter,paths,_=scenes(stills,root)
    members=tuple(obs.ReadMember(p,8*1024*1024,False,False,mode!='no_raw',mode!='no_strict')
                  for p in paths if mode!='unlisted' or p!=request)
    item=obs.ObservedReads(roots=(root,),members=members)
    with pytest.raises((obs.ObservedReadError,ValueError)):
        stills.read_request(request,'creator-999',passport_adapter=adapter,reads=item)


def test_changed_photo_and_coherent_draft_binding_still_reconstructs(copied):
    stills,root,package=copied
    request,adapter,paths,_=scenes(stills,root)
    photo=root/'Scene.png';Image.new('RGB',(16,24),'white').save(photo)
    path=root/'draft0.json';draft=json.loads(path.read_bytes())
    draft['photo']['sha256']=sha(photo.read_bytes())
    path.write_text(json.dumps(draft),encoding='utf-8')
    document=json.loads(request.read_bytes());document['scenes'][0]['draft']['sha256']=sha(path.read_bytes())
    request.write_text(json.dumps(document),encoding='utf-8')
    with pytest.raises(ValueError,match='draft or evidence changed'):
        stills.read_request(request,'creator-999',passport_adapter=adapter,reads=retained(root,paths))


def test_malformed_request_json_refused(copied):
    stills,root,package=copied
    request=root/'request.json';request.write_bytes(b'{bad')
    with pytest.raises(stills.StillsError,match='strict JSON'):
        stills.read_request(request,'creator-999',passport_adapter=None,reads=retained(root,[request]))
