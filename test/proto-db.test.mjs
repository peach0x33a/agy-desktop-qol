import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  KNOWN_PROTO_VERSIONS,
  decodeProto,
  decodeProtoDuration,
  decodeProtoTimestamp,
  readDbMaxTokenLimit,
  readDbTimingStats,
} from '../src/proto-db.mjs';

function encodeVarint(num) {
  const bytes = [];
  let v = BigInt(num);
  while (v >= 128n) {
    bytes.push(Number((v & 127n) | 128n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function encodeTag(field, wire) {
  return encodeVarint(field * 8 + wire);
}

function encodeBytesField(field, buf) {
  return Buffer.concat([encodeTag(field, 2), encodeVarint(buf.length), buf]);
}

function encodeVarintField(field, val) {
  return Buffer.concat([encodeTag(field, 0), encodeVarint(val)]);
}

function encodeTimestamp(sec, nano = 0) {
  return Buffer.concat([encodeVarintField(1, sec), encodeVarintField(2, nano)]);
}

test('decodeProto and decodeProtoTimestamp decode nested protobuf messages', () => {
  assert.ok(KNOWN_PROTO_VERSIONS.includes('2.35'));
  const tsBuf = encodeTimestamp(1760000000, 500000000);
  const ts = decodeProtoTimestamp(tsBuf);
  assert.equal(ts, 1760000000.5);

  // Sub-second proto3 Duration omits field 1 (seconds = 0)
  const subSecDur = encodeVarintField(2, 250000000);
  assert.equal(decodeProtoDuration(subSecDur), 0.25);

  // root.f10.f2.f5 = 1048576
  const f2 = encodeVarintField(5, 1048576);
  const f10 = encodeBytesField(2, f2);
  const root = encodeBytesField(10, f10);

  const decoded = decodeProto(root);
  const inner10 = decodeProto(decoded.get(10)[0]);
  const inner2 = decodeProto(inner10.get(2)[0]);
  assert.equal(inner2.get(5)[0], 1048576);
});

test('readDbMaxTokenLimit and readDbTimingStats read SQLite conversation db accurately', async (t) => {
  let nodeSqlite;
  try {
    nodeSqlite = await import('node:sqlite');
  } catch {
    t.skip('node:sqlite not available');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-db-'));
  const convId = 'conv_sqlite_1';
  const dbPath = path.join(tmpDir, `${convId}.db`);

  try {
    const db = new nodeSqlite.DatabaseSync(dbPath);
    db.exec('CREATE TABLE executor_metadata (data BLOB);');
    db.exec('CREATE TABLE steps (step_type INTEGER, status INTEGER, metadata BLOB);');

    // Insert max_token_limit = 512000 at f10.f2.f5
    const metaBlob = encodeBytesField(10, encodeBytesField(2, encodeVarintField(5, 512000)));
    db.prepare('INSERT INTO executor_metadata (data) VALUES (?)').run(metaBlob);

    // Insert step timing: t1=1760000000, t6=1760000001, t7=1760000005 (4s stream), out=200 -> 50 tok/s, 5000ms total
    const stepBlob = Buffer.concat([
      encodeBytesField(1, encodeTimestamp(1760000000, 0)),
      encodeBytesField(6, encodeTimestamp(1760000001, 0)),
      encodeBytesField(7, encodeTimestamp(1760000005, 0)),
      encodeBytesField(9, encodeVarintField(3, 200)),
    ]);
    db.prepare('INSERT INTO steps (step_type, status, metadata) VALUES (15, 3, ?)').run(stepBlob);
    db.close();

    const limit = readDbMaxTokenLimit(convId, { conversationsDir: tmpDir });
    assert.equal(limit, 512000);

    const timing = readDbTimingStats(convId, { conversationsDir: tmpDir });
    assert.deepEqual(timing, {
      hasData: true,
      tps: 50,
      modelMs: 5000,
      lastTtftMs: 1000,
      avgTtftMs: 1000,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readDbTimingStats prefers gen_metadata Duration and excludes retried steps from TTFT', async (t) => {
  let nodeSqlite;
  try {
    nodeSqlite = await import('node:sqlite');
  } catch {
    t.skip('node:sqlite not available');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qol-db-gen-'));
  const convId = 'conv_sqlite_gen';
  const dbPath = path.join(tmpDir, `${convId}.db`);

  try {
    const db = new nodeSqlite.DatabaseSync(dbPath);
    db.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);');
    db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB);');

    const insertGenAndStep = (stepIdx, genIdx, t1, t6, t7, d11Sec, d11Nano, retryCount) => {
      const genInner = Buffer.concat([
        encodeBytesField(11, encodeTimestamp(d11Sec, d11Nano)),
        ...(retryCount > 0 ? [encodeVarintField(14, retryCount)] : []),
      ]);
      db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
        genIdx,
        encodeBytesField(1, genInner)
      );
      const f20 = Buffer.concat([
        encodeVarintField(2, stepIdx),
        ...(genIdx > 0 ? [encodeVarintField(3, genIdx)] : []),
      ]);
      const stepBlob = Buffer.concat([
        encodeBytesField(1, encodeTimestamp(t1, 0)),
        encodeBytesField(6, encodeTimestamp(t6, 0)),
        encodeBytesField(7, encodeTimestamp(t7, 0)),
        encodeBytesField(9, encodeVarintField(3, 200)),
        encodeBytesField(20, f20),
      ]);
      db.prepare('INSERT INTO steps (idx, step_type, status, metadata) VALUES (?, 15, 3, ?)').run(
        stepIdx,
        stepBlob
      );
    };

    // Step 1 (gen 0): clean TTFT = 2.4s
    insertGenAndStep(1, 0, 1760000000, 1760000002, 1760000006, 2, 400000000, 0);
    // Step 4 (gen 1): clean TTFT = 3.6s
    insertGenAndStep(4, 1, 1760000010, 1760000014, 1760000018, 3, 600000000, 0);
    // Step 7 (gen 2): retried 3 times (45s total wait) -> excluded from clean TTFT
    insertGenAndStep(7, 2, 1760000020, 1760000065, 1760000070, 45, 0, 3);
    db.close();

    const timing = readDbTimingStats(convId, { conversationsDir: tmpDir });
    assert.equal(timing.lastTtftMs, 3600);
    assert.equal(timing.avgTtftMs, 3000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
