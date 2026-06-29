# 运行时数据与聊天 UI 优化设计

本文记录权限确认卡片、工具调用卡片、运行时配置目录和消息持久化的优化方案。本文只做设计，不包含实现代码改动。

## 1. 背景

当前实现状态：

1. UI 通过 `ui/src/services/agentClient.ts` 调用 Tauri `ensure_backend`，再读取 Python backend 的 NDJSON 流。
2. `ui/src/App.tsx` 直接维护会话、消息、工具调用和审批状态。
3. 会话与消息暂存在浏览器 `localStorage`，键名为 `pc-agent-ui-state-v2`。
4. 权限确认卡片目前渲染在消息列表底部，和输入框没有形成固定关联。
5. 工具调用卡片目前直接内联展示，完成后仍展开显示一个 `pre`，且只展示参数或结果中的一种。
6. backend 默认读取 `backend/config/nanobot_config.local.json`，不存在时回退到 `demo/nanobot_config.local.json` 或示例配置。
7. `src-tauri/src/lib.rs` 中 `choose_config_path(...)` 也硬编码了同样的仓库内配置查找逻辑。

本轮目标是把用户交互和本地数据边界前移到更接近产品形态的设计：

1. 审批卡片贴齐输入框上方，减少消息区干扰。
2. 工具调用卡片支持等待确认、完成折叠、展开查看入参和结果。
3. 连续多个工具调用自动合并到一个大的折叠组。
4. 配置和消息记录不再依赖仓库内 `backend/config` 或浏览器 `localStorage`。
5. 运行时数据统一落到 data 目录，并按环境变量选择开发目录或用户目录。

## 2. 设计目标

1. 权限确认卡片成为输入前的操作确认层，位置固定、信息更短、操作更明确。
2. 工具调用既能让用户看见 Agent 正在做什么，又不会让对话区被大量 JSON 淹没。
3. 工具调用在等待审批时必须展示输入参数，避免用户在缺少上下文的情况下确认。
4. 工具完成后默认折叠，展开时同时展示入参和输出结果。
5. 连续工具调用形成工具组，组本身可折叠，降低长任务视觉复杂度。
6. 配置读取以 `REPAIR_AGENTS_ENV` 为第一入口。
7. 开发环境和正式环境使用不同 data 根目录。
8. 缺失配置时自动创建最小配置，保证首次启动可解释、可继续配置。
9. 消息记录以 JSON 文件存储到 data 目录，不再写入浏览器 storage。

非目标：

1. 本文不设计真实驱动下载、安装器执行或系统修复命令。
2. 本文不引入数据库。MVP 使用 JSON 文件即可。
3. 本文不改变 nanobot SDK 本身的审批机制。
4. 本文不要求本轮立即实现多端同步或云端备份。

## 3. 运行时数据目录

### 3.1 环境变量

运行时首先读取：

```text
REPAIR_AGENTS_ENV
```

取值约定：

| 值 | 含义 | data 根目录 |
| --- | --- | --- |
| `DEV` | 开发环境 | 当前项目根目录下的 `data/` |
| 其他或未设置 | 普通本机环境 | 当前用户家目录下的 `.repair-agent/` |

Windows 示例：

```text
REPAIR_AGENTS_ENV=DEV
H:\pc-repair-agent\data
```

普通环境示例：

```text
C:\Users\kevin\.repair-agent
```

建议 data 根目录由 Python backend 作为最终来源解析。Tauri 只负责把必要的环境变量、工作目录和可选命令行参数传给 backend，避免 Rust 和 Python 各自实现一套不一致的路径规则。

### 3.2 目录结构

推荐结构：

```text
data/
  config/
    nanobot_config.json
    app_config.json
  record/
    20260629-203012-8f4c0f6d9b8b4c6a/
      session.json
      messages.json
      events.ndjson
    20260629-204455-4fb196dfd86d4f0e/
      session.json
      messages.json
      events.ndjson
  logs/
  cache/
```

普通环境下同构到：

```text
~/.repair-agent/
  config/
  record/
  logs/
  cache/
```

说明：

1. `config/` 保存非敏感 Agent 配置，例如模型供应商、模型预设、工具开关。
2. `record/` 保存对话记录。
3. `logs/` 保存 backend 或运行时日志。
4. `cache/` 保存运行时缓存，不保存真实 API Key。
5. API Key 仍只通过环境变量或后续系统凭据存储读取。

