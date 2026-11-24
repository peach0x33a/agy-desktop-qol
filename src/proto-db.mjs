import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCdpPort, loadConfig } from './config.mjs';
import { getHostVersion } from './cdp.mjs';

let nodeSqlite = null;
try {
  nodeSqlite = await import('node:sqlite');
} catch {
  // Node < 22.5: 回退为推断上限
}

export function decodeProto(bytes) {
  const out = new Map();
  if (!(bytes instanceof Uint8Array)) return out;
  let o = 0;
  const varint = () => {
    let v = 0n;
    for (let sh = 0n; sh < 70n; sh += 7n) {
      if (o >= bytes.length) throw new Error('eof');
      const b = bytes[o++];
      v |= BigInt(b & 127) << sh;
      if (b < 128) return Number(v);
    }
    throw new Error('varint');
  };
  while (o < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (!field) break;
    if (wire === 0) {
      (out.get(field) || out.set(field, []).get(field)).push(varint());
    } else if (wire === 2) {
      const len = varint();
      if (len < 0 || len > bytes.length - o) break;
      (out.get(field) || out.set(field, []).get(field)).push(bytes.subarray(o, o + len));
      o += len;
    } else if (wire === 1) {
      if (o + 8 > bytes.length) break;
      o += 8;
    } else if (wire === 5) {
      if (o + 4 > bytes.length) break;
      o += 4;
    } else {
      break;
    }
  }
  return out;
}

export function decodeProtoTimestamp(bytes) {
  if (!(bytes instanceof Uint8Array)) return 0;
  try {
    const d = decodeProto(bytes);
    const sec = d.get(1)?.[0];
    const nano = d.get(2)?.[0] || 0;
    return typeof sec === 'number' && sec > 1700000000 ? sec + nano / 1e9 : 0;
  } catch {
    return 0;
  }
}

const KNOWN_PROTO_VERSIONS = ['2.33', '2.34'];
let hostVersionCache = { version: null, at: 0, port: null };

export function refreshHostVersion(cdpPort) {
  const port = cdpPort ?? getCdpPort(loadConfig());
  const now = Date.now();
  const ttl = hostVersionCache.version ? 60000 : 10000;
  if (hostVersionCache.port === port && now - hostVersionCache.at < ttl) return;
  hostVersionCache.at = now;
  hostVersionCache.port = port;
  getHostVersion(port)
    .then((h) => {
      if (h?.version) hostVersionCache.version = h.version;
    })
    .catch(() => {});
}

export function isKnownProtoVersion() {
  const v = hostVersionCache.version;
  return Boolean(v) && KNOWN_PROTO_VERSIONS.includes(v.split('.').slice(0, 2).join('.'));
}

const dbLimitCache = new Map();
const dbTimingCache = new Map();

export function getDbFingerprint(dbPath) {
  try {
    const a = fs.statSync(dbPath);
    let w = { mtimeMs: 0, size: 0 };
    try {
      w = fs.statSync(dbPath + '-wal');
    } catch {
      // no wal
    }
    return `${a.mtimeMs}:${a.size}:${w.mtimeMs}:${w.size}`;
  } catch {
    return null;
  }
}

function getConversationsDir(customDir, homeDir) {
  return customDir || path.join(homeDir || os.homedir(), '.gemini', 'antigravity', 'conversations');
}

