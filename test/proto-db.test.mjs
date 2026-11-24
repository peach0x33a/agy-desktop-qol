import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  KNOWN_PROTO_VERSIONS,
  decodeProto,
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
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
