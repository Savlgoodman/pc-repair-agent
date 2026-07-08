# 文档中心

本文档是 `docs/` 的总入口。新增文档应按主题放入对应目录，文件使用 UTF-8 编码，不写入 API Key、Token、账号密码、私钥或真实用户数据。

## 目录分类

| 目录 | 用途 |
|------|------|
| `architecture/` | 系统边界、模块职责、长期结构、跨模块协议和目录结构 |
| `design/` | 功能设计、模块设计和实施阶段设计 |
| `refactor/` | 重构、迁移、清理、性能优化和 UI 优化方案 |
| `guides/` | 产品说明、启动说明、构建说明、发布说明和排错说明 |
| `development/` | 协作规范、分支流程、提交规范、发布合并流程和 AI Agent 工作要求 |
| `research/` | 技术调研、SDK 探针、外部资料对比、实验记录和待验证结论 |

## 当前文档

### architecture

| 路径 | 用途 |
|------|------|
| `architecture/ARCHITECTURE.md` | Tauri、Python 后台、Agent Runtime、审批网关等长期架构设计 |
| `architecture/PROJECT_STRUCTURE.md` | 项目目录结构规划和职责边界 |

### design

| 路径 | 用途 |
|------|------|
| `design/0708-UI-NANOBOT-INTEGRATION.md` | UI 去 mock、接入 nanobot Python 后台和 streamdown Markdown 渲染设计 |
| `design/0708-RUNTIME-MODEL-PROVIDER.md` | 模型供应商配置、模型选择和 nanobot 配置同步设计 |
| `design/0708-NANOBOT-COMMAND-PERMISSION.md` | nanobot 命令执行权限模式和审批切换设计 |

### refactor

| 路径 | 用途 |
|------|------|
| `refactor/RUNTIME_DATA_AND_CHAT_UI_OPTIMIZATION.md` | 运行时数据目录、消息持久化和聊天 UI 优化方案 |

### guides

| 路径 | 用途 |
|------|------|
| `guides/PRD.md` | 产品定位、核心功能、MVP 范围和路线规划 |
| `guides/UI_DEVELOPMENT.md` | UI 与 Tauri 桌面壳开发、启动和排错说明 |
| `guides/BUILD_AND_RELEASE.md` | Windows 构建、打包和发布流程 |
| `guides/RELEASE_AND_UPDATE.md` | 版本号、发布和自动更新策略 |

### development

| 路径 | 用途 |
|------|------|
| `development/DEVELOPMENT_WORKFLOW.md` | 分支开发、合并、版本升级和发布流程 |

### research

| 路径 | 用途 |
|------|------|
| `research/0708-NANOBOT-SDK-RESEARCH.md` | nanobot SDK 流式输出、审批、自定义 Tool 和 Skill 注入调研 |

## 命名规则

`design/` 文档必须使用：

```text
MMDD-MODULE-CONTENT.md
```

示例：

```text
0703-AGENT-CODEX-ACP.md
0703-RUNTIME-MODEL-PROVIDER.md
0704-REMOTE-VIEWER-SYNC.md
```

`research/` 文档必须使用：

```text
MMDD-SUBJECT-RESEARCH.md
```

示例：

```text
0703-CLAUDE-CODE-ACP-RESEARCH.md
0703-OPENCODE-ACP-RESEARCH.md
0704-CODEX-USAGE-RESEARCH.md
```
