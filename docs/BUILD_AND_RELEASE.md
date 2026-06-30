# 编译与发布

本文记录 Windows 原型阶段的本地编译、打包和发布产物整理流程。

## 环境要求

1. Node.js 与 npm。
2. Rust stable MSVC 工具链。
3. Visual Studio Build Tools 2022，包含 C++ Build Tools 和 Windows SDK。
4. uv。
5. Microsoft Edge WebView2 Runtime。

如网络需要代理，默认使用：

```powershell
http://127.0.0.1:7899
```

## 常用验证

发布前建议执行：

```powershell
npm run ui:build
uv run --project backend python -m pc_agent_backend.main --help
python -m compileall backend\pc_agent_backend
cargo check --manifest-path .\src-tauri\Cargo.toml
```

## 版本号

统一更新版本号：

```powershell
npm run version:set -- 0.1.2
```

该命令会同步根 `package.json`、`ui/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `backend/pyproject.toml`。

## 打包

完整 Windows 打包：

```powershell
npm run package:win
```

不使用代理：

```powershell
npm run package:win -- -NoProxy
```

只复用已有依赖：

```powershell
npm run package:win -- -SkipDependencySync
```

只复用已有 backend sidecar：

```powershell
npm run package:win -- -SkipDependencySync -SkipBackendBuild
```

Tauri 原始产物位于：

```text
src-tauri/target/release/
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

## 一键发布

根目录脚本 `release.ps1` 会先打包，再整理发布产物到 `dist/`：

```powershell
.\release.ps1
```

也可以通过 npm 调用：

```powershell
npm run release:win
```

如已经打包完成，只想重新整理 `dist/`：

```powershell
.\release.ps1 -SkipBuild
```

`dist/` 会包含：

```text
PC Repair Agent_<version>_x64-setup.exe
PC Repair Agent_<version>_x64_en-US.msi
pc-repair-agent.exe
pc-agent-backend.exe
```

`dist/` 是本地发布产物目录，已被 `.gitignore` 忽略，不提交到仓库。

## 发布给用户

当前阶段推荐手动分发 NSIS 或 MSI 安装包。用户安装新版本会保留运行时数据：

```text
%USERPROFILE%\.repair-agent\config
%USERPROFILE%\.repair-agent\record
%USERPROFILE%\.repair-agent\logs
%USERPROFILE%\.repair-agent\cache
```

自动更新规划见 `docs/RELEASE_AND_UPDATE.md`。
