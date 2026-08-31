# 为 EasyMove 做贡献

感谢你愿意帮助 EasyMove 变得更好。

## 开始之前

1. 搜索现有 Issue，确认问题或建议尚未被记录。
2. Bug 报告请写明操作系统、EasyMove 版本、复现步骤、预期结果和实际结果。
3. 涉及文件删除、覆盖、跨磁盘移动或权限处理的改动，请在 PR 中说明失败恢复策略。

## 开发流程

`main` 只保留已验证的稳定状态。请从最新 `main` 创建 `feat/<name>`、`fix/<name>`、`docs/<name>` 或 `release/<version>` 分支，通过 Pull Request 合并，不直接向 `main` 提交日常开发改动。

```bash
npm ci
npm run check
npm start
```

提交 Pull Request 前：

- 保持一次 PR 只解决一个清晰问题
- 说明风险等级、受影响平台和实际验证结果
- 在 macOS 或 Windows 上手动验证受影响的文件操作
- 不提交个人路径、测试文件、签名证书、构建产物或 `node_modules`
- 新增界面元素时检查三个主题、单/双/四窗格以及窄窗口
- 新增依赖时解释用途，并优先选择维护活跃、许可证兼容的项目

## 提交信息

建议使用简洁的祈使句，例如：

```text
Fix cross-volume move cleanup
Add keyboard focus indicator
```

提交贡献即表示你确认自己有权提交该内容，并同意按本项目的 MIT License 发布相关代码。EasyMove 品牌识别不随代码贡献自动授权，详见 [TRADEMARKS.md](TRADEMARKS.md)。
