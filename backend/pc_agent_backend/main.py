from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import sys
import uuid
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from nanobot import (
    STREAM_EVENT_REASONING_COMPLETED,
    STREAM_EVENT_REASONING_DELTA,
    STREAM_EVENT_RUN_COMPLETED,
    STREAM_EVENT_RUN_FAILED,
    STREAM_EVENT_RUN_STARTED,
    STREAM_EVENT_TEXT_COMPLETED,
    STREAM_EVENT_TEXT_DELTA,
    STREAM_EVENT_TOOL_COMPLETED,
    STREAM_EVENT_TOOL_FAILED,
    STREAM_EVENT_TOOL_STARTED,
    Nanobot,
)
from nanobot.agent import AgentHook, AgentHookContext

from .config import RuntimeConfig, resolve_runtime_config

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
DEFAULT_WORKSPACE = REPO_ROOT

HIGH_RISK_TOOL_NAMES = {
    "apply_patch",
    "edit_file",
    "exec",
    "execution_gateway_request",
    "modify_registry",
    "restart_service",
    "run_installer",
    "set_environment_variable",
    "write_file",
    "write_stdin",
}

MEDIUM_RISK_TOOL_NAMES = {
    "download_candidate",
    "web_fetch",
    "web_search",
}


def configure_stdio_encoding() -> None:
    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            with contextlib.suppress(Exception):
                reconfigure(encoding="utf-8")


def to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if is_dataclass(value):
        return to_jsonable(asdict(value))
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    if hasattr(value, "model_dump"):
        with contextlib.suppress(Exception):
            return to_jsonable(value.model_dump())
    if hasattr(value, "__dict__"):
        return to_jsonable(vars(value))
    return repr(value)


def encode_event(event: dict[str, Any]) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")


def risk_level(tool_name: str) -> str:
    if tool_name in HIGH_RISK_TOOL_NAMES:
        return "high"
    if tool_name in MEDIUM_RISK_TOOL_NAMES or tool_name.startswith("web_"):
        return "medium"
    return "low"


def describe_risk(tool_name: str) -> dict[str, Any]:
    level = risk_level(tool_name)
    if level == "high":
        return {
            "purpose": "Agent 准备执行可能修改本机状态的工具调用。",
            "impact": "该操作可能修改文件、执行命令、安装程序或影响系统配置。",
            "risks": [
                "参数不当可能造成文件或系统状态变化。",
                "执行失败可能让维修流程处于不完整状态。",
            ],
            "rollback": "拒绝后本轮 Agent 会中断；允许前请确认参数、来源和影响范围。",
        }
    if level == "medium":
        return {
            "purpose": "Agent 准备执行涉及网络或下载的工具调用。",
            "impact": "该操作可能访问外部资源或下载文件到本机缓存。",
            "risks": [
                "外部来源可能不可用或不可信。",
                "下载内容需要后续校验签名和来源。",
            ],
            "rollback": "拒绝后本轮 Agent 会中断；允许后仍不会自动执行高风险安装动作。",
        }
    return {
        "purpose": "Agent 准备执行只读或低风险工具调用。",
        "impact": "通常只读取信息或生成结果。",
        "risks": [],
        "rollback": "无需回滚。",
    }


class ToolApprovalRejected(RuntimeError):
    pass


class ApprovalBroker:
    def __init__(self) -> None:
        self._pending: dict[str, asyncio.Future[bool]] = {}
        self._lock = asyncio.Lock()

    async def create(self, approval_id: str) -> asyncio.Future[bool]:
        async with self._lock:
            future = asyncio.get_running_loop().create_future()
            self._pending[approval_id] = future
            return future

    async def resolve(self, approval_id: str, decision: bool) -> bool:
        async with self._lock:
            future = self._pending.pop(approval_id, None)
        if future is None or future.done():
            return False
        future.set_result(decision)
        return True

    async def reject_all(self) -> None:
        async with self._lock:
            futures = list(self._pending.values())
            self._pending.clear()
        for future in futures:
            if not future.done():
                future.set_result(False)


APPROVALS = ApprovalBroker()
ACTIVE_RUNS: dict[str, Any] = {}


