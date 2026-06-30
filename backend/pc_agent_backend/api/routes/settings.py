from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tomllib
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pc_agent_backend.api.dependencies import get_services
from pc_agent_backend.core.process_utils import run_hidden
from pc_agent_backend.core.paths import REPO_ROOT
from pc_agent_backend.services.runtime import AppServices
from pc_agent_backend.version import APP_VERSION, BACKEND_VERSION


router = APIRouter()


def _format_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    amount = float(max(0, size))
    unit_index = 0
    while amount >= 1024 and unit_index < len(units) - 1:
        amount /= 1024
        unit_index += 1

    if amount >= 10 or unit_index == 0:
        return f"{amount:.0f} {units[unit_index]}"
    return f"{amount:.1f} {units[unit_index]}"


def _directory_size(path: Path) -> int:
    if not path.exists():
        return 0

    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def _read_json_version(path: Path) -> str:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "待检测"
    return str(payload.get("version") or "待检测")


def _read_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    temp_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp_path.replace(path)


def _read_pyproject_version(path: Path) -> str:
    try:
        payload = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return "待检测"
    return str(payload.get("project", {}).get("version") or "待检测")


def _run_git(args: list[str], workspace: Path) -> str:
    try:
        result = run_hidden(
            ["git", *args],
            cwd=workspace,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return "待检测"

    if result.returncode != 0:
        return "待检测"
    return result.stdout.strip() or "待检测"


def _sanitize_remote(remote: str) -> str:
    if remote == "待检测":
        return remote

    parsed = urlparse(remote)
    if not parsed.netloc or "@" not in parsed.netloc:
        return remote

    host = parsed.netloc.rsplit("@", 1)[-1]
    return urlunparse((parsed.scheme, host, parsed.path, parsed.params, parsed.query, parsed.fragment))


def _collect_about_info(services: AppServices) -> dict[str, Any]:
    runtime_config = services.runtime_config
    data_sections = [
        ("配置", runtime_config.config_dir),
        ("会话记录", runtime_config.record_dir),
        ("日志", runtime_config.logs_dir),
        ("缓存", runtime_config.cache_dir),
    ]
    section_usage = []
    for label, path in data_sections:
        size = _directory_size(path)
        section_usage.append({
            "label": label,
            "path": str(path),
            "bytes": size,
            "size": _format_bytes(size),
        })

    total_size = _directory_size(runtime_config.data_dir)
    workspace = services.workspace
    remote = _sanitize_remote(_run_git(["config", "--get", "remote.origin.url"], workspace))
    app_version = os.environ.get("REPAIR_AGENT_APP_VERSION") or _read_json_version(REPO_ROOT / "package.json")
    if app_version == "待检测":
        app_version = APP_VERSION
    backend_version = os.environ.get("REPAIR_AGENT_BACKEND_VERSION") or _read_pyproject_version(
        REPO_ROOT / "backend" / "pyproject.toml"
    )
    if backend_version == "待检测":
        backend_version = BACKEND_VERSION

    return {
        "appVersion": app_version,
        "backendVersion": backend_version,
        "runtimeEnv": runtime_config.env or "默认",
        "agentAdapter": runtime_config.agent_adapter,
        "workspace": str(workspace),
        "dataDir": str(runtime_config.data_dir),
        "dataDirBytes": total_size,
        "dataDirSize": _format_bytes(total_size),
        "git": {
            "remote": remote,
            "branch": _run_git(["branch", "--show-current"], workspace),
            "commit": _run_git(["rev-parse", "--short", "HEAD"], workspace),
        },
        "dataUsage": section_usage,
    }


def _model_endpoint_candidates(base_url: str) -> list[str]:
    normalized = base_url.strip().rstrip("/")
    if not normalized:
        return []

    if normalized.endswith("/models"):
        return [normalized]

    candidates = [f"{normalized}/models"]
    if not normalized.endswith("/v1"):
        candidates.append(f"{normalized}/v1/models")
    return list(dict.fromkeys(candidates))


def _extract_model_ids(payload: Any) -> list[str]:
    data = payload.get("data") if isinstance(payload, dict) else payload
    if data is None and isinstance(payload, dict):
        data = payload.get("models")

    if isinstance(data, dict):
        data = list(data.values())

    models: list[str] = []
    if not isinstance(data, list):
        return models

    for item in data:
        if isinstance(item, str):
            model_id = item
        elif isinstance(item, dict):
            model_id = item.get("id") or item.get("name") or item.get("model")
        else:
            model_id = None

        if model_id:
            models.append(str(model_id))

    return sorted(set(models))


def _probe_models(base_url: str, api_key: str) -> dict[str, Any]:
    last_error = "无法获取模型列表"
    for endpoint in _model_endpoint_candidates(base_url):
        request = Request(
            endpoint,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
        except HTTPError as error:
            last_error = f"模型列表接口返回 {error.code}"
            continue
        except (OSError, URLError, TimeoutError, json.JSONDecodeError):
            last_error = "无法获取模型列表"
            continue

        models = _extract_model_ids(payload)
        if models:
            return {"endpoint": endpoint, "models": models}
        last_error = "模型列表为空"

    raise RuntimeError(last_error)


def _sanitize_generated_env_placeholder(config: dict[str, Any]) -> None:
    providers = config.get("providers")
    if not isinstance(providers, dict):
        return

    deepseek = providers.get("deepseek")
    if (
        isinstance(deepseek, dict)
        and deepseek.get("apiKey") == "${DEEPSEEK_API_KEY}"
        and not os.environ.get("DEEPSEEK_API_KEY")
    ):
        deepseek["apiKey"] = ""


def _save_default_model_provider(
    *,
    services: AppServices,
    base_url: str,
    api_key: str,
    model: str,
    supports_reasoning: bool,
) -> dict[str, Any]:
    config_path = services.runtime_config.nanobot_config_path
    config = _read_json_object(config_path)
    providers = config.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        config["providers"] = providers

    providers["custom"] = {
        "apiKey": api_key,
        "apiBase": base_url,
    }
    _sanitize_generated_env_placeholder(config)

    preset_id = "pcAgentDefault"
    model_preset: dict[str, Any] = {
        "label": f"PC Agent 默认模型 ({model})",
        "provider": "custom",
        "model": model,
        "maxTokens": 4096,
        "contextWindowTokens": 65536,
        "temperature": 0.1,
    }
    if supports_reasoning:
        model_preset["reasoningEffort"] = "medium"

    model_presets = config.setdefault("modelPresets", {})
    if not isinstance(model_presets, dict):
        model_presets = {}
        config["modelPresets"] = model_presets
    model_presets[preset_id] = model_preset

    agents = config.setdefault("agents", {})
    if not isinstance(agents, dict):
        agents = {}
        config["agents"] = agents
    defaults = agents.setdefault("defaults", {})
    if not isinstance(defaults, dict):
        defaults = {}
        agents["defaults"] = defaults
    defaults["modelPreset"] = preset_id
    defaults.setdefault("maxToolIterations", 20)
    defaults.setdefault("failOnToolError", True)

    tools = config.setdefault("tools", {})
    if isinstance(tools, dict):
        tools.setdefault("restrictToWorkspace", True)
        tools.setdefault("exec", {"enable": True, "timeout": 30})
        tools.setdefault("file", {"enable": True})
        tools.setdefault("web", {"search": {"enable": False}, "fetch": {"enable": False}})

    _atomic_write_json(config_path, config)
    return {
        "configPath": str(config_path),
        "model": model,
        "modelPreset": preset_id,
        "provider": "custom",
    }


@router.get("/settings/about")
async def settings_about(services: AppServices = Depends(get_services)) -> dict[str, Any]:
    return await asyncio.to_thread(_collect_about_info, services)


@router.post("/settings/model-providers/models")
async def probe_model_provider_models(payload: dict[str, Any]) -> JSONResponse:
    base_url = str(payload.get("baseUrl") or "").strip()
    api_key = str(payload.get("apiKey") or "").strip()

    if not base_url or not api_key:
        return JSONResponse({"error": "baseUrl and apiKey are required"}, status_code=400)

    try:
        result = await asyncio.to_thread(_probe_models, base_url, api_key)
    except RuntimeError as error:
        return JSONResponse({"error": str(error)}, status_code=502)

    return JSONResponse(result)


@router.post("/settings/model-providers/default")
async def save_default_model_provider(
    payload: dict[str, Any],
    services: AppServices = Depends(get_services),
) -> JSONResponse:
    base_url = str(payload.get("baseUrl") or "").strip()
    api_key = str(payload.get("apiKey") or "").strip()
    model = str(payload.get("model") or "").strip()
    supports_reasoning = bool(payload.get("supportsReasoning"))

    if not base_url or not api_key or not model:
        return JSONResponse({"error": "baseUrl, apiKey and model are required"}, status_code=400)

    result = await asyncio.to_thread(
        _save_default_model_provider,
        services=services,
        base_url=base_url,
        api_key=api_key,
        model=model,
        supports_reasoning=supports_reasoning,
    )
    return JSONResponse(result)
