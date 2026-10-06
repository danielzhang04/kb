"""Windows named/fd executable inference differs; same-API identity stays exact."""
import dataclasses
import importlib.util
import os
from pathlib import Path
import stat
import sys
from types import SimpleNamespace

import pytest

spec=importlib.util.spec_from_file_location('mode_observed_reads',Path(__file__).parents[1]/'observed_reads.py')
obs=importlib.util.module_from_spec(spec);sys.modules[spec.name]=obs;spec.loader.exec_module(obs)


def make(path):
    return obs.ObservedReads(roots=(path.parent,),members=(obs.ReadMember(path,100,allow_bytes=True,exact_case=True),))


def test_real_bat_named_fd_identity_raw_hash_and_recheck(tmp_path):
    path=tmp_path/'installer.bat';path.write_bytes(b'fixture installer bytes; never executed')
    named=obs._fingerprint(path.lstat(),directory=False)
    with path.open('rb',buffering=0) as handle:opened=obs._fingerprint(os.fstat(handle.fileno()),directory=False)
    assert named.mode != opened.mode and (named.mode ^ opened.mode) & ~0o111 == 0
    assert obs._same_object(named,opened)
    item=make(path)
    raw=item.read_bytes(path)
    import hashlib
    assert item.sha256(path)==hashlib.sha256(raw).hexdigest()
    item.recheck()


@pytest.mark.parametrize('bit',[stat.S_IRUSR,stat.S_IWUSR,stat.S_IRGRP,stat.S_IWGRP,stat.S_IROTH,stat.S_IWOTH,stat.S_IFREG,stat.S_IFDIR])
def test_cross_api_other_mode_bits_remain_exact(tmp_path,bit):
    path=tmp_path/'data';path.write_bytes(b'x')
    stamp=obs._fingerprint(path.lstat(),directory=False)
    assert not obs._same_object(stamp,dataclasses.replace(stamp,mode=stamp.mode^bit))


@pytest.mark.parametrize('field',['device','inode','size','modified','birthtime','attributes'])
def test_cross_api_other_identity_fields_remain_exact(tmp_path,field):
    path=tmp_path/'data';path.write_bytes(b'x')
    stamp=obs._fingerprint(path.lstat(),directory=False)
    assert not obs._same_object(stamp,dataclasses.replace(stamp,**{field:getattr(stamp,field)+1}))


@pytest.mark.parametrize('api',['named','opened'])
def test_same_api_executable_drift_still_refuses(tmp_path,monkeypatch,api):
    path=tmp_path/'installer.bat';path.write_bytes(b'fixture')
    item=make(path);item.read_bytes(path)
    if api=='named':
        original=item._named
        monkeypatch.setattr(item,'_named',lambda p:dataclasses.replace(original(p),mode=original(p).mode^0o111))
    else:
        original=os.fstat
        def changed(fd):
            result=original(fd)
            fields={name:getattr(result,name) for name in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_birthtime_ns','st_file_attributes','st_mode')}
            fields['st_mode'] ^= 0o111
            return SimpleNamespace(**fields)
        monkeypatch.setattr(os,'fstat',changed)
    with pytest.raises(obs.ObservedReadError):item.recheck()
