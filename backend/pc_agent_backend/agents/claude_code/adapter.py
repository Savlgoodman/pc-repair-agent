from __future__ import annotations

from pc_agent_backend.agents.placeholders import PlaceholderAgentAdapter


class ClaudeCodeAgentAdapter(PlaceholderAgentAdapter):
    def __init__(self) -> None:
        super().__init__("claude_code")
