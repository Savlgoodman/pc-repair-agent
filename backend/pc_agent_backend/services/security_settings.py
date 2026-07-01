from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pc_agent_backend.core.config import RuntimeConfig
from pc_agent_backend.storage.conversations import atomic_write_json


CommandPermissionMode = Literal["ask", "auto", "full", "repair"]

VALID_PERMISSION_MODES = {"ask", "auto", "full", "repair"}
DEFAULT_PERMISSION_MODE: CommandPermissionMode = "ask"


class SecuritySettingsError(ValueError):
    pass


def read_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def normalize_security_settings(value: Any) -> dict[str, Any]:
    settings = value if isinstance(value, dict) else {}
    mode = str(settings.get("commandPermissionMode") or DEFAULT_PERMISSION_MODE).strip()
    if mode not in VALID_PERMISSION_MODES:
        mode = DEFAULT_PERMISSION_MODE
    return {
        "commandPermissionMode": mode,
        "rememberLowRiskApprovals": settings.get("rememberLowRiskApprovals", True) is not False,
        "rememberMediumRiskApprovals": bool(settings.get("rememberMediumRiskApprovals")),
        "fullAccessConfirmedAt": settings.get("fullAccessConfirmedAt"),
    }


class SecuritySettingsStore:
    def __init__(self, runtime_config: RuntimeConfig) -> None:
        self._path = runtime_config.app_config_path

    def load_config(self) -> dict[str, Any]:
        config = read_json_object(self._path)
        security = normalize_security_settings(config.get("security"))
        if config.get("security") != security:
            config["security"] = security
            atomic_write_json(self._path, config)
        return config

    def get_settings(self) -> dict[str, Any]:
        config = self.load_config()
        return {
            **normalize_security_settings(config.get("security")),
            "configPath": str(self._path),
            "availableModes": [
                {
                    "id": "ask",
                    "label": "用户审批",
                    "description": "低风险自动允许，中高风险执行前确认。",
                },
                {
                    "id": "auto",
                    "label": "自动审批",
                    "description": "低中风险自动允许，高风险执行前确认。",
                },
                {
                    "id": "full",
                    "label": "完全允许",
                    "description": "低中高风险自动允许，禁止项仍会拦截。",
                },
                {
                    "id": "repair",
                    "label": "维修模式",
                    "description": "先经过自定义维修过滤器，再决定自动允许或请求确认。",
                },
            ],
        }

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        config = self.load_config()
        security = normalize_security_settings(config.get("security"))

        if "commandPermissionMode" in patch:
            mode = str(patch.get("commandPermissionMode") or "").strip()
            if mode not in VALID_PERMISSION_MODES:
                raise SecuritySettingsError("未知的命令执行权限模式")
            security["commandPermissionMode"] = mode
            if mode != "full":
                security["fullAccessConfirmedAt"] = None
            elif patch.get("fullAccessConfirmedAt") is not None:
                security["fullAccessConfirmedAt"] = patch.get("fullAccessConfirmedAt")

        if "rememberLowRiskApprovals" in patch:
            security["rememberLowRiskApprovals"] = bool(patch.get("rememberLowRiskApprovals"))
        if "rememberMediumRiskApprovals" in patch:
            security["rememberMediumRiskApprovals"] = bool(patch.get("rememberMediumRiskApprovals"))

        config["security"] = security
        atomic_write_json(self._path, config)
        return self.get_settings()

    def command_permission_mode(self) -> CommandPermissionMode:
        settings = normalize_security_settings(self.load_config().get("security"))
        mode = str(settings["commandPermissionMode"])
        return mode if mode in VALID_PERMISSION_MODES else DEFAULT_PERMISSION_MODE  # type: ignore[return-value]
