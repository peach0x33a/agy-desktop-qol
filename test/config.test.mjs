import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeConfig,
  normalizeOpacity,
  normalizePort,
  normalizeStatsBarItems,
  saveConfig,
} from '../src/config.mjs';

test('DEFAULT_CONFIG disables wallpaper by default so fresh installs do not throw', () => {
  assert.equal(DEFAULT_CONFIG.enableWallpaper, false);
  assert.equal(DEFAULT_CONFIG.imagePath, '');
  assert.equal(DEFAULT_CONFIG.enableInputStyle, true);
  assert.equal(DEFAULT_CONFIG.enableStatsBar, true);
  assert.equal(DEFAULT_CONFIG.enableEscCancel, true);
});

test('normalizePort validates integer range 1..65535', () => {
  assert.equal(normalizePort(9222, 9222), 9222);
  assert.equal(normalizePort('9333', 9222), 9333);
  assert.equal(normalizePort(0, 9222), 9222);
  assert.equal(normalizePort(70000, 9222), 9222);
  assert.equal(normalizePort('abc', 9222), 9222);
  assert.equal(normalizePort('', 9222), 9222);
  assert.equal(normalizePort(true, 9222), 9222);
});

test('normalizeOpacity rejects NaN/booleans and clamps to [0, 1]', () => {
  assert.equal(normalizeOpacity(0.25, 0.12), 0.25);
  assert.equal(normalizeOpacity('0', 0.12), 0);
  assert.equal(normalizeOpacity(-0.5, 0.12), 0);
  assert.equal(normalizeOpacity(2.5, 0.12), 1);
  assert.equal(normalizeOpacity('not-a-num', 0.12), 0.12);
  assert.equal(normalizeOpacity(NaN, 0.12), 0.12);
  assert.equal(normalizeOpacity('', 0.12), 0.12);
  assert.equal(normalizeOpacity(false, 0.12), 0.12);
});

test('normalizeStatsBarItems filters and deduplicates valid items', () => {
  assert.deepEqual(normalizeStatsBarItems(['STATUS', 'ttft', 'tokens', 'invalid', 'status']), [
    'status',
    'ttft',
    'tokens',
  ]);
  assert.deepEqual(normalizeStatsBarItems([]), []);
  assert.deepEqual(normalizeStatsBarItems(null), [
    'status',
    'turns',
    'ttft',
    'tokens',
    'context',
  ]);
});

test('saveConfig writes atomically and loadConfig reads normalized values', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-cfg-'));
  const cfgPath = path.join(tmpDir, 'qol-config.json');
  try {
    const saved = saveConfig(
      {
        lang: 'en',
        cdpPort: '9444',
        enableWallpaper: true,
        imagePath: '  /tmp/test.png  ',
        opacity: 'invalid',
        statsBarItems: ['turns', 'context', 'bad'],
      },
      cfgPath
    );
    assert.equal(saved.lang, 'en');
    assert.equal(saved.cdpPort, 9444);
    assert.equal(saved.imagePath, '/tmp/test.png');
    assert.equal(saved.opacity, 0.12);
    assert.deepEqual(saved.statsBarItems, ['turns', 'context']);

    const loaded = loadConfig(cfgPath);
    assert.deepEqual(loaded, saved);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
