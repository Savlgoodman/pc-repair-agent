# 项目目录结构设计

本文档定义 PC Repair Agent 的目标仓库结构。当前只作为规划文档，不代表这些目录都需要立即创建。

## 根目录结构

```text
PC-agent/
  docs/
  ui/
  src-tauri/
  backend/
  skills/
  packages/
  scripts/
  tests/
  assets/
  .gitignore
```

## 目录职责

### `docs/`

产品和工程文档。

规划文件：

```text
docs/
  PRD.md
  ARCHITECTURE.md
  PROJECT_STRUCTURE.md
  ADR/
```

`ADR/` 用于保存架构决策记录。当某个技术选择足够重要，例如“为什么选择 stdio JSON-RPC 而不是 HTTP”，就可以写一篇 ADR。

### `ui/`

桌面前端 UI 源码目录。

建议结构：

```text
ui/
  src/
    app/
    components/
    features/
      dashboard/
      scan/
      skills/
      approvals/
      audit/
      settings/
      agent-chat/
    lib/
    styles/
  public/
  package.json
  tsconfig.json
  vite.config.ts
```

职责：

1. 主工作台。
2. Skill 卡片和执行进度。
3. 命令审批弹窗。
4. Agent 对话界面。
5. 扫描结果展示。
6. 审计日志查看器。

### `src-tauri/`

Tauri 应用外壳和 Rust 执行网关目录。

建议结构：

```text
src-tauri/
  src/
    main.rs
    commands/
    gateway/
      risk_classifier.rs
      executor.rs
      approvals.rs
      audit.rs
    sidecar/
      backend_process.rs
      protocol.rs
    config/
  capabilities/
  tauri.conf.json
  Cargo.toml
```

职责：

1. 暴露给 UI 的 Tauri 命令。
2. Python sidecar 生命周期管理。
3. 结构化操作校验。
4. 风险分级。
5. 高风险审批流程。
6. 本地命令执行。
7. 审计日志持久化。

### `backend/`

Python Agent 后台目录，最终会作为 sidecar 随 Tauri 应用分发。

建议结构：

```text
backend/
  pc_agent/
    __init__.py
    main.py
    protocol/
    agent_runtime/
      base.py
      nanobot_adapter.py
      codex_adapter.py
      registry.py
    skills/
      loader.py
      runner.py
      manifest.py
    system/
      hardware.py
      drivers.py
      runtimes.py
      os_info.py
      logs.py
    planning/
    downloads/
    security/
    storage/
  tests/
  pyproject.toml
```

职责：

1. Agent 编排。
2. Agent Runtime Adapter 选择。
3. Skill 加载和执行。
4. 硬件与系统扫描。
5. 驱动和运行时来源发现。
6. 维修计划生成。
7. 进度事件流式返回。

### `skills/`

第一方 Skill 包目录。

建议结构：

```text
skills/
  driver-auto-install/
    skill.json
    README.md
  laptop-oem-driver/
    skill.json
    README.md
  runtime-completion/
    skill.json
    README.md
  smart-diagnostics/
    skill.json
    README.md
```

每个 Skill 应声明：

1. Skill ID。
2. 展示名称。
3. 描述。
4. 版本。
5. 所需权限。
6. 支持平台。
7. 风险类别。
8. 入口点。

示例 manifest：

```json
{
  "id": "runtime-completion",
  "name": "运行时环境补全",
  "version": "0.1.0",
  "platforms": ["windows"],
  "permissions": ["system.read", "download.file", "installer.run"],
  "riskCategories": ["medium", "high"],
  "entry": "runtime_completion"
}
```

### `packages/`

跨层共享协议和生成类型目录。

建议结构：

```text
packages/
  protocol/
    schema/
    typescript/
    python/
    rust/
```

可能用途：

1. 共享 JSON Schema。
2. 操作定义。
3. 事件定义。
4. Skill manifest schema。
5. 生成 TypeScript、Python 或 Rust 类型。

### `scripts/`

开发自动化脚本目录。

建议结构：

```text
scripts/
  dev/
  build/
  package/
  verify/
```

可能脚本：

1. 启动 UI 和后台开发环境。
2. 构建 Python sidecar。
3. 打包 Tauri 应用。
4. 校验 Skill manifest。
5. 运行 lint 和测试。

### `tests/`

跨层集成测试和测试夹具目录。

建议结构：

```text
tests/
  fixtures/
  integration/
  e2e/
```

单元测试应尽量靠近具体实现。根目录 `tests/` 主要放跨模块、跨语言或端到端测试。

### `assets/`

产品静态资源目录。

建议结构：

```text
assets/
  icons/
  branding/
  screenshots/
```

不要把下载的驱动、运行时安装包或用户机器扫描数据放在这里。

## 运行时数据

运行时数据不应提交到 git。

预期本地运行时目录：

```text
data/
downloads/
driver-cache/
runtime-cache/
audit-logs/
logs/
```

这些路径已经被 `.gitignore` 忽略。

## 初始目录创建策略

推荐第一阶段按这个顺序创建实际目录：

1. 用选定的前端框架创建 `ui/`。
2. 通过 Tauri 初始化工具创建 `src-tauri/`。
3. 创建 `backend/pc_agent/`，先放最小 sidecar 入口。
4. 在深度连接 UI 和后台前，先创建 `packages/protocol/schema/`。
5. 在实现完整 Skill 逻辑前，先创建 `skills/` manifest。

这样仓库会保持清晰，同时避免过早实现不稳定的业务代码。

