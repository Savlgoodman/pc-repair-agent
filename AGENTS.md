# PC Repair Agent - Agent 协作规范

本文件面向所有参与本仓库工作的 AI Coding Agent 和开发者。当前 UI 与 Tauri 桌面壳已进入原型阶段，Python 后台、Agent Runtime 和审批网关等模块仍在规划与验证中。本文件只记录高频协作规则、文档入口、简要启动入口、提交规范和文件编码要求；完整实现细节统一沉淀到 `docs/` 下的专项文档。

## AI Coding 规范

所有 AI Coding Agent 必须遵守以下规则：

1. **UTF-8 编码**：读取、写入、修改任何代码文件和文档文件时，必须显式使用 UTF-8 编码，避免中文内容乱码。
2. **保护用户改动**：修改文件前先检查工作区状态，不覆盖、不回退用户已有改动；遇到不属于当前任务的改动，保持原样。
3. **禁止写入敏感信息**：不要把 API Key、Token、账号密码、私钥等敏感信息写入仓库文件；配置文件只保留环境变量占位或示例值。
4. **禁止 Emoji**：代码、注释、提交信息、文档和用户可见文案中不使用 emoji 表情。
5. **禁止擅自启动长期进程**：未经用户明确要求，不自行后台启动前端、后端、数据库、Agent 服务或其他长期运行进程。
6. **优先阅读文档**：开始涉及需求、架构、nanobot、demo 或目录设计的任务前，先阅读本文件和相关 `docs/` 文档。
7. **小步修改**：每次改动尽量围绕一个明确目标，不做无关重构，不顺手格式化无关文件。
8. **可验证优先**：能用脚本、命令或静态检查验证的改动，应在完成后执行验证，并在回复中说明结果。

对任意 Agent：请记住，本项目中任何文档和代码都必须以 UTF-8 的方式读取和写入。

## 文件编码要求

本项目包含大量中文文档，所有工具操作都必须注意编码。

PowerShell 读取文件时建议：

```powershell
Get-Content -Encoding UTF8 .\docs\PRD.md
```

PowerShell 写入文件时必须显式指定 UTF-8：

```powershell
Set-Content -Encoding UTF8 .\path\to\file.md $content
```

Python 读写文件时必须显式指定编码：

```python
Path("docs/PRD.md").read_text(encoding="utf-8")
Path("docs/PRD.md").write_text(content, encoding="utf-8")
```

手动编辑文件时，也应确认编辑器保存编码为 UTF-8。

## 文档入口

当前主要文档如下：

| 路径 | 用途 |
|------|------|
| `docs/PRD.md` | 产品需求文档，记录产品定位、核心功能、MVP 范围和路线规划 |
| `docs/ARCHITECTURE.md` | 架构设计文档，记录 Tauri、Python 后台、Agent Runtime、审批网关等设计方向 |
| `docs/PROJECT_STRUCTURE.md` | 项目目录结构规划，记录未来代码目录和职责边界 |
| `docs/UI_DEVELOPMENT.md` | UI 与 Tauri 桌面壳开发文档，记录环境依赖、启动流程、目录职责和常见问题 |
| `docs/DEVELOPMENT_WORKFLOW.md` | 开发流程规范，记录 dev 集成、分支命名、master 使用范围、变基合并和版本升级要求 |
| `docs/UI_NANOBOT_INTEGRATION_DESIGN.md` | UI 去 mock、接入 nanobot Python 后台和 streamdown Markdown 渲染的设计文档 |
| `docs/NANOBOT_SDK_RESEARCH.md` | nanobot SDK 调研记录，包含流式输出、工具审批、自定义 Tool、Skill 注入和配置建议 |
| `demo/README.md` | nanobot 命令行 demo 使用说明 |

阅读建议：

1. 做产品需求相关任务，先读 `docs/PRD.md`。
2. 做架构和模块边界相关任务，先读 `docs/ARCHITECTURE.md` 和 `docs/PROJECT_STRUCTURE.md`。
3. 做 UI、Tauri 桌面壳、前端交互和启动环境相关任务，先读 `docs/UI_DEVELOPMENT.md`。
4. 做 UI 去 mock、接入 nanobot、流式事件、审批闭环和 Markdown 渲染相关任务，先读 `docs/UI_NANOBOT_INTEGRATION_DESIGN.md`。
5. 做 nanobot、Skill、Tool、审批流相关任务，先读 `docs/NANOBOT_SDK_RESEARCH.md`。
6. 做 demo 相关任务，先读 `demo/README.md` 和 `demo/pyproject.toml`。
7. 做功能开发、Bug 修复、性能优化、重构或发布合并前，先读 `docs/DEVELOPMENT_WORKFLOW.md`。

## 开发与启动入口

当前已落地的桌面 UI 原型由 `ui/`、`src-tauri/` 和 `backend/` 组成：

