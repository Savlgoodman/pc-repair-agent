from __future__ import annotations

import asyncio
import uuid
from typing import Any

from nanobot.agent import AgentHook, AgentHookContext

from pc_agent_backend.agents.permissions import ToolPermissionPolicy
from pc_agent_backend.agents.risk import describe_risk
from pc_agent_backend.core.json_utils import to_jsonable
from pc_agent_backend.services.approvals import ApprovalBroker, ToolApprovalRejected
from pc_agent_backend.services.security_settings import SecuritySettingsStore


class UiApprovalHook(AgentHook):
    def __init__(
        self,
        *,
        conversation_id: str,
        turn_id: str,
        output_queue: asyncio.Queue[dict[str, Any]],
        approvals: ApprovalBroker,
        security_settings: SecuritySettingsStore,
        permission_policy: ToolPermissionPolicy | None = None,
    ) -> None:
        super().__init__(reraise=True)
        self._conversation_id = conversation_id
        self._turn_id = turn_id
        self._output_queue = output_queue
        self._approvals = approvals
        self._security_settings = security_settings
        self._permission_policy = permission_policy or ToolPermissionPolicy()

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        for call in context.tool_calls:
            mode = self._security_settings.command_permission_mode()
            arguments = to_jsonable(call.arguments or {})
            if not isinstance(arguments, dict):
                arguments = {}
            decision = self._permission_policy.evaluate(
                mode=mode,
                tool_name=call.name,
                arguments=arguments,
            )
            if decision.action == "allow":
                await self._output_queue.put(
                    {
                        "type": "approval.auto_decided",
                        "conversationId": self._conversation_id,
                        "turnId": self._turn_id,
                        "toolCallId": call.id,
                        "name": call.name,
                        "arguments": arguments,
                        "risk": decision.risk,
                        "permissionMode": decision.mode,
                        "decision": "allow",
                        "policyAction": decision.action,
                        "policyReason": decision.reason,
                    }
                )
                continue

            if decision.action == "deny":
                await self._output_queue.put(
                    {
                        "type": "approval.auto_decided",
                        "conversationId": self._conversation_id,
                        "turnId": self._turn_id,
                        "toolCallId": call.id,
                        "name": call.name,
                        "arguments": arguments,
                        "risk": decision.risk,
                        "permissionMode": decision.mode,
                        "decision": "deny",
                        "policyAction": decision.action,
                        "policyReason": decision.reason,
                    }
                )
                raise ToolApprovalRejected(f"权限策略拒绝执行工具：{call.name}")

            approval_id = f"approval-{uuid.uuid4().hex}"
            future = await self._approvals.create(
                approval_id=approval_id,
                conversation_id=self._conversation_id,
                turn_id=self._turn_id,
            )
            risk = describe_risk(call.name, arguments)
            await self._output_queue.put(
                {
                    "type": "approval.required",
                    "conversationId": self._conversation_id,
                    "turnId": self._turn_id,
                    "approvalId": approval_id,
                    "toolCallId": call.id,
                    "name": call.name,
                    "arguments": arguments,
                    "risk": decision.risk,
                    "permissionMode": decision.mode,
                    "policyAction": decision.action,
                    "policyReason": decision.reason,
                    **risk,
                }
            )

            allowed = await future
            if not allowed:
                raise ToolApprovalRejected(f"用户拒绝执行工具：{call.name}")
