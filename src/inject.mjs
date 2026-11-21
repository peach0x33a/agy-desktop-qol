import os from 'node:os';
import {
  DEFAULT_CONFIG,
  I18N,
  PREFERRED_STATS_PORT,
  STATS_BAR_VERSION,
  UI_STYLE_ID,
  WALLPAPER_STYLE_ID,
  getCdpPort,
  normalizeConfig,
  normalizeOpacity,
  normalizeStatsBarItems,
  t,
} from './config.mjs';
import { ensureCDPReady, evalOverCDP, isInjectablePage } from './cdp.mjs';
import { getStatsToken, resolveStatsPort } from './stats-server.mjs';
import { computeConversationStats } from './transcript.mjs';
import { resolveWallpaperBgUrl } from './wallpaper.mjs';

export function buildInjectJS(id, cssText) {
  const escaped = JSON.stringify(cssText);
  return `(() => {
    const id = ${JSON.stringify(id)};
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = ${escaped};
    return 'ok';
  })()`;
}

export function buildRemoveJS(id) {
  return `(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (el) el.remove();
    return 'removed';
  })()`;
}

export function buildStatsBarInjectJS(
  lang = 'zh',
  clickTarget = '',
  statsBarItems = DEFAULT_CONFIG.statsBarItems,
  statsPort = PREFERRED_STATS_PORT,
  statsToken = getStatsToken()
) {
  const L = JSON.stringify(I18N[lang === 'en' ? 'en' : 'zh'].bar);
  const CLICK_TARGET = JSON.stringify(String(clickTarget || '').trim());
  const ITEMS = JSON.stringify(normalizeStatsBarItems(statsBarItems));
  const PORT = Number(statsPort) || PREFERRED_STATS_PORT;
  const TOKEN = JSON.stringify(String(statsToken || ''));
  return `(() => {
    const L = ${L};
    const CLICK_TARGET = ${CLICK_TARGET};
    const ITEMS = ${ITEMS};
    const STATS_PORT = ${PORT};
    const STATS_TOKEN = ${TOKEN};
    if (window.__agyStatsTimer) clearInterval(window.__agyStatsTimer);
    window.__agyStatsPort = STATS_PORT;
    window.__agyStatsVersion = ${STATS_BAR_VERSION};
    const old = document.getElementById('agy-stats-bar');
    if (old) old.remove();

    const formatTok = (n) => {
      const val = Number(n || 0);
      if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
      if (val >= 1000) return Math.round(val / 1000) + 'K';
      return String(val);
    };

    const formatDuration = (sec) => {
      const val = Number(sec || 0);
      if (!val) return '0 ' + L.sec;
      const m = Math.floor(val / 60);
      const s = val % 60;
      return m > 0 ? m + ' ' + L.min + ' ' + s + ' ' + L.sec : s + ' ' + L.sec;
    };

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const formatLiveBadge = (live) => {
      if (!live || live.phase === 'idle') {
        return {
          color: 'var(--muted-foreground, light-dark(#64748b, rgba(255,255,255,0.52)))',
          dot: 'light-dark(rgba(10,10,12,0.32), rgba(255,255,255,0.32))',
          barText: L.phaseIdle,
          popText: L.phaseIdle,
          detail: '',
          idle: true,
        };
      }
      const el = live.elapsedSec != null ? ' · ' + live.elapsedSec + 's' : '';
      if (live.phase === 'retry' || live.phase === 'error') {
        const barLabel = live.noCapacity ? L.noCapacity : (live.phase === 'retry' ? L.phaseRetry : L.phaseError);
        const tag = live.noCapacity ? L.noCapacity : (live.code ? 'HTTP ' + live.code : L.phaseError);
        const att = live.attempt ? ' #' + live.attempt : '';
        const wait = live.retryIn ? ' (' + live.retryIn + ' ' + L.retryIn + ')' : '';
        return {
          color: 'light-dark(#dc2626, #f87171)',
          dot: 'light-dark(#dc2626, #f87171)',
          barText: barLabel,
          popText: tag + att + wait,
          detail: live.detail || '',
          idle: false,
        };
      }
      if (live.phase === 'monitor') {
        return {
          color: 'light-dark(#7c3aed, #c084fc)',
          dot: 'light-dark(#7c3aed, #c084fc)',
          barText: L.phaseMonitor,
          popText: L.phaseMonitor + el,
          detail: live.detail || '',
          idle: false,
        };
      }
      if (live.phase === 'tool') {
        return {
          color: 'light-dark(#b45309, #fbbf24)',
          dot: 'light-dark(#b45309, #fbbf24)',
          barText: L.phaseTool,
          popText: L.phaseTool + el,
          detail: (live.tools || []).join(', '),
          idle: false,
        };
      }
      if (live.phase === 'streaming') {
        return {
          color: 'light-dark(#059669, #34d399)',
          dot: 'light-dark(#059669, #34d399)',
          barText: L.phaseStreaming,
          popText: L.phaseStreaming + el,
          detail: '',
          idle: false,
        };
      }
      return {
        color: 'light-dark(#2563eb, #60a5fa)',
        dot: 'light-dark(#2563eb, #60a5fa)',
        barText: L.phaseWaiting,
        popText: L.phaseWaiting + el,
        detail: '',
        idle: false,
      };
    };

    const ensureBar = () => {
      const composer = document.querySelector('.surface-composer');
      if (!composer || !composer.parentElement) return null;
      let bar = document.getElementById('agy-stats-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'agy-stats-bar';
        bar.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;padding:6px 10px 2px;font-size:12px;color:var(--muted-foreground,light-dark(#52525b,rgba(255,255,255,0.62)));user-select:none;font-family:system-ui,-apple-system,sans-serif;cursor:default;';

        const popWrap = document.createElement('div');
        popWrap.id = 'agy-stats-popover-wrap';
        popWrap.style.cssText = 'display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding-bottom:10px;z-index:100000;pointer-events:auto;';

        const pop = document.createElement('div');
        pop.id = 'agy-stats-popover';
        pop.style.cssText = 'width:280px;padding:12px 14px;border-radius:12px;background:var(--card,light-dark(rgba(255,255,255,0.96),rgba(28,28,34,0.96)));border:1px solid var(--card-border,light-dark(rgba(10,10,12,0.12),rgba(255,255,255,0.12)));box-shadow:light-dark(0 8px 28px rgba(10,10,12,0.12),0 8px 28px rgba(0,0,0,0.45));backdrop-filter:blur(12px);color:var(--foreground,light-dark(#0a0a0c,rgba(255,255,255,0.88)));font-size:12px;user-select:text;cursor:auto;';
        popWrap.appendChild(pop);
        bar.appendChild(popWrap);

        let hideTimer = null;
        const showPop = () => {
          if (!pop.dataset.lastHtml) return;
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          popWrap.style.display = 'block';
        };
        const scheduleHide = () => {
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => { popWrap.style.display = 'none'; }, 250);
        };
        bar.addEventListener('mouseenter', showPop);
        bar.addEventListener('mouseleave', scheduleHide);
        popWrap.addEventListener('mouseenter', showPop);
        popWrap.addEventListener('mouseleave', scheduleHide);

        composer.parentElement.appendChild(bar);
      } else if (!composer.parentElement.contains(bar)) {
        composer.parentElement.appendChild(bar);
      }
      return bar;
    };

    const ensureSummary = (bar) => {
      let summary = document.getElementById('agy-stats-summary');
      if (!summary) {
        summary = document.createElement('div');
        summary.id = 'agy-stats-summary';
        summary.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:12px;';
        bar.appendChild(summary);
      }
      return summary;
    };

    const setPlainStatus = (bar, text) => {
      const summary = ensureSummary(bar);
      summary.onclick = null;
      summary.style.cursor = 'default';
      summary.title = '';
      if (summary.dataset.lastHtml !== text) {
        summary.dataset.lastHtml = text;
        summary.textContent = text;
      }
      const pop = document.getElementById('agy-stats-popover');
      if (pop && pop.dataset.lastHtml) {
        pop.dataset.lastHtml = '';
        pop.innerHTML = '';
      }
      const popWrap = document.getElementById('agy-stats-popover-wrap');
      if (popWrap) popWrap.style.display = 'none';
    };

    const renderData = (bar, d) => {
      const turns = Number(d.turns || 0);
      const steps = Number(d.steps || 0);
      const totalTokens = Number(d.totalTokens || 0);
      const outputTokens = Number(d.outputTokens || 0);
      const cacheHitRate = Number(d.cacheHitRate || 0);
      const pct = Number(d.contextPct || 0);
      const r = 5;
      const c = 2 * Math.PI * r;
      const offset = c - (pct / 100) * c;
      const ringSvg =
        '<svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(-90deg);flex-shrink:0;">' +
        '<circle cx="7" cy="7" r="' + r + '" fill="none" stroke="light-dark(rgba(10,10,12,0.16), rgba(255,255,255,0.18))" stroke-width="2"/>' +
        '<circle cx="7" cy="7" r="' + r + '" fill="none" stroke="light-dark(rgba(10,10,12,0.72), rgba(255,255,255,0.78))" stroke-width="2" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '" stroke-linecap="round"/>' +
        '</svg>';
      const gaugeSvg =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.85;">' +
        '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>';
      const dbSvg =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.85;">' +
        '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>';
      const liveBadge = formatLiveBadge(d.live);
      const pop = document.getElementById('agy-stats-popover');
      if (pop) {
        const row = (k, v) =>
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;">' +
          '<span style="color:var(--muted-foreground,light-dark(#52525b,rgba(255,255,255,0.62)));">' + k + '</span>' +
          '<span style="font-variant-numeric:tabular-nums;">' + v + '</span></div>';
        let liveHtml = '';
        if (liveBadge) {
          const isErr = d.live && (d.live.phase === 'retry' || d.live.phase === 'error');
          const detailText = liveBadge.detail || '';
          const detailColor = isErr ? 'light-dark(#dc2626,rgba(248,113,113,0.9))' : 'var(--muted-foreground,light-dark(#52525b,rgba(255,255,255,0.65)))';
          const detailLine = detailText
            ? '<div style="margin-top:5px;font-size:11px;line-height:1.4;color:' + detailColor + ';word-break:break-word;">' + esc(detailText) + '</div>'
            : '';
          liveHtml =
            '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border,light-dark(rgba(10,10,12,0.1),rgba(255,255,255,0.1)));">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
            '<span style="color:var(--muted-foreground,light-dark(#52525b,rgba(255,255,255,0.62)));flex-shrink:0;">' + L.liveTitle + '</span>' +
            '<span style="color:' + liveBadge.color + ';font-weight:500;text-align:right;">' + esc(liveBadge.popText) + '</span></div>' +
            detailLine + '</div>';
        }
        const nextPopHtml =
          '<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;margin-bottom:6px;border-bottom:1px solid var(--border,light-dark(rgba(10,10,12,0.1),rgba(255,255,255,0.1)));font-weight:600;">' +
          '<span style="display:inline-flex;align-items:center;gap:6px;">' + gaugeSvg + L.popTitle + '</span><span>' + turns + ' ' + L.turns + ' ' + steps + ' ' + L.steps + '</span></div>' +
          row(L.modelTime, formatDuration(d.modelSeconds)) +
          row(L.tps, (d.tps || '--') + ' tok/s') +
          row(L.outTok, formatTok(outputTokens)) +
          row(L.totTok, formatTok(totalTokens)) +
          row(L.cacheRate, cacheHitRate + '%') +
          row(L.ctxUsage, formatTok(d.lastContextTokens || 0) + ' / ' + formatTok(d.maxContext || 512000) + ' (' + pct + '%)') +
          liveHtml;
        if (pop.dataset.lastHtml !== nextPopHtml) {
          pop.dataset.lastHtml = nextPopHtml;
          pop.innerHTML = nextPopHtml;
        }
      }
      const summary = ensureSummary(bar);
      const liveSpan =
        '<span style="display:inline-flex;align-items:center;gap:6px;color:' + liveBadge.color + ';font-weight:' + (liveBadge.idle ? '400' : '500') + ';">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + liveBadge.dot + ';display:inline-block;"></span>' +
        esc(liveBadge.barText) + '</span>';
      const partMap = {
        status: liveSpan,
        turns: '<span style="display:inline-flex;align-items:center;gap:5px;">' + gaugeSvg + turns + ' ' + L.turns + ' ' + steps + ' ' + L.steps + ' · ' + (d.tps || '--') + ' tok/s</span>',
        tokens: '<span style="display:inline-flex;align-items:center;gap:5px;">' + dbSvg + formatTok(totalTokens) + ' tok · ' + L.cacheHit + ' ' + cacheHitRate + '%</span>',
        context: '<span id="agy-context-trigger" style="display:inline-flex;align-items:center;gap:5px;">' + ringSvg + pct + '%</span>',
      };
      const sep = '<span style="opacity:0.35">|</span>';
      const nextSummaryHtml = ITEMS.map((k) => partMap[k]).filter(Boolean).join(sep);
      summary.style.cursor = CLICK_TARGET ? 'pointer' : 'default';
      summary.title = CLICK_TARGET || '';
      if (summary.dataset.lastHtml !== nextSummaryHtml) {
        summary.dataset.lastHtml = nextSummaryHtml;
        summary.innerHTML = nextSummaryHtml;
      }
      summary.onclick = CLICK_TARGET
        ? () => {
            if (/^https?:\\/\\//i.test(CLICK_TARGET)) {
              window.open(CLICK_TARGET, '_blank', 'noopener,noreferrer');
              return;
            }
            const u = new URL(location.href);
            u.searchParams.set('tab', CLICK_TARGET);
            history.pushState({}, '', u.toString());
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        : null;
    };

    window.__agyRenderStats = (convId, d) => {
      window.__agyStatsLastPush = Date.now();
      const bar = ensureBar();
      if (!bar) return;
      const m = location.pathname.match(/\\/c\\/([a-zA-Z0-9_-]+)/);
      if (!m || !convId || m[1] !== convId || !d) {
        setPlainStatus(bar, L.waiting);
        return;
      }
      renderData(bar, d);
    };

    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      const bar = ensureBar();
      if (!bar) return;
      const m = location.pathname.match(/\\/c\\/([a-zA-Z0-9_-]+)/);
      if (!m) {
        setPlainStatus(bar, L.waiting);
        return;
      }
      if (window.__agyStatsLastPush && Date.now() - window.__agyStatsLastPush < 4000) {
        return;
      }
      inFlight = true;
      try {
        const res = await fetch('http://127.0.0.1:' + STATS_PORT + '/stats?id=' + encodeURIComponent(m[1]), {
          headers: { 'X-QoL-Token': STATS_TOKEN },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();
        renderData(bar, d);
      } catch {
        if (!window.__agyStatsLastPush || Date.now() - window.__agyStatsLastPush >= 6000) {
          setPlainStatus(bar, L.disconnected);
        }
      } finally {
        inFlight = false;
      }
    };

    const initBar = ensureBar();
    if (initBar) setPlainStatus(initBar, L.waiting);
    window.__agyStatsTimer = setInterval(refresh, 1000);
    return 'stats-ok';
  })()`;
}

