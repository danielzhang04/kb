# Local ComfyUI runtime audit — 2026-09-08

## Scope and result

This is a read-only audit of two frozen private baseline attempts and the V2
import probe. It does not start ComfyUI, send a prompt, create an image, or
alter the baselines. Neither baseline contains dispatch-attempt.json, a
receipt, or a PNG under its output directory. Both journals record
prompt_id null and status failed.

The result is not an identity, apparent-age, clothing, realism, quality, or
availability finding. It establishes two startup failures and the limits of the
first runtime ownership design.

The pre-run inventory is in the [local capability record](2026-09-08-local-comfy-capability.md).
The offline launcher contract is [LOCAL-COMFY-INPUT](../../orgs/figment/pipeline/expand/LOCAL-COMFY-INPUT.md).

## Frozen evidence

| Attempt | Frozen private root | Journal / manifest / log SHA-256 | Observed result |
| --- | --- | --- | --- |
| V1 baseline | _private/figment-local-comfy-baseline-20260908-v1 | journal d0d7c2f7977bb02c2dff1fd3d2168df8b0b8b9ab140a6171eccca101ea9494cf; manifest b1f7ae4efc56f4137f073f7511120847800a94b63c696b60dbdbcbc7aa0048dc; stderr 1cbb18d4e36df1bce5aa002a275aac7008e667a4192f1bb3084469e5740adcae | The process exited before listener readiness. The traceback reaches torch._dynamo and fails because the default Inductor cache derives a username unavailable in the isolated environment. |
| V2 baseline | _private/figment-local-comfy-baseline-20260908-v2 | journal a3ff8ec4235227d42cd0fd4992de76365072f2ad1b97f9048926cffecc788255; manifest b45656b829ad06e4fe9e218a75603505e35f82608b355c20b640bf87203e1c5f; stderr 2b605833b4b5f72192ab2ca21bedc1d81156bdcf7c9c556c8da5407428affb4a | The V2 log reaches Starting server and advertises loopback 127.0.0.1:8190, but the launcher refused it as unowned before any POST. |
| V2 import probe | _private/figment-local-comfy-importprobe-20260908-v2 | probe 049f3401ebea89bb71dd57451b0cbf7f6ab32fc7ef2f1e5ab2951403fc893282; receipt bd338a42627b68b7415377baa77948790ba5285ad0f85f73e13c0da15302e54c; stderr e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | import torch._dynamo returned 0 with an owned TORCHINDUCTOR_CACHE_DIR; its receipt says network false and server_started false. This validates only the isolated import fix. |

The V1 and V2 manifests bind the same sole copied g01.jpg hash
e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed,
the inspected model pins, and the static diagnostic workflow. Their launcher
hashes differ: V1 records
66463ca6f7eab86db06cbd8e95cf3979c79a9b8c563b50ffe1130d720718cb04;
V2 records
150b5d6156af14de07bfa585ae2ca11dc221f8f7417b6a7fad618509d9c447d6.

## What happened in V2

The Popen PID recorded by the V2 journal was 33680, a virtual-environment
redirector. The actual Python server process was 41576, with conhost 34896 in
its process tree. The original identity check compared the listener PID only
with the direct Popen PID, so it did not recognize the real server and did not
dispatch a prompt. The root intervened to verify and stop the actual 41576
leaf; the wrapper journal then recorded failure and verified_stopped true. The
parent separately verified all three processes absent afterward.

This is evidence of a gap in the original ownership control. The V2 journal's
successful wrapper teardown field is not proof that the original code correctly
identified or independently stopped every server descendant.

The V2 log also reports an attempted backup of
C:\Users\danie\tools\ComfyUI\user\comfyui.db and WinError 5 access denied,
despite the configured private --user-directory. The attempt was denied, but it
shows that the launch did not prove the whole existing ComfyUI installation
uses only private state. No claim of a fully read-only shared installation is
warranted.

## Fixture coverage and the missed conditions

The accepted offline fixture tests covered manifest pin/source binding, a sole
copied g01, fresh private roots, loopback-only command construction, disabled
API nodes, custom-node allowlisting, occupied-port refusal, proxy/redirect
refusal, a foreign listener PID, one POST attempt with its marker, bounded PNG
validation, and failed-journal/teardown behavior. These are useful refusals and
static controls.

They did not exercise a Windows virtual-environment redirector that spawns a
different Python listener PID, descendant identity with creation-time binding,
or ComfyUI's effective database location. Mocked Popen objects made the
direct-PID listener relation appear sufficient. The V2 runtime evidence shows
that this was not a valid ownership proof for the actual launch shape.

## Pending bounded fixture

No third ComfyUI start has occurred. The proposed repair remains unexercised:
use Toolhelp process data to bind an exact PID and creation time through the
owned descendant tree; reject a listener outside that identity; configure an
explicit private database URL; and flush the bounded startup log before
readiness or failure is recorded. First, a tiny server launched through the
same Windows virtual environment must demonstrate ownership and complete
descendant teardown without ComfyUI or image generation. A future one-image
loopback smoke must use a
fresh private root, record these controls, refuse before POST if ownership is
ambiguous, and preserve the same no-retry behavior. Its result must be assessed
separately from this audit.
