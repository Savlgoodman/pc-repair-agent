from __future__ import annotations

from typing import Any, Literal


RiskLevel = Literal["low", "medium", "high", "blocked"]


HIGH_RISK_TOOL_NAMES = {
    "apply_patch",
    "edit_file",
    "exec",
    "execution_gateway_request",
    "modify_registry",
    "restart_service",
    "run_installer",
    "set_environment_variable",
    "write_file",
    "write_stdin",
}

MEDIUM_RISK_TOOL_NAMES = {
    "download_candidate",
    "web_fetch",
    "web_search",
}

BLOCKED_TOOL_NAMES = {
    "disable_security_software",
    "exfiltrate_secret",
    "format_disk",
}

BLOCKED_COMMAND_PATTERNS = (
    "format ",
    "diskpart",
    "cipher /w",
    "shutdown",
    "reboot",
    "poweroff",
)


def risk_level(tool_name: str, arguments: dict[str, Any] | None = None) -> RiskLevel:
    if tool_name in BLOCKED_TOOL_NAMES:
        return "blocked"
    command = ""
    if isinstance(arguments, dict):
        command = str(arguments.get("command") or arguments.get("cmd") or "").lower()
    if tool_name == "exec" and command and any(pattern in command for pattern in BLOCKED_COMMAND_PATTERNS):
        return "blocked"
    if tool_name in HIGH_RISK_TOOL_NAMES:
        return "high"
    if tool_name in MEDIUM_RISK_TOOL_NAMES or tool_name.startswith("web_"):
        return "medium"
    return "low"


def describe_risk(tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    level = risk_level(tool_name, arguments)
    if level == "blocked":
        return {
            "purpose": "Agent 准备执行被安全策略禁止的工具调用。",
            "impact": "该操作可能造成不可恢复的系统破坏、越权访问或超出维修场景。",
            "risks": [
                "禁止操作不会被执行。",
                "如确需类似操作，应改为人工处理或设计专门的受控维修动作。",
            ],
            "rollback": "该操作已被拦截，无需回滚。",
        }
    if level == "high":
        return {
            "purpose": "Agent 准备执行可能修改本机状态的工具调用。",
            "impact": "该操作可能修改文件、执行命令、安装程序或影响系统配置。",
            "risks": [
                "参数不当可能造成文件或系统状态变化。",
                "执行失败可能让维修流程处于不完整状态。",
            ],
            "rollback": "拒绝后本轮 Agent 会中断；允许前请确认参数、来源和影响范围。",
        }
    if level == "medium":
        return {
            "purpose": "Agent 准备执行涉及网络或下载的工具调用。",
            "impact": "该操作可能访问外部资源或下载文件到本机缓存。",
            "risks": [
                "外部来源可能不可用或不可信。",
                "下载内容需要后续校验签名和来源。",
            ],
            "rollback": "拒绝后本轮 Agent 会中断；允许后仍不会自动执行高风险安装动作。",
        }
    return {
        "purpose": "Agent 准备执行只读或低风险工具调用。",
        "impact": "通常只读取信息或生成结果。",
        "risks": [],
        "rollback": "无需回滚。",
    }