export function buildStatsBarRemoveJS() {
  return `(() => {
    if (window.__agyStatsTimer) {
      clearInterval(window.__agyStatsTimer);
      window.__agyStatsTimer = null;
    }
    window.__agyRenderStats = null;
    window.__agyStatsLastPush = 0;
    window.__agyStatsPort = null;
    window.__agyStatsVersion = null;
    const bar = document.getElementById('agy-stats-bar');
    if (bar) bar.remove();
    return 'stats-removed';
  })()`;
}

export async function pushStatsToPage(wsUrl) {
  try {
    const check = await evalOverCDP(
      wsUrl,
      `(() => {
        const m = location.pathname.match(/\\/c\\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : '';
      })()`
    );
    const convId = check?.result?.value || '';
    const data = convId ? computeConversationStats(convId) : null;
    await evalOverCDP(
      wsUrl,
      `(() => {
        if (typeof window.__agyRenderStats === 'function') {
          window.__agyRenderStats(${JSON.stringify(convId)}, ${JSON.stringify(data)});
        }
      })()`
    );
  } catch {
    // ignore transient CDP error
  }
}

const WIN_MEDIA_MODAL_CSS =
  os.platform() === 'win32'
    ? `
  [data-testid="media-modal-header"] {
    padding-top: calc(env(titlebar-area-height, 32px) + 8px) !important;
    padding-bottom: 8px !important;
    padding-right: 16px !important;
    height: auto !important;
  }
`
    : '';

