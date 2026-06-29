from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from pc_agent_backend.api.dependencies import get_services
from pc_agent_backend.services.runtime import AppServices


router = APIRouter()


@router.post("/approvals/{approval_id}/decision")
async def approval_decision(
    approval_id: str,
    request: Request,
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    body = await request.json()
    decision = str(body.get("decision", "")).lower()
    allowed = decision in {"allow", "allowed", "yes", "true"}
    resolved = await services.approvals.resolve(approval_id, allowed)
    return JSONResponse({"ok": resolved})
