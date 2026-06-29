# PC Repair Agent - Agent 协作规范

本文件面向所有参与本仓库工作的 AI Coding Agent 和开发者。项目主体代码尚未正式搭建，因此当前只记录通用协作规则、文档入口、提交规范和文件编码要求；具体启动方式、模块职责和实现细节以后随项目落地再补充。

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
| `docs/NANOBOT_SDK_RESEARCH.md` | nanobot SDK 调研记录，包含流式输出、工具审批、自定义 Tool、Skill 注入和配置建议 |
| `demo/README.md` | nanobot 命令行 demo 使用说明 |

阅读建议：

1. 做产品需求相关任务，先读 `docs/PRD.md`。
2. 做架构和模块边界相关任务，先读 `docs/ARCHITECTURE.md` 和 `docs/PROJECT_STRUCTURE.md`。
3. 做 nanobot、Skill、Tool、审批流相关任务，先读 `docs/NANOBOT_SDK_RESEARCH.md`。
4. 做 demo 相关任务，先读 `demo/README.md` 和 `demo/pyproject.toml`。

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

项目主体代码尚未正式搭建，当前阶段不要在 `AGENTS.md` 中写死具体启动方式、端口、服务名称或模块实现细节。等 `ui/`、`backend/`、`src-tauri/` 等主体结构落地后，再补充对应的开发、启动和测试说明。

