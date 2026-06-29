from __future__ import annotations

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
    conversation_id = str(body.get("conversationId") or f"conv-{uuid.uuid4().hex}")
    turn_id = str(body.get("turnId") or f"turn-{uuid.uuid4().hex}")
    prompt = str(body.get("input") or "").strip()
    run_request = AgentRunRequest(
        conversation_id=conversation_id,
        turn_id=turn_id,
        prompt=prompt,
        workspace=services.workspace,
    )

    async def event_stream():
        async for event in services.agent_adapter.stream_turn(run_request):
            yield encode_ndjson_event(event)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson; charset=utf-8",
    )
