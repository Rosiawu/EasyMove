# EasyMove 开发与发布流程

这套流程的目标是：让 `main` 始终稳定，让每次改动能独立追溯，并把文件安全风险挡在正式发布之前。

## 通俗版流程

```text
Issue / 需求
      ↓
独立功能分支
      ↓
代码 + 对应级别测试
      ↓
Pull Request 验收单
      ↓
自动检查通过后合并 main
      ↓
版本标签 + 已签名/公证安装包
      ↓
GitHub Pre-release / Release
```

## 1. 从需求创建分支

```bash
git switch main
git pull --ff-only
git switch -c feat/short-description
```

分支名示例：

- `feat/workspace-export`：新功能；
- `fix/cross-volume-resume`：Bug 修复；
- `docs/security-guide`：只改文档；
- `release/v0.7.0`：版本整理。

## 2. 按风险选择验证

| 改动 | 最低验证 |
| --- | --- |
| 文档、普通逻辑 | `npm run check` + `npm test` |
| UI、快捷键、右键菜单 | 上述检查 + `npm run test:electron` |
| 多窗格、预览、搜索、索引 | 上述检查 + `npm run test:electron:v060` |
| 删除、覆盖、跨盘移动、断点续传、权限、第三方上传 | 全部自动检查 + 可丢弃文件的真实环境验收 |

## 3. 通过 Pull Request 合并

PR 需要写清楚：

1. 这次解决什么问题；
2. 哪些平台和功能受影响；
3. 运行了哪些测试；
4. 哪些真实环境场景尚未验证；
5. UI 改动附截图，并移除个人路径与文件内容。

## 4. 版本号

- `0.6.19 → 0.6.20`：修复 Bug；
- `0.6.x → 0.7.0`：增加一组功能；
- `0.x → 1.0.0`：第一个承诺稳定的正式版本。

发布前同步更新 `package.json`、`package-lock.json`、README、RELEASE_NOTES、Git tag 与 GitHub Release。

## 5. macOS 官方发布门槛

0.6.19 的公开 DMG 等待吴熳加入 Apple Developer Program 后完成。就绪后必须：

1. 创建并安装 `Developer ID Application` 证书；
2. 开启 Hardened Runtime 并检查 Electron 所需 entitlements；
3. 签名应用及 DMG；
4. 使用 `notarytool` 提交 Apple 公证；
5. 使用 `stapler` 装订公证票据；
6. 通过 `codesign --verify`、`spctl --assess` 和 `stapler validate` 验收；
7. 生成 SHA-256，将 DMG 与校验值一起上传 GitHub Pre-release。

证书、私钥、Apple 密码、App Store Connect API 私钥和公证凭据永远不提交到 Git。
