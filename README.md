# PC Repair Agent

PC Repair Agent 是一款面向 PC 维修、装机、运维和普通用户故障修复场景的智能维修 Agent 工具。项目通过 Tauri 桌面 UI、Python 后台 Agent、命令审批网关和可扩展 Skill 系统，帮助用户完成硬件识别、驱动检索、运行时环境补全、系统异常诊断与修复建议。

项目当前处于原型阶段：桌面 UI 与 Tauri 壳已经落地，Python 后台、Agent Runtime、审批网关和 Skill 工作流仍在持续规划与验证中。

## 产品目标

1. 降低 PC 维修、装机和系统排障门槛。
2. 自动识别本机硬件、系统环境和缺失运行时。
3. 优先从官方来源搜索和下载驱动、运行时组件。
4. 对删除、系统修改、驱动安装、注册表修改等高风险操作进行审批。
5. 通过 Skill 系统沉淀可复用的维修工作流。
6. 为后续切换或并行评估 nanobot-sdk 与 codex-sdk 预留运行时适配层。

## 核心能力规划

| 能力 | 说明 |
|------|------|
| 工作台 | 展示系统版本、设备型号、CPU、GPU、主板、内存、磁盘、驱动健康状态和推荐操作 |
| 设备与系统扫描 | 收集 Windows 版本、设备品牌型号、BIOS、CPU、GPU、网卡、声卡、蓝牙、运行时和系统日志摘要 |
| 驱动下载安装 | 识别硬件并优先从 NVIDIA、AMD、Intel 或 OEM 官网查找适配驱动 |
| 笔记本驱动工作流 | 针对 Lenovo、Dell、HP、ASUS、Acer、MSI 等品牌优先匹配整机厂商支持页面 |
| 运行时环境补全 | 检测并补齐 VC++、.NET、DirectX、WebView2、Java 等常见运行时 |
| 智能疑难诊断 | 根据用户自然语言描述收集上下文，生成原因排序、修复计划和下一步建议 |
| 命令审批中心 | 对中高风险操作展示目的、影响范围、风险点、回滚方式和用户确认入口 |
| 审计日志 | 记录 Agent 建议、用户确认结果、执行命令、输出摘要、状态和回滚建议 |

## 安全原则

PC Repair Agent 的核心原则是：Agent 可以提出自动化方案，但不能无审查地执行高风险操作。

高风险操作包括但不限于：

1. 删除、移动或覆盖重要文件。
2. 修改系统环境变量、注册表、服务、启动项、计划任务或防火墙。
3. 安装、卸载或更新驱动。
4. 下载后直接执行安装器。
5. 调整分区、格式化磁盘、修改启动配置或 BitLocker 相关设置。

执行前应向用户展示命令或操作、目的、影响范围、风险点、是否可回滚、备份或还原建议，并在用户确认后才允许继续。

## 技术架构

```text
Tauri Desktop App
  - Web UI: React + Vite + TypeScript
  - Rust Core: 权限网关、命令审批、进程管理、自动更新、sidecar 管理

Python Agent Backend
  - Agent Runtime Adapter
  - nanobot-sdk Adapter
  - codex-sdk Adapter
  - Skill Runner
  - 硬件识别、驱动搜索、运行时检测、诊断编排

Execution Gateway
  - 命令风险分级
  - 用户审批
  - 管理员权限执行
  - 审计日志
```

当前已落地目录：

| 路径 | 说明 |
|------|------|
| `ui/` | React + Vite 前端 UI，使用 `streamdown` 渲染 assistant Markdown |
| `src-tauri/` | Tauri 2 桌面壳，负责桌面窗口和本地能力集成 |
| `backend/` | Python nanobot 后台，使用 uv 管理依赖，提供本地 NDJSON 流式接口 |
| `docs/` | 产品需求、架构设计、开发流程、UI 开发、nanobot 调研和专项设计文档 |
| `demo/` | nanobot 命令行 demo 与验证入口 |
| `scripts/` | 本地开发、Tauri 启动和辅助脚本 |

## 快速开始

安装前端依赖：

```powershell
npm install --prefix ui
```

同步 Python backend 依赖：

```powershell
npm run backend:sync
```

构建前端：

```powershell
npm run ui:build
```

启动 Tauri 开发环境：

```powershell
npm run tauri:dev:win
```

Windows 一键开发启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

只启动前端浏览器调试：

```powershell
npm run ui:dev
```

只启动 Python backend：

```powershell
npm run backend:dev
```

完整环境依赖、启动流程和排错说明见 `docs/UI_DEVELOPMENT.md`。

## 文档入口

| 路径 | 用途 |
|------|------|
| `docs/PRD.md` | 产品定位、核心功能、MVP 范围和路线规划 |
| `docs/ARCHITECTURE.md` | Tauri、Python 后台、Agent Runtime、审批网关等架构设计 |
| `docs/PROJECT_STRUCTURE.md` | 项目目录结构规划和职责边界 |
| `docs/UI_DEVELOPMENT.md` | UI 与 Tauri 桌面壳开发、启动和排错说明 |
| `docs/DEVELOPMENT_WORKFLOW.md` | 分支开发、合并、版本升级和发布流程 |
| `docs/UI_NANOBOT_INTEGRATION_DESIGN.md` | UI 去 mock、接入 nanobot 后台和流式事件设计 |
| `docs/NANOBOT_SDK_RESEARCH.md` | nanobot SDK 流式输出、审批、自定义 Tool 和 Skill 注入调研 |
| `demo/README.md` | nanobot 命令行 demo 使用说明 |

## 协作流程

项目长期保留 `dev` 和 `master` 两个主干分支：

1. `dev` 是集成测试分支，用于汇总功能、修复和性能优化分支。
2. `master` 是稳定发布分支，仅管理员可将 `dev` 合入 `master`。

多人协作开发时，请先从最新 `dev` 创建个人工作分支：

```powershell
git switch dev
git pull
git switch -c feat/ui-0708-setting-page
```

分支命名格式：

```text
<type>/<scope>-<MMdd>-<name>
```

示例：

```text
feat/ui-0708-setting-page
fix/backend-0708-stream-error
perf/scan-0708-cache
```

功能开发、Bug 修复或性能优化完成后，在个人分支内提交 Pull Request 至 `dev`。`dev` 至 `master` 的发布合并仅由管理员操作。

## 当前阶段

MVP 阶段重点：

1. 完成 Tauri + Python sidecar 基础通信。
2. 完成硬件和系统信息扫描。
3. 完成命令风险分级和审批中心。
4. 完成运行时检测原型。
5. 完成显卡驱动检索原型。
6. 展示 Skill 列表和 Skill 执行状态。

更完整的产品范围、非目标、成功指标、风险和路线图见 `docs/PRD.md`。
