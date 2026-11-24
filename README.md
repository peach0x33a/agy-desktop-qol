# agy-desktop-qol

[简体中文](./README_ZH.md) | **English**

> Zero-dependency, cross-platform Quality-of-Life (QoL) enhancer & native Sidecar plugin for **Antigravity Desktop** via Chrome DevTools Protocol (CDP), modifying zero application files.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## ✨ Features

- **🎨 Custom Wallpaper (Local & URL)**: Inject any local image path (including `~/...`), `https://` URL, or `data:image/...` as a translucent ambient background layer (`opacity` configurable via slider, default `0.12`, up to `10MB`). Remote URLs are streamed and converted to `base64` on the fly to bypass CSP restrictions.
- **🪄 Style Flattening**: Globally remove multi-layer `box-shadow` / glow overlays and apply clean `1px` hairline borders.
- **📊 Session Stats Bar & Live Internal Status**: Centered bottom bar below the composer (with customizable `status`, `turns`, `tokens`, and `context` items) showing:
  - **Live Fixed-Width Status Slot**: Real-time internal state parsed from `transcript.jsonl` & `language_server.log` without layout shift (`Idle` / `Waiting` / `Streaming` / `Running tool` / `Safety check` / `503 No capacity` / `Retrying` / `Request error`).
  - **Turns, Steps & Speed**: Turns, steps, and average output speed (`tok/s`).
  - **Tokens & Cache Hit**: Total tokens and prompt cache hit rate.
  - **Context Usage Ring**: Reads local SQLite `.db` (Protobuf metadata) or `.pbtxt` `max_token_limit`.
  - **Interactive Hover Popover**: Detailed session metrics, elapsed seconds, active tool names, and 503 / retry diagnostics.
  - **Configurable Click Action**: Click the stats bar to open any Sidecar panel (defaults to `sidecar__context/context_panel__/`) or external URL.
- **⎋ Double-ESC to Cancel**: Double-press `ESC` while generating (within 2 seconds, with a centered confirmation toast) to stop generation without conflicting with key auto-repeat, open menus, dialogs, or IME composition.
- **🎛️ Native Sidecar Settings Panel (`Desktop QoL`)**: Built-in Web UI panel accessible from the side panel `+` menu (`Cmd+T`) or `⋮ -> Extensions -> Desktop QoL`, featuring toggle switches, stats bar item checkboxes, custom CDP port configuration, opacity slider, bilingual i18n (`中文` / `EN`), and an in-process background daemon (`startWatchLoop`) that hosts the local stats server (port `9223` with automatic random port fallback if occupied) and auto-injects via CDP.
- **🖥️ Interactive CLI / TUI**: Also usable standalone via terminal TUI or CLI flags. Configuration persists in `~/.gemini/antigravity/qol-config.json` (with automatic fallback migration from legacy `config.json`).

---

## 📦 Requirements

- **Node.js >= 22** (Node >= 22.5 enables built-in `node:sqlite` for exact `.db` streaming timing and context limit reads; zero `npm install` needed)
- Launch Antigravity Desktop with `--remote-debugging-port=9222` (the plugin modifies zero application files; the port is customizable in the settings panel or via `AGY_CDP_PORT`):
  - **macOS**: `open -a Antigravity --args --remote-debugging-port=9222`
  - **Windows**: `Antigravity.exe --remote-debugging-port=9222`
  - **Linux**: `antigravity --remote-debugging-port=9222`

---

## 🚀 Quick Start

### 1. Install as Antigravity Plugin (Recommended)
```bash
agy plugin install https://github.com/peach0x33a/agy-desktop-qol

# Or link/clone directly into Antigravity plugins directory:
ln -s "$(pwd)" ~/.gemini/config/plugins/agy-desktop-qol
```

Once installed, open **Desktop QoL** from the side panel `+` menu (`Cmd+T`), **`⋮ -> Extensions -> Desktop QoL`**, or invoke `/desktop-qol` in chat to configure all options visually.

### 2. Interactive Terminal TUI
```bash
node agy-desktop-qol.mjs
```

### 3. CLI Shortcuts
```bash
node agy-desktop-qol.mjs <image-path-or-url> [opacity]
node agy-desktop-qol.mjs --apply       # Apply current config once via CDP
node agy-desktop-qol.mjs --watch       # Standalone background auto-inject & stats daemon
node agy-desktop-qol.mjs --clear       # Clear wallpaper only and persist config
node agy-desktop-qol.mjs --clear-all   # Clear all injected styles and persist config
```

### 4. Run Unit Tests
```bash
npm test
```