export const CLEAN_INPUT_CSS = `
  *, *::before, *::after {
    box-shadow: none !important;
  }
  :focus-visible:not([contenteditable], textarea, input, [role="textbox"]) {
    outline: 2px solid light-dark(rgba(10, 10, 12, 0.55), rgba(255, 255, 255, 0.6)) !important;
    outline-offset: 1px !important;
  }
  .surface-composer,
  .agy-user-bubble,
  [role="dialog"],
  [role="menu"],
  [data-radix-popper-content-wrapper] > * {
    border: 1px solid light-dark(rgba(10, 10, 12, 0.12), rgba(255, 255, 255, 0.14)) !important;
  }
  [data-slot="toggle-group"] > button[data-pressed],
  .agy-sidebar-row[data-selected="true"] {
    box-shadow: inset 0 0 0 1px light-dark(rgba(10, 10, 12, 0.09), rgba(255, 255, 255, 0.09)) !important;
  }
  [data-main-content-body]::after,
  [data-side-panel-body]::after,
  [data-hoisted-slot-rim="side"],
  [data-tiling-pane]::after,
  [data-testid="bottom-terminal-panel"]::after {
    box-shadow: inset 0 0 0 0.5px var(--card-edge, light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.10))) !important;
  }
  [role="switch"] > span {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.08) !important;
  }
  ${WIN_MEDIA_MODAL_CSS}
`;

