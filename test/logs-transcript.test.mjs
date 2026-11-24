import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getLanguageServerLogPath,
  inspectLanguageServerLogText,
  parseGlogTimestamp,
  readLogTail,
} from '../src/logs.mjs';
import {
  clearTranscriptCache,
  computeConversationStats,
  inferContextLimit,
  readTranscriptIncremental,
} from '../src/transcript.mjs';

test('parseGlogTimestamp handles year rollover across Dec 31 -> Jan 1', () => {
  const jan1 = new Date(2027, 0, 1, 0, 5, 0, 0);
  const ts = parseGlogTimestamp('I1231 23:58:10.500000 12345 run.go:10] msg', jan1);
  assert.ok(ts);
  const parsed = new Date(ts);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 11);
  assert.equal(parsed.getDate(), 31);
});

test('readLogTail drops partial first line when reading from non-zero offset', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-log-'));
  const file = path.join(tmpDir, 'language_server.log');
  try {
    fs.writeFileSync(file, 'FIRST_LINE_PARTIAL_1234567890\nSECOND_LINE_COMPLETE\nTHIRD_LINE\n');
    const tail = readLogTail(file, 35);
    assert.equal(tail.includes('FIRST_LINE'), false);
    assert.equal(tail, 'SECOND_LINE_COMPLETE\nTHIRD_LINE\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('inspectLanguageServerLogText clears retryInfo once a newer streamGenerateContent request starts', () => {
  const now = new Date(2026, 10, 21, 10, 0, 10, 0).getTime();
  const since = new Date(2026, 10, 21, 10, 0, 0, 0).getTime();
  const log = [
    'W1121 10:00:02.000000 1 run.go:100] Run: attempt 1 failed (status code 503: no capacity available), retrying in 2s',
    'I1121 10:00:05.000000 1 http_helpers.go:50] URL: https://generativelanguage.googleapis.com/v1main/models:streamGenerateContent?alt=sse',
  ].join('\n');

  const res = inspectLanguageServerLogText(log, since, now);
  assert.equal(res.requestSent, true);
  assert.equal(res.retryInfo, null);
});

test('readTranscriptIncremental preserves lastContextTokens on zero-token step and avoids same-ms GENERIC timing leak', () => {
  clearTranscriptCache();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-tr-'));
  const convId = 'conv_test_1';
  const logDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'transcript.jsonl');

  try {
    const lines = [
      JSON.stringify({
        type: 'USER_INPUT',
        created_at: '2026-11-21T10:00:00.000Z',
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-21T10:00:01.000Z',
        model: 'gemini-2.5-pro',
        input_tokens: 1000,
        cache_read_tokens: 4000,
        output_tokens: 200,
        tool_calls: [{ name: 'run_command' }, { name: 'read_file' }],
      }),
      // First GENERIC has identical timestamp to PLANNER_RESPONSE
      JSON.stringify({
        type: 'GENERIC',
        created_at: '2026-11-21T10:00:01.000Z',
      }),
      // Second GENERIC arrives 10s later (after first tool finished executing)
      JSON.stringify({
        type: 'GENERIC',
        created_at: '2026-11-21T10:00:11.000Z',
      }),
      // Empty / zero-token PLANNER_RESPONSE should not wipe lastContextTokens
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-21T10:00:12.000Z',
        input_tokens: 0,
        cache_read_tokens: 0,
        output_tokens: 0,
        status: 'DONE',
      }),
    ];
    fs.writeFileSync(logPath, lines.join('\n') + '\n');

    const st = readTranscriptIncremental(convId, logPath);
    assert.equal(st.turns, 1);
    assert.equal(st.steps, 2);
    assert.equal(st.lastContextTokens, 5200);
    // Same-ms first GENERIC cleared pendingTs, so the 10s tool duration was NOT added to modelMs
    assert.equal(st.modelMs, 0);

    const stats = computeConversationStats(convId, {
      brainDir: tmpDir,
      conversationsDir: tmpDir,
      nowMs: Date.parse('2026-11-21T10:00:15.000Z'),
    });
    assert.equal(stats.lastContextTokens, 5200);
    assert.equal(stats.cacheHitRate, 80);
    assert.equal(stats.live.phase, 'idle');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeConversationStats expires old ERROR_MESSAGE steps back to idle after 120s', () => {
  clearTranscriptCache();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-err-'));
  const convId = 'conv_err_1';
  const logDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'transcript.jsonl');

  try {
    fs.writeFileSync(
      logPath,
      JSON.stringify({
        type: 'ERROR_MESSAGE',
        created_at: '2026-11-21T10:00:00.000Z',
        error: 'code 503: no capacity',
      }) + '\n'
    );

    const recent = computeConversationStats(convId, {
      brainDir: tmpDir,
      conversationsDir: tmpDir,
      lsLogPath: path.join(tmpDir, 'nonexistent.log'),
      nowMs: Date.parse('2026-11-21T10:00:10.000Z'),
    });
    assert.equal(recent.live.phase, 'error');
    assert.equal(recent.live.noCapacity, true);

    const stale = computeConversationStats(convId, {
      brainDir: tmpDir,
      conversationsDir: tmpDir,
      lsLogPath: path.join(tmpDir, 'nonexistent.log'),
      nowMs: Date.parse('2026-11-21T10:05:00.000Z'),
    });
    assert.equal(stale.live.phase, 'idle');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getLanguageServerLogPath discovers newest remote server ls-*.log in .antigravity-hub-server/data', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-hub-'));
  const hubData = path.join(tmpHome, '.antigravity-hub-server', 'data');
  fs.mkdirSync(hubData, { recursive: true });
  const olderLog = path.join(hubData, 'ls-old.log');
  const newerLog = path.join(hubData, 'ls-new.log');
  try {
    fs.writeFileSync(olderLog, 'old');
    fs.writeFileSync(newerLog, 'new');
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(olderLog, past, past);
    assert.equal(getLanguageServerLogPath(tmpHome), newerLog);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('CHECKPOINT immediately drops lastContextTokens and lastCacheHitRate tracks latest turn', () => {
  clearTranscriptCache();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-cp-'));
  const convId = 'conv-checkpoint-test';
  const logsDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const trPath = path.join(logsDir, 'transcript.jsonl');

  try {
    const lines = [
      JSON.stringify({
        type: 'USER_INPUT',
        created_at: '2026-11-24T10:00:00.000Z',
        content: 'hello',
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-24T10:00:01.000Z',
        model: 'gemini-4-neon-medium',
        input_tokens: 10000,
        cache_read_tokens: 0,
        output_tokens: 500,
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-24T10:00:05.000Z',
        model: 'gemini-4-neon-medium',
        input_tokens: 1000,
        cache_read_tokens: 9000,
        output_tokens: 500,
      }),
      JSON.stringify({
        type: 'CHECKPOINT',
        created_at: '2026-11-24T10:00:10.000Z',
        output_tokens: 1200,
        content: 'summary',
      }),
    ];
    fs.writeFileSync(trPath, lines.join('\n') + '\n', 'utf8');

    const stats = computeConversationStats(convId, {
      brainDir: tmpDir,
      conversationsDir: tmpDir,
      lsLogPath: path.join(tmpDir, 'nonexistent.log'),
      nowMs: Date.parse('2026-11-24T10:00:15.000Z'),
    });
    assert.equal(stats.lastContextTokens, 1200);
    assert.equal(stats.cacheHitRate, 45);
    assert.equal(stats.lastCacheHitRate, 90);
    assert.equal(stats.maxContext, 512000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('inferContextLimit fallback matches Antigravity 2.34 model limits before executor_metadata is written', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-lim-'));
  try {
    assert.equal(inferContextLimit('gemini-4-neon-medium', 'missing-conv', { conversationsDir: tmpDir }), 512000);
    assert.equal(inferContextLimit('claude-sonnet-5-5-low', 'missing-conv', { conversationsDir: tmpDir }), 840000);
    assert.equal(inferContextLimit('gpt-oss-120b-medium', 'missing-conv', { conversationsDir: tmpDir }), 131072);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
