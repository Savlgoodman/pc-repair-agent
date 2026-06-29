# PC Repair Agent 架构设计

## 1. 架构目标

PC Repair Agent 采用桌面优先的本地自动化架构。应用需要能够检查当前电脑、生成维修计划、下载官方驱动或运行时安装包，并在用户明确确认后执行高风险操作。

架构设计目标：

1. UI 保持清晰、响应快，普通用户也能理解正在发生什么。
2. Agent 推理和 Skill 工作流由 Python 后台承载，方便快速迭代。
3. 危险命令执行必须经过 Tauri/Rust 安全网关。
4. nanobot-sdk 与 codex-sdk 通过适配层隔离，便于后续切换或并行评估。

## 2. 总体架构

```text
PC Repair Agent
  |
  |-- ui/
  |     桌面 UI，使用 TypeScript 和前端框架实现。
  |
  |-- src-tauri/
  |     Tauri 外壳与 Rust 安全执行网关。
  |
  |-- backend/
  |     Python sidecar 后台，负责 Agent 编排和 Skill 执行。
  |
  |-- skills/
  |     面向用户的维修工作流，以 Skill 形式组织。
  |
  |-- docs/
  |     PRD、架构设计、目录结构和技术决策文档。
```

运行时进程模型：

```text
Tauri 应用进程
  - 承载 UI WebView。
  - 启动并管理 Python sidecar。
  - 承载命令审批交互。
  - 承载本地执行网关。

Python Agent Sidecar
  - 运行 Agent Runtime Adapter。
  - 运行 nanobot-sdk 或 codex-sdk 适配器。
  - 执行 Skill 工作流。
  - 只提出操作请求，不直接执行高风险系统操作。

Execution Gateway 执行网关
  - 对操作进行风险分级。
  - 拦截禁止操作。
  - 对高风险操作要求用户确认。
  - 执行已批准命令并记录审计日志。
```

## 3. 组件职责

### 3.1 UI 层

位置：`ui/`

职责：

1. 渲染桌面主界面。
2. 展示系统扫描结果。
3. 展示 Skill 列表和 Skill 执行状态。
4. 展示 Agent 对话和维修计划。
5. 展示命令审批弹窗。
6. 展示审计日志和操作历史。
7. 提供模型供应商、SDK 运行时选择、安全偏好等设置。

UI 不直接执行 shell 命令。UI 只向 Tauri 发送用户意图，由 Tauri 判断该请求是安全、需要确认，还是必须阻止。

### 3.2 Tauri / Rust 层

位置：`src-tauri/`

职责：

1. 打包桌面应用。
2. 启动、停止和监控 Python sidecar。
3. 提供 UI 与后台通信所需的 IPC 命令。
4. 实现 Execution Gateway 执行网关。
5. 对命令和结构化操作进行风险分级。
6. 只在必要时请求管理员权限。
7. 执行用户已批准的本地命令。
8. 保存本地配置和审计日志。
9. 在后续阶段管理自动更新和发布打包。

这一层是产品的安全边界。Python 可以请求操作，但是否允许执行、如何执行，必须由 Rust 网关决定。

### 3.3 Python 后台

位置：`backend/`

职责：

1. 承载 Agent Runtime Adapter。
2. 提供 nanobot-sdk 和 codex-sdk 适配器。
3. 运行 Skill 工作流。
4. 收集硬件、驱动、运行时和系统上下文。
5. 查询官方驱动和运行时来源。
6. 生成维修计划。
7. 向 Tauri 返回待执行操作。
8. 向 UI 流式返回进度事件。

后台应把所有会改变系统状态的行为都表达为“待执行操作”。后台不应直接删除文件、修改注册表、修改环境变量、安装驱动或运行下载后的安装器。

### 3.4 Skill 层

位置：`skills/`

职责：

1. 把维修流程定义为可发现的 Skill 包。
2. 提供 UI 展示所需的元数据。
3. 声明所需权限和风险类别。
4. 实现扫描、计划、下载、校验、提出执行请求等阶段。
5. 保持工作流逻辑可复用，不直接绑定某一个 Agent SDK。

初始 Skill：

1. `driver-auto-install`：全自动驱动下载安装。
2. `laptop-oem-driver`：笔记本 OEM 驱动下载。
3. `runtime-completion`：运行时环境补全。
4. `smart-diagnostics`：智能疑难杂症诊断。

### 3.5 Agent Runtime Adapter

位置：`backend/agent_runtime/`

项目保留 nanobot-sdk 和 codex-sdk，但产品业务逻辑不应直接依赖其中任何一个 SDK。业务层只依赖统一的运行时接口。

统一接口：

```text
AgentRuntime
  - plan(task, context)
  - run_skill(skill_id, input, context)
  - propose_actions(context)
  - request_tool_call(tool_id, args)
  - summarize(result)
```

适配器实现：

