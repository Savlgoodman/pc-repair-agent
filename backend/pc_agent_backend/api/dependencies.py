from __future__ import annotations

from fastapi import Request

from pc_agent_backend.services.runtime import AppServices


def get_services(request: Request) -> AppServices:
    return request.app.state.services
