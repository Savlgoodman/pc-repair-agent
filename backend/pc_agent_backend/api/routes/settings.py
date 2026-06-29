from __future__ import annotations

import asyncio
import json
import subprocess
import tomllib
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pc_agent_backend.api.dependencies import get_services
from pc_agent_backend.core.paths import REPO_ROOT
from pc_agent_backend.services.runtime import AppServices


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


def _read_pyproject_version(path: Path) -> str:
    try:
        payload = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return "待检测"
    return str(payload.get("project", {}).get("version") or "待检测")


def _run_git(args: list[str], workspace: Path) -> str:
    try:
        result = subprocess.run(
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

    return {
        "appVersion": _read_json_version(REPO_ROOT / "package.json"),
        "backendVersion": _read_pyproject_version(REPO_ROOT / "backend" / "pyproject.toml"),
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