```text
backend/agent_runtime/
  base.py
  nanobot_adapter.py
  codex_adapter.py
  registry.py
```

运行时可以通过配置选择。未来可以按任务类型路由到不同运行时，但 MVP 阶段建议一次只启用一个主运行时，避免复杂度过早上升。

## 4. 安全模型

### 4.1 操作类型

Agent 和 Skill 应尽量用结构化操作表达请求，而不是直接传递原始命令字符串。

示例：

```text
ReadSystemInfo
DownloadFile
VerifySignature
RunInstaller
SetEnvironmentVariable
ModifyRegistry
DeleteFile
RestartService
CreateRestorePoint
```

Execution Gateway 在用户批准后，把结构化操作转换为平台相关命令。

### 4.2 风险等级

| 等级 | 含义 | 行为 |
| --- | --- | --- |
| 低风险 | 只读或几乎没有副作用 | 可直接执行 |
| 中风险 | 下载文件、打开工具或改变临时应用状态 | 需要提示或轻量确认 |
| 高风险 | 修改系统、驱动、注册表、环境变量、服务或启动项 | 必须明确确认 |
| 禁止 | 默认破坏性或不安全 | 默认阻止，未来可考虑专家模式 |

### 4.3 审批流程

```text
Python Skill 提出操作
  -> Tauri 接收结构化操作
  -> Execution Gateway 进行风险分级
  -> 低风险：直接执行或返回结果
  -> 中风险：展示提示或确认
  -> 高风险：展示审批弹窗，说明用途、影响、风险和回滚方式
  -> 禁止：阻止并解释原因
  -> 审计日志记录用户决策和执行结果
```

高风险审批必须包含：

1. 操作名称。
2. 精确命令或结构化操作。
3. 操作用途。
4. 影响范围。
5. 风险点。
6. 回滚或恢复方式。
7. 来源 Skill。
8. 用户决策。

## 5. 后台打包方案

Python 后台应作为 Tauri sidecar 可执行文件随应用分发。用户不需要手动安装 Python。

MVP 推荐：

1. 使用 PyInstaller `onedir` 模式，便于调试，也能减少单文件解压带来的启动问题。
2. 将生成的后台可执行程序作为 Tauri sidecar 打包。
3. Skill 元数据和静态资源可按需放在可执行文件外部。
4. 后续只有在有明确需求时，再评估 Nuitka 或更复杂的打包方案。

预期发布形态：

```text
PCRepairAgent/
  PCRepairAgent.exe
  resources/
    pc-agent-backend.exe
    skills/
    runtime/
```

## 6. 数据存储

建议本地数据分类：

1. 应用设置。
2. 运行时供应商设置。
3. 扫描快照。
4. 下载缓存。
5. 审计日志。
6. Skill 执行历史。
7. 用户对低风险行为的偏好设置。

敏感数据规则：

1. 不记录 API Key。
2. 默认不上传本机扫描数据。
3. 尽量脱敏用户名、本地路径、序列号和 token。
4. 可导出的维修报告与内部调试日志分开存储。

## 7. 通信协议

MVP 可选三种通信方式：

| 方案 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| stdio JSON-RPC | sidecar 生命周期简单，没有端口冲突 | 流式输出和调试需要设计 | MVP 推荐 |
| localhost HTTP | 易调试，接口直观 | 需要端口管理，可能遇到本地防火墙提示 | 后台 API 复杂时可选 |
| named pipe | Windows 友好，私密性更好 | 实现复杂度更高 | 生产强化阶段可考虑 |

MVP 推荐通信约定：

1. Tauri 启动 backend sidecar。
2. backend 通过 stdio 使用换行 JSON 或 JSON-RPC 通信。
3. 长任务通过进度事件回传状态。
4. 所有风险操作都返回为待审批操作。
5. Tauri 将用户审批结果发回 backend。

## 8. MVP 技术范围

MVP 应先搭结构，不急着堆复杂抽象：

1. Tauri 应用外壳。
2. Python sidecar 骨架。
3. Agent Runtime Adapter 接口。
4. nanobot-sdk 和 codex-sdk 适配器占位。
5. Skill manifest 定义。
6. 硬件扫描模块设计。
7. 运行时检测模块设计。
8. Execution Gateway 设计。
9. 审计日志格式。

真实驱动下载、安装器执行和系统修复命令，应在安全模型和通信协议稳定后再实现。

## 9. 待确认架构决策

1. 前端框架选择：React、Vue 还是 Svelte。
2. 后台通信方式：stdio JSON-RPC、localhost HTTP 还是 named pipe。
3. 初始主 Agent 运行时：nanobot-sdk 还是 codex-sdk。
4. 模型供应商策略：仅 OpenAI、多供应商，还是支持本地模型。
5. MVP 是否必须创建系统还原点。
6. 驱动安装 MVP 是仅打开官方安装器，还是支持静默安装。
7. 日志是否只保存在本地，是否支持导出维修报告。

