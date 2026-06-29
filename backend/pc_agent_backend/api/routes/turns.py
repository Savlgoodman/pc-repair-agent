from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from pc_agent_backend.api.dependencies import get_services
from pc_agent_backend.core.json_utils import encode_ndjson_event
from pc_agent_backend.schemas.agent import AgentRunRequest
from pc_agent_backend.services.runtime import AppServices


router = APIRouter()


@router.post("/turns/{turn_id}/cancel")
async def cancel_turn(
    turn_id: str,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    await services.agent_adapter.cancel_turn(turn_id)
    await services.approvals.reject_all()
    return JSONResponse({"ok": True})


@router.post("/turns/stream")
async def stream_turn(
    request: Request,
    services: AppServices = Depends(get_services),
) -> StreamingResponse:
    body = await request.json()
    conversation_id = str(body.get("conversationId") or "").strip()
    if not conversation_id:
        conversation_id = services.conversation_recorder.create_conversation_id()
    turn_id = str(body.get("turnId") or f"turn-{uuid.uuid4().hex}")
    prompt = str(body.get("input") or "").strip()
    run_request = AgentRunRequest(
        conversation_id=conversation_id,
        turn_id=turn_id,
        prompt=prompt,
        workspace=services.workspace,
    )

    async def event_stream():
        assistant_message_id = ""
        if prompt:
            turn_record = services.conversation_recorder.start_turn(
                conversation_id=conversation_id,
                prompt=prompt,
            )
            assistant_message_id = str(turn_record.assistant_message["id"])
            yield encode_ndjson_event(
                {
                    "type": "conversation.turn.started",
                    "conversationId": conversation_id,
                    "turnId": turn_id,
                    "session": turn_record.session,
                    "userMessage": turn_record.user_message,
                    "assistantMessage": turn_record.assistant_message,
                }
            )

        completed = False
        try:
            async for event in services.agent_adapter.stream_turn(run_request):
                if assistant_message_id:
                    session = services.conversation_recorder.apply_agent_event(
                        conversation_id=conversation_id,
                        assistant_message_id=assistant_message_id,
                        event=event,
                    )
                    if session is not None:
                        event = {
                            **event,
                            "session": session,
                        }
                yield encode_ndjson_event(event)
                if event.get("type") in {"agent.run.completed", "agent.run.failed"}:
                    completed = True
        except asyncio.CancelledError:
            if assistant_message_id:
                services.conversation_recorder.apply_agent_event(
                    conversation_id=conversation_id,
                    assistant_message_id=assistant_message_id,
                    event={
                        "type": "agent.run.failed",
                        "conversationId": conversation_id,
                        "turnId": turn_id,
                        "error": "用户取消了当前任务。",
                    },
                )
                completed = True
            raise
        finally:
            if assistant_message_id and not completed:
                services.conversation_recorder.discard_turn(conversation_id)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson; charset=utf-8",
    )
