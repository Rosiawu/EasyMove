# EasyMove 0.1.1 发布说明

这是 EasyMove 的首个交互修正版。

## 本次修正

- 修复点击文件后窗格被重绘、滚动位置跳回顶部的问题
- 文件选择改为原地更新，单选、`⌘` 多选与 `Shift` 连选均不会扰动当前位置
- macOS 菜单直接连接 EasyMove 文件命令，支持 `⌘C`、`⌘X`、`⌘V`、`⌘A`
- 新增 Finder 风格的 `⌥⌘V` 移动到当前窗格、`⇧⌘N` 新建文件夹、Return 重命名与 `⌘Delete` 移到废纸篓
- 主界面整体内收，四边保留 20px 不被面板遮挡的水彩画框

## 安装包

- `EasyMove-0.1.1-mac-arm64.dmg`：macOS Apple Silicon（M 系列芯片）
- `EasyMove-0.1.1-win-x64.exe`：Windows 10/11 x64 安装器

## 首次启动

两个安装包均未使用商业开发者证书签名。

- macOS：打开 DMG 并拖入“应用程序”。首次启动若受阻，在 Finder 中右键应用并选择“打开”。
- Windows：SmartScreen 出现未知发布者提示时，先核对 `SHA256SUMS.txt`，再选择“更多信息 → 仍要运行”。

## 验证摘要

- JavaScript 静态语法检查通过
- npm 依赖审计：0 个已知漏洞
- macOS DMG 镜像校验通过，应用深度签名结构校验通过
- macOS 打包应用已完成真实目录浏览、复制、重命名、移动、废纸篓、四窗格和自然声测试
- Windows NSIS 归档校验通过，内含程序确认是 x86-64
- Windows 应用在 Wine 环境中完成启动、真实目录读取和文件复制测试

Windows 安装器仍建议在真实 Windows 10/11 机器上做最终验收。已配置 GitHub Actions，公开仓库后可在原生 Windows Runner 上重新构建安装器。

## 校验文件

在终端中运行：

```bash
shasum -a 256 EasyMove-0.1.0-mac-arm64.dmg
shasum -a 256 EasyMove-0.1.0-win-x64.exe
```

输出应与 `SHA256SUMS.txt` 一致。
