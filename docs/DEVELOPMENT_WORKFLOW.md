# 开发流程规范

本文记录本项目的分支开发、合并和版本升级规则。所有开发者和 AI Coding Agent 在开始功能开发、Bug 修复、性能优化或其他代码变更前，都应先确认当前分支和工作区状态。

## 分支原则

`master` 分支只保留以下操作：

1. 合并已经完成验证的特性分支。
2. 合并后进行版本升级提交。
3. 用户明确授权的紧急文档或流程修正。

除上述情况外，不应直接在 `master` 上开发新功能、修复 Bug、做性能优化或重构。

## 分支命名

开发新功能、修复 Bug、性能优化、重构和测试补充等，都必须从 `master` 新建分支。

分支命名格式：

```text
<type>/<scope>-date<MMdd>-<name>
```

字段说明：

1. `<type>` 使用提交类型风格，例如 `feat`、`fix`、`perf`、`refactor`、`test`、`docs`、`chore`。
2. `<scope>` 表示影响范围、模块或任务编号，例如 `ui`、`backend`、`tauri`、`release`。
3. `<MMdd>` 使用创建分支当天的 4 位月日，例如 6 月 30 日写作 `0630`。
4. `<name>` 使用简短英文短横线描述，避免空格、中文和特殊符号。

示例：

```text
feat/settings-0630-model-provider
fix/backend-0630-sidecar-lifecycle
perf/overview-0630-cache
refactor/release-0630-version-sync
```

## 开发流程

推荐流程：

```powershell
git switch master
git pull
git switch -c feat/settings-0630-model-provider
```

开发过程中保持小步提交，每个提交对应一个清晰目标。提交前应至少执行：

```powershell
git status --short
```

能用脚本、测试或静态检查验证的改动，应在分支内完成验证，并在合并说明中记录结果。

## 合并与版本升级

分支开发完成并验证后，合并回 `master`。合并后必须进行一次版本升级提交。

版本升级提交要求：

1. 合并特性分支后立即执行，不能跳过。
2. 使用项目统一版本入口，例如 `npm run version:set -- 0.1.3` 或修改 `VERSION` 后运行 `npm run version:sync`。
3. 版本提交只包含版本相关文件，不混入功能代码。
4. 提交信息使用 Conventional Commits，例如 `chore: 升级版本到 0.1.3`。

推荐顺序：

```powershell
git switch master
git merge --no-ff feat/settings-0630-model-provider
npm run version:set -- 0.1.3
git status --short
git add VERSION package.json ui/package.json ui/package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock backend/pyproject.toml backend/uv.lock backend/pc_agent_backend/version.py
git commit -m "chore: 升级版本到 0.1.3"
```

如使用 squash merge，也必须在 squash 提交之后追加独立版本升级提交。

## AI Agent 要求

AI Coding Agent 在接到开发、修复、优化类任务时，应先检查当前分支：

```powershell
git branch --show-current
git status --short
```

如果当前在 `master` 且任务不是版本升级、分支合并或用户明确授权的例外，应先创建符合规范的新分支再修改代码。遇到已有未提交改动时，不得擅自覆盖或回退，应先确认改动归属并保护用户工作。