### 3.3 最小配置自动创建

backend 启动时执行：

```text
resolve_data_dir()
ensure_data_layout()
ensure_minimal_config()
```

当 `config/nanobot_config.json` 不存在时，自动创建最小配置：

```json
{
  "providers": {
    "deepseek": {
      "apiKey": "${DEEPSEEK_API_KEY}",
      "apiBase": "https://api.deepseek.com"
    }
  },
  "modelPresets": {
    "deepseekFlash": {
      "label": "DeepSeek V4 Flash",
      "provider": "deepseek",
      "model": "deepseek-v4-flash",
      "maxTokens": 4096,
      "contextWindowTokens": 65536,
      "temperature": 0.1,
      "reasoningEffort": "none"
    }
  },
  "agents": {
    "defaults": {
      "modelPreset": "deepseekFlash",
      "maxToolIterations": 20,
      "failOnToolError": true
    }
  },
  "tools": {
    "restrictToWorkspace": true,
    "exec": {
      "enable": true,
      "timeout": 30
    },
    "file": {
      "enable": true
    },
    "web": {
      "search": {
        "enable": false
      },
      "fetch": {
        "enable": false
      }
    }
  }
}
```

注意：

1. 自动创建的配置只包含环境变量占位，不写入真实 key。
2. `backend/config/nanobot_config.example.json` 可以继续保留为仓库模板。
3. 旧的 `backend/config/nanobot_config.local.json` 可作为开发兼容入口，但不应再作为默认首选路径。
4. Tauri 的 `choose_config_path(...)` 后续应改为选择 data 目录或不再选择配置文件，让 backend 自行解析默认配置。

## 4. 消息记录存储

### 4.1 存储位置

消息记录存储到：

```text
<data-dir>/record/
```

每个会话使用一个独立文件夹：

```text
<timestamp>-<uuid>
```

示例：

```text
20260629-203012-8f4c0f6d9b8b4c6a
```

时间戳建议使用本地时间，格式为：

```text
yyyyMMdd-HHmmss
```

UUID 建议使用无连字符短形式，至少 16 位，降低路径长度和 UI 展示噪音。

### 4.2 文件格式

每个会话目录包含：

```text
session.json
messages.json
events.ndjson
```

`session.json`：

```json
{
  "id": "20260629-203012-8f4c0f6d9b8b4c6a",
  "title": "显卡驱动崩溃排查",
  "preview": "最近游戏启动后黑屏",
  "createdAt": 1782736212000,
  "updatedAt": 1782736330000,
  "status": "idle",
  "schemaVersion": 1
}
```

`messages.json`：

```json
{
  "schemaVersion": 1,
  "messages": [
    {
      "id": "user-...",
      "role": "user",
      "content": "最近游戏启动后黑屏",
      "createdAt": 1782736212000,
      "toolCalls": []
    },
    {
      "id": "assistant-...",
      "role": "assistant",
      "content": "我会先做只读检查。",
      "createdAt": 1782736213000,
      "streaming": false,
      "toolCalls": []
    }
  ]
}
```

`events.ndjson`：

```json
{"type":"agent.run.started","turnId":"turn-...","createdAt":1782736213000}
{"type":"agent.text.delta","turnId":"turn-...","delta":"我会先","createdAt":1782736213100}
```

建议：

1. `session.json` 和 `messages.json` 是 UI 恢复主数据。
2. `events.ndjson` 是调试和审计辅助数据，可以后续再接。
3. MVP 可以先实现 `session.json` 与 `messages.json`，事件日志作为第二阶段。
4. 写文件使用临时文件加原子替换，避免应用退出时写坏 JSON。

### 4.3 存储职责

推荐由 backend 提供存储 HTTP API，UI 不直接写文件：

```text
GET  /api/conversations
POST /api/conversations
GET  /api/conversations/{conversation_id}
PUT  /api/conversations/{conversation_id}/session
PUT  /api/conversations/{conversation_id}/messages
POST /api/conversations/{conversation_id}/messages
```

原因：

