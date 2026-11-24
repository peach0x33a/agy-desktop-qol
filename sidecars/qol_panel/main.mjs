import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  applyConfig,
  getActiveStatsPort,
  loadConfig,
  normalizeOpacity,
  normalizePort,
  normalizeStatsBarItems,
  saveConfig,
  startLifecycleGuard,
  startWatchLoop,
} from '../../agy-desktop-qol.mjs';

const fallbackSdk = pathToFileURL(
  path.join(
    os.homedir(),
    '.gemini',
    'antigravity',
    'lib',
    'node_modules',
    'sidecar_sdk',
    'index.mjs'
  )
).href;

const { SidecarApp, Response } = await import('sidecar_sdk').catch(() => import(fallbackSdk));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NO_STORE = { 'Cache-Control': 'no-store' };

// 生命周期守护：随宿主父进程退出而退出，不抢占其他 Antigravity 实例的 Sidecar 端口
startLifecycleGuard(3000, { singleInstance: false, exitOnParentExit: true });

// 在 Sidecar 后台进程内直接托管统计服务与 CDP 自动注入/直推守护
startWatchLoop(1000, { takeover: false });

const app = new SidecarApp();

app.page('/', () =>
  new Response(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), {
    contentType: 'text/html; charset=utf-8',
    headers: NO_STORE,
  })
);

app.api(
  '/api/config',
  async () => ({
    ...loadConfig(),
    daemonOnline: true,
    statsPort: getActiveStatsPort(),
  }),
  'GET'
);

export async function handleConfigUpdate(data) {
  const current = loadConfig();
  const allowed = [
    'lang',
    'cdpPort',
    'enableWallpaper',
    'imagePath',
    'opacity',
    'enableInputStyle',
    'enableStatsBar',
    'enableEscCancel',
    'statsClickTarget',
    'statsBarItems',
  ];
  const raw = data && typeof data === 'object' ? data : {};
  const langOnly = Boolean(raw.langOnly);
  const patch = Object.fromEntries(
    Object.entries(raw).filter(([k]) => allowed.includes(k))
  );
  const targetLang = patch.lang === 'en' ? 'en' : patch.lang === 'zh' ? 'zh' : current.lang;

  if ('cdpPort' in patch) {
    if (patch.cdpPort === '' || patch.cdpPort === null || patch.cdpPort === undefined) {
      patch.cdpPort = normalizePort(undefined, 9222);
    } else {
      const port = Number(patch.cdpPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return {
          ok: false,
          config: current,
          daemonOnline: true,
          statsPort: getActiveStatsPort(),
          error:
            targetLang === 'en'
              ? 'CDP port must be an integer between 1 and 65535'
              : 'CDP 端口必须是 1 ~ 65535 的整数',
        };
      }
      patch.cdpPort = port;
    }
  }

  if ('opacity' in patch) {
    if (patch.opacity === '' || patch.opacity === null || patch.opacity === undefined) {
      patch.opacity = 0.12;
    } else {
      const op = Number(patch.opacity);
      if (!Number.isFinite(op) || op < 0 || op > 1) {
        return {
          ok: false,
          config: current,
          daemonOnline: true,
          statsPort: getActiveStatsPort(),
          error:
            targetLang === 'en'
              ? 'Opacity must be a number between 0 and 1'
              : '透明度必须是 0 ~ 1 之间的数字',
        };
      }
      patch.opacity = normalizeOpacity(op, 0.12);
    }
  }

  if ('statsBarItems' in patch) {
    patch.statsBarItems = normalizeStatsBarItems(patch.statsBarItems);
  }

  const next = saveConfig({ ...current, ...patch });

  if (langOnly) {
    try {
      await applyConfig(next, () => {}, {
        launch: false,
        startStatsServer: true,
        tolerantWallpaper: true,
      });
    } catch {
      // 仅切换面板语言时忽略 CDP 离线或未配置壁纸的错误
    }
    return {
      ok: true,
      config: next,
      daemonOnline: true,
      statsPort: getActiveStatsPort(),
    };
  }

  try {
    const count = await applyConfig(next, () => {}, {
      launch: false,
      startStatsServer: true,
    });
    return {
      ok: true,
      count,
      config: next,
      daemonOnline: true,
      statsPort: getActiveStatsPort(),
    };
  } catch (err) {
    return {
      ok: false,
      config: next,
      daemonOnline: true,
      statsPort: getActiveStatsPort(),
      error: err.message || String(err),
    };
  }
}

app.api('/api/config', handleConfigUpdate, 'POST');

app.run();
