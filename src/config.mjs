import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(os.homedir(), '.gemini', 'antigravity');
export const LEGACY_CONFIG_PATH = path.join(REPO_ROOT, 'config.json');
export const CONFIG_PATH = path.join(DATA_DIR, 'qol-config.json');

export function getConfigPath(customPath) {
  if (customPath) return path.resolve(customPath);
  if (process.env.AGY_QOL_CONFIG_PATH) return path.resolve(process.env.AGY_QOL_CONFIG_PATH);
  return CONFIG_PATH;
}

export function normalizePort(val, fallback = 9222) {
  if (val === '' || val === null || val === undefined || typeof val === 'boolean') {
    return fallback;
  }
  const n = Number(val);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

export function normalizeOpacity(val, fallback = 0.12) {
  if (val === '' || val === null || val === undefined || typeof val === 'boolean') {
    return fallback;
  }
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, Number(n.toFixed(4))));
}

export const VALID_STATS_ITEMS = ['status', 'turns', 'ttft', 'tokens', 'context'];

export function normalizeStatsBarItems(items) {
  const valid = new Set(VALID_STATS_ITEMS);
  if (!Array.isArray(items)) return [...VALID_STATS_ITEMS];
  const filtered = items
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => valid.has(s));
  return [...new Set(filtered)];
}

export const DEFAULT_CDP_PORT = normalizePort(process.env.AGY_CDP_PORT, 9222);
export const PREFERRED_STATS_PORT = normalizePort(process.env.AGY_STATS_PORT, 9223);
export const WALLPAPER_STYLE_ID = 'agy-custom-wallpaper';
export const UI_STYLE_ID = 'agy-clean-ui';
export const STATS_BAR_VERSION = 5;
export const UI_STYLE_VERSION = 4;
export const ESC_CANCEL_VERSION = 3;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export const DEFAULT_LANG = (process.env.LC_ALL || process.env.LANG || '')
  .toLowerCase()
  .startsWith('zh')
  ? 'zh'
  : 'en';

export const DEFAULT_CONFIG = {
  lang: DEFAULT_LANG,
  cdpPort: DEFAULT_CDP_PORT,
  enableWallpaper: false,
  imagePath: '',
  opacity: 0.12,
  enableInputStyle: true,
  enableStatsBar: true,
  enableEscCancel: true,
  statsClickTarget: 'sidecar__context/context_panel__/',
  statsBarItems: [...VALID_STATS_ITEMS],
};