1. 浏览器环境不适合直接管理本地文件。
2. Tauri/Rust 也可以做存储，但当前消息流和 nanobot session 已经在 backend 侧，backend 更容易保证 `conversationId` 与 nanobot `session_key` 一致。
3. 后续打包为 sidecar 后，backend 可以继续使用同一套 data 目录。

前端新增抽象：

```text
ui/src/services/conversationStore.ts
```

接口：

```ts
interface ConversationStore {
  list(): Promise<Session[]>;
  create(input?: { title?: string }): Promise<Session>;
  load(sessionId: string): Promise<ChatMessage[]>;
  saveSession(session: Session): Promise<void>;
  saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
}
```

`App.tsx` 不再直接调用 `localStorage`，只依赖 `ConversationStore`。

## 5. 权限确认卡片

### 5.1 布局位置

权限确认卡片从消息列表底部移动到输入框上方，并与输入框同宽贴齐：

```text
chat-scroll

composer-stack
  approval-card
  composer
```

建议把当前 `.composer-wrap` 改造成底部堆叠容器：

```text
.composer-wrap
  .composer-stack
    .approval-card
    .composer
```

视觉规则：

1. 审批卡片宽度与输入框一致。
2. 审批卡片和输入框之间保持 8px 间距。
3. 审批卡片出现时，聊天滚动区底部 padding 增加，避免遮挡最后一条消息。
4. 审批卡片不进入消息历史；审批结果可以写入工具调用状态或事件日志。

### 5.2 信息简化

当前审批卡片包含用途、影响范围、回滚方式、风险列表和完整参数。新的默认展示应更短：

默认态只展示：

1. 工具名或操作名。
2. 风险等级。
3. 一句话用途。
4. 参数摘要。
5. 拒绝、允许按钮。

展开后展示：

1. 完整入参 JSON。
2. 影响范围。
3. 风险点。
4. 回滚方式。

默认态示例：

```text
需要确认：exec
高风险。Agent 准备执行可能修改本机状态的工具调用。
参数：command = "..."
[拒绝] [允许]
```

这里的参数摘要由 UI 从 `argumentsText` 中生成，规则：

1. JSON 对象展示前 1 到 3 个关键字段。
2. 字符串过长时截断到 120 字。
3. 完整 JSON 放到展开区。

### 5.3 状态变化

审批状态：

| 状态 | UI 行为 |
| --- | --- |
| `pending` | 卡片贴在输入框上方，输入框仍可编辑但发送禁用 |
| `allowing` | 允许按钮进入 loading，防止重复点击 |
| `denying` | 拒绝按钮进入 loading，防止重复点击 |
| `resolved` | 卡片消失，工具卡片状态更新 |
| `failed` | 卡片保留错误提示，可重试提交决策 |

## 6. 工具调用卡片

### 6.1 单个工具卡片

工具卡片字段：

```ts
interface ToolCallItem {
  id: string;
  name: string;
  argumentsText: string;
  resultText?: string;
  status: "pending" | "running" | "approval" | "complete" | "error";
  risk?: "low" | "medium" | "high" | "blocked";
  error?: string;
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
}
```

展示规则：

| 状态 | 默认展示 |
| --- | --- |
| `running` | 展开，展示工具名、风险、入参 |
| `approval` | 展开，展示工具名、风险、入参，并提示等待确认 |
| `complete` | 折叠，只展示工具名、状态、结果摘要 |
| `error` | 展开，展示工具名、入参和错误 |

展开内容：

```text
入参
<argumentsText>

输出
<resultText 或 error>
```

完成后默认折叠：

1. 收到 `agent.tool.completed` 后，将 `collapsed` 设为 `true`。
2. 用户点击卡片头部或 chevron 后展开。
3. 展开后必须同时展示入参和输出结果。
4. 结果过长时保留滚动区域或截断摘要，完整内容仍可展开查看。

### 6.2 等待确认时的工具参数

当前 backend 的 `approval.required` 已包含：

```json
{
  "toolCallId": "...",
  "name": "...",
  "arguments": {},
  "risk": "high"
}
```

UI 收到 `approval.required` 时必须 upsert 对应工具卡片：

1. `status = "approval"`。
2. `argumentsText = formatJson(event.arguments)`。
3. `risk = event.risk`。
4. `anchorOffset = 当前 assistant content 长度`。