1. `ui/`：React + Vite 前端 UI，使用 `streamdown` 渲染 assistant Markdown，当前由 backend 流式事件驱动消息。
2. `src-tauri/`：Tauri 2 桌面壳，默认窗口为 `1200x756`，最小窗口为 `900x620`。
3. `backend/`：Python nanobot 后台，使用 uv 管理依赖，提供本地 NDJSON 流式接口。
4. `scripts/dev-tauri.ps1`：Windows 本地开发启动脚本，会临时设置 VS Build Tools、Cargo PATH 和代理环境。

常用命令：

```powershell
npm install --prefix ui
npm run backend:sync
npm run ui:build
npm run tauri:dev:win
```

Windows 一键开发启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

如只需要启动前端浏览器调试：

```powershell
npm run ui:dev
```

如只需要单独启动 Python backend：

```powershell
npm run backend:dev
```

如需要自定义代理端口，可直接调用脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-tauri.ps1 -Proxy http://127.0.0.1:7899
```

完整开发步骤、环境依赖、排错说明和 UI 结构说明见 `docs/UI_DEVELOPMENT.md`。

## 分支开发流程

项目长期保留 `master` 和 `dev` 两个主干分支：

1. `master`：稳定发布分支，只保留发布级合并、版本升级和用户明确授权的紧急修正。
2. `dev`：集成测试分支，用于在合并到 `master` 前汇总功能分支、修复分支和性能优化分支，并完成合并测试。

功能开发、Bug 修复、性能优化、重构和测试补充等改动，必须从 `dev` 新建分支进行，不直接在 `master` 上开发。文档修改、参数配置、流程说明等小幅度改动允许直接在 `dev` 上修改和提交。

分支命名格式：

```text
<type>/<scope>-<MMdd>-<name>
```

示例：

```text
feat/settings-0630-model-provider
fix/backend-0630-sidecar-lifecycle
perf/overview-0630-cache
```

`master` 分支只保留以下操作：

1. 合并已经在 `dev` 完成集成验证的内容。
2. 合并后进行版本升级提交。
3. 用户明确授权的紧急文档或流程修正。

所有合并尽量采用变基合并：功能分支先 `rebase dev`，再快进合并到 `dev`；`dev` 达到可发布状态后先完成集成验证，再快进合并到 `master`。如 `dev` 与 `master` 分叉，应先 `git rebase master`，再 `git merge --ff-only dev`。

每次 `dev` 合并到 `master` 后，必须立即进行一次独立版本升级提交。版本升级使用统一入口，例如 `npm run version:set -- 0.1.3` 或修改 `VERSION` 后运行 `npm run version:sync`。版本提交只包含版本相关文件，不混入功能代码。

完整流程见 `docs/DEVELOPMENT_WORKFLOW.md`。

## 提交规范

提交信息使用 Conventional Commits 格式：

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat:` | 新功能 | `feat: 增加命令审批原型` |
| `fix:` | 修复问题 | `fix: 修复 demo 配置路径错误` |
| `docs:` | 文档变更 | `docs: 更新 nanobot 调研记录` |
| `refactor:` | 重构 | `refactor: 调整 Agent 适配层结构` |
| `test:` | 测试相关 | `test: 添加工具注册验证脚本` |
| `chore:` | 构建、依赖、工具链 | `chore: 初始化 uv 项目配置` |
| `style:` | 纯格式调整 | `style: 统一 Markdown 表格格式` |
| `perf:` | 性能优化 | `perf: 优化硬件扫描缓存逻辑` |

提交规则：

1. 主语使用中文，简洁描述变更内容。
2. 一个提交对应一个清晰目标，避免把无关改动混在一起。
3. 提交前检查 `git status --short`，确认没有误加临时文件或敏感文件。
4. 不提交本地密钥、缓存、虚拟环境、日志、下载文件和运行时生成文件。
5. 如用户没有要求提交，Agent 不应主动创建 git commit。

## 敏感信息与本地文件

以下内容不得提交：

1. API Key、Token、账号密码、私钥。
2. `.env`、本地配置、真实用户数据。
3. Python 虚拟环境、Node 依赖、Rust 编译产物。
4. 日志、下载缓存、驱动缓存、运行时 session。
5. 包含真实机器信息或用户隐私的诊断报告。

配置文件应提供示例模板，例如：

```text
config.example.json
.env.example
```

真实配置应使用 `.gitignore` 排除。

## 当前阶段约束

当前 UI 与 Tauri 桌面壳已进入原型阶段，`AGENTS.md` 只保留高频入口和协作规范；详细设计、启动流程、排错步骤和模块说明应写入 `docs/` 下的专项文档。后续 Python 后台、Agent Runtime、审批网关等模块落地后，也应优先补充对应专项文档，再在本文件中加入简要入口。
