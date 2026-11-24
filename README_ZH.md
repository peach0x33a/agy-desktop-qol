# agy-desktop-qol

**简体中文** | [English](./README.md)

> 零第三方依赖、跨平台的 **Antigravity Desktop** 体验增强插件（基于 CDP 动态注入 + 原生 Sidecar 设置面板），不修改任何桌面端应用文件。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## ✨ 功能特性

- **🎨 自定义背景注入（本地 & URL）**：支持本地图片路径（含 `~/...`）、`https://` 远程图片链接或 `data:image/...` 作为半透明氛围背景层（支持滑块实时调节透明度，默认 `0.12`，上限 `10MB`）。远程图片由 Node 端流式拉取并转为 `base64` 注入，规避桌面端 CSP 限制。
- **🪄 样式扁平化**：全局去除多层阴影/发光叠加，为输入框、弹窗、菜单统一加上 `1px` 极简细边框。
- **📊 底部会话统计栏 & 实时内部状态**：在输入框下方居中展示（支持按需勾选 `status` / `turns` / `tokens` / `context` 显示项）：
  - **等宽 4 字实时状态**：解析本地 `transcript.jsonl` 与 `language_server.log`，直观显示当前内部阶段且不抖动（`空闲状态` / `等待响应` / `接收响应` / `执行工具` / `安全检查` / `容量不足` / `重试请求` / `请求出错`）。
  - **轮数 / 步数 / 速度**：`X 轮 Y 步` 与平均输出速度（`tok/s`）。
  - **Token 与缓存命中**：总 Token 消耗与 Prompt 缓存命中率（`缓存命中 XX%`）。
  - **上下文占用圆环**：优先从本地 SQLite `.db`（Protobuf 元数据）或 `.pbtxt` 读取精确 `max_token_limit` 绘制百分比圆环。
  - **可交互悬停弹窗**：鼠标移入可查看模型耗时、正在执行的工具名、重试次数与 503 报错详情（支持直接划选复制）。
  - **点击跳转地址可配**：点击状态栏可打开任意 Sidecar 面板（默认跳转到 `sidecar__context/context_panel__/`）或外部链接。
- **⎋ 双击 ESC 取消对话**：生成过程中 2 秒内连按两次 `ESC`（带对话区居中毛玻璃二次确认 Toast）即可快速停止生成；长按连发、输入法选词或弹窗/下拉菜单打开时不误触。
- **🎛️ 原生 Sidecar 设置面板（`Desktop QoL`）**：内置于侧边栏 `+` 菜单（`Cmd+T`）或 `⋮ -> Extensions -> Desktop QoL`，提供图形化开关、底栏显示项勾选、自定义 CDP 端口、中英双语切换，并在 Sidecar 进程内直接托管本地统计服务（默认 `9223`，端口占用时自动回退到随机可用端口）与 CDP 自动注入守护。
- **🖥️ 终端交互式 TUI / CLI**：也可独立通过终端 TUI 或命令行参数运行，配置持久化保存在 `~/.gemini/antigravity/qol-config.json`（兼容旧版插件目录 `config.json` 自动迁移）。

---

## 📦 环境要求

- **Node.js >= 22**（Node >= 22.5 可启用内置 `node:sqlite` 读取 `.db` 精确流式耗时与上下文上限；作为插件运行时直接使用 Antigravity Desktop 内置运行时，无需 `npm install`）
- 启动 Antigravity Desktop 时带上调试端口参数 `--remote-debugging-port=9222`（插件本身不修改任何应用文件，可在面板中或通过 `AGY_CDP_PORT` 自定义端口）：
  - **macOS**：`open -a Antigravity --args --remote-debugging-port=9222`
  - **Windows**：`Antigravity.exe --remote-debugging-port=9222`
  - **Linux**：`antigravity --remote-debugging-port=9222`

---

## 🚀 快速开始

### 1. 作为 Antigravity 插件安装（推荐）
```bash
agy plugin install https://github.com/peach0x33a/agy-desktop-qol

# 或直接软链接 / 克隆到插件目录：
ln -s "$(pwd)" ~/.gemini/config/plugins/agy-desktop-qol
```

安装后可通过侧边栏 `+` 菜单（`Cmd+T`）、右上角 **`⋮ -> Extensions -> Desktop QoL`** 或在对话中调用 `/desktop-qol` 打开设置面板。

### 2. 终端交互式 TUI
```bash
node agy-desktop-qol.mjs
```

### 3. 命令行快捷指令
```bash
node agy-desktop-qol.mjs <图片路径或URL> [透明度]
node agy-desktop-qol.mjs --apply       # 按当前配置立即执行一次 CDP 注入
node agy-desktop-qol.mjs --watch       # 独立运行后台自动注入与统计服务守护进程
node agy-desktop-qol.mjs --clear       # 仅清除壁纸并保存配置
node agy-desktop-qol.mjs --clear-all   # 清除所有注入样式并保存配置
```

### 4. 运行单元测试
```bash
npm test
```
