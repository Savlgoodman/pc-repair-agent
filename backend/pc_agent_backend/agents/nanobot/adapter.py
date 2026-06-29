from __future__ import annotations

import asyncio
import contextlib
from typing import Any, AsyncIterator

from nanobot import Nanobot

from pc_agent_backend.agents.nanobot.events import map_nanobot_event
from pc_agent_backend.agents.nanobot.hooks import UiApprovalHook
from pc_agent_backend.core.config import RuntimeConfig
from pc_agent_backend.schemas.agent import AgentAdapterCapabilities, AgentEvent, AgentRunRequest
from pc_agent_backend.services.approvals import ApprovalBroker, ToolApprovalRejected


class NanobotAgentAdapter:
    name = "nanobot"
    capabilities = AgentAdapterCapabilities(
        streaming=True,
        tool_registration=True,
        tool_approval=True,
        session_state=True,
        notes=["使用 nanobot SDK run_streamed 输出统一 AgentEvent。"],
    )

    def __init__(self, *, runtime_config: RuntimeConfig, approvals: ApprovalBroker) -> None:
        self._runtime_config = runtime_config
        self._approvals = approvals
        self._active_runs: dict[str, Any] = {}

    async def stream_turn(self, request: AgentRunRequest) -> AsyncIterator[AgentEvent]:
        prompt = request.prompt.strip()
        if not prompt:
            yield {
                "type": "agent.run.failed",
                "conversationId": request.conversation_id,
                "turnId": request.turn_id,
                "error": "输入不能为空。",
            }
            return

        if not self._runtime_config.nanobot_config_path.exists():
            yield {
                "type": "agent.run.failed",
                "conversationId": request.conversation_id,
                "turnId": request.turn_id,
                "error": f"nanobot 配置文件不存在：{self._runtime_config.nanobot_config_path}",
            }
            return

        output_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        done_marker = {"type": "__done__"}

        async def produce_events() -> None:
            try:
                async with Nanobot.from_config(
                    config_path=self._runtime_config.nanobot_config_path,
                    workspace=request.workspace,
                ) as bot:
                    run = await bot.run_streamed(
                        prompt,
                        session_key=request.conversation_id,
                        hooks=[
                            UiApprovalHook(
                                conversation_id=request.conversation_id,
                                turn_id=request.turn_id,
                                output_queue=output_queue,
                                approvals=self._approvals,
                            )
                        ],
                    )
                    self._active_runs[request.turn_id] = run
                    try:
                        async for nanobot_event in run.stream_events():
                            await output_queue.put(
                                map_nanobot_event(
                                    nanobot_event,
                                    conversation_id=request.conversation_id,
                                    turn_id=request.turn_id,
                                )
                            )
                        if not getattr(run, "done", False):
                            await run.wait()
                    finally:
                        self._active_runs.pop(request.turn_id, None)
                        if not getattr(run, "done", False):
                            await run.aclose()
            except ToolApprovalRejected as exc:
                await output_queue.put(
                    {
                        "type": "agent.run.failed",
                        "conversationId": request.conversation_id,
                        "turnId": request.turn_id,
                        "error": str(exc),
                    }
                )
            except asyncio.CancelledError:
                await output_queue.put(
                    {
                        "type": "agent.run.failed",
                        "conversationId": request.conversation_id,
                        "turnId": request.turn_id,
                        "error": "用户取消了当前任务。",
                    }
                )
                raise
            except Exception as exc:
                await output_queue.put(
                    {
                        "type": "agent.run.failed",
                        "conversationId": request.conversation_id,
                        "turnId": request.turn_id,
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
                yield event
        finally:
            if not producer.done():
                producer.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await producer

    async def cancel_turn(self, turn_id: str) -> bool:
        run = self._active_runs.get(turn_id)
        if run is None or getattr(run, "done", False):
            return False
        await run.cancel()
        return True
