from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pc_agent_backend.agents.risk import RiskLevel, risk_level
from pc_agent_backend.services.security_settings import CommandPermissionMode


PermissionAction = Literal["allow", "ask", "deny"]


@dataclass(frozen=True)
class PermissionDecision:
    action: PermissionAction
    risk: RiskLevel
    mode: CommandPermissionMode
    reason: str


class RepairPermissionFilter(Protocol):
    def evaluate(self, *, tool_name: str, arguments: dict[str, Any], risk: RiskLevel) -> PermissionDecision | None:
        ...


class DefaultRepairPermissionFilter:
    """Default repair-mode filter placeholder.

    Replace this with a project-specific filter when repair workflows gain
    richer command semantics. The default keeps high-risk actions visible.
    """

    def evaluate(self, *, tool_name: str, arguments: dict[str, Any], risk: RiskLevel) -> PermissionDecision | None:
        if risk == "blocked":
            return PermissionDecision(
                action="deny",
                risk=risk,
                mode="repair",
                reason="维修模式过滤器判定该工具调用命中禁止策略。",
            )
        if risk in {"low", "medium"}:
            return PermissionDecision(
                action="allow",
                risk=risk,
                mode="repair",
                reason="维修模式过滤器允许低中风险维修工具调用自动执行。",
            )
        return PermissionDecision(
            action="ask",
            risk=risk,
            mode="repair",
            reason="维修模式过滤器要求高风险维修工具调用先由用户确认。",
        )


class ToolPermissionPolicy:
    def __init__(self, *, repair_filter: RepairPermissionFilter | None = None) -> None:
        self._repair_filter = repair_filter or DefaultRepairPermissionFilter()

    def evaluate(
        self,
        *,
        mode: CommandPermissionMode,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
    ) -> PermissionDecision:
        risk = risk_level(tool_name, arguments or {})

        if mode == "repair":
            decision = self._repair_filter.evaluate(
                tool_name=tool_name,
                arguments=arguments or {},
                risk=risk,
            )
            if decision is not None:
                return decision
            mode = "auto"

        if risk == "blocked":
            return PermissionDecision(
                action="deny",
                risk=risk,
                mode=mode,
                reason="该工具调用命中禁止策略，不能自动或手动执行。",
            )
        if mode == "ask":
            return PermissionDecision(
                action="allow" if risk == "low" else "ask",
                risk=risk,
                mode=mode,
                reason=(
                    "用户审批模式自动允许低风险工具调用。"
                    if risk == "low"
                    else "当前为用户审批模式，中高风险工具调用需要确认。"
                ),
            )
        if mode == "auto":
            return PermissionDecision(
                action="ask" if risk == "high" else "allow",
                risk=risk,
                mode=mode,
                reason=(
                    "自动审批模式要求高风险工具调用先由用户确认。"
                    if risk == "high"
                    else "自动审批模式允许低中风险工具调用自动执行。"
                ),
            )
        return PermissionDecision(
            action="allow",
            risk=risk,
            mode="full",
            reason="完全允许模式放行非禁止工具调用。",
        )