class UiApprovalHook(AgentHook):
    def __init__(
        self,
        *,
        conversation_id: str,
        turn_id: str,
        output_queue: asyncio.Queue[dict[str, Any]],
    ) -> None:
        super().__init__(reraise=True)
        self._conversation_id = conversation_id
        self._turn_id = turn_id
        self._output_queue = output_queue

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        for call in context.tool_calls:
            level = risk_level(call.name)
            if level == "low":
                continue

            approval_id = f"approval-{uuid.uuid4().hex}"
            future = await APPROVALS.create(approval_id)
            risk = describe_risk(call.name)
            await self._output_queue.put(
                {
                    "type": "approval.required",
                    "conversationId": self._conversation_id,
                    "turnId": self._turn_id,
                    "approvalId": approval_id,
                    "toolCallId": call.id,
                    "name": call.name,
                    "arguments": to_jsonable(call.arguments or {}),
                    "risk": level,
                    **risk,
                }
            )

            allowed = await future
            if not allowed:
                raise ToolApprovalRejected(f"用户拒绝执行工具：{call.name}")


def map_nanobot_event(event: Any, *, conversation_id: str, turn_id: str) -> dict[str, Any]:
    base = {
        "conversationId": conversation_id,
        "turnId": turn_id,
    }

    if event.type == STREAM_EVENT_RUN_STARTED:
        return {
            **base,
            "type": "agent.run.started",
            "metadata": to_jsonable(getattr(event, "metadata", {}) or {}),
        }
    if event.type == STREAM_EVENT_TEXT_DELTA:
        return {
            **base,
            "type": "agent.text.delta",
            "delta": getattr(event, "delta", "") or "",
        }
    if event.type == STREAM_EVENT_TEXT_COMPLETED:
        return {
            **base,
            "type": "agent.text.completed",
            "resuming": bool(getattr(event, "resuming", False)),
        }
    if event.type == STREAM_EVENT_REASONING_DELTA:
        return {
            **base,
            "type": "agent.reasoning.delta",
            "delta": getattr(event, "delta", "") or "",
        }
    if event.type == STREAM_EVENT_REASONING_COMPLETED:
        return {
            **base,
            "type": "agent.reasoning.completed",
            "content": getattr(event, "content", "") or "",
        }
    if event.type == STREAM_EVENT_TOOL_STARTED:
        name = getattr(event, "name", "") or ""
        return {
            **base,
            "type": "agent.tool.started",
            "toolCallId": getattr(event, "tool_call_id", "") or "",
            "name": name,
            "arguments": to_jsonable(getattr(event, "arguments", {}) or {}),
            "risk": risk_level(name),
        }
    if event.type == STREAM_EVENT_TOOL_COMPLETED:
        return {
            **base,
            "type": "agent.tool.completed",
            "toolCallId": getattr(event, "tool_call_id", "") or "",
            "name": getattr(event, "name", "") or "",
            "result": to_jsonable(getattr(event, "result", None)),
            "metadata": to_jsonable(getattr(event, "metadata", {}) or {}),
        }
    if event.type == STREAM_EVENT_TOOL_FAILED:
        return {
            **base,
            "type": "agent.tool.failed",
            "toolCallId": getattr(event, "tool_call_id", "") or "",
            "name": getattr(event, "name", "") or "",
            "error": getattr(event, "error", None) or "工具调用失败",
            "metadata": to_jsonable(getattr(event, "metadata", {}) or {}),
        }
    if event.type == STREAM_EVENT_RUN_COMPLETED:
        result = getattr(event, "result", None)
        return {
            **base,
            "type": "agent.run.completed",
            "result": to_jsonable(result),
            "usage": to_jsonable(getattr(result, "usage", None)),
        }
    if event.type == STREAM_EVENT_RUN_FAILED:
        return {
            **base,
            "type": "agent.run.failed",
            "error": getattr(event, "error", None) or "Agent 运行失败",
        }

    return {
        **base,
        "type": "agent.event",
        "rawType": getattr(event, "type", "unknown"),
        "payload": to_jsonable(event),
    }


