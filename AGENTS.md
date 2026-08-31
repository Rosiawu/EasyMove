# EasyMove 协作规则

## 项目身份

- EasyMove 由吴熳（Rosiawu）创作与设计。
- 代码使用 MIT License；EasyMove 品牌识别受 `TRADEMARKS.md` 约束。
- 不要移除、模糊或替换吴熳的作者与版权声明，除非吴熳明确要求。

## Git 与 Pull Request

- `main` 始终代表已验证、可构建的稳定状态。
- 每个需求使用独立的 `feat/`、`fix/`、`docs/` 或 `release/` 分支。
- 日常开发不直接提交到 `main`；通过 PR 说明改动、风险和验证证据后合并。
- 一个 PR 只解决一个清晰问题，避免把无关重构混在功能修复中。
- 禁止强制推送或重写共享的 `main` 历史。

## 验证分级

- 所有改动：`npm run check` 和 `npm test`。
- UI、快捷键、右键菜单或文件交互：增加 `npm run test:electron` 或对应 Electron 回归。
- 窗格、预览、索引、拖放或多窗格状态：增加 `npm run test:electron:v060`。
- 删除、覆盖、跨盘移动、断点续传、外接磁盘、权限或第三方上传：除自动测试外，必须用可丢弃的测试数据完成真实环境验证。
- 没有实际验证的事项要明确说“未验证”，不得把编译、排队或中间状态说成最终成功。

## 文件安全

- 真实用户文件不用于破坏性测试。第一轮跨盘验收先测试“复制”，再测试“移动”。
- 复制先进入隐藏暂存区，核对目录结构、大小与 SHA-256 后才显示正式副本。
- 跨盘移动只在目标副本完成验证后才可删除源文件。
- 不提交个人路径、真实测试文件、日志、证书、密钥、Token、构建产物、AI 记忆或会话记录。

## UI 与产品一致性

- 保留 EasyMove 克制、通透、水彩与毛玻璃的视觉气质。
- 新增或修改 UI 时检查三个主题、单/双/四窗格、窄窗口、鼠标与键盘焦点。
- 不为了技术便利而改变用户已验收的布局、字体、色彩或交互语义。

## 版本与发布

- `package.json`、README、RELEASE_NOTES、Git tag 和 GitHub Release 版本必须一致。
- DMG、EXE、解包目录与 `node_modules` 不进入 Git 历史；可下载安装包放在 GitHub Release。
- macOS 官方安装包必须使用 Developer ID Application 签名、开启 Hardened Runtime、通过 Apple 公证、装订票据，并通过 `codesign`、`spctl` 与 `stapler` 校验。
- 未签名或未公证的 macOS 构建仅用于本机测试，不作为官方 GitHub Release 公开。
- 新版完成真实验收前保留上一个已知可用版本。