export function buildEscCancelInjectJS(lang = 'zh') {
  const hintText = JSON.stringify(
    lang === 'en' ? 'Press ESC again to cancel' : '再按一次 ESC 取消对话'
  );
  return `(() => {
    if (window.__agyEscCancelHandler) {
      window.removeEventListener('keydown', window.__agyEscCancelHandler, true);
    }
    if (window.__agyEscToastTimer) {
      clearTimeout(window.__agyEscToastTimer);
      window.__agyEscToastTimer = null;
    }
    const oldToast = document.getElementById('agy-esc-toast');
    if (oldToast) oldToast.remove();

    const HINT_TEXT = ${hintText};
    let armedUntil = 0;

    const hideToast = () => {
      armedUntil = 0;
      if (window.__agyEscToastTimer) {
        clearTimeout(window.__agyEscToastTimer);
        window.__agyEscToastTimer = null;
      }
      const el = document.getElementById('agy-esc-toast');
      if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -46%) scale(0.97)';
      }
    };

    const showToast = (composer) => {
      let el = document.getElementById('agy-esc-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'agy-esc-toast';
        el.style.cssText =
          'position:fixed;z-index:100001;pointer-events:none;padding:9px 16px;border-radius:999px;' +
          'background:var(--card,light-dark(rgba(255,255,255,0.94),rgba(24,24,30,0.92)));border:1px solid var(--card-border,light-dark(rgba(10,10,12,0.14),rgba(255,255,255,0.14)));' +
          'box-shadow:light-dark(0 8px 28px rgba(10,10,12,0.12),0 8px 28px rgba(0,0,0,0.45));backdrop-filter:blur(12px);' +
          'color:var(--foreground,light-dark(#0a0a0c,rgba(255,255,255,0.92)));font-size:13px;font-weight:500;letter-spacing:0.01em;' +
          'font-family:system-ui,-apple-system,sans-serif;white-space:nowrap;' +
          'opacity:0;transform:translate(-50%,-46%) scale(0.97);transition:opacity 0.16s ease,transform 0.16s ease;';
        document.body.appendChild(el);
      }
      const r = composer.getBoundingClientRect();
      el.style.left = Math.round(r.left + r.width / 2) + 'px';
      el.style.top = Math.round(r.top / 2) + 'px';
      el.textContent = HINT_TEXT;
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translate(-50%, -50%) scale(1)';
      });
      if (window.__agyEscToastTimer) clearTimeout(window.__agyEscToastTimer);
      window.__agyEscToastTimer = setTimeout(hideToast, 2000);
    };

    window.__agyEscCancelHandler = (e) => {
      if (e.key !== 'Escape' || e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const blocking = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')].some((el) => {
        if ((el.getAttribute('aria-label') || '').startsWith('Typeahead')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      });
      if (blocking) return;
      const composer = document.querySelector('.surface-composer');
      if (!composer) return;
      const btn = composer.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
        [...composer.querySelectorAll('button')].find((b) => /cancel|stop|取消|停止/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-tooltip-id') || '')));
      if (!btn || btn.disabled) {
        hideToast();
        return;
      }
      e.preventDefault();
      const now = Date.now();
      if (now < armedUntil) {
        hideToast();
        btn.click();
      } else {
        armedUntil = now + 2000;
        showToast(composer);
      }
    };
    window.addEventListener('keydown', window.__agyEscCancelHandler, true);
    return 'esc-ok';
  })()`;
}

