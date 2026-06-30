# 发布与版本更新

本文记录当前 Windows 原型阶段的版本号、打包和更新策略。

完整编译和发布步骤见 `docs/BUILD_AND_RELEASE.md`。

## 版本号

项目使用 SemVer，例如 `0.1.1`：

1. `0.1.x`：原型期修复和小功能。
2. `0.x.0`：较大功能阶段，例如新增自动更新或执行网关。
3. `x.0.0`：稳定发布后再使用。

同步版本号：

```powershell
npm run version:set -- 0.1.2
```

该脚本会同步：

1. `package.json`
2. `ui/package.json`
3. `src-tauri/tauri.conf.json`
4. `src-tauri/Cargo.toml`
5. `backend/pyproject.toml`

## 打包

Windows 安装包使用：

```powershell
npm run package:win
```

如只改了 Tauri/UI，没有改 Python backend 依赖和打包内容，可复用已有 sidecar：

```powershell
npm run package:win -- -SkipDependencySync -SkipBackendBuild
```

产物位于：

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

## 手动更新流程

当前阶段推荐手动更新：

1. 更新版本号，例如 `npm run version:set -- 0.1.2`。
2. 运行验证命令。
3. 执行 `npm run package:win`。
4. 发布新的 `.exe` 或 `.msi`。
5. 用户运行新安装包覆盖安装。

安装包会保留用户运行时数据，例如：

```text
%USERPROFILE%\.repair-agent\config
%USERPROFILE%\.repair-agent\record
%USERPROFILE%\.repair-agent\logs
%USERPROFILE%\.repair-agent\cache
```

## 自动更新规划

后续接入自动更新时，建议使用 Tauri updater：

1. 新增 `tauri-plugin-updater`。
2. 生成并保护 updater 私钥，不提交仓库。
3. 每个版本发布安装包、签名文件和更新 manifest。
4. manifest 放在稳定 HTTPS 地址，例如 GitHub Releases、对象存储或自建更新服务。
5. UI 在设置页或启动时检查更新，下载后提示用户重启安装。

自动更新上线前，需要先确定发布渠道、签名密钥保存方式和回滚策略。
