from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pc_agent_backend.api.dependencies import get_services
from pc_agent_backend.services.runtime import AppServices


router = APIRouter()


@router.get("/conversations")
async def list_conversations(services: AppServices = Depends(get_services)) -> dict[str, Any]:
    return {"sessions": services.conversation_store.list_sessions()}


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    conversation = services.conversation_store.get_conversation(conversation_id)
    if conversation is None:
        return JSONResponse({"error": "conversation not found"}, status_code=404)
    return JSONResponse(conversation)
