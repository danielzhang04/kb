"""Stage L only: retained buffers and synthetic callback unit boundaries."""
import copy
import hashlib
import importlib.util
import inspect
import io
import json
import os
from pathlib import Path
import sys

import pytest
from PIL import Image

HERE = Path(__file__).parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


obs = load('leaf_observed_reads', 'observed_reads.py')
gen = load('leaf_source_router', 'gen_source_read.py')
intake = load('leaf_prompt_intake', 'prompt_intake.py')
edit = load('leaf_tensor_edit', 'tensor_edit.py')
assert edit._PATHS is None


def digest(raw): return hashlib.sha256(raw).hexdigest()
def forbidden(*args, **kwargs): raise AssertionError('unexpected domain I/O or helper import')


def reader(root, paths, *, strict=True, raw=True, optional=False, router=False):
    members = tuple(obs.ReadMember(p, 32 * 1024 * 1024, False, optional, raw, strict) for p in paths)
    if router:
        item = gen._Router(obs)
        item.admit((root,), members, (), obs.ReadLimits())
        item.admit((root,), (), (), obs.ReadLimits())
        item.admit((root,), (), (), obs.ReadLimits())
        item.begin_domain()
        return item
    return obs.ObservedReads(roots=(root,), members=members)


def picture(root, name='Scene.png', *, format='PNG', size=(16, 24), orientation=1, animated=False):
    path = root / name
    im = Image.new('RGB', size, 'navy')
    options = {}
    if orientation != 1:
        exif = Image.Exif(); exif[274] = orientation; options['exif'] = exif
    if animated:
        options.update(save_all=True, append_images=[Image.new('RGB', size, 'white')], duration=100, loop=0)
    im.save(path, format=format, **options)
    return path


def domain_traps(monkeypatch):
    sources = {intake.__file__, edit.__file__}
    for name in ('open', 'read_bytes', 'read_text', 'resolve', 'absolute', 'stat', 'lstat', 'iterdir', 'is_file', 'cwd'):
        original = getattr(Path, name)
        def wrapped(*args, _original=original, **kwargs):
            if inspect.currentframe().f_back.f_code.co_filename in sources:
                forbidden()
            return _original(*args, **kwargs)
        monkeypatch.setattr(Path, name, wrapped)
    monkeypatch.setattr(edit, '_frame_paths', forbidden)


@pytest.mark.parametrize('router', [False, True])
@pytest.mark.parametrize('exists', [False, True])
def test_exact_policy_required_before_data_io(tmp_path, monkeypatch, router, exists):
    path = tmp_path / 'Leaf'
    if exists: path.write_bytes(b'{}')
    item = reader(tmp_path, [path], strict=False, optional=True, router=router)
    with monkeypatch.context() as guard:
        guard.setattr(Path, 'open', forbidden)
        guard.setattr(os, 'scandir', forbidden)
        guard.setattr(os, 'lstat', forbidden)
        with pytest.raises((obs.ObservedReadError, gen._Refusal)):
            item.resolve_exact_file(path)
    with pytest.raises((obs.ObservedReadError, gen._Refusal)):
        item.recheck()


@pytest.mark.parametrize('router', [False, True])
@pytest.mark.parametrize('operand', ['wrongcase', 'missing', 'directory', 'unlisted'])
def test_exact_file_closed_operands(tmp_path, router, operand):
    path = tmp_path / 'Leaf'; path.write_bytes(b'{}')
    if operand == 'missing': path.unlink()
    item = reader(tmp_path, [path], optional=True, router=router)
    target = {'wrongcase': path.with_name('leaf'), 'missing': path,
              'directory': tmp_path, 'unlisted': tmp_path / 'Other'}[operand]
    with pytest.raises((obs.ObservedReadError, gen._Refusal, OSError)):
        item.resolve_exact_file(target)


@pytest.mark.parametrize('router', [False, True])
def test_exact_resolve_same_owner_buffer_final_and_seal(tmp_path, router):
    path = picture(tmp_path); raw = path.read_bytes()
    item = reader(tmp_path, [path], router=router)
    assert item.resolve_exact_file(path) == path
    assert intake._read(tmp_path, path.name, image=True, reads=item) == raw
    item.recheck()
    with pytest.raises((obs.ObservedReadError, gen._Refusal)):
        item.resolve_exact_file(path)


