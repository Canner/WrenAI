"""Exercise the example's agent loop and HTTP MCP requests without network/LLM."""

from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path

import httpx
from pydantic_ai.messages import (
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import FunctionModel

EXAMPLE = Path(__file__).parents[2] / "examples" / "parallel_research_demo.py"
spec = importlib.util.spec_from_file_location("parallel_research_demo", EXAMPLE)
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


def test_research_agent_dispatches_wren_search_and_fetch(
    tmp_project, fake_active_profile, monkeypatch
):
    requests = []

    def serve(request):
        requests.append(request)
        if request.method != "POST":
            return httpx.Response(405)
        body = json.loads(request.content)
        if "id" not in body:
            return httpx.Response(202)
        method = body["method"]
        if method == "initialize":
            result = {
                "protocolVersion": body["params"]["protocolVersion"],
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "research-fixture", "version": "1"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": name,
                        "description": name,
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                **properties,
                                "session_id": {"type": "string"},
                            },
                            "required": list(properties),
                        },
                    }
                    for name, properties in [
                        (
                            "web_search",
                            {
                                "objective": {"type": "string"},
                                "search_queries": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                        ),
                        (
                            "web_fetch",
                            {"urls": {"type": "array", "items": {"type": "string"}}},
                        ),
                    ]
                ]
            }
        elif method == "tools/call":
            result = {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "results": [
                                    {
                                        "url": "https://example.com/retail",
                                        "excerpts": ["Public retail report"],
                                    }
                                ]
                            }
                        ),
                    }
                ],
                "isError": False,
            }
        else:
            raise AssertionError(method)
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": body["id"], "result": result}
        )

    original_init = httpx.AsyncClient.__init__

    def client_init(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(serve)
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", client_init)
    calls = [
        ("wren_list_models", {}),
        (
            "parallel_web_search",
            {
                "objective": "Public retail trends",
                "search_queries": ["public retail trends"],
            },
        ),
        ("parallel_web_fetch", {"urls": ["https://example.com/retail"]}),
    ]

    def model(messages, info):
        returns = [
            part
            for message in messages
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        ]
        if len(returns) < len(calls):
            name, args = calls[len(returns)]
            assert name in {t.name for t in info.function_tools}
            return ModelResponse([ToolCallPart(name, args)])
        assert returns[0].content == []  # Real Wren model loader, empty fixture MDL.
        assert all("Public retail report" in str(r.content) for r in returns[1:])
        return ModelResponse(
            [TextPart("Public retail report: https://example.com/retail")]
        )

    async def run():
        agent = demo.build_agent(tmp_project, FunctionModel(model))
        async with agent:
            return await agent.run("List models and research public retail trends")

    result = asyncio.run(run())
    assert "https://example.com/retail" in result.output
    assert requests
    assert all(str(r.url) == demo.PARALLEL_URL for r in requests)
    assert all(r.headers["user-agent"] == demo.USER_AGENT for r in requests)
    assert all("authorization" not in r.headers for r in requests)
    bodies = [json.loads(r.content) for r in requests if r.method == "POST"]
    assert "initialize" in {b["method"] for b in bodies}
    assert "tools/list" in {b["method"] for b in bodies}
    dispatched = [b["params"] for b in bodies if b["method"] == "tools/call"]
    assert [p["name"] for p in dispatched] == ["web_search", "web_fetch"]
    session_ids = {p["arguments"]["session_id"] for p in dispatched}
    assert len(session_ids) == 1
    assert len(session_ids.pop()) == 32
    assert dispatched[0]["arguments"]["search_queries"] == ["public retail trends"]
    assert dispatched[1]["arguments"]["urls"] == ["https://example.com/retail"]
