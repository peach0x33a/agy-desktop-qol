import fs from 'node:fs';
import {
  STATS_BAR_VERSION,
  UI_STYLE_ID,
  WALLPAPER_STYLE_ID,
  getCdpPort,
  loadConfig,
} from './config.mjs';
import { evalOverCDP, getTargets, isInjectablePage } from './cdp.mjs';
import { applyConfig, pushStatsToPage } from './inject.mjs';
import {
  PID_LOCK_PATH,
  claimSingleInstanceLock,
  ensureStatsServer,
  getActiveStatsPort,
  isCurrentInstanceOwner,
} from './stats-server.mjs';

function isPidAlive(pid) {
  if (!pid || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

export function startLifecycleGuard(intervalMs = 3000, opts = {}) {
  const singleInstance = Boolean(opts.singleInstance);
  const exitOnParentExit = Boolean(opts.exitOnParentExit);
  if (singleInstance) {
    claimSingleInstanceLock();
  }
  const parentPid = process.ppid;
  let idleConfirmCount = 0;

  const timer = setInterval(async () => {
    try {
      if (singleInstance && !isCurrentInstanceOwner()) {
        process.exit(0);
      }

      const parentAlive =
        parentPid > 1 &&
        (process.platform === 'win32' || process.ppid === parentPid) &&
        isPidAlive(parentPid);

      if (exitOnParentExit && parentPid > 1 && !parentAlive) {
        process.exit(0);
      }

      let anyWindowOpen = false;
      try {
        const cfg = loadConfig();
        const targets = await getTargets(getCdpPort(cfg));
        anyWindowOpen = Array.isArray(targets) && targets.some(isInjectablePage);
      } catch {
        anyWindowOpen = false;
      }

      if (parentAlive || anyWindowOpen) {
        idleConfirmCount = 0;
        return;
      }

      idleConfirmCount++;
      if (idleConfirmCount >= 2) {
        if (singleInstance) {
          try {
            if (isCurrentInstanceOwner() && fs.existsSync(PID_LOCK_PATH)) {
              fs.unlinkSync(PID_LOCK_PATH);
            }
          } catch {
            // ignore
          }
        }
        process.exit(0);
      }
    } catch {
      // ignore transient error
    }
  }, intervalMs);

  timer.unref();
  return timer;
}

export function buildNeedInjectExpression(cfg, activeStatsPort) {
  const checks = [];
  if (cfg.enableWallpaper && cfg.imagePath) {
    checks.push(`!document.getElementById(${JSON.stringify(WALLPAPER_STYLE_ID)})`);
  }
  if (cfg.enableInputStyle) {
    checks.push(`!document.getElementById(${JSON.stringify(UI_STYLE_ID)})`);
  }
  if (cfg.enableStatsBar) {
    checks.push('!window.__agyStatsTimer');
    checks.push("typeof window.__agyRenderStats !== 'function'");
    checks.push(`window.__agyStatsVersion !== ${STATS_BAR_VERSION}`);
    if (activeStatsPort) {
      checks.push(`window.__agyStatsPort !== ${Number(activeStatsPort)}`);
    }
  }
  if (cfg.enableEscCancel) {
    checks.push('!window.__agyEscCancelHandler');
  }
  return checks.length > 0 ? checks.join(' || ') : 'false';
}

export function startWatchLoop(intervalMs = 1000, opts = {}) {
  const takeover = Boolean(opts.takeover);
  ensureStatsServer(undefined, { takeover }).catch((err) => {
    console.error('[warn] 统计服务启动失败:', err && err.message);
  });

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const currentCfg = loadConfig();
      const hasEffectiveWallpaper = Boolean(
        currentCfg.enableWallpaper && currentCfg.imagePath
      );
      if (
        !hasEffectiveWallpaper &&
        !currentCfg.enableInputStyle &&
        !currentCfg.enableStatsBar &&
        !currentCfg.enableEscCancel
      ) {
        return;
      }
      const statsPort = currentCfg.enableStatsBar
        ? getActiveStatsPort() || (await ensureStatsServer(undefined, { takeover }))
        : null;
      const targets = await getTargets(getCdpPort(currentCfg));
      if (!targets) return;
      const pages = targets.filter(isInjectablePage);
      const checkExpr = buildNeedInjectExpression(currentCfg, statsPort);
      if (checkExpr === 'false') return;

      let injected = false;
      for (const page of pages) {
        const check = await evalOverCDP(page.webSocketDebuggerUrl, checkExpr);
        if (check && check.result && check.result.value === true) {
          await applyConfig(currentCfg, () => {}, {
            launch: false,
            startStatsServer: true,
            tolerantWallpaper: true,
            statsPort,
          });
          injected = true;
          break;
        }
      }

      if (!injected && currentCfg.enableStatsBar) {
        for (const page of pages) {
          await pushStatsToPage(page.webSocketDebuggerUrl);
        }
      }
    } catch {
      // CDP 未就绪或页面切换中，下个周期重试
    } finally {
      running = false;
    }
  };

  tick();
  return setInterval(tick, intervalMs);
}
