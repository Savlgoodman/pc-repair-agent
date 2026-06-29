# UI 与 Tauri 桌面壳开发文档

本文记录 PC Repair Agent 当前 UI 原型、Tauri 桌面壳和 Python nanobot 后台的开发方式。当前阶段已经移除固定 mock 回复，UI 会通过 Tauri 启动本地 Python backend，并以流式事件展示 nanobot 输出。

## 当前状态

已落地的 UI 原型包含：

1. 类 Codex App 的简洁桌面布局。
2. 左侧全局会话列表，不按项目文件夹分组。
3. 主区域聊天界面、工具调用卡片、审批面板、底部输入框。
4. 新建会话、搜索会话、发送消息和 `localStorage` 状态暂存。
5. `streamdown` Markdown 渲染，用于 assistant 流式消息。
6. Python backend 基于 nanobot SDK，提供本地 HTTP NDJSON 流式接口。
7. Tauri 2 桌面壳，默认窗口 `1200x756`，最小窗口 `900x620`，支持拉伸。
8. Windows 本地开发启动脚本，自动进入 VS Build Tools 环境并设置代理。

## 目录职责

```text
.
├── package.json              # 根脚本入口
├── scripts/
│   └── dev-tauri.ps1         # Windows Tauri 开发启动脚本
├── ui/
│   ├── package.json          # 前端依赖和脚本
│   ├── vite.config.ts        # Vite 配置
│   └── src/
│       ├── App.tsx           # UI 主体
│       ├── components/       # UI 组件，例如 Markdown 消息渲染
│       ├── services/         # 前端服务适配，例如 agentClient
│       ├── styles.css        # 全局样式
│       └── types.ts          # 前端类型定义
├── backend/
│   ├── pyproject.toml        # Python backend 依赖
│   ├── uv.lock               # uv 锁文件
│   ├── config/               # nanobot 配置模板
│   └── pc_agent_backend/     # backend 源码
└── src-tauri/
    ├── Cargo.toml            # Tauri Rust 工程配置
    ├── tauri.conf.json       # Tauri 应用、窗口、构建和图标配置
    ├── icons/                # Tauri 图标资源
    └── src/                  # Rust 入口代码
```

## 环境依赖

Windows 本地开发需要：

1. Node.js 与 npm。
2. Rust stable MSVC 工具链。
3. Visual Studio Build Tools 2022，需安装 C++ Build Tools 和 Windows SDK。
4. Microsoft Edge WebView2 Runtime。现代 Windows 通常已内置。
5. uv，用于管理 Python backend 环境。
6. 如网络需要代理，可使用本机 HTTP 代理，例如 `http://127.0.0.1:7899`。

当前脚本不会修改系统级环境变量，只会在本次启动进程内临时设置：

```text
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
PATH 中的 %USERPROFILE%\.cargo\bin
```

## 安装依赖

前端依赖安装在 `ui/` 下：

```powershell
npm install --prefix ui
```

Python backend 依赖使用 uv：

```powershell
npm run backend:sync
```

根目录 `package.json` 作为统一脚本入口，当前不需要在根目录安装额外 npm 依赖。

## 启动方式

推荐一键启动开发环境：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

该脚本会用 Windows Terminal 打开单窗口多标签：

1. `backend` 标签：启动 Python backend，默认监听 `http://127.0.0.1:8765`。
2. `tauri` 标签：启动 Tauri 桌面壳，Tauri 会自动启动 Vite。

默认代理为：

```text
http://127.0.0.1:7899
```

如不需要代理：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1 -NoProxy
```

如需要指定代理：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1 -Proxy http://127.0.0.1:7899
```

推荐使用 Windows 开发启动脚本：

```powershell
npm run tauri:dev:win
```

该命令会执行以下工作：

1. 调用 Visual Studio Build Tools 的 `VsDevCmd.bat`。
2. 临时把 `%USERPROFILE%\.cargo\bin` 加入 `PATH`。
3. 设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`。
4. 启动 `npm run tauri:dev`。
5. Tauri 自动启动 Vite，再启动桌面窗口。
6. UI 首次发送消息时，Tauri 会通过 `ensure_backend` 启动 Python backend。

如需指定其他代理：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-tauri.ps1 -Proxy http://127.0.0.1:7899
```

启动成功后，开发服务器默认监听：

```text
http://127.0.0.1:1420
```

Tauri 桌面窗口标题为：

```text
PC Repair Agent
```

Python backend 默认监听：

```text
http://127.0.0.1:8765
```

开发期也可以单独启动 backend：

```powershell
npm run backend:dev
```

如果需要指定 nanobot 配置：

```powershell
uv run --project backend python -m pc_agent_backend.main --config .\demo\nanobot_config.local.json --workspace .
```

## 前端单独调试

如暂时只调 UI，不启动 Tauri：

```powershell
npm run ui:dev
```

前端开发服务器由 Vite 启动，浏览器调试时会使用同一套 React 代码，但无法覆盖 Tauri 桌面窗口能力。

## 构建与检查

前端构建检查：

```powershell
npm run ui:build
```

Tauri 后端检查可在 VS Build Tools 环境中执行：