审批卡片和工具卡片共享同一份入参，避免确认卡片与消息区展示不一致。

### 6.3 连续工具调用分组

为避免多个连续工具调用刷屏，新增工具组概念：

```ts
interface ToolCallGroup {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: "running" | "approval" | "complete" | "error";
  collapsed: boolean;
  toolCallIds: string[];
}
```

分组规则：

1. 按 assistant 消息内部的工具调用顺序分组。
2. 如果两个工具调用之间没有新增可见 assistant 文本，则归为同一组。
3. 如果工具调用间隔出现新的 assistant 文本，则开启新组。
4. 同一轮连续 `tool.started` / `approval.required` / `tool.completed` 事件应尽量落入同一组。

组默认行为：

| 组状态 | 默认折叠 |
| --- | --- |
| 包含 running 或 approval | 否 |
| 全部 complete | 是 |
| 包含 error | 否 |

组头折叠态只展示：

```text
已调用 3 个工具
```

展开后展示组内每个工具卡片。折叠态不展示逐个工具摘要，避免连续工具调用占用过多对话空间。

### 6.4 与流式文本锚点的关系

当前 `ToolCallItem.anchorOffset` 会把工具卡片插入 assistant Markdown 中相近位置。分组后建议保留该机制，但锚点绑定到工具组：

```text
ToolCallGroup.anchorOffset = firstTool.anchorOffset
```

这样既能保持“工具发生在文本附近”的上下文，又能避免连续工具调用逐个撑开页面。

## 7. 前后端协议调整

### 7.1 backend health

`GET /api/health` 建议增加：

```json
{
  "ok": true,
  "env": "DEV",
  "dataDir": "H:\\pc-repair-agent\\data",
  "configPath": "H:\\pc-repair-agent\\data\\config\\nanobot_config.json",
  "configExists": true,
  "apiKeyPresent": false
}
```

### 7.2 conversation API

新增 conversation API 后，UI 初始化流程改为：

```text
ensureBackend()
  -> GET /api/conversations
  -> 如果为空，POST /api/conversations 创建空会话
  -> GET /api/conversations/{id} 加载消息
```

发送消息流程：

```text
UI append user message
  -> POST /api/conversations/{id}/messages
  -> UI append assistant placeholder
  -> POST /api/conversations/{id}/messages
  -> POST /api/turns/stream
  -> 流式事件更新 assistant message
  -> 节流 PUT /api/conversations/{id}/messages
```

为了降低写入频率，建议：

1. 文本 delta 每 800ms 或 run 完成时保存一次。
2. 工具事件、审批事件、错误和完成事件立即保存。
3. 页面关闭前触发一次保存。

### 7.3 配置路径参数

后续 backend 启动参数建议从：

```text
--config <path>
```

调整为兼容：

```text
--data-dir <path>
--config <path>
```

优先级：

1. 显式 `--config`。
2. 显式 `--data-dir` 下的 `config/nanobot_config.json`。
3. `REPAIR_AGENTS_ENV=DEV` 时的 `<repo>/data/config/nanobot_config.json`。
4. 默认 `~/.repair-agent/config/nanobot_config.json`。

缺失时自动创建最小配置。

## 8. 前端改造建议

推荐拆分：

```text
ui/src/
  components/
    ApprovalCard.tsx
    ToolCallCard.tsx
    ToolCallGroup.tsx
    MessageRenderer.tsx
  services/
    agentClient.ts
    conversationStore.ts
  state/
    chatReducer.ts
  types.ts
```

`App.tsx` 保留页面组合和顶层状态，事件规约迁移到 `chatReducer.ts`：

```text
AgentEvent
  -> chatReducer
  -> messages/session/pendingApproval/toolGroups
```

迁移重点：

1. 删除 `STORAGE_KEY` 和直接 `localStorage` 调用。
2. 用 `ConversationStore` 初始化会话和消息。
3. 审批卡片从 `chat-content` 移到 `composer-wrap` 内。
4. `ToolCallCard` 支持 `collapsed`。
5. `AssistantMessageContent` 从 tool list 改为 tool group list。
6. 完成后的工具组和工具卡片默认折叠。
7. 删除对话界面底部的推荐技能按钮区，即当前 `skill-strip` 中的“硬件扫描”“驱动下载”“运行库补全”按钮。