// 从 .db 的 steps.metadata 读取精确流式耗时:
// f1=请求开始, f6=首token时间(TTFT结束), f7=生成完成, f9.f3=output_tokens
export function readDbTimingStats(convId, opts = {}) {
  const dbPath = path.join(getConversationsDir(opts.conversationsDir, opts.homeDir), `${convId}.db`);
  // 跨 WSL2 UNC 路径 (\\wsl.localhost\...) 不直接打开 SQLite WAL 数据库，避免跨内核文件锁冲突，直接回退为 transcript 时间戳推算
  if (dbPath.startsWith('\\\\')) return null;
  const fp = getDbFingerprint(dbPath);
  if (!fp || !nodeSqlite) return null;
  const hit = dbTimingCache.get(convId);
  if (hit && hit.fp === fp) return hit.val;

  let val = null;
  let querySucceeded = false;
  let db;
  try {
    db = new nodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 100;');
    } catch {
      // ignore if unsupported
    }
    const rows = db.prepare('SELECT metadata FROM steps WHERE step_type = 15 AND status = 3').all();
    let validSteps = 0;
    let modelSecTotal = 0;
    let tpsOut = 0;
    let tpsSec = 0;
    for (const row of rows) {
      if (!(row?.metadata instanceof Uint8Array)) continue;
      const d = decodeProto(row.metadata);
      const t1 = decodeProtoTimestamp(d.get(1)?.[0]);
      const t6 = decodeProtoTimestamp(d.get(6)?.[0]);
      const t7 = decodeProtoTimestamp(d.get(7)?.[0]);
      const f9 = d.get(9)?.[0];
      const out = f9 instanceof Uint8Array ? decodeProto(f9).get(3)?.[0] || 0 : 0;
      if (!t1 || !t7 || t7 <= t1 || t7 - t1 >= 600 || out <= 0 || out >= 1000000) continue;
      validSteps++;
      modelSecTotal += t7 - t1;
      if (t6 >= t1 && t7 > t6 && t7 - t6 >= 0.5 && out >= 100) {
        tpsOut += out;
        tpsSec += t7 - t6;
      }
    }
    if (validSteps > 0) {
      val = {
        hasData: true,
        tps: tpsSec > 0 ? Math.round(tpsOut / tpsSec) : 0,
        modelMs: Math.round(modelSecTotal * 1000),
      };
    }
    querySucceeded = true;
  } catch {
    // 数据库被锁 (SQLITE_BUSY) 或临时错误: 不写入缓存，避免污染后续轮询
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
  if (querySucceeded) {
    dbTimingCache.set(convId, { fp, val });
    if (dbTimingCache.size > 100) dbTimingCache.delete(dbTimingCache.keys().next().value);
  }
  return val;
}

export function readDbMaxTokenLimit(convId, opts = {}) {
  refreshHostVersion(opts.cdpPort);
  const known = isKnownProtoVersion();
  const dbPath = path.join(getConversationsDir(opts.conversationsDir, opts.homeDir), `${convId}.db`);
  if (dbPath.startsWith('\\\\')) return 0;
  const fp = getDbFingerprint(dbPath);
  if (!fp || !nodeSqlite) return 0;
  const hit = dbLimitCache.get(convId);
  if (hit && hit.fp === fp && hit.known === known) return hit.limit;

  let limit = 0;
  let querySucceeded = false;
  let db;
  try {
    db = new nodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 100;');
    } catch {
      // ignore
    }
    const row = db.prepare('SELECT data FROM executor_metadata ORDER BY rowid DESC LIMIT 1').get();
    if (row && row.data instanceof Uint8Array) {
      // 路径: 根字段 10 -> 嵌套字段 2 -> varint 字段 5 (与官方 context 插件一致)
      const f10 = decodeProto(row.data).get(10)?.[0];
      const f2 = f10 instanceof Uint8Array ? decodeProto(f10).get(2)?.[0] : null;
      const v = f2 instanceof Uint8Array ? decodeProto(f2).get(5)?.[0] : 0;
      if (typeof v === 'number' && v > 0 && (known || (v >= 32768 && v <= 20000000))) {
        limit = v;
      }
    }
    querySucceeded = true;
  } catch {
    // 数据库被锁 (SQLITE_BUSY) 或结构变化: 不缓存临时失败
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
  if (querySucceeded) {
    dbLimitCache.set(convId, { fp, limit, known });
    if (dbLimitCache.size > 100) dbLimitCache.delete(dbLimitCache.keys().next().value);
  }
  return limit;
}
