# Prospecting private model runtime proposal

Status: **synthetic-only executor implemented and tested; real prospect text remains prohibited pending review.**

This runtime is a reusable stage executor for the outreach-skill pipeline. Intake, research,
fact checking, drafting, humanization, independent critique, and human review remain controller-owned
stages. This document specifies the private model subprocess boundary only. It does not launch a
provider call, create a human attestation, qualify a person, or bypass the existing prospect store or
P8/P11 gates.

## Decision

Codex CLI 0.153.4 can run a structured synthetic turn against a credential-free loopback Responses
provider with an isolated per-job home, stdin input, discarded stdout/stderr, and a staged final-output
file. The direct CLI request is **side-effect-tool-free but not literally tool-free**: after all
supported disables, it still declares one function named `request_user_input`. The request declares
no shell, filesystem, web, MCP, app, computer-use, image, multi-agent, or subprocess tool.

The synthetic executor allows only an empty tools array or one declaration whose type is `function`
and name is exactly that non-I/O clarification function. It rejects duplicates, nameless built-ins,
wrong-type same-name rows, and the observed fake-provider response as soon as it contains the call.
The controller supplies no interactive answer and the attempt fails with `tool_call_rejected`. If a
future live-runtime review requires
a zero-length provider `tools` array, the installed CLI is not sufficient by itself. A loopback
request normalizer could remove the function, but that would add provider credential and forwarding
responsibilities and is not part of this proposal or probe.

## Implemented synthetic boundary

`scripts/prospecting/personalizer/private_runtime.py` exposes `build_synthetic_request(...)` and
`execute_synthetic_turn(request, *, environ=None)`. The builder is the only public content entrypoint:
it supplies frozen input, schema, and skill bytes, while callers supply bounded identity fields and a
closed fake-provider scenario. Execution rejects altered bytes or hashes before creating an attempt.
It accepts no command, provider, host, URL, credential, or path from a caller.

The executor creates a fresh exclusive directory below the desktop prospect store, starts the native
CLI suspended, assigns it to a kill-on-close Windows Job Object, then resumes it. Prompt data travels
on stdin; stdout and stderr use `NUL`; only the schema and final message use the attempt directory.
Results expose fixed codes and hashes. Raw input, schema, skill, and output byte fields are excluded
from `repr`. The echoed `TurnBinding` is a controller comparison seam; it does not prove that an
external lease is current or fence a durable attempt.

If Job Object assignment fails, the executor explicitly terminates and waits for the still-suspended
process before releasing its handles. An orchestration error also stops the tool-observer thread and
deletes the owned attempt. These failure paths are covered by injected synthetic tests.

The code-owned provider binds `127.0.0.1` and implements only seven synthetic scenarios: success,
provider error canary, `request_user_input` call, malformed output, oversized output, schema mismatch,
and stall. Output validation uses the installed `jsonschema` implementation after schema validation;
there is no partial home-grown schema evaluator.

## Measured synthetic result

The reproducible artifacts are under
`C:/Users/danie/kb/_private/prospecting-runtime-probe-20260909/snapshots/`.
They contain only the fixed canary `PROSPECTING_RUNTIME_CANARY_7F3A2C91`.

| Boundary | Observation |
| --- | --- |
| CLI | `codex-cli 0.153.4`; native executable SHA-256 `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b` |
| Transport | One POST per attempt to loopback `/v1/responses`; no external provider call |
| Input | Canary supplied on stdin; absent from argv |
| Request | `stream=true`, `store=false`, no Authorization header |
| Tools | Exactly one function, `request_user_input`; all side-effect-capable tool families absent |
| Output | Schema-conforming 44-byte JSON written only to `last_message.json`; exit 0 |
| Streams | stdout and stderr sent to DEVNULL in the frozen run |
| Timeout | A stalled fake provider was terminated after the two-second controller limit; no output file |
| Recovery | A new process completed successfully after the forced timeout |
| Descendants | A synthetic parent spawned a child sleeper; the deadline killed both through the Job Object, and a new owned process then completed |
| Tool response | The fake provider emitted `request_user_input`; the adapter observed it, terminated the attempt, and returned `tool_call_rejected` without waiting |
| Output rejection | Malformed JSON, an over-limit message, and schema mismatch returned fixed failure codes and no output bytes |
| Error canary | A fake 500 response carried the error canary; no input, output, or error canary appeared in the named isolated CLI sinks |
| Local state | No `auth.json` or session/rollout/history file; the CLI did create local state/log/memory/queue SQLite files, an installation ID, and bundled system-skill files |
| Canary scan | No plaintext canary bytes found in the isolated runtime-home files |
| Cleanup | The isolated runtime home was deleted after observation |

The loopback handler also computed a hypothetical normalized body with `tools=[]` and
`tool_choice="none"`, but did not forward it. That demonstrates a possible transformation only; it
does not prove an auth-forwarding broker, provider acceptance, or model behavior.

The absence of plaintext canary bytes is a narrow byte scan, not proof that SQLite pages, OS logs,
telemetry, crash handling, endpoint security, or a provider retained no equivalent data. The probe
did not inspect system or provider logs and did not access or create a real credential object.

## Version-compatible command

The tested command shape is below. `<job-home>` is a newly created empty directory and
`<loopback-port>` belongs to the controller-owned fake provider in this synthetic probe.

