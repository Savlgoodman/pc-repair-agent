from __future__ import annotations

from pc_agent_backend.agents.claude_code import ClaudeCodeAgentAdapter
from pc_agent_backend.agents.codex import CodexAgentAdapter
from pc_agent_backend.agents.errors import UnsupportedAgentAdapterError
from pc_agent_backend.agents.nanobot import NanobotAgentAdapter
from pc_agent_backend.core.config import RuntimeConfig
from pc_agent_backend.schemas.agent import AgentAdapter
from pc_agent_backend.services.approvals import ApprovalBroker


def create_agent_adapter(*, runtime_config: RuntimeConfig, approvals: ApprovalBroker) -> AgentAdapter:
    name = runtime_config.agent_adapter
    if name == "nanobot":
        return NanobotAgentAdapter(runtime_config=runtime_config, approvals=approvals)
    if name == "codex":
        return CodexAgentAdapter()
    if name in {"claude", "claude_code", "claudecode"}:
        return ClaudeCodeAgentAdapter()
    raise UnsupportedAgentAdapterError(f"unsupported agent adapter: {name}")
