from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from pc_agent_backend.api.dependencies import get_services
from pc_agent_backend.services.runtime import AppServices


router = APIRouter()


@router.get("/conversations")
async def list_conversations(services: AppServices = Depends(get_services)) -> dict[str, Any]:
    return {"sessions": services.conversation_store.list_sessions()}


@router.post("/conversations")
async def create_conversation(
    request: Request,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    body = await request.json()
    session = services.conversation_store.create_session(
        title=body.get("title") if isinstance(body.get("title"), str) else None,
        preview=body.get("preview") if isinstance(body.get("preview"), str) else None,
    )
    return JSONResponse({"session": session})


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    conversation = services.conversation_store.get_conversation(conversation_id)
    if conversation is None:
        return JSONResponse({"error": "conversation not found"}, status_code=404)
    return JSONResponse(conversation)


@router.put("/conversations/{conversation_id}/session")
async def save_conversation_session(
    conversation_id: str,
    request: Request,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    body = await request.json()
    session_payload = body.get("session") if isinstance(body.get("session"), dict) else body
    session = services.conversation_store.save_session(conversation_id, session_payload)
    return JSONResponse({"session": session})


@router.put("/conversations/{conversation_id}/messages")
async def save_conversation_messages(
    conversation_id: str,
    request: Request,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    body = await request.json()
    messages = body.get("messages")
    if not isinstance(messages, list):
        return JSONResponse({"error": "messages must be a list"}, status_code=400)
    services.conversation_store.save_messages(conversation_id, messages)
    return JSONResponse({"ok": True})


@router.post("/conversations/{conversation_id}/messages")
async def append_conversation_message(
    conversation_id: str,
    request: Request,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    body = await request.json()
    message = body.get("message") if isinstance(body.get("message"), dict) else body
    if not isinstance(message, dict):
        return JSONResponse({"error": "message must be an object"}, status_code=400)
    messages = services.conversation_store.append_message(conversation_id, message)
    return JSONResponse({"messages": messages})
