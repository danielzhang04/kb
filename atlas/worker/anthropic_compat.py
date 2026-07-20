"""Shim for a livekit-agents 1.6.6 tool_result serialization bug (livekit/agents#2519 class).

`livekit/agents/llm/_provider_format/anthropic.py::to_chat_ctx` (v1.6.6, lines 71-86)
json.loads a tool's output and, when it parses to a LIST, passes that list straight
through as the Anthropic `tool_result.content`. Anthropic then rejects it because each
list item must be a content block ({"type":"text",...} / {"type":"image",...}):
  - list-of-dicts (our list-returning tools, e.g. running_work) ->
    400 'messages.N.content.0.tool_result.content.0.type: Field required'
  - MCP TextContent dicts carry an 'annotations' field ->
    400 'tool_result.content.0.text.annotations: Extra inputs are not permitted'
Either way the malformed block poisons chat history, so the follow-up (2nd) LLM call
of a session 400s. The bug lives in livekit-agents (already latest 1.6.x), NOT the
plugin, so no minimal plugin bump fixes it — hence this request-path sanitizer.

We wrap the AsyncAnthropic client's messages.create so every outbound
tool_result.content is normalized to valid blocks and extra fields dropped.

REMOVAL CONDITION: delete this module + revert app.py/pairing_smoke.py to
anthropic.LLM(model=...) once the upstream serializer is fixed (livekit/agents#2519);
re-run `python -m worker.pairing_smoke` (both paths must still PASS) to confirm.
"""
from __future__ import annotations

import json
from typing import Any

# Module-level imports so the livekit anthropic plugin registers on the MAIN thread
# (app.py imports this module at startup). Importing it lazily inside build_llm would
# register the plugin from the job thread -> "Plugins must be registered on the main thread".
import anthropic
from livekit.plugins import anthropic as lk_anthropic

_ALLOWED_BLOCK_TYPES = {"text", "image"}


def _sanitize_tool_result_content(content: Any) -> Any:
    """Normalize a tool_result `content` to a string or a list of valid Anthropic blocks."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return json.dumps(content, default=str)
    blocks: list[dict[str, Any]] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") in _ALLOWED_BLOCK_TYPES:
            if item["type"] == "text":
                blocks.append({"type": "text", "text": str(item.get("text", ""))})
            else:  # image: keep the source, drop any non-schema fields (e.g. annotations)
                blocks.append({"type": "image", "source": item["source"]})
        else:  # dict/scalar with no valid block type -> fold into one text block
            blocks.append({"type": "text",
                           "text": item if isinstance(item, str) else json.dumps(item, default=str)})
    return blocks or ""


def _sanitize_messages(messages: Any) -> None:
    """In-place: repair every tool_result content block in an Anthropic messages list."""
    for msg in messages or []:
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                block["content"] = _sanitize_tool_result_content(block.get("content"))


def build_llm(model: str):
    """anthropic.LLM whose request path sanitizes tool_result serialization (see module docstring)."""
    client = anthropic.AsyncClient()  # reads ANTHROPIC_API_KEY from env (repl.load_env ran first)
    for resource in (client.messages, client.beta.messages):
        _orig = resource.create

        def _wrapped(*args, _orig=_orig, **kwargs):
            if "messages" in kwargs:
                _sanitize_messages(kwargs["messages"])
            return _orig(*args, **kwargs)

        resource.create = _wrapped
    return lk_anthropic.LLM(model=model, client=client)
