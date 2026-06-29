from __future__ import annotations

from fastapi import APIRouter

from pc_agent_backend.api.routes import approvals, conversations, health, system, turns


api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(system.router)
api_router.include_router(approvals.router)
api_router.include_router(conversations.router)
api_router.include_router(turns.router)
