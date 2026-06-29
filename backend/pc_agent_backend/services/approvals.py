from __future__ import annotations

import asyncio


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