def test_strict_resolution_never_grants_raw_permission(tmp_path):
    path = picture(tmp_path); item = reader(tmp_path, [path], raw=False)
    assert item.resolve_exact_file(path) == path
    with pytest.raises((intake.IntakeError, obs.ObservedReadError)):
        intake._read(tmp_path, path.name, image=True, reads=item)


@pytest.mark.parametrize('relative', ['', '.', '../Scene.png', './Scene.png', '/Scene.png', 'a//b', 'a\\b', 'c:x', 'a.', 'a '])
def test_intake_grammar_precedes_reader(relative, tmp_path):
    class Trap:
        resolve_exact_file = forbidden
    with pytest.raises(intake.IntakeError): intake._path(tmp_path, relative, reads=Trap())


def test_absolute_observed_root_required(tmp_path, monkeypatch):
    with monkeypatch.context() as guard:
        guard.setattr(Path, 'cwd', forbidden)
        with pytest.raises(intake.IntakeError): intake._path(Path('relative'), 'Scene.png', reads=object())
        with pytest.raises(edit.EditInputError):
            edit.registered_passport_authority('creator-999', {'_persona_path':'relative'}, Path('plan'), 'x',
                                               validated_anchor=forbidden, reads=object())


@pytest.mark.parametrize('case', ['valid', 'corrupt', 'wrong_suffix', 'animated', 'orientation', 'dimension', 'pixels', 'truncated'])
def test_same_buffer_image_semantics_match_native(tmp_path, monkeypatch, case):
    options = {}
    if case == 'wrong_suffix': options.update(name='Scene.jpg')
    if case == 'animated': options.update(animated=True)
    if case == 'orientation': options.update(format='JPEG', name='Scene.jpg', orientation=6)
    if case == 'dimension': options.update(size=(8193, 1))
    if case == 'pixels': options.update(size=(4100, 4100))
    path = picture(tmp_path, **options)
    if case == 'corrupt': path.write_bytes(b'not an image')
    if case == 'truncated': path.write_bytes(path.read_bytes()[:40])
    raw = path.read_bytes(); binding = {'path':str(path), 'sha256':digest(raw)}
    for module, call in [(intake, lambda reads: intake._read(tmp_path,path.name,image=True,reads=reads)),
                         (edit, lambda reads: edit.file_binding(binding,tmp_path,image=True,reads=reads))]:
        try: expected = call(None); error = False
        except (ValueError, OSError): error = True
        item = reader(tmp_path, [path])
        with monkeypatch.context() as guard:
            domain_traps(guard)
            if error:
                with pytest.raises((ValueError, OSError)): call(item)
            else:
                assert call(item) == expected
                item.recheck()


def test_bounds_hash_json_and_hash_only_permission(tmp_path, monkeypatch):
    path = tmp_path / 'data'; raw = b'{"a":1,"a":2}'; path.write_bytes(raw)
    binding = {'path':str(path),'sha256':digest(raw)}
    item = reader(tmp_path,[path],raw=False)
    with monkeypatch.context() as guard:
        domain_traps(guard)
        assert edit.file_binding(binding,tmp_path,reads=item)['bytes'] == len(raw)
        item.recheck()
    for raw_override in [None, raw, b'{}', b'x' * (edit.MAX_JSON_BYTES+1)]:
        item = reader(tmp_path,[path])
        with pytest.raises(edit.EditInputError): edit._json_binding(binding,tmp_path,raw=raw_override,reads=item)
    with pytest.raises(edit.EditInputError): edit.file_binding(binding,tmp_path,limit=len(raw)-1,reads=reader(tmp_path,[path]))
    with monkeypatch.context() as guard:
        guard.setattr(intake,'MAX_BYTES',len(raw)-1)
        with pytest.raises(intake.IntakeError): intake._read(tmp_path,path.name,reads=reader(tmp_path,[path]))
    bad = dict(binding,sha256='0'*64)
    with pytest.raises(edit.EditInputError): edit.file_binding(bad,tmp_path,reads=reader(tmp_path,[path]))


def test_final_mutation_detected(tmp_path):
    path=picture(tmp_path); item=reader(tmp_path,[path])
    intake._read(tmp_path,path.name,image=True,reads=item)
    path.write_bytes(b'changed')
    with pytest.raises(obs.ObservedReadError): item.recheck()


