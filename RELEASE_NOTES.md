# EasyMove 0.3.0 发布说明

这是 EasyMove 的四视图与可靠预览版本。

## 本次更新

- 顶部主题栏提供“我的”入口，可导入 PNG、JPEG 或 WebP 图片作为本地持久化主题，并在内置主题间随时切换
- 每个窗格可独立使用图标、列表、Finder 式分栏或画廊视图，选择和路径在重启后保留
- 修复空格、中文、括号、`#`、`%` 和长文件名路径下 PNG 缩略图与 hover 预览失败
- 缩略图协议直接返回受控缓存字节，错误日志区分不存在、权限、解码、协议和 Quick Look 超时
- 所有大预览使用 contain；缩略图生成按最长边等比缩放，纵向海报、横图、超长图和方图不再变形

- 强化悬停预览：失败时不再显示类型图标冒充内容
- TXT/Markdown 和 DOCX/PPTX/XLSX 生成真实内容预览卡；文件夹选择第一份可预览内容
- 保留并发限制、路径/mtime/size 缓存失效、hover token 防串项和 Quick Look 超时
- 增加真实像素、文本内容、OOXML fallback、文件夹选择和失败状态测试

- 核心界面字号整体提升一级，文件行与缩略图同步增大
- 每个窗格独立按名称、类型、修改时间或大小升降序排列；所有字段稳定保持文件夹优先
- 文件夹异步大小整批返回后一次重排，未完成项稳定排在已知大小之后
- 图片显示真实缩略图，图片文件夹显示自然名称排序的第一张直接子图片并保留文件夹边框
- macOS Quick Look 为 PDF 和视频生成真实页面/帧；文本与 Office 使用真实内容 fallback；失败时明确显示无法生成内容预览
- 图标悬停 400ms 显示大图、名称、类型、修改时间、大小与文件夹前五项
- 缩略图服务限制为两个并发任务、8 秒超时、1 GB 源文件上限，使用 path、mtime 和 size 组成缓存键
- 缓存只通过受控 `easymove-thumb` 协议读取，文件操作后自动失效

## 支持矩阵

- 图片：PNG、JPEG、WebP、GIF、BMP、HEIC、TIFF
- macOS Quick Look：PDF、MOV、MP4、M4V、AVI、TXT、RTF、Markdown、HTML、Pages、Keynote、Numbers、DOC/DOCX、XLS/XLSX、PPT/PPTX
- 实际 Quick Look 结果取决于 macOS 版本及本机可用预览生成器；失败、权限不足、损坏或消失文件均回退类型图标
- Windows：图片缩略图与图片文件夹封面；其他文件回退类型图标

## 安装包

- `EasyMove-0.3.0-mac-arm64.dmg`：macOS Apple Silicon（M 系列芯片）

macOS 安装包未使用 Apple Developer ID 签名，也未经过 Apple 公证。首次启动若受阻，请在 Finder 中右键应用并选择“打开”。