export function buildEscCancelRemoveJS() {
  return `(() => {
    if (window.__agyEscCancelHandler) {
      window.removeEventListener('keydown', window.__agyEscCancelHandler, true);
      window.__agyEscCancelHandler = null;
    }
    if (window.__agyEscToastTimer) {
      clearTimeout(window.__agyEscToastTimer);
      window.__agyEscToastTimer = null;
    }
    const toast = document.getElementById('agy-esc-toast');
    if (toast) toast.remove();
    return 'esc-removed';
  })()`;
}

export async function applyConfig(rawCfg, logFn = console.log, opts = {}) {
  const cfg = normalizeConfig(rawCfg);
  const tr = t(cfg);
  const parts = [];

  if (cfg.enableWallpaper) {
    if (opts.tolerantWallpaper && !cfg.imagePath) {
      parts.push(buildRemoveJS(WALLPAPER_STYLE_ID));
    } else {
      try {
        const bgUrl = await resolveWallpaperBgUrl(cfg.imagePath, cfg.lang);
        const opacity = normalizeOpacity(cfg.opacity, 0.12);
        const wpCss = `
          body::before {
            content: "";
            position: fixed;
            inset: 0;
            z-index: 99999;
            pointer-events: none;
            background-image: url(${JSON.stringify(bgUrl)});
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            opacity: ${opacity};
          }
        `;
        parts.push(buildInjectJS(WALLPAPER_STYLE_ID, wpCss));
      } catch (err) {
        if (opts.tolerantWallpaper) {
          parts.push(buildRemoveJS(WALLPAPER_STYLE_ID));
        } else {
          throw err;
        }
      }
    }
  } else {
    parts.push(buildRemoveJS(WALLPAPER_STYLE_ID));
  }

  if (cfg.enableInputStyle) {
    parts.push(buildInjectJS(UI_STYLE_ID, CLEAN_INPUT_CSS));
  } else {
    parts.push(buildRemoveJS(UI_STYLE_ID));
  }

  if (cfg.enableStatsBar) {
    const statsPort =
      opts.statsPort ||
      (await resolveStatsPort({ startServer: Boolean(opts.startStatsServer) }));
    parts.push(
      buildStatsBarInjectJS(cfg.lang, cfg.statsClickTarget, cfg.statsBarItems, statsPort)
    );
  } else {
    parts.push(buildStatsBarRemoveJS());
  }

  if (cfg.enableEscCancel) {
    parts.push(buildEscCancelInjectJS(cfg.lang));
  } else {
    parts.push(buildEscCancelRemoveJS());
  }

  const expression = parts.join('; ');
  const targets = await ensureCDPReady(
    logFn,
    opts.launch !== false,
    getCdpPort(cfg),
    cfg.lang
  );
  const pages = targets.filter(isInjectablePage);
  if (pages.length === 0) {
    throw new Error(tr.errNoPages);
  }

  for (const page of pages) {
    await evalOverCDP(page.webSocketDebuggerUrl, expression);
    if (cfg.enableStatsBar) {
      await pushStatsToPage(page.webSocketDebuggerUrl);
    }
  }

  return pages.length;
}