def test_canonical_callbacks_rebuild_draft_and_projection_without_native_io(tmp_path, monkeypatch):
    # Synthetic callback boundary tests only; real registration is a separate fixture.
    image=picture(tmp_path); source=tmp_path/'plan.json'; source.write_bytes(b'{}')
    record={'path':str(source),'sha256':digest(b'{}')}
    authority={'schema':edit.PASSPORT_SCHEMA,'creator':'creator-999','fixture':True,
        'image':dict(record,image_id='fixture'), 'source_plan':record,'chosen_anchor':record,
        'approval_lineage':record,'rulings':record,'registered_reference':'fixture'}
    authority['authority_sha256']=intake._hash(intake._canonical(authority))
    calls=[]
    def callback(*args): calls.append(1); return copy.deepcopy(authority)
    adapter=intake.CanonicalPassportAdapter(callback, lambda *args:dict.fromkeys(intake.DESCRIPTORS,'adult'))
    selection={'source_plan':str(source),'image_id':'fixture'}
    passport=intake.canonical_passport_binding(creator='creator-999',selection=selection,passport_adapter=adapter)
    response=dict.fromkeys(intake.SECTIONS,'');response.update(shot_subject='one adult person',age_appearance=dict.fromkeys(intake.DESCRIPTORS,''),clothing='Opaque jacket.')
    kwargs=dict(photo_path=image.name,creator='creator-999',passport=passport,aspects=['clothing'],framing='full',runner=intake.FixtureRunner(json.dumps(response)),passport_adapter=adapter)
    native=intake.extract_fixture_draft(tmp_path,**kwargs)
    item=reader(tmp_path,[image,source])
    monkeypatch.chdir(tmp_path.parent)
    with monkeypatch.context() as guard:
        domain_traps(guard)
        draft=intake.extract_fixture_draft(tmp_path,**kwargs,reads=item)
        assert draft == native
        approval=intake.approve_fixture_prompt(tmp_path,draft,decided_by='fixture:test',decided_at='2026-10-06T00:00:00Z',acknowledged_notes=draft['review_notes'],passport_adapter=adapter,reads=item)
        projection=intake.approved_prompt_projection(tmp_path,draft,approval,current_passport=passport,passport_adapter=adapter,reads=item)
        assert projection['text']==native['text'] and len(calls)==6
        item.recheck()
    with pytest.raises(intake.IntakeError,match='canonical'):
        intake._passport(tmp_path,{'kind':'fixture-registration-only'},'creator-999',reads=object())


def test_registered_passport_native_parity_with_synthetic_anchor_callback(tmp_path, monkeypatch):
    # This callback is a unit seam, not canonical approval proof.
    image=picture(tmp_path); raw=image.read_bytes(); registered=tmp_path/'Registered.png';registered.write_bytes(raw)
    source=tmp_path/'plan.json';source.write_bytes(b'{}')
    persona=tmp_path/'persona.yaml';persona.write_bytes(b'{}')
    chosen=tmp_path/'grade/anchor/chosen-anchor.json';chosen.parent.mkdir(parents=True)
    chosen.write_text(json.dumps({'schema':'figment/chosen-anchor@1','creator':'creator-999','image_id':'fixture','sha256':digest(raw),'path':str(registered)}))
    approved={'image_id':'fixture','path':str(image),'sha256':digest(raw),'fixture':True,
        'source_plan':{'path':str(source),'sha256':digest(b'{}')},'approval_lineage':{},'rulings':{}}
    state={'_persona_path':str(persona),'identity':{'references':[str(registered)]}}
    callback=lambda *args:copy.deepcopy(approved)
    native=edit.registered_passport_authority('creator-999',state,source,'fixture',validated_anchor=callback)
    item=reader(tmp_path,[image,registered,source,persona,chosen])
    monkeypatch.chdir(tmp_path.parent)
    with monkeypatch.context() as guard:
        domain_traps(guard)
        actual=edit.registered_passport_authority('creator-999',state,source,'fixture',validated_anchor=callback,reads=item)
        assert actual==native
        item.recheck()


def test_supplied_json_buffer_cannot_substitute_named_content(tmp_path):
    path=tmp_path/'record.json';path.write_bytes(b'{"a":1}')
    raw=b'{"a":2}'
    with pytest.raises(edit.EditInputError,match='observed file'):
        edit._json_binding({'path':str(path),'sha256':digest(raw)},tmp_path,raw=raw,reads=reader(tmp_path,[path],raw=False))
    raw=path.read_bytes(); item=reader(tmp_path,[path],raw=False)
    doc,binding=edit._json_binding({'path':str(path),'sha256':digest(raw)},tmp_path,raw=raw,reads=item)
    assert doc=={'a':1} and binding['sha256']==digest(raw)
    item.recheck()