```text
<codex.exe> --ask-for-approval never --strict-config exec
  --model synthetic-model
  --ephemeral
  --ignore-user-config
  --ignore-rules
  --skip-git-repo-check
  --sandbox read-only
  --cd <stage-dir>
  --output-schema <stage-schema.json>
  --output-last-message <stage-output.json>
  --config model_provider="loopback"
  --config model_providers.loopback.name="Synthetic loopback"
  --config model_providers.loopback.base_url="http://127.0.0.1:<loopback-port>/v1"
  --config model_providers.loopback.wire_api="responses"
  --config model_providers.loopback.requires_openai_auth=false
  --config model_providers.loopback.request_max_retries=0
  --config model_providers.loopback.stream_max_retries=0
  --config model_context_window=8192
  --config web_search="disabled"
  --config tools.web_search=false
  --config features.shell_tool=false
  --config features.unified_exec=false
  --config features.apps=false
  --config features.skill_mcp_dependency_install=false
  --config features.code_mode.enabled=false
  --config features.multi_agent=false
  --config features.default_mode_request_user_input=false
  --config features.request_permissions_tool=false
  --config features.collaboration_modes=false
  --config features.view_image=false
  --config features.skill_search=false
  --config features.plugins=false
  --config features.skip_host_skill_discovery=true
  --config features.browser_use=false
  --config features.computer_use=false
  --config features.image_generation=false
  --config features.tool_suggest=false
  --config features.hooks=false
  --config features.goals=false
  --config features.sleep_tool=false
  --config features.auth_elicitation=false
  --config features.tool_call_mcp_elicitation=false
  --config apps._default.enabled=false
  --config memories.generate_memories=false
  --config feedback.enabled=false
  --config otel.exporter="none"
  --config otel.trace_exporter="none"
  --config otel.metrics_exporter="none"
  --config otel.log_user_prompt=false
  --config check_for_update_on_startup=false
  --config cli_auth_credentials_store="ephemeral"
  --config project_doc_max_bytes=0
  --config shell_environment_policy.inherit="none"
  --config hide_agent_reasoning=true
  --config notify=[]
  -
```

Set `CODEX_HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, and `TMP` to
controller-created per-job directories. Inherit only the Windows variables required to start the
native executable. Do not put prompt text, identifiers, tokens, or credentials in argv.

Two installed-version details matter:

- `--ask-for-approval never` must appear before `exec`; placing it among exec arguments failed.
- With `--strict-config`, this CLI rejects the current documentation keys
  `tools.view_image` and `apps._default.default_tools_enabled`. The tested configuration uses
  `features.view_image=false` and `apps._default.enabled=false`.

## Controller contract for a future real adapter

A later adapter may execute only after a separate privacy review and synthetic tests freeze these
rules:

1. Build a typed private envelope from an already claimed stage job. Include the immutable run,
   revision/body, evidence, schema, and exact skill bytes needed by that stage. Hash every component
   before launch.
2. Resolve and hash the native executable. Refuse an unapproved CLI version, executable hash,
   config hash, output-schema hash, model ID, provider ID, or skill manifest hash.
3. Create a new private job directory and empty runtime home. Write only the schema and eventual
   output there. Supply the envelope exclusively on stdin.
4. Permit an outbound request only when its declared tools are either empty or exactly
   `request_user_input`. Reject every response containing a tool/function call; never enter an
   interactive clarification wait.
5. Send stdout and stderr to DEVNULL. Validate the final-output file against the pinned schema,
   validate stage semantics separately, hash it, and import it into the existing desktop-local
   prospecting store. A hash receipt is structural evidence, not model judgment or human approval.
6. Delete the staged output, schema, and entire job home after durable import. Record metadata only:
   job/stage/revision IDs, input/output/skill/config/runtime hashes, timings, exit code, validation
   result, and cleanup result.
7. Start suspended, assign the process to a Windows Job Object configured with
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and resume only after assignment. Terminate the Job Object
   on deadline or an observed tool response, then let the external controller park or retry according
   to its durable lease. The synthetic child-process test establishes local descendant containment;
   durable attempt fencing still belongs to the existing controller and store.
8. Never interpret a model result, a hash receipt, acceptance of an automated suggestion, or a
   controller event as a human attestation. Human edits and review decisions continue through the
   existing authenticated review service.

Each stage has its own output schema. Research and fact-check outputs must carry source IDs and
uncertainty/shortfall fields. Drafting and humanization produce suggestions bound to the exact input
revision, not silent rewrites. Post-humanization fact checking and independent critique bind to the
exact accepted revision hash. A second failed repair parks the run.

## Workflow-version compatibility

P15 currently compares stored intake rows with the code-current `WORKFLOW_HASH`. Enabling an
adapter by changing the manifest would make previously accepted intake projections unreadable.
Before the runtime is wired, replace that single-current comparison with an explicit supported
workflow registry keyed by `(workflow_id, workflow_version, workflow_hash)`, or create a new run
bound to a new version while retaining the old validator. Add historical snapshot/replay tests.
Never mutate the binding on an existing intake or run.

## Approval gates still open

Real prospect or draft text must not enter this runtime until independent review accepts:

- the exact treatment of the remaining `request_user_input` declaration;
- provider identity, network destination, authentication boundary, retention terms, and cost;
- per-job directory ACLs and cleanup behavior;
- the production stage schemas and exact skill manifests;
- the supported workflow-version lookup; and
- a production-bound synthetic test of wrong hashes and cleanup failures after the live adapter seam
  is designed. The current executor already covers tool-call responses, malformed and oversized
  outputs, schema mismatch, deadlines, descendant termination, cleanup, and fresh-attempt recovery.

Official OpenAI documentation describes custom model providers and their Responses wire API at
https://developers.openai.com/codex/config-reference and documents `--ephemeral` and
`--output-schema` at https://developers.openai.com/codex/noninteractive. Those pages describe
configuration and CLI behavior; they do not establish this application's privacy boundary.