def create_app(runtime_config: RuntimeConfig, workspace: Path) -> FastAPI:
    app = FastAPI(title="PC Repair Agent Backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "env": runtime_config.env,
            "dataDir": str(runtime_config.data_dir),
            "configPath": str(runtime_config.nanobot_config_path),
            "configExists": runtime_config.nanobot_config_path.exists(),
            "apiKeyPresent": bool(os.environ.get("DEEPSEEK_API_KEY")),
            "workspace": str(workspace),
        }

    @app.post("/api/approvals/{approval_id}/decision")
    async def approval_decision(approval_id: str, request: Request) -> JSONResponse:
        body = await request.json()
        decision = str(body.get("decision", "")).lower()
        allowed = decision in {"allow", "allowed", "yes", "true"}
        resolved = await APPROVALS.resolve(approval_id, allowed)
        return JSONResponse({"ok": resolved})

    @app.post("/api/turns/{turn_id}/cancel")
    async def cancel_turn(turn_id: str) -> JSONResponse:
        run = ACTIVE_RUNS.get(turn_id)
        if run is not None and not getattr(run, "done", False):
            await run.cancel()
        await APPROVALS.reject_all()
        return JSONResponse({"ok": True})

    @app.post("/api/turns/stream")
    async def stream_turn(request: Request) -> StreamingResponse:
        body = await request.json()
        conversation_id = str(body.get("conversationId") or f"conv-{uuid.uuid4().hex}")
        turn_id = str(body.get("turnId") or f"turn-{uuid.uuid4().hex}")
        prompt = str(body.get("input") or "").strip()

        async def event_stream():
            if not prompt:
                yield encode_event(
                    {
                        "type": "agent.run.failed",
                        "conversationId": conversation_id,
                        "turnId": turn_id,
                        "error": "输入不能为空。",
                    }
                )
                return

            if not runtime_config.nanobot_config_path.exists():
                yield encode_event(
                    {
                        "type": "agent.run.failed",
                        "conversationId": conversation_id,
                        "turnId": turn_id,
                        "error": f"nanobot 配置文件不存在：{runtime_config.nanobot_config_path}",
                    }
                )
                return

            output_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
            done_marker = {"type": "__done__"}

            async def produce_events() -> None:
                try:
                    async with Nanobot.from_config(
                        config_path=runtime_config.nanobot_config_path,
                        workspace=workspace,
                    ) as bot:
                        run = await bot.run_streamed(
                            prompt,
                            session_key=conversation_id,
                            hooks=[
                                UiApprovalHook(
                                    conversation_id=conversation_id,
                                    turn_id=turn_id,
                                    output_queue=output_queue,
                                )
                            ],
                        )
                        ACTIVE_RUNS[turn_id] = run
                        try:
                            async for nanobot_event in run.stream_events():
                                await output_queue.put(
                                    map_nanobot_event(
                                        nanobot_event,
                                        conversation_id=conversation_id,
                                        turn_id=turn_id,
                                    )
                                )
                            if not getattr(run, "done", False):
                                await run.wait()
                        finally:
                            ACTIVE_RUNS.pop(turn_id, None)
                            if not getattr(run, "done", False):
                                await run.aclose()
                except ToolApprovalRejected as exc:
                    await output_queue.put(
                        {
                            "type": "agent.run.failed",
                            "conversationId": conversation_id,
                            "turnId": turn_id,
                            "error": str(exc),
                        }
                    )
                except asyncio.CancelledError:
                    await output_queue.put(
                        {
                            "type": "agent.run.failed",
                            "conversationId": conversation_id,
                            "turnId": turn_id,
                            "error": "用户取消了当前任务。",
                        }
                    )
                    raise
                except Exception as exc:
                    await output_queue.put(
                        {
                            "type": "agent.run.failed",
                            "conversationId": conversation_id,
                            "turnId": turn_id,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                    )
                finally:
                    await output_queue.put(done_marker)

            producer = asyncio.create_task(produce_events())
            try:
                while True:
                    event = await output_queue.get()
                    if event is done_marker:
                        break
                    yield encode_event(event)
            finally:
                if not producer.done():
                    producer.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await producer

        return StreamingResponse(
            event_stream(),
            media_type="application/x-ndjson; charset=utf-8",
        )

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PC Repair Agent backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--config", default=None)
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--workspace", default=str(DEFAULT_WORKSPACE))
    return parser.parse_args()


def main() -> None:
    configure_stdio_encoding()
    args = parse_args()
    workspace = Path(args.workspace).resolve()
    runtime_config = resolve_runtime_config(
        workspace=workspace,
        config_override=Path(args.config) if args.config else None,
        data_dir_override=Path(args.data_dir) if args.data_dir else None,
    )
    app = create_app(runtime_config=runtime_config, workspace=workspace)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
