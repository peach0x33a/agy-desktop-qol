import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ESC_CANCEL_VERSION, UI_STYLE_VERSION } from '../src/config.mjs';
import { isInjectablePage } from '../src/cdp.mjs';
import {
  CLEAN_INPUT_CSS,
  buildEscCancelInjectJS,
  buildEscCancelRemoveJS,
  buildInjectJS,
  buildRemoveJS,
  buildStatsBarInjectJS,
  buildStatsBarRemoveJS,
} from '../src/inject.mjs';
import {
  createStatsRequestHandler,
  verifyStatsToken,
} from '../src/stats-server.mjs';
import {
  expandHomePath,
  resolveWallpaperBgUrl,
} from '../src/wallpaper.mjs';
import { buildNeedInjectExpression } from '../src/watch.mjs';

test('verifyStatsToken uses constant-time comparison and rejects mismatched lengths', () => {
  const tok = 'a'.repeat(48);
  assert.equal(verifyStatsToken(tok, tok), true);
  assert.equal(verifyStatsToken('b'.repeat(48), tok), false);
  assert.equal(verifyStatsToken('short', tok), false);
  assert.equal(verifyStatsToken('', tok), false);
  assert.equal(verifyStatsToken(null, tok), false);
});

test('createStatsRequestHandler handles OPTIONS, X-QoL-Token auth, /health, and malformed URLs safely', async () => {
  const token = '0123456789abcdef0123456789abcdef0123456789abcdef';
  const handler = createStatsRequestHandler({
    getToken: () => token,
    getPort: () => 9223,
    computeStats: (id) => ({
      turns: 3,
      steps: 7,
      totalTokens: 12000,
      outputTokens: 1500,
      cacheHitRate: 75,
      tps: 42,
      id,
    }),
  });

  // Direct unit check with malformed req.url that throws in new URL()
  let statusCode = 0;
  let body = '';
  handler(
    {
      method: 'GET',
      url: 'http://[::1',
      headers: {},
    },
    {
      headersSent: false,
      setHeader() {},
      get statusCode() {
        return statusCode;
      },
      set statusCode(v) {
        statusCode = v;
      },
      end(chunk = '') {
        body = chunk;
      },
    }
  );
  assert.equal(statusCode, 400);
  assert.equal(body, '{}');

  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    // 1. OPTIONS preflight
    const optRes = await fetch(`http://127.0.0.1:${port}/stats`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    assert.equal(optRes.status, 204);
    assert.equal(optRes.headers.get('access-control-allow-headers'), 'X-QoL-Token');
    assert.equal(optRes.headers.get('access-control-allow-private-network'), 'true');

    // 2. Unauthorized GET /stats
    const unauthRes = await fetch(`http://127.0.0.1:${port}/stats?id=conv1`);
    assert.equal(unauthRes.status, 403);

    // 3. Authorized GET /health via X-QoL-Token header
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'X-QoL-Token': token },
    });
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.service, 'agy-desktop-qol');

    // 4. Authorized GET /stats via X-QoL-Token header
    const statsRes = await fetch(`http://127.0.0.1:${port}/stats?id=conv1`, {
      headers: { 'X-QoL-Token': token },
    });
    assert.equal(statsRes.status, 200);
    const statsJson = await statsRes.json();
    assert.equal(statsJson.turns, 3);
    assert.equal(statsJson.tps, 42);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('isInjectablePage filters out devtools, extensions, and data URLs', () => {
  assert.equal(
    isInjectablePage({
      type: 'page',
      url: 'http://127.0.0.1:5000/c/123',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    }),
    true
  );
  assert.equal(
    isInjectablePage({
      type: 'page',
      url: 'devtools://devtools/bundled/inspector.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/2',
    }),
    false
  );
  assert.equal(
    isInjectablePage({
      type: 'page',
      url: 'data:text/html,hello',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/3',
    }),
    false
  );
});

