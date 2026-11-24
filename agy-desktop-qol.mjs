#!/usr/bin/env node
/**
 * Antigravity Desktop 跨平台外观注入工具 (CDP 方案，零文件修改、零第三方依赖)
 * 支持 macOS / Windows / Linux (需 Node.js >= 22，原生支持 fetch & WebSocket)
 *
 * 用法:
 *   node agy-desktop-qol.mjs                     # 启动交互式 TUI 配置界面
 *   node agy-desktop-qol.mjs <图片路径> [透明度]   # 命令行直接注入壁纸 + 输入框样式改善
 *   node agy-desktop-qol.mjs --apply             # 按当前配置立即执行一次 CDP 注入
 *   node agy-desktop-qol.mjs --watch             # 独立运行后台自动注入与统计服务守护进程
 *   node agy-desktop-qol.mjs --clear             # 仅清除壁纸，保留其余配置并持久化
 *   node agy-desktop-qol.mjs --clear-all         # 清除所有注入样式并持久化
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCdpPort,
  loadConfig,
  normalizeConfig,
  normalizeOpacity,
  normalizePort,
  normalizeStatsBarItems,
  saveConfig,
} from './src/config.mjs';
import { getHostVersion } from './src/cdp.mjs';
import { applyConfig } from './src/inject.mjs';
import { ensureStatsServer, getActiveStatsPort } from './src/stats-server.mjs';
import { expandHomePath } from './src/wallpaper.mjs';
import { startLifecycleGuard, startWatchLoop } from './src/watch.mjs';
import { runTUI } from './src/tui.mjs';

export {
  applyConfig,
  ensureStatsServer,
  getActiveStatsPort,
  getCdpPort,
  getHostVersion,
  loadConfig,
  normalizeConfig,
  normalizeOpacity,
  normalizePort,
  normalizeStatsBarItems,
  saveConfig,
  startLifecycleGuard,
  startWatchLoop,
};

async function main() {
  if (typeof WebSocket === 'undefined') {
    console.error('[error] 需要 Node.js >= 22（原生支持 WebSocket）。当前版本:', process.version);
    process.exit(1);
  }

  const arg1 = process.argv[2];
  if (arg1 === '--watch') {
    startLifecycleGuard(3000, { singleInstance: true, exitOnParentExit: false });
    startWatchLoop(1000, { takeover: true });
    return;
  }
  if (!arg1) {
    await runTUI();
    return;
  }

  let cfg = loadConfig();
  if (arg1 === '--apply') {
    const count = await applyConfig(cfg, () => {}, { startStatsServer: false });
    console.log(JSON.stringify({ ok: true, count }));
    return;
  }

  if (arg1 === '--clear') {
    cfg.enableWallpaper = false;
    cfg = saveConfig(cfg);
    const count = await applyConfig(cfg, console.log, { startStatsServer: false });
    console.log(`[ok] 已清除壁纸并保存配置，共 ${count} 个窗口`);
    return;
  }

  if (arg1 === '--clear-all') {
    cfg = saveConfig({
      ...cfg,
      enableWallpaper: false,
      enableInputStyle: false,
      enableStatsBar: false,
      enableEscCancel: false,
    });
    const count = await applyConfig(cfg, console.log, { startStatsServer: false });
    console.log(`[ok] 已清除所有注入样式并保存配置，共 ${count} 个窗口`);
    return;
  }

  if (arg1.startsWith('-')) {
    console.error(
      `[error] 未知参数: ${arg1}\n用法: --apply | --clear | --clear-all | --watch | <图片路径或URL> [透明度]`
    );
    process.exit(1);
  }

  cfg.enableWallpaper = true;
  cfg.imagePath = /^(https?:\/\/|data:image\/)/i.test(arg1)
    ? arg1
    : path.resolve(expandHomePath(arg1));

  if (process.argv[3] !== undefined) {
    const num = Number(process.argv[3]);
    if (!Number.isFinite(num) || num < 0 || num > 1) {
      console.error('[error] 透明度必须是 0 ~ 1 之间的数字');
      process.exit(1);
    }
    cfg.opacity = normalizeOpacity(num, cfg.opacity);
  }

  cfg = saveConfig(cfg);
  const count = await applyConfig(cfg, console.log, { startStatsServer: false });
  console.log(`[ok] 已注入壁纸到 ${count} 个窗口`);
}

function checkIsDirectRun() {
  if (!process.argv[1]) return false;
  const selfPath = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(selfPath);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(selfPath);
  }
}

if (checkIsDirectRun()) {
  main().catch((err) => {
    console.error('[error]', err.message || err);
    process.exit(1);
  });
}