## 9. 后端改造建议

推荐拆分：

```text
backend/pc_agent_backend/
  config.py
  storage/
    __init__.py
    conversations.py
  main.py
```

`config.py`：

1. 解析 `REPAIR_AGENTS_ENV`。
2. 解析 data 根目录。
3. 创建 `config/record/logs/cache`。
4. 创建最小 nanobot 配置。
5. 返回 `RuntimeConfig`。

`storage/conversations.py`：

1. 创建会话目录。
2. 读写 `session.json`。
3. 读写 `messages.json`。
4. 追加 `events.ndjson`。
5. 提供 JSON schema version 迁移入口。

`main.py`：

1. 启动时构造 `RuntimeConfig`。
2. `Nanobot.from_config(...)` 使用 `runtime_config.nanobot_config_path`。
3. 增加 conversation API。
4. stream turn 事件可选追加到 `events.ndjson`。

## 10. 迁移策略

### 阶段 1：设计落地但兼容旧行为

1. 新增 data dir resolver。
2. backend 自动创建 data 配置。
3. Tauri 启动 backend 时不再硬依赖仓库内 local config。
4. 继续允许显式 `--config` 覆盖，方便调试。

### 阶段 2：消息存储迁移到 backend JSON

1. 新增 conversation API。
2. UI 新增 `ConversationStore`。
3. UI 初始化从 backend 加载记录。
4. 暂时保留读取旧 `localStorage` 的一次性迁移逻辑：
   - 如果 backend record 为空且 localStorage 有旧状态，则导入到 backend。
   - 导入成功后删除旧 localStorage。

### 阶段 3：审批卡片和工具卡片优化

1. 审批卡片移到输入框上方。
2. 审批卡片默认简化，展开查看详情。
3. 工具卡片等待审批时展示入参。
4. 工具完成后默认折叠，展开展示入参和输出。
5. 连续工具调用形成工具组。

建议先做阶段 1 和阶段 2，再做阶段 3。原因是工具卡片折叠状态也属于消息 UI 状态，最好和新的消息持久化一起稳定下来。

## 11. 验收标准

### 配置与数据目录

1. `REPAIR_AGENTS_ENV=DEV` 时，backend 使用 `<repo>/data`。
2. 未设置 `REPAIR_AGENTS_ENV` 时，backend 使用 `~/.repair-agent`。
3. 缺少配置文件时自动创建 `config/nanobot_config.json`。
4. 自动创建的配置不包含真实 API Key。
5. `GET /api/health` 能返回 dataDir 和 configPath。

### 消息持久化

1. 新会话会在 `<data-dir>/record/` 下创建 `timestamp-uuid` 文件夹。
2. 刷新 UI 或重启应用后，会话列表和消息能从 JSON 恢复。
3. 浏览器 `localStorage` 不再保存主消息记录。
4. 流式输出中断时，已保存内容不会破坏 JSON 格式。

### 审批 UI

1. 审批卡片显示在输入框上方并与输入框同宽。
2. 默认态信息简洁，不展示大段 JSON。
3. 展开态能查看完整入参、影响、风险和回滚方式。
4. 等待审批期间，对应工具卡片也展示入参。
5. 对话界面最下方不再显示“硬件扫描”“驱动下载”“运行库补全”推荐技能按钮。

### 工具调用 UI

1. 工具运行中展示入参。
2. 工具完成后默认折叠。
3. 展开已完成工具时同时展示入参和输出。
4. 连续多个工具调用会合并到一个可折叠工具组。
5. 工具失败时默认展开并展示入参和错误。

## 12. 待确认问题

1. 自动创建的最小配置文件名是否确定为 `config/nanobot_config.json`，还是沿用 `nanobot_config.local.json`。
2. 普通环境目录名是否固定为 `~/.repair-agent`，还是后续需要和应用名称保持一致，例如 `~/.pc-repair-agent`。
3. `events.ndjson` 是否第一阶段就要实现，还是先只实现 `session.json` 和 `messages.json`。
4. 旧 `localStorage` 会话是否需要一次性迁移，还是可以在开发阶段直接丢弃。
5. 工具组折叠状态是否需要持久化到 `messages.json`，还是每次加载后根据工具状态重新计算。