test('expandHomePath and resolveWallpaperBgUrl validate local and remote images properly', async () => {
  assert.equal(expandHomePath('~/test.png'), path.join(os.homedir(), 'test.png'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-wp-'));
  const imgFile = path.join(tmpDir, 'tiny.png');
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex'
  );
  fs.writeFileSync(imgFile, pngBytes);

  const server = http.createServer((req, res) => {
    if (req.url === '/ok.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(pngBytes);
      return;
    }
    if (req.url === '/huge.png') {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', String(20 * 1024 * 1024));
      res.end(pngBytes);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const localDataUrl = await resolveWallpaperBgUrl(imgFile, 'en');
    assert.ok(localDataUrl.startsWith('data:image/png;base64,'));

    const remoteDataUrl = await resolveWallpaperBgUrl(`http://127.0.0.1:${port}/ok.png`, 'en');
    assert.equal(remoteDataUrl, localDataUrl);

    // Oversized remote image must throw instead of silently falling back to raw URL
    await assert.rejects(
      () => resolveWallpaperBgUrl(`http://127.0.0.1:${port}/huge.png`, 'en'),
      /10MB/
    );

    // HTTP 404 must throw instead of silently falling back
    await assert.rejects(
      () => resolveWallpaperBgUrl(`http://127.0.0.1:${port}/missing.png`, 'en'),
      /HTTP 404/
    );
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('injected scripts include key repeat guard, res.ok check, X-QoL-Token header, and port tracking', () => {
  const escJs = buildEscCancelInjectJS('en');
  assert.ok(escJs.includes('e.repeat'));
  assert.ok(escJs.includes(`window.__agyEscCancelVersion = ${ESC_CANCEL_VERSION}`));
  assert.ok(buildEscCancelRemoveJS().includes('window.__agyEscCancelVersion = null'));
  assert.ok(escJs.includes('[role="alertdialog"]'));
  assert.ok(escJs.includes('.agy-overlay'));
  assert.ok(escJs.includes('[data-select-popup]'));
  assert.ok(escJs.includes('[data-hover-card-popup]'));
  assert.ok(escJs.includes('[data-bottom-sheet-popup]:not([data-closed])'));
  assert.ok(escJs.includes('button[data-testid="input-cancel-button"]'));
  assert.ok(!escJs.includes('[data-base-ui-portal]'));

  assert.ok(CLEAN_INPUT_CSS.includes('.surface-composer > .surface-composer-card'));
  assert.ok(CLEAN_INPUT_CSS.includes('border: 0 !important;'));
  assert.ok(
    CLEAN_INPUT_CSS.includes(
      '.surface-composer > :not(.surface-composer-card, .voice-glow-ring, [hidden], [class*="grid-rows-[0fr]"]) ~ .surface-composer-card'
    )
  );
  assert.ok(CLEAN_INPUT_CSS.includes('.surface-composer:focus-within'));
  assert.ok(CLEAN_INPUT_CSS.includes('.agy-overlay'));
  assert.ok(CLEAN_INPUT_CSS.includes('[role="alertdialog"]'));
  assert.ok(CLEAN_INPUT_CSS.includes('[data-select-popup]'));
  assert.ok(CLEAN_INPUT_CSS.includes('[data-hover-card-popup]'));
  assert.ok(CLEAN_INPUT_CSS.includes('[data-peek-surface]::after'));
  assert.ok(CLEAN_INPUT_CSS.includes('tiling-splitter'));
  assert.ok(
    CLEAN_INPUT_CSS.includes(
      '.agy-sheet[data-side-panel-docked] [data-side-panel-strip]:not([data-active-tab-id="newTab__empty"])::before'
    )
  );
  assert.ok(CLEAN_INPUT_CSS.includes('data-has-browser-hole="true"'));
  assert.ok(!CLEAN_INPUT_CSS.includes('media-modal-header'));

  const statsJs = buildStatsBarInjectJS(
    'zh',
    'sidecar__context/context_panel__/',
    ['status', 'turns', 'ttft'],
    9555,
    'secret_tok'
  );
  assert.ok(statsJs.includes('window.__agyStatsPort = STATS_PORT'));
  assert.ok(statsJs.includes('window.__agyRenderStats = (convId, d) =>'));
  assert.ok(statsJs.includes("'X-QoL-Token': STATS_TOKEN"));
  assert.ok(!statsJs.includes('?t='));
  assert.ok(statsJs.includes('if (!res.ok)'));
  assert.ok(statsJs.includes('summary.dataset.lastHtml !== nextSummaryHtml'));
  assert.ok(statsJs.includes('formatTtft(d.lastTtftMs)'));
  assert.ok(statsJs.includes('formatTtft(d.avgTtftMs)'));
  assert.ok(statsJs.includes('sidePanelV2/setContent'));
  assert.ok(statsJs.includes('sidePanel/setSidePanelOpen'));

  const uiInjectJs = buildInjectJS('agy-clean-ui', CLEAN_INPUT_CSS, UI_STYLE_VERSION);
  assert.ok(uiInjectJs.includes(`el.dataset.agyVersion = "${UI_STYLE_VERSION}"`));

  // All generated browser scripts must parse as valid JS
  for (const snippet of [
    escJs,
    buildEscCancelRemoveJS(),
    statsJs,
    buildStatsBarRemoveJS(),
    uiInjectJs,
    buildRemoveJS('agy-clean-ui'),
  ]) {
    assert.doesNotThrow(() => new Function(`return ${snippet};`));
  }

  // Watch expression skips wallpaper check when imagePath is empty
  const exprEmptyWp = buildNeedInjectExpression(
    {
      enableWallpaper: true,
      imagePath: '',
      enableInputStyle: true,
      enableStatsBar: true,
      enableEscCancel: true,
    },
    9555
  );
  assert.equal(exprEmptyWp.includes('agy-custom-wallpaper'), false);
  assert.equal(exprEmptyWp.includes('window.__agyStatsPort !== 9555'), true);
  assert.equal(
    exprEmptyWp.includes(`dataset?.agyVersion || 0) < ${UI_STYLE_VERSION}`),
    true
  );
  assert.equal(
    exprEmptyWp.includes(`Number(window.__agyEscCancelVersion || 0) < ${ESC_CANCEL_VERSION}`),
    true
  );
});