```powershell
cd src-tauri
cargo check
```

如果普通 PowerShell 中无法识别 `cargo`，优先使用 `npm run tauri:dev:win` 或先进入 VS Build Tools 环境。

Python backend 入口检查：

```powershell
uv run --project backend python -m pc_agent_backend.main --help
```

## 窗口配置

窗口配置位于 `src-tauri/tauri.conf.json`：

```json
{
  "width": 1200,
  "height": 756,
  "minWidth": 900,
  "minHeight": 620,
  "resizable": true,
  "center": true,
  "decorations": false
}
```

当前使用自绘标题栏，因此 `decorations` 设置为 `false`。后续如果要接入系统原生标题栏，需要同步调整前端 titlebar 样式和 Tauri 窗口配置。

## 图标资源

图标资源位于 `src-tauri/icons/`。当前 `app-icon.svg` 是临时开发图标源，已生成 Tauri 需要的多尺寸图标，包括：

```text
src-tauri/icons/icon.ico
src-tauri/icons/icon.icns
src-tauri/icons/32x32.png
src-tauri/icons/128x128.png
src-tauri/icons/128x128@2x.png
```

替换品牌图标时，建议准备正方形 SVG 或 PNG，然后重新执行：

```powershell
npm exec --prefix ui -- tauri icon .\src-tauri\icons\app-icon.svg --output .\src-tauri\icons
```

## 当前 UI 数据策略

当前 UI 不再使用固定 mock 数据：

1. `ui/src/types.ts` 定义会话、消息、工具调用、审批请求和 Agent 事件类型。
2. `ui/src/services/agentClient.ts` 负责调用 Tauri `ensure_backend`，并读取 backend NDJSON 流。
3. `ui/src/components/MessageRenderer.tsx` 使用 `streamdown` 渲染 assistant Markdown。
4. `localStorage` 暂时保存会话和消息，刷新后仍能保留演示数据。
5. backend 未连接或配置缺失时，UI 会展示真实错误，不生成假回复。

后续建议把会话持久化迁移到 Tauri 或 Python backend，避免长期依赖浏览器本地存储。

## 后续集成建议

UI 与后台集成时建议优先拆分以下边界：

1. 会话存储接口：创建会话、读取会话列表、读取消息、追加消息。
2. Agent 运行接口：发送用户输入、接收流式文本、接收工具调用事件。
3. 审批接口：展示高风险命令说明、风险点、影响范围和确认结果。
4. Skill 展示接口：展示驱动安装、笔记本驱动下载、运行时补全等技能入口和执行状态。
5. 本机诊断接口：展示硬件、系统、运行时环境和驱动扫描结果。

建议先把 mock 数据替换为一层前端服务适配器，再让适配器对接 Tauri 或 Python 后台，避免 UI 组件直接绑定某个 SDK。

## 常见问题

### 端口 1420 被占用

检查占用进程：

```powershell
Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
```

如果已有旧的 Vite 或 Tauri 开发进程，需要先关闭旧进程再重启。

### 找不到 cargo

确认 Rust 已安装在当前用户目录：

```powershell
Test-Path "$env:USERPROFILE\.cargo\bin\cargo.exe"
```

如果存在但普通 PowerShell 找不到，使用：

```powershell
npm run tauri:dev:win
```

该脚本会为当前启动进程临时补充 Cargo PATH。

### 找不到 cl 或 link

说明当前 shell 不在 Visual Studio 开发者环境中。使用：

```powershell
npm run tauri:dev:win
```

脚本会自动调用 Visual Studio Build Tools 的 `VsDevCmd.bat`。

### 图标缺失导致 Windows Resource 构建失败

Tauri Windows 构建需要 `src-tauri/icons/icon.ico`。如图标文件缺失，重新生成：

```powershell
npm exec --prefix ui -- tauri icon .\src-tauri\icons\app-icon.svg --output .\src-tauri\icons
```

### 网络下载依赖失败

确认本机代理端口可用，例如 `7899`。默认启动脚本使用：

```text
http://127.0.0.1:7899
```

也可以通过 `-Proxy` 参数指定其他地址。

### backend 配置缺失

backend 默认优先读取：

```text
backend/config/nanobot_config.local.json
```

如果该文件不存在，Tauri 启动 backend 时会回退到：

```text
demo/nanobot_config.local.json
```

真实配置不提交到仓库。可以从模板复制：

```powershell
Copy-Item .\backend\config\nanobot_config.example.json .\backend\config\nanobot_config.local.json
```

API Key 使用环境变量：

```powershell
$env:DEEPSEEK_API_KEY = "你的 DeepSeek API Key"
```

### backend 端口 8765 被占用

检查占用进程：

```powershell
Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
```

如果已有旧 backend 进程，可关闭后重新启动 Tauri。

## 提交注意事项

不要提交以下内容：

1. `ui/node_modules/`
2. `ui/dist/`
3. `src-tauri/target/`
4. `backend/.venv/`
5. `.cache/`
6. 日志、临时文件、本地密钥和真实用户诊断数据。

提交前建议检查：

```powershell
git status --short
npm run ui:build
uv run --project backend python -m pc_agent_backend.main --help
```