export const I18N = {
  zh: {
    title: '=== Antigravity Desktop 外观配置 (CDP 零修改注入) ===',
    cdpPort: 'CDP 端口',
    configFile: '配置文件',
    langLabel: '语言 / Language: 中文 (按 Enter 切换)',
    enableWallpaper: '启用注入背景',
    imagePath: '背景图片路径',
    unset: '(未设置)',
    opacity: '背景透明度',
    enableFlat: '启用样式扁平化 (全局去阴影叠加 + 极简细边框)',
    enableEscCancel: '启用双击 ESC 取消生成 (2 秒内二次确认)',
    enableStats: '启用底部会话统计栏 (轮数/步数 · TTFT · tok/s · 缓存命中率)',
    statsClickTarget: '点击统计栏跳转地址',
    statsBarItems: '底栏显示项 (status, turns, ttft, tokens, context)',
    promptCdpPort: '请输入 CDP 端口 (1 ~ 65535)',
    promptImg: '请输入背景图片路径或 URL (输入 - 清空)',
    promptOpacity: '请输入透明度 (0.0 ~ 1.0)',
    promptClickTarget: '请输入点击统计栏跳转地址 (输入 - 清空)',
    promptStatsItems: '输入底栏显示项，逗号分隔 (status, turns, ttft, tokens, context)',
    currentValue: '当前',
    warnPort: '[warn] CDP 端口必须是 1 ~ 65535 的整数',
    warnOpacity: '[warn] 透明度必须是 0 ~ 1 之间的数字',
    injecting: '[info] 正在注入...',
    applied: (n) => `[ok] 已成功应用配置到 ${n} 个窗口`,
    clearedAll: (n) => `[ok] 已清除 ${n} 个窗口的所有注入样式`,
    errNoCdp: (port) =>
      `未检测到 CDP 端口 ${port}，请以 --remote-debugging-port=${port} 启动 Antigravity`,
    errCdpLaunchTimeout: (port) =>
      `等待 CDP 端口 ${port} 超时。如果 Antigravity 已在运行，请先完全退出后再运行本脚本。`,
    errNoPages: '未找到可注入的页面目标',
    errNoImage: '已启用注入背景，但未设置图片路径或 URL',
    errImageNotFound: (p) => `找不到图片文件: ${p}`,
    errImageType: (ext) => `不支持的图片类型: ${ext || '(无扩展名)'}`,
    errImageTooLarge: '图片过大 (上限 10MB)',
    errImageFetch: (msg) => `远程图片拉取失败: ${msg}`,
    bar: {
      waiting: '会话统计: 等待对话...',
      disconnected: '会话统计: 本地服务未连接',
      turns: '轮',
      steps: '步',
      cacheHit: '缓存命中',
      popTitle: '会话统计',
      modelTime: '模型用时',
      tps: '输出速度 (TPS)',
      ttftLast: '上轮 TTFT',
      ttftAvg: '会话平均 TTFT',
      ttftLastShort: '上轮',
      ttftAvgShort: '均',
      outTok: '输出 Token',
      totTok: '总 Token',
      cacheRate: '缓存命中率',
      lastTurn: '本轮',
      ctxUsage: '上下文占用',
      min: '分',
      sec: '秒',
      liveTitle: '内部状态',
      phaseIdle: '空闲状态',
      phaseWaiting: '等待响应',
      phaseStreaming: '接收响应',
      phaseTool: '执行工具',
      phaseMonitor: '安全检查',
      phaseRetry: '重试请求',
      phaseError: '请求出错',
      retryIn: '后重试',
      noCapacity: '容量不足',
    },
  },
  en: {
    title: '=== Antigravity Desktop QoL Config (Zero-Mod CDP) ===',
    cdpPort: 'CDP Port',
    configFile: 'Config',
    langLabel: 'Language / 语言: English (Enter to switch)',
    enableWallpaper: 'Enable Custom Wallpaper',
    imagePath: 'Wallpaper Path',
    unset: '(not set)',
    opacity: 'Wallpaper Opacity',
    enableFlat: 'Enable Style Flattening (No Shadows + Hairline Borders)',
    enableEscCancel: 'Enable Double-ESC to Cancel Generation (2s confirmation)',
    enableStats: 'Enable Bottom Stats Bar (Turns/Steps · TTFT · tok/s · Cache Hit)',
    statsClickTarget: 'Stats Bar Click Target',
    statsBarItems: 'Bottom Bar Items (status, turns, ttft, tokens, context)',
    promptCdpPort: 'Enter CDP port (1 ~ 65535)',
    promptImg: 'Enter wallpaper image path or URL (enter - to clear)',
    promptOpacity: 'Enter opacity (0.0 ~ 1.0)',
    promptClickTarget: 'Enter stats bar click target (enter - to clear)',
    promptStatsItems: 'Enter bottom bar items, comma-separated (status, turns, ttft, tokens, context)',
    currentValue: 'current',
    warnPort: '[warn] CDP port must be an integer between 1 and 65535',
    warnOpacity: '[warn] Opacity must be a number between 0 and 1',
    injecting: '[info] Injecting...',
    applied: (n) => `[ok] Applied config to ${n} window(s)`,
    clearedAll: (n) => `[ok] Cleared all injected styles from ${n} window(s)`,
    errNoCdp: (port) =>
      `CDP port ${port} not detected. Launch Antigravity with --remote-debugging-port=${port}`,
    errCdpLaunchTimeout: (port) =>
      `Timed out waiting for CDP port ${port}. If Antigravity is already running, quit it completely first.`,
    errNoPages: 'No injectable page targets found',
    errNoImage: 'Custom wallpaper is enabled, but no image path or URL is set',
    errImageNotFound: (p) => `Image file not found: ${p}`,
    errImageType: (ext) => `Unsupported image type: ${ext || '(no extension)'}`,
    errImageTooLarge: 'Image exceeds 10MB limit',
    errImageFetch: (msg) => `Failed to fetch remote image: ${msg}`,
    bar: {
      waiting: 'Session Stats: Waiting for chat...',
      disconnected: 'Session Stats: Local server disconnected',
      turns: 'turns',
      steps: 'steps',
      cacheHit: 'Cache',
      popTitle: 'Session Stats',
      modelTime: 'Model Time',
      tps: 'Output Speed (TPS)',
      ttftLast: 'Last TTFT',
      ttftAvg: 'Session Avg TTFT',
      ttftLastShort: 'last',
      ttftAvgShort: 'avg',
      outTok: 'Output Tokens',
      totTok: 'Total Tokens',
      cacheRate: 'Cache Hit Rate',
      lastTurn: 'last',
      ctxUsage: 'Context Usage',
      min: 'm',
      sec: 's',
      liveTitle: 'Live Status',
      phaseIdle: 'Idle',
      phaseWaiting: 'Waiting for model',
      phaseStreaming: 'Streaming',
      phaseTool: 'Running tool',
      phaseMonitor: 'Safety check',
      phaseRetry: 'Retrying',
      phaseError: 'Request error',
      retryIn: 'next retry',
      noCapacity: '503 No capacity',
    },
  },
};

export function t(cfg) {
  return I18N[cfg?.lang === 'en' ? 'en' : 'zh'];
}

export function normalizeConfig(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const lang = src.lang === 'en' ? 'en' : src.lang === 'zh' ? 'zh' : DEFAULT_CONFIG.lang;
  const imagePath = typeof src.imagePath === 'string' ? src.imagePath.trim() : '';
  const hasExplicitWallpaper = typeof src.enableWallpaper === 'boolean';
  return {
    lang,
    cdpPort: normalizePort(src.cdpPort, DEFAULT_CONFIG.cdpPort),
    enableWallpaper: hasExplicitWallpaper ? src.enableWallpaper : DEFAULT_CONFIG.enableWallpaper,
    imagePath,
    opacity: normalizeOpacity(src.opacity, DEFAULT_CONFIG.opacity),
    enableInputStyle:
      typeof src.enableInputStyle === 'boolean'
        ? src.enableInputStyle
        : DEFAULT_CONFIG.enableInputStyle,
    enableStatsBar:
      typeof src.enableStatsBar === 'boolean' ? src.enableStatsBar : DEFAULT_CONFIG.enableStatsBar,
    enableEscCancel:
      typeof src.enableEscCancel === 'boolean'
        ? src.enableEscCancel
        : DEFAULT_CONFIG.enableEscCancel,
    statsClickTarget:
      typeof src.statsClickTarget === 'string'
        ? src.statsClickTarget.trim()
        : DEFAULT_CONFIG.statsClickTarget,
    statsBarItems: Array.isArray(src.statsBarItems)
      ? normalizeStatsBarItems(src.statsBarItems)
      : [...DEFAULT_CONFIG.statsBarItems],
  };
}

export function loadConfig(customPath) {
  const target = getConfigPath(customPath);
  const candidates =
    customPath || process.env.AGY_QOL_CONFIG_PATH
      ? [target]
      : [target, LEGACY_CONFIG_PATH];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        return normalizeConfig(parsed);
      }
    } catch {
      // try next candidate or fallback to default
    }
  }
  return normalizeConfig(DEFAULT_CONFIG);
}

export function saveConfig(cfg, customPath) {
  const normalized = normalizeConfig(cfg);
  const target = getConfigPath(customPath);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, target);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
  return normalized;
}

export function getCdpPort(cfg) {
  return normalizePort(cfg?.cdpPort, DEFAULT_CDP_PORT);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
